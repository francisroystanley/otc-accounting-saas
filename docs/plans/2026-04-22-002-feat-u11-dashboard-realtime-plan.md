---
title: "feat: U11 dashboard (list, search, filters, Realtime, delete)"
type: feat
status: active
date: 2026-04-22
origin: docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md
---

# feat: U11 dashboard (list, search, filters, Realtime, delete)

## Overview

Build the workspace dashboard: a table of `documents` rows for the authed workspace, with client-side search, doc-type and status filters in URL params, a Realtime stream that merges CDC events without races, a low-confidence count chip on `complete` rows, inline popover on `failed` rows, and row-level hard delete (row + Storage object).

This is a focused plan for **Unit 11** from the parent prototype plan. The parent plan already enumerates the shape, test scenarios, and security boundaries; this plan carries that content forward, grounds it in current repo patterns (DI port / thin-adapter split, `(app)` layout, RLS-enforced Realtime), and sequences the work into commit-sized units.

## Problem Frame

Today `src/app/(app)/dashboard/page.tsx` is a stub. U10 just shipped upload, so rows now land in `public.documents` with `status='pending'` and transition through `processing → complete|failed|needs_review` as the extract pipeline runs. Users have no way to see their queue, search it, filter it, fix broken uploads (delete), or watch extraction progress live. That's the demo's primary surface — without it the whole pipeline is invisible.

The dashboard must satisfy: R15 (searchable filterable table), R16 (search + filters), R17 (Realtime streaming), R20 (hard delete row + Storage object), R33 (user-facing error handling), and the chip half of R13a (per-doc low-confidence count).

## Requirements Trace

- R15 — Searchable filterable table of workspace documents (filename, type, status, date, confidence count chip, actions).
- R16 — Search (client-side debounced, matches filename + payer/employer/tin extracted-data strings) + filters (doc_type, status) backed by URL params so export can consume them.
- R17 — Realtime streaming of `documents` changes: INSERT/UPDATE/DELETE; the status chip animates `pending → processing → complete` without refresh.
- R20 — Hard delete: removes the `documents` row and the Storage object; UI removes the row.
- R33 — User-facing error handling: Sonner toast when a row transitions to `failed`; inline red icon + popover with `error_message`; error toast if DELETE fails.
- R13a (chip portion) — Per-`complete` document low-confidence count chip `<Badge>N to review</Badge>`, N = fields with `confidence < CONFIDENCE_THRESHOLD` AND not in `edited_fields`. Badge absent when N = 0.
- R28b — RLS scopes Realtime CDC per event. Client-side workspace filter is optimization, not the security boundary.
- R28c (compliance) — The dashboard never mints a read signed URL. (Detail view owns that, U12.)

## Scope Boundaries

- No detail-view navigation wiring to a functional detail page (detail page is U12). The filename cell renders as a `<Link href="/documents/[id]">` but clicking it lands on whatever U12 ships; for this plan the link target need only be correct — the detail page is not part of U11.
- No CSV export button. U13 adds the export button that consumes the URL-param filter state this plan produces.
- No column sort controls. Default order is `created_at DESC`; sort toggles are out of scope.
- No pagination. Workspace cap is ≤ ~100 docs for the demo (per parent plan); a plain scroll is sufficient.
- No bulk delete. Delete is strictly per-row.
- No edit-in-place on the table. Edits happen in U12's detail form.

### Deferred to Separate Tasks

- Per-field confidence **dot** (R13a dot + tooltip) and `edited_fields` latch UI: U12 (`ConfidenceBadge` on the detail form).
- "Next uncertain" button (R13b): U12.
- Signed preview URL minting: U12 (`/api/documents/[id]/preview-url`).
- PATCH handler on `/api/documents/[id]`: U12 (this plan only ships the DELETE verb on that route).

## Context & Research

### Relevant Code and Patterns

