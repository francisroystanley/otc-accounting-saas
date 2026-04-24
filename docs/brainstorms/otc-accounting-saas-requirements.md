---
date: 2026-04-21
topic: otc-accounting-saas-prototype
---

# OTC Accounting SaaS Prototype

## Problem Frame

OTC (Own The Climb) is in active sales conversations with accounting firms and needs a working demo that showcases the value of AI-assisted tax-document data entry. Accountants currently waste hours keying figures off K-1s, 1099s, and W-2s into spreadsheets. The demo must let an accountant drag in a stack of PDFs, watch the system extract structured data via Gemini, review and correct it, and export to CSV. Evaluation happens on a hard deadline of **Friday 2026-04-24 15:00 EDT** — roughly three working days from kickoff.

A working deployed URL with strict multi-tenant isolation, real async processing, and polish that makes it feel like a product (not a prototype) is the artifact that accelerates those sales conversations.

## Pipeline Flow

```
┌──────────┐  1. sign       ┌──────────────┐
│ Browser  │───────────────▶│ /api/upload/ │  scoped signed upload URL
│ (dropzone│◀───────────────│ sign         │  (per file, short TTL)
└────┬─────┘                └──────────────┘
     │ 2. PUT bytes direct to Supabase Storage (bypasses Vercel body limit)
     ▼
┌──────────────┐  3. finalize  ┌──────────────┐  insert row   ┌───────────┐
│   Storage    │──────────────▶│ /api/upload/ │──────────────▶│  Postgres │
│ (workspace/  │               │ finalize     │   status=     │ documents │
│  prefixed)   │               └──────┬───────┘   'pending'   └─────┬─────┘
└──────────────┘                      │                             │
      ▲                               │ qstash.publish              │
      │ Realtime postgres_changes     ▼                             │
      │ (Realtime RLS enforced)  ┌──────────────┐                   │
      │                          │  Upstash     │                   │
      │                          │  QStash      │                   │
      │                          └──────┬───────┘                   │
      │                                 │ POST /api/extract         │
      │                                 ▼                           │
      │                          ┌──────────────┐                   │
      │                          │ /api/extract │ conditional       │
      │                          │ (signed +    │ UPDATE: pending   │
      │                          │  idempotent) │ → processing      │
      │                          └──────┬───────┘                   │
      │                                 │ fetch bytes (service role)│
      │                                 ▼                           │
      │                                Gemini ─▶ update row ────────┘
      │                                         (complete / failed)
      └────────────── status transitions stream to Browser ──────────
```

## Requirements

**Authentication and Tenancy**

- R1. Users sign up and log in with email + password via Supabase Auth; email verification is required for new signups.
- R2. On first signup, the system auto-creates a personal workspace and adds the user as the workspace's sole owner.
- R3. All tenant data tables are scoped by `workspace_id` with RLS policies that only permit access to rows where the current user is a member of the workspace.
- R4. Two seeded test accounts ship at delivery: one populated with sample extracted documents, one empty. Both are pre-verified so the reviewer can log in without clicking a confirmation email. Running the two accounts side by side must produce fully isolated data views. The seed script (`scripts/seed-demo.ts`) uses the service-role client to create verified users (`email_confirm: true`), upload sample PDFs directly to Storage under the `<workspace_id>/<document_id>.pdf` prefix (satisfying R7 and R6 constraints manually in the script), insert `documents` rows, and invoke `src/lib/extraction/gemini.ts` inline (bypassing QStash) — then writes results through the `update_extraction_result` function (R28f) so the seed path exercises the same write boundary as production.

**Document Upload**

- R5. Authenticated users can drag and drop multiple PDFs at once on an upload surface.
- R6. Per-file cap **10 MB**, per-batch cap **10 files**. Client-side validates PDF extension/MIME and size before requesting an upload URL; server-side `/api/upload/finalize` re-verifies size + magic bytes (first 4 bytes = `%PDF`) against the uploaded Storage object and rejects mismatches. Violations surface a specific, human-readable error per file; valid files in a partially-invalid batch still proceed.
- R7. Uploads go **direct from the browser to Supabase Storage** via scoped signed upload URLs minted by `/api/upload/sign` (necessary because Vercel serverless functions cap request bodies at ~4.5 MB). Objects are written under the path prefix `<workspace_id>/<document_id>.pdf` with `contentType='application/pdf'` and `contentDisposition='inline'` (so the iframe preview renders inline across browsers).
- R8. After the browser confirms the Storage upload, it calls `/api/upload/finalize` which inserts the `documents` row with `status = 'pending'` and enqueues the extraction job on QStash. The finalize request returns as soon as the row is persisted and the job is published.

