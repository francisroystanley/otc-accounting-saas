# OTC Accounting SaaS — prototype

> ⚠ **Prototype — demo only.** Synthetic IRS sample PDFs only; do not upload real tax documents. Accepted risks are listed under [Known issues & accepted risks](#known-issues--accepted-risks).

A multi-tenant web app that ingests US tax PDFs (W-2, 1099-NEC, 1099-MISC, Schedule K-1), extracts structured fields via Google Gemini, surfaces per-field confidence for human review, and exports per-doc-type CSVs as a zip.

- **Live URL:** https://otc-accounting-saas.vercel.app/
- **Stack:** Next.js 16.2.4 (App Router, `proxy.ts`) · React 19.2.4 · Supabase (Auth + Postgres + Storage + Realtime) · Upstash QStash (Flow Control) · Google Gemini 3 Flash Preview · Tailwind v4 · shadcn/ui · Vercel
- **Demo credentials:** two seeded accounts (`demo-populated` and `demo-empty`). Plaintext credentials live in `scripts/lib/demo-users.ts` — this is deliberate for a disposable reviewer demo. Do not reuse these passwords in any production system.

## Table of contents

1. [Quickstart (verify the build)](#quickstart-verify-the-build)
2. [Setup from scratch](#setup-from-scratch)
3. [Architecture](#architecture)
4. [What was built](#what-was-built)
5. [What was intentionally not built](#what-was-intentionally-not-built)
6. [Known issues & accepted risks](#known-issues--accepted-risks)
7. [Extraction quality](#extraction-quality)
8. [Project layout](#project-layout)
9. [Further reading](#further-reading)

---

## Quickstart (verify the build)

If you only want to confirm the repo builds and tests pass locally — no external services needed:

```bash
git clone <repo-url>
cd otc-accounting-saas
npm install
npm run lint        # tsc --noEmit && eslint .
npm run test        # vitest, 278 tests
npm run build       # next build
```

To run the app end-to-end locally, continue with [Setup from scratch](#setup-from-scratch).

## Setup from scratch

### 1. Prerequisites

- Node.js 20.9+ (24 LTS recommended)
- npm
- Vercel CLI — `npm i -g vercel`
- Supabase CLI — `npm i -g supabase`

### 2. Provision external services

| Service                                                | Create                                             | Where to find keys                            |
| ------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------- |
| [Supabase](https://supabase.com/dashboard)             | A new project                                      | Project Settings → Data API                   |
| [Google AI Studio](https://aistudio.google.com/apikey) | An API key with access to `gemini-3-flash-preview` | API keys page                                 |
| [Upstash QStash](https://console.upstash.com/qstash)   | A QStash instance                                  | Dashboard (token + current/next signing keys) |
| [Vercel](https://vercel.com/new)                       | A project linked to the GitHub repo                | CLI (`vercel link`)                           |

### 3. Configure local environment

```bash
cp .env.example .env.local
# Fill in the values. Every key is documented inline in .env.example.
```

### 4. Apply the database schema and seed demo data

```bash
supabase link --project-ref <your-ref>
supabase db push
npm run seed           # creates two demo accounts + seeds the populated one
```

The seed script is idempotent — rerunning it upserts the two demo users (see `scripts/lib/demo-users.ts`) and replaces the populated account's document set from `fixtures/`.

### 5. Run the app

QStash is wired end-to-end in both dev and prod. Local dev uses the Upstash CLI emulator in **two terminals**:

```bash
# Terminal 1 — QStash emulator (prints the token, signing keys, and URL
# to paste into .env.local)
npx @upstash/qstash-cli@latest dev
```

```bash
# Terminal 2 — Next.js
npm run dev
```

Open http://localhost:3000. If `/api/upload/finalize` returns a network error, the QStash CLI is probably not running — that's the signal to start it.

### 6. Configure Vercel

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GOOGLE_GENAI_API_KEY
vercel env add QSTASH_TOKEN
vercel env add QSTASH_CURRENT_SIGNING_KEY
vercel env add QSTASH_NEXT_SIGNING_KEY
# Leave QSTASH_URL unset in Vercel so production uses the cloud default.
vercel --prod
```

## Architecture

### Extraction pipeline

```
Browser ──sign──▶ /api/upload/sign ──▶ Supabase Storage (direct PUT, bypasses 4.5 MB)
   │
   └─finalize─▶ /api/upload/finalize ──▶ documents row (status='pending')
                              │
                              └─QStash publish (flowControl: key='extract', parallelism=2)
                                             │
                                             ▼
                                   /api/extract  (QStash-signed)
                                             │
                     ┌───────────────────────┼───────────────────────┐
                     ▼                       ▼                       ▼
            UPDATE ... WHERE      Gemini 3 Flash Preview     update_extraction_result
            status='pending'      (inline PDF bytes,         (SECURITY DEFINER, writes
            (atomic claim)         responseSchema)           status + extracted_data)
                                                                     │
                                                                     ▼
                                                          Supabase Realtime (RLS-filtered)
                                                                     │
                                                                     ▼
                                                          Browser dashboard updates
```

### Document status machine

```
pending ──claim──▶ processing ──┬──▶ complete       (high-confidence path)
                                ├──▶ needs_review    (doc_type='unknown' OR doc_type_confidence < threshold)
                                │        │ user picks type + saves
                                │        └────────▶ complete
                                └──▶ failed          (after QStash exhausts 3 retries)
```

`update_extraction_result` (SECURITY DEFINER, `service_role` grant only) is the sole extraction-result write path. User edits on `complete` rows use a direct `UPDATE` via the user-session client — RLS enforces workspace membership.

### Three Supabase clients, strictly partitioned

| Client           | File                          | Who calls it                                                                                                | Use                                                                   |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Browser**      | `src/lib/supabase/browser.ts` | Client Components (dashboard, upload dropzone, Realtime subscribers)                                        | User-session via cookies; RLS enforced                                |
| **Server**       | `src/lib/supabase/server.ts`  | Server Components, Server Actions, Route Handlers (for reads + user edits)                                  | User-session via SSR cookies; RLS enforced                            |
| **Service-role** | `src/lib/supabase/service.ts` | Server-only paths that write through `update_extraction_result` or verify Storage objects before row insert | Bypasses RLS; **throws at import if `typeof window !== 'undefined'`** |

**Service-role inventory (R28c)** — the service-role client is imported from exactly five server paths:

- `src/app/api/upload/sign/route.ts` — mint signed upload URL scoped to the caller's workspace prefix
- `src/app/api/upload/finalize/route.ts` — verify uploaded object exists + magic bytes + size, insert row, publish QStash
- `src/app/api/extract/route.ts` — atomic claim, Gemini call, write result via `update_extraction_result`
- `src/app/api/documents/[id]/route.ts` — delete Storage object on DELETE (user-session client runs the DB DELETE first under RLS)
- `src/app/api/documents/[id]/preview-url/route.ts` — sign 15-min Storage preview URL after user-session RLS check
- (`scripts/seed-demo.ts` also uses it — local one-time seeding, not a runtime path)

Each call site does the RLS-enforced authorization check **before** reaching for the service-role client. ESLint does not enforce this at present; audit by `grep -rn "lib/supabase/service" src/` if you need to re-confirm the inventory.

### Key technical decisions

- **Next.js 16 `proxy.ts`** (renamed from `middleware.ts`) refreshes the Supabase session on every navigation using `supabase.auth.getClaims()` — local JWKS verification with no network hop, falling back to `getUser()` only when asymmetric keys aren't available.
- **QStash Flow Control** (not named queues) — `flowControl: { key: 'extract', parallelism: 2 }` on every `publishJSON`. Named queues with `parallelism > 1` are deprecated upstream.
- **Gemini SDK = `@google/genai`** (not the deprecated `@google/generative-ai`). Model is env-flippable via `GEMINI_MODEL`; default `gemini-3-flash-preview`, fallback `gemini-2.5-flash` if the preview model is retired.
- **Shared extraction core** — `src/lib/extraction/gemini.ts` is consumed by `/api/extract`, `scripts/extract-report.ts`, and `scripts/seed-demo.ts`. Prompt, schema, and Zod validation stay in sync across all three.
- **Idempotent QStash claim** — `UPDATE documents SET status='processing' WHERE id=$1 AND status='pending'`. Zero rows changed → 200 no-op (duplicate delivery); one row claimed → proceed.
- **CSV export** — `jszip` buffers the per-doc-type CSVs in memory; demo-scale (≤100 docs) stays under the 4.5 MB Vercel response-body cap. Values are sanitized against formula injection (leading `=`, `+`, `-`, `@`, `\t`, `\r`).
- **Strict TypeScript** — `no-explicit-any: error` and `consistent-type-assertions: ['error', { assertionStyle: 'never' }]`. Zero `: any` and zero bare `as` casts in `src/`.

## What was built

Every requirement from the origin document (R1–R35) is addressed:

- **Auth & isolation (R1–R3, R28a, R28b, R28e, R28f, R34):** email+password via Supabase Auth; workspaces auto-created on first signup via a Postgres trigger on `auth.users` (SECURITY DEFINER, race-free); RLS on `documents` and `workspace_members`; Storage RLS mirrors DB RLS; all IDs server-generated via `gen_random_uuid()`; `update_extraction_result` is SECURITY DEFINER with `SET search_path = ''` and `service_role`-only grant.
- **Seeded demo accounts (R4, R27):** two accounts — `populated` (pre-filled with extracted fixtures) and `empty` (proves R3 isolation). Credentials in the reviewer email.
- **Upload pipeline (R5–R8, R10):** drag-and-drop dropzone, per-file 10 MB cap, per-batch 10-file cap, PDF magic-bytes + MIME + extension checks, direct-to-Storage signed uploads, workspace-path-prefix enforced on both `sign` and `finalize`.
- **Async extraction (R9, R11, R12):** QStash Flow Control parallelism 2; `/api/extract` idempotent claim + inline Gemini call + `update_extraction_result` write. Failure path writes `status='failed'` with `error_message` via the same function.
- **Four doc types (R13, R13a, R13b, R14, R14a):** W-2, 1099-NEC, 1099-MISC, K-1 discriminated union (K-1 inclusion confirmed — 100% on filled fixtures, see [Extraction quality](#extraction-quality)). Confidence UI: per-field dot, per-doc low-confidence chip on the dashboard, `edited_fields` latch clearing the dot after user save. "Next uncertain" button + Alt+N keyboard shortcut. `needs_review` type-picker. `needs_review` rows excluded from CSV export.
- **Review UI (R15–R20):** searchable/filterable table, Realtime streaming via Supabase `postgres_changes` (RLS-filtered), detail view with 15-min signed preview URL, editable form with explicit Save + dirty guard, hard delete (row + Storage object).
- **Export (R21, R22):** zip of per-doc-type CSVs (`w2.csv`, `1099_nec.csv`, `1099_misc.csv`, `k1.csv`), filter-scoped, `document_id` + `filename` + `{field, field_confidence}` column pairs, formula-injection-safe.
- **Deploy & handoff (R23–R27):** live Vercel URL; GitHub repo with reviewer invited as collaborator; README (this document); Loom walkthrough (see reviewer email); credentials emailed.
- **Code quality (R28c, R28d, R32, R33, R35):** service-role inventory documented above; all write handlers authed via SSR cookie + Origin check; strict TypeScript + Zod validation at every I/O boundary; user-facing errors via Sonner toasts + inline popovers (no stack traces, no raw error codes); demo banner on every authed page; accepted-risk documentation (this section).

## What was intentionally not built

From the origin document's Scope Boundaries:

- QuickBooks Online OAuth; Microsoft/Google OAuth sign-in
- Multi-user firms / roles UI (schema supports `workspace_members`, UI does not)
- PDF bounding-box annotation; Excel/CSV ingestion
- Audit log UI, transactional email, Sentry/PostHog
- Comprehensive automated test coverage — per-unit targeted tests only (278 tests, not a full suite)
- Rate limiting / Arcjet
- OCR pre-pass (Gemini vision handles scanned PDFs)
- Custom animations beyond shadcn defaults; custom domain
- Doc types beyond W-2 / 1099-NEC / 1099-MISC / Schedule K-1
- Re-extraction / reclassification of `complete` docs (admin path)
- Per-field auto-save on the edit form (explicit Save button only, per R19)
- Polling fallback for Realtime (auto-reconnect handles transients; extended outage → manual refresh)

### Deferred to separate tasks

- Confidence-UI extensions (dedicated review mode, low-confidence filter/sort)
- Pagination / streaming CSV export (the 4.5 MB response-body cap is the ceiling at ≤100 docs/workspace scale)
- Reclassification flow for `complete` docs (admin path)
- Larger-N fixture curation + threshold calibration (see [Extraction quality](#extraction-quality) — the current set is 2 fixtures per doc type)

## Known issues & accepted risks

Per R35, the following are documented and accepted for this prototype:

| Item                                                                                                                                                   | Impact                                                                                                                                       | Status                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Small fixture set (2 per doc type)** — 1 blank IRS template + 1 synthetic-filled. Threshold calibration is directional, not statistically converged. | Sweep precision/recall in `EXTRACTION_REPORT.md` is computed from ≤16 fields per doc type. Larger-N curation is a post-submission iteration. | Tracked in `fixtures/README.md`.                                                                                                                                  |
| **CSV zip export subject to Vercel's 4.5 MB response-body cap.**                                                                                       | At ≤100 docs/workspace scale, ~200 KB zip — well under cap. Larger workspaces would hit the ceiling.                                         | Documented; streaming export is a post-submission iteration.                                                                                                      |
| **iOS Safari blocks `application/pdf` in iframes** regardless of `Content-Disposition`.                                                                | Mobile Safari users see a broken preview.                                                                                                    | Reviewer uses desktop; Loom recorded on desktop.                                                                                                                  |
| **QStash Flow Control `key: 'extract'` is a per-QStash-account global**, not per-workspace.                                                            | Two concurrent demo accounts share the parallelism-2 budget globally.                                                                        | Fine for a 2-account demo; flagged as a production ceiling.                                                                                                       |
| **No migration rollback** — no down-migrations.                                                                                                        | If a migration ships with a bug, fix-forward with a new migration.                                                                           | Deliberate for a disposable demo.                                                                                                                                 |
| **Fixture PDFs are IRS public samples only** — no real PII.                                                                                            | Training-data leakage risk eliminated by construction.                                                                                       | Spot-checked during fixture curation.                                                                                                                             |
| **Gemini 3 Flash Preview is a preview model** and can be retired on short notice (Gemini 3 Pro Preview was retired 2026-03-09).                        | If retired between ship and evaluation, extractions would fail.                                                                              | `GEMINI_MODEL` env var defaults to `gemini-3-flash-preview`; flipping to `gemini-2.5-flash` is a Vercel env change + redeploy — no code change, no schema change. |
| **Realtime drops during extended outages**; no polling fallback.                                                                                       | Dashboard appears stale until manual refresh.                                                                                                | Auto-reconnect handles transients. Documented behavior.                                                                                                           |
| **Service-role usage** — the service-role client bypasses RLS. A leak into a Client bundle would be catastrophic.                                      | See [service-role inventory](#three-supabase-clients-strictly-partitioned). The client throws at import if `typeof window !== 'undefined'`.  | Enforced by the `server-only` guard and documented here; audit by `grep -rn "lib/supabase/service" src/`.                                                         |

## Extraction quality

See `docs/EXTRACTION_REPORT.md` for the full per-fixture breakdown.

| Doc type    | Fixtures              | Classification | Field accuracy |
| ----------- | --------------------- | -------------- | -------------- |
| `w2`        | 2 (1 blank, 1 filled) | 2/2 (100%)     | 20/20 (100%)   |
| `1099_nec`  | 2 (1 blank, 1 filled) | 2/2 (100%)     | 11/12 (91.7%)  |
| `1099_misc` | 2 (1 blank, 1 filled) | 2/2 (100%)     | 16/16 (100%)   |
| `k1`        | 2 (1 blank, 1 filled) | 2/2 (100%)     | 16/16 (100%)   |

**K-1 inclusion confirmed:** 100% field accuracy on the filled K-1 fixture; previous "conditional K-1" gate (≥ 80%) cleared. See `EXTRACTION_REPORT.md` → "K-1 inclusion decision" for the harness output.

**One 1099-NEC miss:** `payer_name` came back with the full PAYER block ("Summit Consulting LLC 77 Industrial Blvd, Denver CO 80202") because the IRS 1099-NEC template puts PAYER's name and address in a single AcroForm text field — when filled, the model can't always separate the two visually. A real 1099-NEC PDF (typed or scanned) typically presents these as distinct visual lines and extracts cleanly; the fixture is the constraint here, not the model.

**Fixture provenance:** blank `sample1.pdf` files are verbatim IRS forms from `irs.gov/pub/irs-pdf/`. Filled `sample2.pdf` files are the same IRS blanks with synthetic (fabricated) values written into their AcroForm text fields by `scripts/generate-filled-fixtures.mjs`. No real PII — see [fixtures/README.md](fixtures/README.md) for the policy.

The report is regenerated on demand via:

```bash
npm run extract:report
```

The harness is **not** CI-wired — it consumes Gemini quota and its value is in calibrating thresholds, not gating CI.

## Project layout

```
src/
  app/
    (app)/                  # authed routes: dashboard, upload, document detail
    (auth)/                 # login, signup
    actions/                # Server Actions (auth)
    api/                    # route handlers: upload, extract, documents, export
    auth/confirm/           # email confirmation callback
  components/
    DemoBanner.tsx          # R35 accepted-risk banner
    TopNav.tsx
    ui/                     # shadcn/ui components
    upload/                 # dropzone
  lib/
    supabase/               # three clients: browser, server, service-role
    extraction/             # shared Gemini module + schemas + prompt
    auth/                   # SSR auth helpers
    documents/ export/ upload/ extract/  # domain helpers
    database.types.ts       # generated Supabase types
proxy.ts                    # Next 16 session-refresh (renamed from middleware.ts)
supabase/
  migrations/               # schema, RLS, SECURITY DEFINER function, Storage RLS
scripts/
  extract-report.ts         # fixture harness (npm run extract:report)
  seed-demo.ts              # demo account seeder (npm run seed)
fixtures/                   # IRS public sample PDFs + ground-truth JSON
docs/
  plans/                    # implementation plan (parent + U15)
  brainstorms/              # requirements source of truth
  solutions/                # documented learnings from prior units
  EXTRACTION_REPORT.md      # fixture accuracy snapshot
```

## Further reading

- **Implementation plan:** [docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md](docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md)
- **U15 ship plan:** [docs/plans/2026-04-24-001-feat-u15-polish-deploy-readme-loom-plan.md](docs/plans/2026-04-24-001-feat-u15-polish-deploy-readme-loom-plan.md)
- **Requirements:** [docs/brainstorms/otc-accounting-saas-requirements.md](docs/brainstorms/otc-accounting-saas-requirements.md)
- **Extraction report:** [docs/EXTRACTION_REPORT.md](docs/EXTRACTION_REPORT.md)
- **Fixture curation backlog:** [fixtures/README.md](fixtures/README.md)
- **Documented solutions** (per-unit learnings): [docs/solutions/](docs/solutions/)