- `src/app/(app)/layout.tsx` — authed layout. `getAuthenticatedContext` redirects to `/login` on failure; `DemoBanner` + `TopNav` are already rendered. The dashboard page does NOT re-auth itself; the layout handles it. (Current stub at `src/app/(app)/dashboard/page.tsx` re-authes — this plan drops that redundancy.)
- `src/lib/supabase/browser.ts` — singleton `createSupabaseBrowserClient`. Use this in the Client Component for the initial fetch + Realtime subscription. RLS is the boundary; the browser client uses the publishable key and the user session.
- `src/lib/supabase/server.ts` — server client for the Server Component's initial data fetch.
- `src/lib/supabase/service.ts` — service-role client for the DELETE route's Storage remove + row delete. Row delete could go through the user-session client (RLS would enforce), but Storage removal must use service role because Storage RLS was hardened to tenant-scoped paths in migration `20260421000018_storage_path_tenant_scoping.sql` — we go service-role for both to keep the route's authorization story uniform and explicit.
- `src/lib/auth/require-auth.ts` — `getAuthenticatedContext()` returns `{ userId, workspaceId, email }` or `null`. Use in both Server Component and the DELETE route.
- `src/lib/auth/origin-check.ts` — `isSameOriginRequest(request)` for state-changing endpoints. DELETE needs it.
- `src/app/api/upload/finalize/route.ts` — canonical example of the route → DI port → handler split. U11's DELETE route should follow the same shape.
- `src/components/upload/UploadDropzone.tsx` + `src/lib/upload/client-batch.ts` — canonical example of the client-component → DI port → pure-orchestration split. U11's `DashboardTable` must follow this split so the merge logic (Realtime buffer + initial fetch + de-dup by id + newer `updated_at` wins) is unit-testable in Node.
- `src/lib/extraction/config.ts` — `CONFIDENCE_THRESHOLD = 0.85`. The low-confidence count chip uses this exact constant; do not introduce a second copy.
- `src/lib/database.types.ts` — `documents` row shape; `document_status` enum is `pending | processing | complete | failed | needs_review`. `extracted_data` and `edited_fields` are `Json | null`.
- `supabase/migrations/20260421000005_realtime_publication.sql` — `documents` is in the `supabase_realtime` publication; `postgres_changes` events go through the SELECT RLS policy per row (R28b).
- `supabase/migrations/20260421000019_documents_replica_identity_full.sql` — `REPLICA IDENTITY FULL` is set, so DELETE events include the full old row. The client can read `workspace_id` off the DELETE payload — handy, but still not a security boundary (RLS is).
- `supabase/migrations/20260421000004_storage_bucket_and_rls.sql` + `20260421000018_storage_path_tenant_scoping.sql` — Storage objects are `workspaces/<workspace_id>/<document_id>.pdf`; the service-role client bypasses Storage RLS so we pass the exact `storage_path` from the row.
- shadcn primitives already installed: `table.tsx`, `select.tsx`, `alert-dialog.tsx`, `badge.tsx`, `popover.tsx`, `button.tsx`, `input.tsx`, `tooltip.tsx`, `sonner.tsx`. No new shadcn installs needed.

### Institutional Learnings

- `docs/solutions/best-practices/testable-client-component-via-di-port-and-thin-adapter-2026-04-22.md` — split the Client Component into (1) a pure `src/lib/dashboard/live-feed.ts` with no React/no browser imports that owns the buffer → fetch → merge state machine, and (2) a thin `DashboardTable.tsx` that wires the Supabase browser client's Realtime channel + initial query into the port. Vitest is Node-only (`vitest.config.ts: environment: "node"`); without this split, the merge logic is untestable.
- `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md` — split the DELETE route into `src/lib/documents/delete.ts` (pure) + `src/app/api/documents/[id]/route.ts` (adapter wiring `requireAuth`, `isSameOriginRequest`, service-role Storage + DB calls). Matches `src/app/api/upload/finalize/route.ts`.
- `docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md` — cross-tenant leakage is the standing threat model for this table. Two-workspace side-by-side Realtime test is required (parent plan called it "the most important integration test"). This plan keeps that assertion.
- `docs/solutions/best-practices/multi-write-route-idempotency-and-rollback-2026-04-22.md` — DELETE order matters. Delete Storage object first, then row; if Storage delete fails we abort before touching the row, so a retry is safe. If Storage delete succeeds but row delete fails, the next retry is a no-op on Storage (404 from Storage is treated as success) and completes the row delete — idempotent.
- `docs/solutions/best-practices/nextjs-supabase-shadcn-scaffolding-defaults-2026-04-21.md` — use arrow-function components, `React.ReactElement` return type, kebab-case routes, `@/*` import alias, Zod for every boundary.

### External References

- Supabase Realtime `postgres_changes` reference: `node_modules/@supabase/realtime-js` + official docs for channel filter syntax `workspace_id=eq.${workspaceId}`. Event payload for DELETE carries `old` with full row when `REPLICA IDENTITY FULL` is set, else just PK. Our migration 19 sets FULL.
- Next 16 App Router note: `searchParams` in a Server Component is a `Promise` (Next 15+). The dashboard Server Component must `await` it.

## Key Technical Decisions