**Async Extraction Pipeline**

- R9. Each pending document is enqueued on Upstash QStash targeting a protected `/api/extract` endpoint. Messages are published to a **named queue** `extract-queue` with `parallelism: 2` (kept well under Gemini Flash's current free-tier rate ceiling of ~10–15 req/min — worth verifying empirically on Day 1). Queue setup is an idempotent `npm run qstash:setup` script the developer runs once after provisioning — it calls `queue.upsert({ queueName, parallelism })` against `QSTASH_TOKEN` from `.env.local`, logs a warning on transient failures, and is re-runnable. If Upstash has deprecated `parallelism` on named queues in favor of Flow-Control by delivery time, the script falls back to publishing with `flowControl: { parallelism: 2, key: 'extract' }` on every `publishJSON` call. Unqueued `publishJSON` without flow-control is forbidden.
- R10. `/api/extract` verifies the QStash signature on every request and rejects unauthenticated calls. It also looks up the `document_id` from the payload and confirms the row (a) exists, (b) has a valid `workspace_id` (UUID, per R28e), and (c) the `workspace_id` in the DB row matches the workspace prefix in the Storage path it is about to read. Existence alone is not sufficient — a signature-verified but forged payload pointing at another workspace's document_id must be rejected before any Storage fetch.
- R11. The endpoint performs an **idempotent conditional update** `UPDATE documents SET status='processing' WHERE id=? AND status='pending'`; if zero rows change, the row is already past the `pending` state — the handler returns 200 without calling Gemini (treats all of duplicate-delivery, already-processing, already-complete, already-failed, already-needs_review as no-ops). Rationale: QStash's own 3-retry policy is exhausted before a row reaches `failed`, so "already-failed" is terminal by the time we see another delivery; re-extraction of a terminal-state document is not supported in initial scope and would require an explicit admin reset to `pending` (out of scope). On a successful claim, the PDF **bytes are fetched from Storage via the service-role client and passed inline** to Gemini 2.5 Flash with a structured `responseSchema` (never a URL Gemini fetches itself — eliminates SSRF surface). The Gemini call itself lives in `src/lib/extraction/gemini.ts`, which exports `extractFromPdfBytes(bytes: Uint8Array): Promise<ExtractionResult>` — this single module is consumed by `/api/extract`, the seed script's inline extraction, and the `npm run extract:report` fixture harness so all three paths exercise identical prompt, `responseSchema`, and Zod validation. On a successful extraction, the endpoint writes `extracted_data` and sets `status = 'complete'` (or `status = 'needs_review'` when Gemini returned `doc_type = 'unknown'` or the doc-type classification confidence was below the configured threshold — see R14).
- R12. On failure, the row is set to `status = 'failed'` with a user-visible `error_message`. QStash's built-in retry policy (up to 3 attempts with exponential backoff) handles transient failures (5xx, Gemini 429s, timeouts) before the row is finalized as failed. All row writes in `/api/extract` are performed via the `update_extraction_result` SECURITY DEFINER function (see R28f for hardening) so the service-role blast radius is confined to that one operation.
- R13. Four document types are supported **conditionally**: **W-2**, **1099-NEC**, **1099-MISC**, and **Schedule K-1 (Form 1065)**. W-2, 1099-NEC, and 1099-MISC are in initial scope unconditionally; K-1 is included if Day-1 fixture validation reaches ≥ 80% accuracy after at most 2 schema iterations, otherwise K-1 is dropped and the zip export + fixtures reduce accordingly. Each included type has its own IRS-standard field schema. Gemini returns a per-field confidence score (0.0–1.0) in the structured output; the score is persisted alongside each field value in `extracted_data`. A separate `doc_type_confidence` is also persisted — see R14.
- R13a. **Confidence is surfaced in the UI.** On the document detail page, fields with `confidence < CONFIDENCE_THRESHOLD` render a small colored dot next to the input, with a tooltip showing the raw score. The badge is **removed immediately the first time the user edits the field** (one-way latch — the dirty-state is persisted via an `edited_fields` boolean map alongside `extracted_data`; reverting to the original value does not restore the badge). On the dashboard row, a chip shows the count of low-confidence unedited fields (e.g., "3 to review") when any exist; the chip is absent when all fields are high-confidence or edited. The chip occupies a fixed-width column positioned immediately after the status column in the dashboard table. `CONFIDENCE_THRESHOLD` is a config constant with default `0.85` (`DOC_TYPE_THRESHOLD` default `0.70` in R14); the fixture report (`EXTRACTION_REPORT.md`) records precision/recall at several thresholds so the defaults can be revised on evidence after Day 1. If tuning produces materially different values, both the constants in code and this document are updated before submission; `EXTRACTION_REPORT.md` is the authoritative calibration record.
- R13b. **"Next uncertain" jump button.** On the detail-view edit form, a small "Next uncertain" button at the top of the form (also triggered by `Alt+N` for keyboard users) imperatively focuses and scrolls to the next low-confidence unedited field, wrapping from the last back to the first. Native `Tab` order is left alone — rewriting the tab ring dynamically was ruled out as high cost (dynamic `tabindex` management, accessibility regressions for screen-reader users) with little demo-legible payoff since Tab-skipping is invisible on screen. The button carries the workflow value ("take me to what needs my eyes") without the complexity. This turns the confidence UI from a warning light into a workflow and is the mechanism that makes the W-2/1099 success criterion (see below) achievable in practice.
- R14. The document status machine is `pending → processing → complete | failed | needs_review`. A document lands in `needs_review` when Gemini returns `doc_type = 'unknown'` **or** when `doc_type_confidence < DOC_TYPE_THRESHOLD` — this catches the common failure mode where Gemini confidently picks the wrong type. `needs_review` rows have no `extracted_data`. On the detail view, a `needs_review` doc shows a banner ("This one needs your judgment — what type is it?") with a dropdown of the supported types; the user picks a type and the empty form for that type renders below the dropdown (the banner remains visible so the user sees the action that got them here). The dropdown stays editable until the user clicks Save — changing it re-renders the form shape and discards any in-progress field edits with a confirm dialog when non-empty. Save is a single DB transaction: the server re-verifies that `document_id` belongs to the caller's workspace (mirroring R10's explicit ownership check), Zod-validates `doc_type` against the allowlist, writes the empty shape for the chosen type into `extracted_data`, and flips `status` to `complete`. After Save, the user lands on the detail view with the now-`complete` doc populated for editing. On the dashboard, `needs_review` shows as its own status chip and is included in the status filter set. For `complete` rows, the `doc_type` field is **read-only** in the detail view — reclassifying a classified document is out of initial scope and would require an explicit admin path.
- R14a. Rows with `status = 'needs_review'` (including the underlying `doc_type = 'unknown'` or low-doc-type-confidence cases from R14) are excluded from CSV export (R21) since they carry no extracted fields.