- **Server Component renders the initial list; Client Component owns Realtime + re-fetch-on-mount.** The Server Component ships the first paint so users don't see a flash of empty table; the Client Component immediately re-fetches via the browser client (same data, same clock as CDC events) and merges buffered events. Prevents the insert-between-server-query-and-subscription-open race described in the parent plan.
- **Filters live in URL params (`?type=w2&status=needs_review&q=acme`).** Read via `searchParams` on the Server Component for first paint; mirrored to/from client state via `useRouter().replace(...)`. This is load-bearing: U13's export reads these same params to scope the CSV zip.
- **Search is client-side only.** Debounced (~200ms) substring match over `filename` + stringified `extracted_data` values (specifically `payer`, `employer`, `tin` if present). The ≤100-doc cap makes server round-trips pure waste. Server-side search is deferred to post-MVP.
- **Low-confidence count is computed client-side from `extracted_data` + `edited_fields` + `CONFIDENCE_THRESHOLD`.** The row already carries everything needed; recomputing in the browser means Realtime UPDATE events recompute for free.
- **DELETE follows the DI-port / thin-adapter pattern.** Pure handler `handleDocumentDelete(request, port)` + real port assembled in `src/app/api/documents/[id]/route.ts`. Mirrors `src/app/api/upload/finalize/route.ts`.
- **Realtime merge logic is a pure reducer in `src/lib/dashboard/live-feed.ts`.** Input: `{ initialRows, bufferedEvents }`. Output: `{ rows }`. De-dup by `id`; on conflict, newer `updated_at` wins; DELETE removes by id (no-op if absent). All unit-testable in Node vitest.
- **Cross-workspace defense in depth.** Realtime channel subscribes with filter `workspace_id=eq.${workspaceId}` AND the reducer re-checks `row.workspace_id === authedWorkspaceId` before accepting any event. Redundant with RLS, cheap, and catches a class of misconfigurations.
- **Delete UX is destructive-variant `AlertDialog` + optimistic UI.** On confirm, remove row from local state immediately; fire DELETE. On 4xx/5xx, restore the row and toast. Matches the upload UX's optimistic-then-reconcile feel.
- **Toast-once-per-doc-per-failure.** Fired-toast doc ids are tracked in a `Set` inside the Client Component so flapping rows (fail → reprocess → fail) don't spam the user within a single session. The set resets on page navigation — that's acceptable.
- **Dashboard page drops the redundant `getAuthenticatedContext` call.** The `(app)` layout already redirects unauthed users. The Server Component takes the layout's auth context via a direct call — but only once — and uses it solely for the `workspaceId` needed to scope the initial query.

## Open Questions

### Resolved During Planning

- **Where does `workspaceId` come from in the Client Component?** → Server Component passes it as a prop. The layout has it too but passing props is simpler than a context.
- **How does the DELETE route know the row's Storage path?** → Load the row first (service-role, by `id`), then membership-check (`workspace_members`), then remove Storage object, then delete row. One extra read, no correctness risk.
- **What if Realtime reconnects?** → Supabase-js auto-reconnects. The reducer's de-dup-by-id + `updated_at`-wins strategy means replayed events are idempotent. We do not attempt a cold refetch on reconnect for MVP (risk: stale rows if the client was offline and missed a DELETE; accepted for demo).
- **Does DELETE use service role or user-session client?** → Service role, for both Storage and row delete. See `src/lib/supabase/service.ts` rationale in Context. Membership check is manual against `workspace_members`.
- **Should the filename cell link to U12's detail route even though U12 isn't built?** → Yes — `<Link href={`/documents/${id}`}>` renders now; U12 implements the destination. Broken-link behavior is acceptable during the ~day U11 ships before U12 lands.

### Deferred to Implementation

- **Exact Zod return-type shape for Realtime payloads.** `@supabase/realtime-js` types are loose around `new`/`old`; the adapter in `DashboardTable.tsx` will parse with a narrow Zod schema and drop malformed events with a console warning rather than crash.
- **Whether to add `processing` rows to `created_at DESC` order or promote them visually.** Parent plan only says "ordered by created_at DESC"; accept that.
- **Exact keybinding for focusing the search input.** `/` is conventional but defer to implementation after U12's Alt+N decision lands to avoid collision.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
                                                            ┌────────────────────────────────┐
                                                            │  src/lib/dashboard/live-feed.ts │
                                                            │  (pure, vitest-friendly)        │
                                                            │  • mergeEvents(initial, events) │
                                                            │  • applyEvent(rows, event)      │
                                                            │  • countLowConfidence(row, thr) │
                                                            │  • matchesSearch(row, q)        │
                                                            │  • filterByParams(rows, params) │
                                                            └────────────┬───────────────────┘
                                                                         │ imported by
 ┌───────────────────────────┐   props   ┌───────────────────────────────▼─────────────────────────┐
 │ dashboard/page.tsx        │──────────▶│ dashboard/DashboardTable.tsx  ("use client")            │
 │ (Server Component)        │ rows,     │  • opens Supabase Realtime channel (buffer events)      │
 │ • layout already authed   │ workspace │  • browser client re-fetches initial list              │
 │ • reads searchParams      │ Id,       │  • calls mergeEvents() to reconcile                     │
 │ • queries documents via   │ params    │  • applies URL-param filters + client-side search       │
 │   server client (SSR)     │──────────▶│  • fires Sonner toast on failed transitions             │
 └───────────────────────────┘           │  • renders shadcn Table + Select + Input + Badge        │
                                         │  • row actions: DeleteDocumentButton (optimistic DELETE)│
                                         └──────────┬──────────────────────────────────────────────┘
                                                    │ fetch DELETE /api/documents/[id]
                                                    ▼
                                         ┌──────────────────────────────────┐
                                         │ src/app/api/documents/[id]/      │
                                         │ route.ts (adapter)               │
                                         │ • DI port from service client    │
                                         │ • handleDocumentDelete(req, port)│
                                         └──────────┬───────────────────────┘
                                                    │
                                                    ▼
                                         ┌──────────────────────────────────┐
                                         │ src/lib/documents/delete.ts      │
                                         │ (pure)                           │
                                         │  auth → origin → membership →    │
                                         │  load row → storage remove →     │
                                         │  row delete → 204                │
                                         └──────────────────────────────────┘
```

## Implementation Units

- [x] **Unit 11a: Pure dashboard live-feed reducer + selectors**

**Goal:** Ship the pure, vitest-friendly module that owns the Realtime merge state machine and the derived selectors the table renders. No React, no Supabase client imports.

**Requirements:** R17 (reducer), R16 (filterByParams + matchesSearch), R13a chip (countLowConfidence).

**Dependencies:** None — foundation for U11b.

**Files:**

- Create: `src/lib/dashboard/live-feed.ts`
- Create: `src/lib/dashboard/live-feed.test.ts`

**Approach:**

- Export a narrow `DocumentRow` type (structural subset of `Tables<'documents'>` limited to what the dashboard reads: id, workspace_id, filename, doc_type, status, extracted_data, edited_fields, error_message, created_at, updated_at, storage_path). Import `Database`/`Tables` from `src/lib/database.types.ts`.
- Export a `FeedEvent` discriminated union: `{ kind: 'insert' | 'update', row: DocumentRow }` and `{ kind: 'delete', id: string, workspaceId: string }`.
- Export `mergeEvents(initial: DocumentRow[], events: FeedEvent[], authedWorkspaceId: string): DocumentRow[]` — fold events onto initial; de-dup INSERT by id (no-op if already present); UPDATE merges by id, keeping the row with the newer `updated_at`; DELETE removes by id. All events with `workspaceId !== authedWorkspaceId` are dropped.
- Export `applyEvent(rows, event, authedWorkspaceId)` — single-event version used inside the Client Component once the feed is live. Same rules as `mergeEvents`.
- Export `countLowConfidence(row, threshold)` — returns `0` unless `status === 'complete'`; scans `row.extracted_data` for `{ value, confidence }`-shaped leaves, counts those with `confidence < threshold` AND not keyed `true` in `row.edited_fields`. Safe against `null`/missing shapes.
- Export `matchesSearch(row, query)` — case-insensitive substring across `row.filename` + any string leaf of `extracted_data` under keys `payer`, `employer`, `tin`. Empty/whitespace query returns true for every row.
- Export `filterByParams(rows, params: { type?: string | null, status?: string | null })` — applies doc_type and status filters. `"all"` or `null`/absent is a pass-through.
- Export `parseDashboardSearchParams(raw: Record<string, string | string[] | undefined>)` — narrow parser for the URL params (`type`, `status`, `q`), with Zod validation against the known enums so a hand-typed `?status=foo` doesn't crash rendering.

**Execution note:** Characterization-first. Write `live-feed.test.ts` before `live-feed.ts`. These selectors are the dashboard's correctness core — the Realtime race, the chip count, and the two-workspace isolation all live here.

**Patterns to follow:**

- Named discriminated unions with `kind` tag (same style as `SignResult`, `UploadOneResult` in `src/lib/upload/client-batch.ts`).
- Zod parsers at every boundary (cf. `src/components/upload/UploadDropzone.tsx` response schemas).
- No `any`, no bare `as`, no `!` — per ESLint config.

**Test scenarios:**

- Happy path: `mergeEvents(initial=[A], events=[insert B, update A'])` with A' newer → `[B, A']`.
- Happy path: `mergeEvents(initial=[A], events=[delete A])` → `[]`.
- Happy path: `countLowConfidence` on a `complete` row with three low-confidence fields, one marked edited → `2`.
- Happy path: `countLowConfidence` on a `pending` row → `0` regardless of `extracted_data`.
- Happy path: `matchesSearch` matches on filename substring; matches on `extracted_data.payer.value`; case-insensitive; empty query returns true.
- Happy path: `filterByParams({type: 'w2', status: 'needs_review'})` — only rows matching both pass.
- Edge case: `mergeEvents` with two updates for same id — the one with the newer `updated_at` wins regardless of input order.
- Edge case: `applyEvent` with a delete for a row not in state → no-op, no throw, stable reference for rows that didn't change.
- Edge case: `mergeEvents` drops any event where `workspaceId` differs from the authed id — no cross-workspace leakage even if RLS misbehaves.
- Edge case: `countLowConfidence` on a `complete` row with `extracted_data: null` → `0`.
- Edge case: `countLowConfidence` on a `complete` row with `edited_fields: null` → every low-confidence field counts (no entries are marked edited).
- Edge case: `matchesSearch` with `extracted_data` containing non-string leaves under `payer` → skipped cleanly (no throw, no coercion).
- Edge case: `filterByParams({type: 'all', status: null})` → identity.
- Edge case: `parseDashboardSearchParams` with `?status=bogus` → `status` drops to `null` (pass-through), no throw.
- Integration: merging 100 events over a 50-row initial list remains O(n + m) and produces a stable sort-by-`created_at-DESC` output when the table sorter runs afterwards.

**Verification:**

- `npm test -- live-feed` passes all cases.
- No imports of `react`, `@supabase/*`, or anything from `@/components/**`.

---

- [x] **Unit 11b: Server Component + Client Component shell (initial fetch, wiring, URL params)**

**Goal:** Replace the dashboard stub with a functional Server Component that reads URL params, runs the initial query, and hands off to a Client Component that reconciles Realtime events via Unit 11a's reducer.

**Requirements:** R15, R16, R17, R33 (failed-row toast + inline error popover wiring), R13a chip rendering.

**Dependencies:** Unit 11a.

**Files:**

- Modify: `src/app/(app)/dashboard/page.tsx` — Server Component.
- Create: `src/app/(app)/dashboard/DashboardTable.tsx` — Client Component.
- Create: `src/app/(app)/dashboard/DashboardFilters.tsx` — Client Component that renders the two `Select`s and search `Input`, syncing to URL via `useRouter().replace()`.
- Create: `src/app/(app)/dashboard/StatusCell.tsx` — Client Component (status chip + failed-row popover + low-confidence count chip).
- Create: `src/app/(app)/dashboard/ConfidenceCountChip.tsx` — presentational badge.
- Create: `src/app/(app)/dashboard/DashboardTable.test.ts` — unit test against the table's port (narrow — asserts orchestration, not JSX).

**Approach:**

- `dashboard/page.tsx` (Server Component):
  - Accept `searchParams: Promise<Record<string, string | string[] | undefined>>`, `await` it.
  - Call `getAuthenticatedContext()` once for `workspaceId`. (The layout already redirects unauthed users; this call is for the id.)
  - Run initial query via `createSupabaseServerClient()` → `from('documents').select('<narrow columns>').eq('workspace_id', workspaceId).order('created_at', { ascending: false })`. Do not `.limit()` — caps are enforced upstream.
  - Parse `searchParams` with `parseDashboardSearchParams` from Unit 11a for first paint.
  - Render `<DashboardTable workspaceId={...} initialRows={...} initialParams={...} />`.
- `DashboardTable.tsx` (Client Component — thin adapter):
  - Constructs a `DashboardLivePort` inline: `subscribe(workspaceId, onEvent)` wraps the browser client's `channel('documents:w:{id}').on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: `workspace_id=eq.${workspaceId}` }, payload => ...)`; `fetchInitial(workspaceId)` uses the same browser client to re-fetch (second source of truth per parent plan).
  - On mount: (1) subscribe and buffer events into an array; (2) fetch initial; (3) call `mergeEvents(fetched, buffered, workspaceId)`; (4) switch to applying subsequent events via `applyEvent` into a `useState<DocumentRow[]>`.
  - On each UPDATE event: if new `status === 'failed'` AND the doc id hasn't fired a toast this session, fire a Sonner toast ("Extraction failed: <filename>") and add the id to a `Set` ref.
  - Renders `DashboardFilters` + a shadcn `Table`. Rows are computed as `filterByParams(rows, currentParams).filter(r => matchesSearch(r, debouncedQuery))`.
  - Each row renders: filename as `<Link href={\`/documents/${id}\`}>`, `doc_type`label (or em-dash on null),`StatusCell`(shows the status pill + failed-popover + low-confidence count chip), created_at formatted (localized date),`DeleteDocumentButton` from Unit 11d.
  - Unmount: `channel.unsubscribe()` + teardown via React `useEffect` cleanup.
- `DashboardFilters.tsx`:
  - shadcn `Select` for doc_type (All, W-2, 1099-NEC, 1099-MISC, K-1) and status (All + each enum value).
  - shadcn `Input` for search, with a ~200ms debounce hook local to the component.
  - Every change calls `router.replace(\`/dashboard?${new URLSearchParams(...)}\`, { scroll: false })`. The Server Component re-renders; the Client Component's `initialParams`prop is ignored after hydration (local state wins), so the`replace` is primarily for deep-linkable filter state and U13's export.
- `StatusCell.tsx`: renders a `Badge` for each `document_status` (color-coded); when `status === 'failed'`, clickable red icon opens a `Popover` with `error_message`; when `status === 'complete'`, renders `<ConfidenceCountChip n={countLowConfidence(row, CONFIDENCE_THRESHOLD)} />` beside the pill (hidden when n=0).
- Do NOT wire delete in this unit — Unit 11d adds `DeleteDocumentButton` and the DELETE route. Until then render a disabled kebab placeholder or omit the actions column; choose at implementation time based on table balance.

**Execution note:** Test the orchestration at the port boundary — mock the port and drive `onEvent` with canned payloads, assert `useState` reflects the merged rows. Skip JSX assertions (project has no RTL / jsdom).

**Patterns to follow:**

- `src/components/upload/UploadDropzone.tsx` for the Client-Component-as-thin-adapter style.
- `src/app/(app)/upload/page.tsx` for the Server Component shell.
- `(app)` layout's existing DemoBanner/TopNav — do NOT re-render them in the page.

**Test scenarios:**

- Happy path: port emits INSERT for a new row while initial fetch is in flight → after both settle, state contains exactly one copy of that row.
- Happy path: port emits UPDATE where new `status='complete'` and `extracted_data` has 3 low-confidence fields → state reflects the update; the row's low-confidence count is 3.
- Happy path: port emits UPDATE to `status='failed'` → Sonner `toast.error` invoked once, captured via a port `onToast` seam or a sonner spy.
- Edge case: port emits two UPDATE events for the same id in the same tick (newer `updated_at` arrives first) → state shows the newer version after both land.
- Edge case: port emits DELETE for an id that was filtered out of the visible rows → no crash.
- Edge case: port emits an event with a different `workspace_id` → event dropped (reducer's belt-and-suspenders defense).
- Error path: `fetchInitial` rejects → state falls back to `initialRows` from props (no blank screen); a one-time toast notifies the user ("Couldn't refresh; reconnecting…").
- Integration (URL params): `initialParams` prop drives the first render's filter set; after mount, `DashboardFilters` changes call `router.replace` with the expected query string.

**Verification:**

- Manual: open `/dashboard`, watch `pending → processing → complete` animate live as an upload runs in another tab.
- Visual: chip appears on `complete` rows with low-confidence fields; absent otherwise; failed rows show the red inline error + popover.
- `npm test -- DashboardTable` passes.
- No Realtime events leak cross-workspace (verified in Unit 11e's integration walkthrough).

---

- [x] **Unit 11c: Pure DELETE handler (port + orchestration)**

**Goal:** Ship the pure `handleDocumentDelete(request, port)` that the DELETE route will adapt. No `server-only` imports, fully unit-testable.

**Requirements:** R20, R33, R28b (membership enforced on server).

**Dependencies:** None (parallel-safe with 11a/11b).

**Files:**

- Create: `src/lib/documents/delete.ts`
- Create: `src/lib/documents/delete.test.ts`

**Approach:**

- Define `DocumentDeletePort`:
  - `getAuthContext(): Promise<AuthenticatedContext | null>`
  - `checkOrigin(req: Request): boolean`
  - `loadDocument(id: string): Promise<{ id: string, workspaceId: string, storagePath: string } | null>`
  - `isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean>` — redundant with `getAuthContext` but defensive against a future where a user has multiple memberships.
  - `removeStorageObject(storagePath: string): Promise<{ ok: true } | { ok: false, kind: 'not_found' | 'other', error: string }>`
  - `deleteDocumentRow(id: string, workspaceId: string): Promise<{ ok: true } | { ok: false, error: string }>`
- `handleDocumentDelete(request, documentId, port)`:
  1. Check origin → 403 on fail.
  2. Get auth context → 401 if null.
  3. Load document → 404 if null.
  4. Verify `document.workspaceId === auth.workspaceId` → 404 (deliberately not 403; avoid existence leaks across tenants per the cross-tenant-teleport solution doc).
  5. `removeStorageObject(storagePath)` — treat `not_found` as success (idempotent retry). Treat `other` as 500.
  6. `deleteDocumentRow(id, workspaceId)` — 500 on failure. (Scoped by workspace id to satisfy RLS even on service-role call.)
  7. Return 204.
- Every return path: `Response` with JSON body for non-204 (`{ error: '<code>' }`) for the client to map.

**Execution note:** Test-first. Every branch above has a test.

**Patterns to follow:**

- `src/lib/upload/finalize.ts` — same pure-handler shape; same error-code vocabulary (`unauthorized`, `forbidden`, `not_found`, `storage_error`, `db_error`).

**Test scenarios:**

- Happy path: valid auth + membership + row loads + Storage remove ok + row delete ok → 204.
- Edge case: Storage `remove` returns `not_found` (object already gone, prior delete half-succeeded) → still proceeds to row delete; still 204.
- Error path: origin check fails → 403.
- Error path: `getAuthContext` returns null → 401.
- Error path: `loadDocument` returns null → 404.
- Error path: `document.workspaceId !== auth.workspaceId` → 404 (not 403 — do not leak existence).
- Error path: `removeStorageObject` returns `{ ok: false, kind: 'other' }` → 500; row is NOT deleted (no orphan).
- Error path: `removeStorageObject` ok, `deleteDocumentRow` fails → 500 (accepted: leaves a row with no Storage object; next manual delete retry is a no-op on Storage and completes row delete — idempotent).
- Integration: port assertions — `removeStorageObject` is called exactly once before `deleteDocumentRow`, never after, never in parallel.

**Verification:**

- `npm test -- documents/delete` passes.
- Module has no `server-only` import, no Supabase client import.

---

- [x] **Unit 11d: DELETE route adapter + DeleteDocumentButton**

**Goal:** Wire the pure handler to the real service-role client via a port assembled in the route file; add the shadcn `AlertDialog` button that calls it from the table.

**Requirements:** R20, R33.

**Dependencies:** Unit 11b (table to render the button), Unit 11c (handler).

**Files:**

- Create: `src/app/api/documents/[id]/route.ts`
- Create: `src/app/(app)/dashboard/DeleteDocumentButton.tsx`

**Approach:**

- `route.ts`:
  - `export const DELETE = async (request, ctx) => { const { id } = await ctx.params; return handleDocumentDelete(request, id, createRealPort()); }`.
  - `createRealPort()` returns a `DocumentDeletePort` wired to:
    - `getAuthContext: getAuthenticatedContext`
    - `checkOrigin: isSameOriginRequest`
    - `loadDocument`: `service.from('documents').select('id, workspace_id, storage_path').eq('id', id).maybeSingle()`.
    - `isWorkspaceMember`: `service.from('workspace_members').select('workspace_id').eq('user_id', userId).eq('workspace_id', workspaceId).maybeSingle()`.
    - `removeStorageObject`: `service.storage.from('documents').remove([storagePath])` — inspect `data[]` / `error` for a "not found" signal. Map to the discriminated return.
    - `deleteDocumentRow`: `service.from('documents').delete().eq('id', id).eq('workspace_id', workspaceId)`.
- `DeleteDocumentButton.tsx` (Client Component):
  - Props: `{ id: string, filename: string, onDeleted: (id: string) => void }`.
  - Renders a destructive-variant `AlertDialog` with trigger = small trash icon button in the row actions cell; confirm button is labeled "Delete document" (destructive variant).
  - On confirm: `onDeleted(id)` is called immediately (optimistic — parent removes the row); `fetch('/api/documents/' + id, { method: 'DELETE' })`. On non-204: re-insert the row (parent callback or explicit revert callback) + `toast.error("Couldn't delete — try again.")`.
  - After successful DELETE: no-op (Realtime DELETE event will also fire; the reducer's DELETE-for-unknown-id branch makes that idempotent).
  - Uses `aria-label` on the trigger icon button so it's discoverable by keyboard.

**Execution note:** The route has no new logic — all branches live in Unit 11c. A single smoke test that asserts `route.DELETE` calls `handleDocumentDelete` with a port shaped like `createRealPort` is sufficient. DeleteDocumentButton has no unit tests (JSX-heavy, no RTL); verify manually.

**Patterns to follow:**

- `src/app/api/upload/finalize/route.ts` — mirror the `createRealPort()` shape.
- `src/components/upload/UploadDropzone.tsx` — sonner error toast vocabulary.
- shadcn `alert-dialog` usage as generated by the CLI.

**Test scenarios:**

- Happy path (integration): seed a doc, DELETE via the route, assert row gone and Storage object gone.
- Error path (integration): DELETE with no session cookie → 401.
- Error path (integration): DELETE a document in workspace B while authed to workspace A → 404.
- Manual: click delete in the UI → dialog; cancel → nothing happens. Confirm → row removed; DB row gone; Storage object gone in bucket.
- Manual: click delete, server returns 500 (simulate by temporarily returning a 500) → row re-appears; error toast.

**Verification:**

- `curl -X DELETE /api/documents/<id>` (with session) returns 204.
- Supabase Storage explorer shows object gone; `SELECT * FROM documents WHERE id = '<id>'` returns zero rows.
- Manual UX flow passes.

---

- [x] **Unit 11e: Cross-workspace isolation verification walkthrough** _(proven at the RLS layer via `SET LOCAL request.jwt.claims` matrix on 2026-04-23; User B sees zero rows of workspace A across documents/workspaces/workspace_members, and the mirror for User A. See `docs/solutions/best-practices/u11-two-workspace-rls-isolation-proof-2026-04-23.md`. Live two-browser walkthrough still recommended when Unit 14's seed script ships.)_

**Goal:** Explicit, documented two-workspace side-by-side test run that validates R3 + R17 + R28b together. This is not code — it is a documented manual test scenario the implementer runs and records the outcome of, because it is the single most important correctness guarantee for this unit per the parent plan.

**Requirements:** R17, R28b, R3.

**Dependencies:** Units 11a–11d complete.

**Files:**

- Create: `docs/solutions/best-practices/u11-two-workspace-realtime-verification-2026-04-22.md` (only if a finding emerges; skip otherwise).

**Approach:**

- Using the seeded workspaces from the seed script, log into workspace A in browser 1 and workspace B in browser 2.
- Upload a PDF in workspace A while watching workspace B's dashboard.
- Assert: workspace B's table is unchanged; no toast fires; no INSERT event arrives (verify via browser devtools Network tab → WS frames).
- Upload a PDF in workspace B; assert symmetrically.
- Trigger a `failed` transition in workspace A (e.g., upload a malformed PDF the pipeline can't parse); assert the failure toast fires in A and not in B.
- Delete a row in workspace A; assert the row disappears in A and workspace B sees no event.

**Test scenarios:**

- Integration: zero cross-workspace Realtime events over a 5-minute interleaved session.
- Integration: zero cross-workspace rows rendered.
- Integration: deleting in A does not affect B's UI.

**Verification:**

- Walkthrough is completed and the outcome ("no leakage observed") is noted in the PR description.
- If any leakage is observed, this unit blocks merge and a solution doc is written in `docs/solutions/security-issues/`.

## System-Wide Impact

- **Interaction graph:** Dashboard reads `documents` (Realtime); Dashboard writes via DELETE only. No mutations to `workspace_members` or `workspaces`. Realtime channel lifecycle is tied to the `DashboardTable` mount; unsubscribe on unmount is load-bearing (prevents leaked channels across client-side navigations).
- **Error propagation:** Route-level 4xx/5xx → client maps to toast + reverts optimistic UI. Realtime stream errors (channel drops) surface as Supabase-js reconnection logs; the reducer's idempotent replays absorb duplicates. A failed INITIAL fetch falls back to the Server-Component-supplied rows.
- **State lifecycle risks:** (1) Race between initial fetch and first CDC events — mitigated by the buffer-then-merge pattern in Unit 11a. (2) DELETE half-success (Storage ok, row fail) — mitigated by idempotent retry semantics in Unit 11c. (3) Stale `edited_fields` affecting the count chip — mitigated by recomputing from live row state, not memoized at INSERT time.
- **API surface parity:** `src/app/api/documents/[id]/route.ts` gains DELETE. U12 will add PATCH and preview-url on adjacent paths; the DELETE handler here does not constrain those.
- **Integration coverage:** Unit 11e (two-workspace test) is the load-bearing integration check. Unit 11a unit tests cover the merge machine. The DELETE route has route-level integration via Unit 11d.
- **Unchanged invariants:** RLS on `documents`, `workspace_members`, `storage.objects` (see migrations 02, 04, 11, 18) is not modified. Realtime publication (migration 05), REPLICA IDENTITY FULL (migration 19), and `update_extraction_result` grants (migration 06/09) are all untouched. The `(app)` layout's auth flow is untouched. U10's upload surface is untouched.

## Risks & Dependencies

| Risk                                                                                                           | Mitigation                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial-fetch-vs-first-CDC-event race (row inserted between the SSR query and the subscription open is missed) | The Client Component buffers subscription events, then re-fetches via browser client, then merges; `mergeEvents` is unit-tested (Unit 11a).                                                             |
| Cross-workspace Realtime leakage breaks the whole multi-tenant story                                           | Defense in depth: RLS on SELECT gates CDC (migration 05); channel filter `workspace_id=eq.${id}`; reducer drops any event whose `workspace_id` mismatches the authed id. Verified manually in Unit 11e. |
| DELETE half-succeeds (Storage ok, row fail) leaving a row with no bytes                                        | Pure handler treats a retried Storage `not_found` as success → idempotent. Accepted failure mode; documented.                                                                                           |
| DELETE half-succeeds (row ok, Storage fail) leaving an orphan PDF                                              | Handler does Storage remove FIRST, aborts before row delete on Storage error. Impossible by construction (modulo the race where a concurrent admin deletes the Storage object; rare + recoverable).     |
| Low-confidence count chip drifts from the detail view's dots (U12)                                             | Both must call `countLowConfidence` / the same per-field predicate. This plan puts the canonical predicate in `live-feed.ts`; U12 must import it, not duplicate.                                        |
| Sonner toasts spam the user on flapping failures                                                               | Session-scoped `Set` of ids that have already fired; `reset()` on navigation.                                                                                                                           |
| `searchParams` hydration mismatch if the Client Component's `useRouter().replace` fires on first render        | The Client Component uses `initialParams` as the source of truth for first render and only `replace`s on user interaction. No render-time `replace`.                                                    |
| Client-side search performance at batch-cap boundary (~100 rows × ~20 extracted fields)                        | Substring scan over ~2000 strings per debounce tick is microseconds; no issue.                                                                                                                          |
| `REPLICA IDENTITY FULL` overhead at demo scale                                                                 | Already accepted in migration 19 (negligible at ≤100 docs/workspace).                                                                                                                                   |
| Realtime channel count leaks across client-side navigations within `(app)`                                     | `useEffect` cleanup calls `channel.unsubscribe()`; browser-client singleton survives — that's correct, only the channel is torn down.                                                                   |

## Documentation / Operational Notes

- Update `README.md` dashboard section if present to note Realtime + filter URL behavior. (Skip if README doesn't already describe per-feature behavior; parent plan is authoritative.)
- No new environment variables. No migrations.
- If Unit 11e surfaces a leakage, write a solution doc under `docs/solutions/security-issues/`.
- If Unit 11a's `countLowConfidence` needs expansion when U12 lands (e.g., handling nested arrays for 1099-MISC boxes), update it in place — it is the canonical predicate.

## Sources & References

- **Origin document:** [docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md](../plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md) — Unit 11 specification, lines ~752–800.
- Related code: `src/app/(app)/layout.tsx`, `src/lib/supabase/browser.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/service.ts`, `src/lib/auth/require-auth.ts`, `src/lib/auth/origin-check.ts`, `src/app/api/upload/finalize/route.ts`, `src/components/upload/UploadDropzone.tsx`, `src/lib/upload/client-batch.ts`, `src/lib/extraction/config.ts`, `src/lib/database.types.ts`.
- Related migrations: `supabase/migrations/20260421000005_realtime_publication.sql`, `20260421000018_storage_path_tenant_scoping.sql`, `20260421000019_documents_replica_identity_full.sql`.
- Institutional learnings: `docs/solutions/best-practices/testable-client-component-via-di-port-and-thin-adapter-2026-04-22.md`, `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md`, `docs/solutions/best-practices/multi-write-route-idempotency-and-rollback-2026-04-22.md`, `docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md`, `docs/solutions/best-practices/nextjs-supabase-shadcn-scaffolding-defaults-2026-04-21.md`.