**Dashboard and Review**

- R15. The dashboard renders a searchable, filterable table of the workspace's documents: filename, doc type, status, uploaded date, uploader.
- R16. Search matches filename and key extracted fields (e.g., payer/employer name, TIN). Filters cover doc type and status at minimum.
- R17. Status transitions stream to the dashboard in real time via Supabase Realtime `postgres_changes` on the `documents` table. Workspace scoping is enforced by the standard RLS policy on `documents` (R3): the Realtime server evaluates the subscribed user's `SELECT` policy per change event before emitting, so a client that alters its subscription filter still receives no cross-workspace events. The browser Supabase client passes the authenticated session to Realtime (default after sign-in; refreshed with `supabase.realtime.setAuth(accessToken)` when the session is refreshed). **DELETE events** carry only the primary key under default `REPLICA IDENTITY` — the browser handler removes the row from local state if its id matches a row already in that client's view (safe no-op otherwise). If the Realtime connection drops, the Supabase JS client auto-reconnects; no additional polling fallback is implemented. Extended outages resolve on manual refresh.
- R18. Clicking a document opens a detail view with a PDF preview next to an editable form of the extracted fields. The preview uses a signed Supabase Storage URL with **TTL ≤ 15 minutes**, minted by `GET /api/documents/[id]/preview-url` — an authenticated (cookie-session) route handler that verifies the requesting user's workspace membership against the requested `document_id` before calling `storage.createSignedUrl`. The handler uses the service-role client (see R28c inventory) and is the only read endpoint allowed to mint signed URLs. The signed URL is rendered in an iframe. When the URL is near expiry, the component shows an inline "Preview expired — click to reload" prompt (no silent background refresh in initial scope).
- R19. The user can edit any extracted field before export. The edit form uses an **explicit Save button** (primary action at the bottom or sticky footer of the form) with a client-side dirty-state tracker: attempting to navigate away with unsaved changes opens a shadcn `AlertDialog` confirmation. Saves persist `extracted_data` as a single transaction with an `updated_at` bump. (Per-field auto-save is rejected — with K-1's 50+ fields it produces chattering PATCHes and flickering indicators; one deliberate Save is the correct primitive at both ends of the form-size spectrum.)
- R20. Users can delete a document from the dashboard. Deletion is a **hard delete**: the `documents` row is removed and the corresponding Supabase Storage object is deleted in the same server action. No undo UI is provided; the delete action opens a shadcn `AlertDialog` with a destructive-variant confirm button (consistent with the rest of the UI, instead of jarring `window.confirm()`).

**Export**

- R21. Users can export the workspace's documents as a **zip of per-doc-type CSVs** (`w2.csv`, `1099_nec.csv`, `1099_misc.csv`, `k1.csv` — only types that were included per R13). Each CSV is narrow — only the fields relevant to that doc type, no cross-type column union and no mostly-blank columns. Columns include `document_id`, `filename`, the doc-type's IRS-standard fields (value columns), and a sibling `*_confidence` column per field. One HTTP endpoint returns `application/zip` with the filtered set. The response is **buffered in memory** — not streamed — so the Vercel 4.5 MB serverless response-body cap applies; at the expected demo scale (≤100 docs/workspace) the zip is well under the cap (~200 KB). A pagination / streaming path is out of scope for the prototype; README calls this out as a known ceiling.
- R22. Export respects the current **doc-type and status filters** from the dashboard: if the user has filtered to only 1099s, the resulting zip contains only `1099_nec.csv` and `1099_misc.csv`. `needs_review`, `pending`, `processing`, and `failed` rows are excluded from export regardless of filter (they have no extracted fields to emit). Free-text search is a dashboard-view affordance only and does **not** reduce exported rows. When the filtered set is empty, the export button is disabled client-side with a tooltip ("No documents to export"); a direct API call to the endpoint with an empty filtered set returns `400 {error: "no_documents_match"}`. While the request is in flight, the export button shows a spinner and is disabled to prevent double-submission; errors surface via Sonner toast.

**Deliverables (Hard Gate)**

- R23. The app is deployed to a working Vercel URL the reviewer can open.
- R24. Repo is pushed to GitHub with `alex@owntheclimb.com` invited as collaborator.
- R25. README covers setup, architecture, what was built, what was intentionally not built (and why), and known issues.
- R26. A 3–5 minute Loom walkthrough demonstrates the product end to end. The Loom is treated as the primary sales artifact (per Problem Frame) and must cover: problem framing, end-to-end happy path with live Realtime status transitions, the confidence-UI trust moment, the two-account isolation test, and a reference to `EXTRACTION_REPORT.md`.
- R27. All required credentials (Supabase URL + anon + service role keys, Gemini API key, QStash keys, test account logins) are emailed separately to the reviewer.

**Security Boundaries**

- R28a. **Supabase Storage bucket RLS** policies mirror the DB `workspace_members` check: a user can read, list, or write objects only under their own `workspace_id/` path prefix. Cross-workspace Storage access must be rejected by the Storage API itself, not just by the app layer.
- R28b. The `documents` table is added to the `supabase_realtime` publication, and workspace scoping on Realtime events relies on the standard RLS policy from R3 (the Realtime server runs the user's `SELECT` policy per CDC event). No separate "Realtime Authorization" / `private: true` channel is used — those apply only to Broadcast/Presence, not postgres_changes.
- R28c. Service role and QStash tokens live only in Vercel environment variables and the seed script's local `.env` (git-ignored). The service-role Supabase client is used only in server-side route handlers and the seed script — never in shared utility modules, never in client components, never in Server Components that render HTML. Every route handler that imports it is documented in the README's architecture section with the reason it needs service-role access. The known inventory at spec time: `/api/upload/sign` (mint signed upload URL after workspace membership check), `/api/upload/finalize` (insert row + publish to QStash under service role since the Storage RLS is already satisfied by the signed-upload URL), `/api/extract` (QStash-invoked, no user session available), `/api/documents/[id]/preview-url` (mint read signed URL after workspace membership check), `/api/documents/[id]` DELETE (hard delete row + Storage object — R20), and the seed script.
- R28d. All `/api/*` write endpoints are authenticated via the user's `@supabase/ssr` cookie session. CSRF is mitigated by the SameSite=Lax attribute on the Supabase auth cookie (default) plus an explicit Origin check on every write handler: `Sec-Fetch-Site: same-origin` is required (`same-site`, `cross-site`, `none` are rejected). The allowed origin is derived at runtime from the Vercel env vars `VERCEL_URL` (current deployment — includes preview deployments) and `VERCEL_PROJECT_PRODUCTION_URL` (production domain), plus `http://localhost:3000` in development. An Authorization Bearer transport is _not_ used — it conflicts with the cookie-based SSR pattern. `/api/extract` is exempted from the Origin check because it is QStash-invoked, not user-invoked; it validates the QStash signature instead (R10).
- R28e. Workspace and document IDs are Postgres `uuid` columns generated by `gen_random_uuid()` server-side; they are never user-supplied or derived from user input. This ensures the Storage path prefix `<workspace_id>/<document_id>.pdf` (R7) cannot be exploited for traversal.
- R28f. A `SECURITY DEFINER` Postgres function `update_extraction_result(doc_id uuid, new_status document_status, data jsonb, error text)` (R12) is hardened with `SET search_path = ''`, schema-qualified table references in the body, `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, and `GRANT EXECUTE TO service_role` only. The `document_status` enum is defined in migration alongside the table and used for the `status` column type.

**Non-Functional**

- R32. Strict TypeScript throughout: no `any`, no bare `as` casts. Database types come from `supabase gen types typescript` committed to the repo. Narrowing `unknown` or Supabase-generated `Json` at I/O boundaries (Gemini responses, JSONB reads from the DB) **must use a runtime validator** (Zod or equivalent) — ad-hoc `as` narrowing is forbidden.
- R33. User-facing error handling covers at minimum: oversized files, non-PDF files, corrupted or unreadable PDFs, Gemini timeouts/errors (after retries exhausted), and upload failures. Failed rows show an inline error indicator on the dashboard row (clickable to reveal `error_message`); when a row transitions to `failed` in real time, a single Sonner toast also fires. Realtime connectivity issues are not surfaced via a dedicated in-UI indicator — per R17 the Supabase JS client auto-reconnects transparently, and the README documents that extended outages require a manual refresh.
- R34. Secrets handling as specified in R28c above.
- R35. **Accepted risks** explicitly documented in README: no rate limiting on public endpoints (brief de-scopes Arcjet); no at-rest application-layer encryption beyond Supabase's default volume-level encryption; service-role key is emailed to the reviewer (per R27) and is not rotated post-seed — mitigated by the throwaway nature of the demo project; demo uses Google AI Studio's free tier whose data-retention terms permit training on inputs — **the demo must only be exercised with synthetic IRS sample PDFs (no real taxpayer PII)**. The upload surface renders a persistent banner ("Demo only: synthetic PDFs. Production deploys to Vertex AI with zero retention.") so the constraint is visible in the product, not just the README. A production deployment would require Vertex AI with a DPA, Arcjet or equivalent rate limiting, and a documented data-retention schedule.

## Success Criteria

- Reviewer can log into each test account and see only that workspace's data; cross-account access is impossible.
- Reviewer can drag multiple PDFs in, watch status progress `pending → processing → complete | failed | needs_review` stream in live via Realtime during normal operation (extended connectivity outages require manual refresh, per R17), and click through to a correct preview + field view.
- Reviewer can upload a PDF Gemini cannot classify and observe it land in `needs_review`, use the detail-view dropdown to pick a doc type, save edits, and see the row flip to `complete` with the chosen type visible on the dashboard.
- Extraction quality is measured against committed fixtures, not by vibe: `fixtures/<doc_type>/` holds **2–3 small IRS sample PDFs per doc type** (8–12 total; enough signal without blowing Day-1 budget on hand-keying), each paired with a hand-keyed `ground_truth.json`. `npm run extract:report` calls Gemini directly against every fixture (bypassing QStash to protect the daily budget — this is a local-only command, not CI-wired, documented in README), compares Gemini output to ground truth (exact match for strings, ±$0.01 for numbers, case-insensitive for names/addresses), and writes `EXTRACTION_REPORT.md` with per-field accuracy per doc type **and** the precision/recall of "badge predicts error" at several confidence thresholds (used to tune `CONFIDENCE_THRESHOLD` in R13a and `DOC_TYPE_THRESHOLD` in R14). The target is **≥ 90% field-match accuracy averaged across fixtures, per doc type**. The generated `EXTRACTION_REPORT.md` is committed at submission time.
- Given the ≥ 90% baseline and the "Next uncertain" workflow (R13b), a user can correct any mis-extracted fields in **under 15 seconds per W-2 or 1099 doc** (typically ≤ 3 low-confidence fields) and **under 45 seconds per K-1** (up to ~5 low-confidence fields on a denser form). The budget is ~5 seconds per low-confidence field for read-compare-retype.
- CSV export opens cleanly in Excel / Google Sheets with recognizable columns.
- Deploy is live, repo is clean and reviewable, Loom tells the story in under 5 minutes.
- Zero `any` or bare casts survive in the codebase at submission time.

## Scope Boundaries

- **Out**: QuickBooks Online OAuth, Microsoft/Google OAuth, multi-user firms/roles (the schema is ready for it but the UI is not), PDF bounding-box annotation, Excel/CSV ingestion, audit log UI, transactional email, Sentry/PostHog wiring, comprehensive test coverage, rate limiting, Arcjet, OCR pre-pass for scanned PDFs (Gemini vision handles them), animations beyond shadcn defaults, custom domain.
- Confidence scores are surfaced in the UI (see R13a). Initial scope is intentionally minimal — a per-field badge + a per-doc count chip — without a dedicated review mode, filters, or sorts; those remain future work.
- **Doc types beyond the four listed** (1098, 5498, 1099-INT/DIV, etc.) are out of initial scope. Schema is flexible enough to add them post-submission.

## Key Decisions

- **Next.js 16.2 App Router + React 19.2 + strict TS + Tailwind v4 + shadcn/ui + lucide-react + Sonner** — matches the brief's required stack and recommended defaults; maximizes polish-per-hour in a short timeline.
- **Workspace-based multi-tenancy** (via `workspaces` + `workspace_members` tables) — costs ~30 min more now versus user-scoped, but makes future firm/roles work a UI change rather than a painful schema+RLS rewrite.
- **Supabase Auth + RLS, no ORM** — use `@supabase/ssr` server client plus `supabase gen types typescript` for end-to-end type safety. Skipping Drizzle avoids 1–2 hours of setup and a second migration source-of-truth on a 3-day deadline.
- **Supabase CLI migrations** (`supabase/migrations/*.sql`) — single source of truth, versioned, repeatable locally and in CI.
- **Upstash QStash for async extraction** — ~60–90 min setup for real durable retries, signed webhooks, and DLQ. Directly raises our score on the "error handling" evaluation axis and satisfies "resilient queue" essentially for free. Chosen over `waitUntil()` + cron reaper (simpler but brittle) and Supabase Edge Functions (separate Deno deploy pipeline).
- **Gemini 2.5 Flash via Google AI Studio** with `responseSchema` structured output — free tier covers the demo; native JSON output eliminates parsing fragility; best-in-class PDF vision avoids a separate OCR stage.
- **Per-doc-type field schemas stored as JSONB** with a TS discriminated union (`W2 | 1099_NEC | 1099_MISC | K1`) — flexible for adding doc types later without schema migrations, keeps the dashboard/export code generic.
- **Supabase Realtime only for status updates, no polling fallback** — Supabase JS auto-reconnects the WebSocket on transient drops; longer outages resolve on manual refresh. Simpler code, acceptable for a prototype.
- **Email verification enabled; test accounts pre-verified via admin API** — production-shaped auth flow, no UX debt for reviewers.
- **Email + password only for auth** — OAuth is explicitly a stretch goal; the 2-account isolation test works fine with email/password and avoids provider setup overhead.
- **Hard delete** — row + Storage object removed in one action, no `deleted_at` column. Simplest schema, no unused machinery. Revisit only if a future audit-log or undo requirement arrives.
- **Confidence surfaced in the UI** (R13a) — minimal shape (per-field badge + per-doc count chip). Turns the AI from a black box into a self-declaring tool; directly serves the "feels like a product" eval axis. Chosen over storing-but-hiding (carrying cost with no payoff) and cutting entirely (loses the demo's trust story).
- **`needs_review` as a first-class status** (R14) — preferred over `complete + doc_type='unknown'` (semantically dishonest — an empty edit form looks like a bug) and `failed` (conflates unclassifiable with unreadable). Costs one extra status chip; payoff is a coherent state machine and a natural hook for future low-confidence-gated review.
- **Export as a zip of per-doc-type CSVs** (R21) — each CSV is narrow and accountant-native. Chosen over a wide cross-type CSV (80+ mostly-blank columns, box_N collisions across forms) and a long-format tall CSV (cleaner data, wrong shape for spreadsheet workflows). ~30 extra minutes, reads as product-thinking in the Loom.
- **Fixture-based extraction measurement** (Success Criteria) — committed ground-truth JSONs + `npm run extract:report` + `EXTRACTION_REPORT.md`. Converts the "90% accuracy" success criterion from a vibe-check into evidence, and gives early-warning on K-1 quality problems.

## Dependencies / Assumptions

- Dev and deployment accounts must be provisioned at kickoff (confirmed not yet provisioned): **Supabase** project, **Google AI Studio** Gemini API key, **Upstash QStash** queue, **Vercel** project linked to the **GitHub** repo. Provisioning fits in the Day-0 window.
- Free tiers are sufficient for the demo on the following budget:
  - Supabase free tier: 500 MB DB, 1 GB Storage, 50 k MAU. Seed PDFs constrained to ≤ 2 MB each (commit 2–3 small IRS samples per doc type to `fixtures/`, per Success Criteria).
  - Gemini Flash free tier: currently ~10–15 req/min depending on region/quota (verify empirically on Day 1). Protected by the R9 queue parallelism.
  - **Upstash QStash free tier: 500 msg/day — budget-accounted**: ~40 msg/seed run × 2 accounts, ~30 msg/day dev testing, ~40 msg for Loom + demo, leaves ~300 msg slack. Seed extraction runs **inline** (direct Gemini call from the seed script, bypassing QStash) to preserve budget. Local dev bypasses QStash via a `USE_QSTASH=false` env flag that invokes `/api/extract` directly after upload.
  - Vercel Hobby: serverless functions cap request bodies at ~4.5 MB — this is the reason uploads go direct-to-Storage, not through the API (R7).
- Gemini 2.5 Flash handles both text-native and scanned-image PDFs acceptably for IRS forms. Assumption; validated early in Day 1 against committed fixtures. The K-1 drop-to-3-types fallback is codified in R13 as a conditional, not a contingency.
- **Gemini data retention**: Google AI Studio free tier may use API inputs to improve Gemini. The demo uses only committed synthetic IRS samples; real taxpayer PII must not be uploaded. Documented as an accepted risk (R35).
- Node.js 24 (Vercel default) and Next.js 16.2 App Router conventions from `node_modules/next/dist/docs/` (per repo `AGENTS.md`) are load-bearing for any code decisions the planner makes — prior Next.js knowledge may be stale. In particular, Next 16 renamed `middleware.ts` → `proxy.ts`; the canonical `@supabase/ssr` session-refresh pattern must be placed accordingly.
- No existing Supabase infrastructure, migrations, schema, or auth setup exists in the repo at kickoff; it is a fresh Next.js boilerplate.

## Outstanding Questions

### Resolve Before Planning

_None — all blocking product decisions are resolved._

### Deferred to Planning

- [Affects R11, R13][Needs research] Final Gemini structured-output schema shape per doc type, including the per-field `{value, confidence}` wrapper and the top-level `doc_type_confidence`. Day-1 calibration against fixtures determines the final `CONFIDENCE_THRESHOLD` and `DOC_TYPE_THRESHOLD` values and decides whether K-1 stays in scope (R13).
- [Affects R11][Technical] How `/api/extract` streams PDF bytes to Gemini — inline `inlineData` (base64) vs. Gemini File API. Inline is simpler for the ≤10 MB file cap; default to inline unless Day-1 testing surfaces issues.
- [Affects R6][Technical] Partial-batch upload semantics — the per-file error object shape returned by `/api/upload/finalize`.

## Next Steps

-> `/ce:plan` for structured implementation planning.
