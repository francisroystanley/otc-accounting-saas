---
title: feat: retry P1 hardening — deterministic-failure 200 + workspace rate limit
type: feat
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-004-feat-pdf-retry-mechanism-plan.md
---

# feat: retry P1 hardening — deterministic-failure 200 + workspace rate limit

## Overview

Addresses the two P1 present findings surfaced by document-review of the
retry-mechanism plan (`docs/plans/2026-04-24-004-feat-pdf-retry-mechanism-plan.md`):

1. **Tighten the Gemini-call ceiling from 40 to 10 per pathological PDF.**
   Today `src/app/api/extract/route.ts:55-59` returns 500 on
   `PipelineFailedError`. QStash sees 500 and retries up to 3 times. That
   turns every deterministic extraction failure into 4 Gemini calls. This
   plan changes the response to 200 with a `{ status: "failed", reason:
"extraction_failed" }` body — QStash treats 200 as success and does not
   retry. The row is already durably marked `failed` by `writeResult` before
   the response is sent, so nothing is lost. Uncaught non-`PipelineFailedError`
   exceptions continue to return 500 (transient infrastructure errors remain
   retryable).

2. **Bound aggregate Gemini spend across a workspace.** Today's per-document
   cooldown (30 s) and per-document cap (10) do not bound cost across many
   failed documents. A workspace with 50 failed rows can burst 200 Gemini
   calls (50 × 4) before the parent plan's "deterministic-failure 200" lands;
   even after (1) lands, 50 bursts to 50 calls. This plan adds a
   **workspace-level rate limit of 5 retries per rolling 60-second window**,
   enforced inside the `reset_document_for_retry` RPC (so the check is
   atomic with the reset). A new tiny table `retry_events` records
   `(workspace_id, occurred_at)` per retry; the RPC counts rows in the last
   60 s for the workspace and returns `kind = 'workspace_rate_limit'` when
   over the limit. Route handler maps that to HTTP 429.

Small, surgical, two implementation units.

## Problem Frame

The parent plan explicitly deferred these two items (see origin doc's
`Deferred to Separate Tasks`: "Make `/api/extract` return 200 on
deterministic extraction failures" and "Workspace-level retry rate limit").
Document-review of the parent plan rated both as P1 because each
materially improves the cost story of the retry feature without adding
significant complexity. The parent plan lands the foundation; this plan
completes the cost-bound story.

See origin: `docs/plans/2026-04-24-004-feat-pdf-retry-mechanism-plan.md`
(specifically Key Technical Decisions → "Total Gemini-call ceiling is 40"
and Risks table → "Workspace with many failed docs").

## Requirements Trace

- **R1.** `src/app/api/extract/route.ts` returns HTTP 200 with
  `{ status: "failed", reason: "extraction_failed", documentId }` when the
  pipeline throws `PipelineFailedError`. QStash must not retry in this case.
- **R2.** Other uncaught exceptions in the extract handler continue to
  return 500 so QStash retries (transient infrastructure failures are
  still recoverable at the queue layer).
- **R3.** A new table `retry_events(workspace_id uuid, occurred_at
timestamptz default now())` is introduced with a supporting index.
- **R4.** `reset_document_for_retry` (introduced in the parent plan's
  Migration 24) gains a workspace-rate-limit check as a precondition.
  Threshold: 5 retry events per workspace in the last 60 s. Exceeding the
  limit returns `{ ok: false, kind: 'workspace_rate_limit' }`.
- **R5.** On `kind = 'workspace_rate_limit'` the retry route handler
  returns HTTP 429 with body `{ error: 'workspace_rate_limit' }` and a
  `Retry-After: 60` header.
- **R6.** Successful resets insert a row into `retry_events` atomically
  with the reset UPDATE (same RPC transaction). Failed resets (any
  non-ok `kind`) do NOT insert.
- **R7.** `RetryErrorCode` union in `src/lib/documents/retry.ts` gains
  `'workspace_rate_limit'`. Client toast map: `"This workspace has
retried too many documents recently. Try again in a minute."`
- **R8.** The `retry_events` table has no RLS (service-role-only access)
  and no grants to `authenticated`. It is a private rate-limit counter.

## Scope Boundaries

- **Not in scope:** Per-user (rather than per-workspace) rate limiting.
  Workspace is the right granularity for a cost bound; per-user is an
  abuse-detection concern outside demo scope.
- **Not in scope:** Configurable rate-limit thresholds per workspace tier
  (e.g., "enterprise customers get 20/min"). Single constant for all.
- **Not in scope:** Global (cross-workspace) rate limit. Every workspace
  is independent; noisy neighbors cannot starve others.
- **Not in scope:** Scheduled cleanup/rotation of `retry_events` rows.
  At demo volume (< 100 events/workspace/day) the table stays small. A
  cron for monthly prune is a follow-up if retention ever becomes an
  operational concern.
- **Not in scope:** Displaying the rate-limit window or a "retries
  remaining" counter in the UI. Feedback is toast-only on hit.
- **Not in scope:** Distinguishing transient Gemini errors (503, timeout)
  from deterministic ones (invalid PDF). The `PipelineFailedError`
  umbrella collapses both, and the parent plan's 40× ceiling is already
  tightened to 10× by treating all pipeline-level failures as terminal.
  Future work could classify further (listed under Deferred to Separate
  Tasks below) but is outside scope here.
- **Not in scope:** Changing the QStash `retries: 3` default on the
  initial finalize publish. Transient 5xx from the extract handler
  (non-`PipelineFailedError`) still benefits from QStash retries.

### Deferred to Separate Tasks

- **Scheduled cleanup of `retry_events`** — a pg_cron job or a weekly
  `delete from retry_events where occurred_at < now() - interval '7 days'`
  if table growth becomes operational. Monitor first; do nothing until
  needed.
- **Transient vs. deterministic error classification inside the
  extraction pipeline** — would let a transient Gemini 503 surface as
  500 (QStash retries) even after this plan lands. Today all pipeline
  errors are collapsed into `PipelineFailedError`.
- **Per-workspace rate-limit configurability** — when tier model exists.

## Context & Research

### Relevant Code and Patterns

- **`src/app/api/extract/route.ts:55-59`** — the exact 3-line block
  being modified for R1/R2. Error classification is already narrow
  (`error instanceof PipelineFailedError`), so the surgical change is
  clean.
- **`src/lib/extract/pipeline.ts:100-114`** — confirms `writeResult(id,
'failed', null, message)` is called before the `PipelineFailedError`
  is thrown. The row is durably `failed` before the handler catches.
  That's why R1's "return 200" is safe: the state is already persisted.
- **`src/lib/documents/retry.ts`** (from parent plan, Unit 3) — where
  `RetryErrorCode` is defined and where `handleDocumentRetry` maps RPC
  `kind` values to HTTP status codes. Extension point for R7 is the
  `RetryErrorCode` union and the handler's switch on `kind`.
- **`supabase/migrations/20260421000024_reset_document_for_retry.sql`**
  (from parent plan, Unit 1) — where the rate-limit check is added to
  the RPC body as another precondition. Same SECURITY DEFINER,
  `search_path = ''` idiom as the parent.
- **`supabase/migrations/20260421000022_documents_retry_columns.sql`**
  (from parent plan, Unit 1) — precedent for adding columns without
  granting UPDATE to `authenticated`. Same discipline applied to
  `retry_events` (REVOKE ALL on the table from `authenticated`/`anon`).
- **Migration filename convention** — `YYYYMMDDNNNNNN_snake_case.sql`,
  6-digit counter, day kept at `20260421`. Next sequence after parent
  plan's 22-24 is **26**.

### Institutional Learnings

- **`docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md`** — the retry handler is already port-shaped; R5/R7 extend
  the port's `resetForRetry` result type without changing the shape.
- **`docs/solutions/best-practices/user-session-patch-with-status-scoped-toctou-guard-2026-04-23.md`** — the `retry_events` insert + count happens inside the RPC's
  single transaction so the rate-limit check and the reset are atomic,
  matching the TOCTOU discipline from this learning.
- **`docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md`** — column-grant / table-grant discipline. `retry_events` is
  service-role-only, no `authenticated` grants.

### External References

External research skipped — the work sits on established local patterns
(Supabase RPC, QStash webhook response codes). Rate-limiting via a
write-and-count table is a well-understood primitive; no need to lean on
Upstash Ratelimit SDK or similar for demo scope.

## Key Technical Decisions

- **Return 200 on `PipelineFailedError`, keep 500 for everything else.**
  `PipelineFailedError` is the pipeline's contract for "ran to
  completion, wrote `failed` to the row, call cycle is done." Retrying
  at the QStash layer can only repeat the same outcome. Bare `throw`
  paths (Supabase down, Gemini HTTP 502 not captured as
  `PipelineFailedError`, unexpected TypeError) continue to 500 because
  those are more likely to be transient. This is the minimum change
  that tightens the ceiling without losing transient recovery.
- **Rate-limit check lives inside `reset_document_for_retry`, not in
  the handler.** Atomicity matters: without it, two concurrent retries
  from the same workspace could both pass a handler-side check and
  both reset. Putting the check + insert inside the RPC gives a
  single-transaction guarantee. Cost: the RPC migration in the parent
  plan needs to be extended (or a new migration replaces it); chosen:
  new replacement migration to preserve review history.
- **New `retry_events` table over a column counter on `workspaces`.**
  A counter column would require reset logic and a "window start"
  timestamp — effectively a hand-rolled sliding window. A tiny
  append-only event table with an index is the standard shape and
  composes with future rate-limit needs (batch retry, export retry)
  without schema churn.
- **Threshold: 5 retries per 60-second window.** Matches a sensible
  power-user upper bound: a reviewer triaging a batch of failures
  might retry 3-4 at once; 5 is above normal use but well below any
  cost-disruption level. Single constant in the migration, easy to
  tune later without code changes (just migration amend).
- **Count retries at RPC commit time, not at publish success.**
  Matches the parent plan's "cap counts intent, not publishes"
  discipline. A user who hits the rate limit genuinely consumed the
  intent to retry; QStash publish failure downstream does not refund.
- **429 with `Retry-After: 60`.** Standard HTTP semantics; makes the
  endpoint behave correctly against generic HTTP clients and future
  admin tools. Client toast message includes the wait guidance.
- **No rate-limit bypass for "failed" state transitions that were not
  user-initiated.** Every path through `reset_document_for_retry` is
  user-initiated (the RPC is only called from the retry endpoint).
  No carve-outs needed.
- **No RLS on `retry_events`.** Table is service-role-only. Users
  never see this table, no multi-tenant read surface, and exposing it
  via RLS would only complicate the threat model. Table-level
  `REVOKE ALL FROM authenticated, anon` is the fence.

## Open Questions

### Resolved During Planning

- **Handler-side vs. RPC-side rate-limit check** — Resolved as
  RPC-side for atomicity.
- **Window primitive (counter vs. event table)** — Resolved as event
  table for simplicity and composability.
- **Threshold value** — Resolved as 5 per 60-second rolling window.
- **How to prevent QStash from retrying a deterministic failure** —
  Resolved: return 200 on `PipelineFailedError`. Any status in the
  2xx range signals success to QStash.
- **What to do when a row in `processing` has its extract handler
  swallowed by a non-`PipelineFailedError` throw after this plan
  lands** — Resolved (unchanged from today): QStash retries up to 3
  times, handler runs again, `claimForProcessing` sees non-`pending`
  and returns `already_processed`, retry short-circuits harmlessly.
  The parent plan's `claim_token` invariant (R10a there) protects
  any late writer from clobbering.

### Deferred to Implementation

- **Retry-after header value calculation** — hardcoded 60 s matches
  the window. If the window becomes configurable, derive from the
  constant.
- **Whether `retry_events` should be partitioned by time** — at demo
  volume, no. A `btree(workspace_id, occurred_at desc)` index handles
  query performance.
- **Exact PL/pgSQL shape of the rate-limit check** — will be an
  additional `if` in the existing RPC body. Implementation-time detail.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance
> for review, not implementation specification._

**Extract route flow change (R1/R2):**

```
handleExtract(request):
  parse body -> 400 on failure
  runExtractPipeline(...)
    - returns unauthorized   -> 404/403 (unchanged)
    - returns already_processed -> 200 noop (unchanged)
    - returns complete       -> 200 ok (unchanged)
    - throws PipelineFailedError
      BEFORE:  return 500 { error: 'extraction_failed' }        -- QStash retries 3x
      AFTER:   return 200 { status: 'failed', reason: 'extraction_failed', documentId }
                                                                -- QStash sees success, stops
    - throws anything else   -> rethrow (Next.js returns 500, QStash retries)
```

**reset_document_for_retry flow with rate-limit precondition (R3-R6):**

```
reset_document_for_retry(doc_id uuid, cooldown_seconds int) returns jsonb:

  1. existing state/cap/cooldown checks (return kind: state|cap|cooldown)
  2. NEW: workspace rate-limit check
     - select count(*) from retry_events
       where workspace_id = (select workspace_id from documents where id = doc_id)
         and occurred_at > now() - interval '60 seconds'
     - if count >= 5, return { ok: false, kind: 'workspace_rate_limit' }
  3. existing reset UPDATE (status=pending, etc.)
  4. NEW: insert into retry_events (workspace_id, occurred_at)
     values ((select workspace_id ...), now())
  5. return { ok: true, new_retry_count }

  Entire body runs in one implicit transaction; rate check and reset
  are atomic.
```

**Handler status-code mapping (R5/R7):**

```
resetForRetry port result -> HTTP response
  ok:true                   -> 202 { ok: true }
  kind:'state'              -> 409 { error: 'retry_not_allowed_status' }
  kind:'cap'                -> 409 { error: 'retry_limit_reached' }
  kind:'cooldown'           -> 429 { error: 'cooldown_active' }
  kind:'workspace_rate_limit' -> 429 { error: 'workspace_rate_limit' }
                                 + header "Retry-After: 60"
```

## Implementation Units

- [ ] **Unit 1: Extract route returns 200 on deterministic failure**

**Goal:** Stop QStash retries on `PipelineFailedError`. Tightens Gemini
ceiling from 40 to 10 per pathological document.

**Requirements:** R1, R2

**Dependencies:** None (independent of the rate-limit unit; can ship
first or in parallel with Unit 2)

**Files:**

- Modify: `src/app/api/extract/route.ts`

**Approach:**

- Replace lines 55-59 (the `PipelineFailedError` catch branch) to
  return HTTP 200 with body
  `{ status: "failed", reason: "extraction_failed", documentId }`.
- The log line (`console.error`) stays — we still want visibility
  into extraction failures. Just the HTTP status changes.
- The fall-through `throw error` on line 62 is unchanged:
  non-`PipelineFailedError` uncaught exceptions continue to return
  500 via Next.js's default error handler, which QStash will retry.
- No other logic changes.

**Patterns to follow:**

- Existing success branches (lines 50-54) already return 200 with
  a structured body — mirror that shape.
- `outcome.kind === "already_processed"` branch (line 50) is a
  precedent for returning 200 with a non-ok structural status.

**Test scenarios:**

- Test expectation: none directly for this unit at the unit-test
  level — the change is a response-code flip with no behavioral
  branching to cover. Coverage is:
  - Happy path (unchanged): pipeline returns `complete` → 200 ok.
  - New path: pipeline throws `PipelineFailedError` → 200 with
    `{ status: 'failed', reason: 'extraction_failed' }`. If there
    is an existing `src/app/api/extract/route.test.ts` (or a
    handler-level test), add one assertion for the 200 + body.
    If there is no existing handler-level test, do NOT create one
    for this change alone (the existing `pipeline.test.ts`
    already covers the pipeline behavior).

**Verification:**

- Trigger an extraction failure end-to-end (e.g., upload a
  magic-bytes-valid but structurally-broken PDF that Gemini
  rejects) and observe in QStash logs that only 1 delivery
  attempt occurs, not 4.
- Confirm the `documents` row is marked `failed` with an
  `error_message` (unchanged behavior).
- `npm test` still green.

---

- [ ] **Unit 2: Workspace-level retry rate limit**

**Goal:** Bound aggregate Gemini cost across a workspace's documents.
Prevents a bursty triage session on 50 stuck rows from firing 50 retries
in 10 seconds.

**Requirements:** R3, R4, R5, R6, R7, R8

**Dependencies:** Parent plan's Unit 1 (the `reset_document_for_retry`
RPC and the retry handler/route must exist before this plan extends
them). Unit 2 of this plan lands in the same PR as the parent plan's
migrations, or in a follow-up PR after the parent has merged.

**Files:**

- Create: `supabase/migrations/20260421000026_retry_events.sql`
- Create: `supabase/migrations/20260421000027_reset_document_for_retry_rate_limit.sql`
- Modify: `src/lib/documents/retry.ts` (extend `RetryErrorCode` union;
  add `kind: 'workspace_rate_limit'` handling in the handler's switch;
  set `Retry-After: 60` header)
- Modify: `src/lib/documents/retry.test.ts` (add rate-limit scenarios)
- Modify: `src/components/documents/RetryDocumentButton.tsx` (add toast
  mapping for `workspace_rate_limit`)
- Modify: `src/components/documents/RetryDocumentButton.test.ts`
  (assert new toast outcome)

**Approach:**

- Migration 26 (`retry_events`):
  - `create table public.retry_events (workspace_id uuid not null
references public.workspaces(id) on delete cascade, occurred_at
timestamptz not null default now())`.
  - Index: `create index retry_events_workspace_id_occurred_at_idx
on public.retry_events (workspace_id, occurred_at desc)`.
  - `revoke all on public.retry_events from public, anon,
authenticated`. Table is service-role-only.
  - No RLS enabled (no user-session access path exists, so RLS
    would be dead code).
- Migration 27 (`reset_document_for_retry` v2):
  - `create or replace function` replacing the parent plan's body.
  - Adds the new rate-limit precondition between existing cooldown
    check and the reset UPDATE. Threshold is a named constant at
    the top of the function body (`v_rate_limit_count constant int
:= 5; v_rate_limit_window constant interval := '60 seconds';`)
    so future tuning is a one-line amend.
  - Insert into `retry_events (workspace_id, occurred_at)` happens
    **after** the successful reset UPDATE, inside the same
    transaction. If the reset somehow fails after the insert the
    whole transaction rolls back.
  - Returns `{ ok: false, kind: 'workspace_rate_limit' }` when
    threshold exceeded. JSON shape consistent with existing
    kinds.
  - Preserves SECURITY DEFINER, `search_path = ''`, and
    service_role-only grant.
- `retry.ts` port result type (`resetForRetry`) gains
  `kind: 'workspace_rate_limit'` as a valid `{ ok: false }`
  branch. The `RetryErrorCode` union adds
  `'workspace_rate_limit'`.
- Handler switch on `kind`: the new branch returns
  `new Response(JSON.stringify({ error: 'workspace_rate_limit' }),
{ status: 429, headers: { 'content-type': 'application/json',
'retry-after': '60' } })`. Keep shape consistent with existing
  429 (`cooldown_active`) but add the `Retry-After` header
  (cooldown path doesn't need one because it's per-document and
  client-side disabled anyway; workspace rate limit is
  cross-document so header matters for any non-UI consumer).
- `RetryDocumentButton` toast mapping adds: `workspace_rate_limit
→ "This workspace has retried too many documents recently.
Try again in a minute."`

**Execution note:** Test-first for the handler extension and the
toast mapping. Both are pure-function changes; the RPC itself is
tested through the retry handler's fake port.

**Patterns to follow:**

- Parent plan's Migration 24 (`reset_document_for_retry`) — same
  RPC hardening idiom (SECURITY DEFINER, `search_path = ''`,
  `revoke all, grant execute ... to service_role`).
- Parent plan's `retry.test.ts` — `kind: 'cooldown'` test is the
  nearest template for the new `kind: 'workspace_rate_limit'`
  test (same discriminated-union return shape, same 429 response,
  add `Retry-After` header assertion).
- `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md` — port/adapter pattern for the handler
  extension.

**Test scenarios** (handler via fake port):

- Happy path: port returns `{ ok: true }` → 202 (unchanged).
- Error path: port returns `{ ok: false, kind: 'workspace_rate_limit' }`
  → 429 with body `{ error: 'workspace_rate_limit' }` AND
  `Retry-After: 60` response header. Assert header presence and value.
- Preserve all existing `kind` branches (state, cap, cooldown) — no
  regressions.
- Edge: `Retry-After` header is NOT present on 429 for
  `kind: 'cooldown'` (the cooldown response keeps its existing
  shape); the header is rate-limit-specific.

**Test scenarios** (`requestDocumentRetry` in RetryDocumentButton):

- Fetch returns 429 with `{ error: 'workspace_rate_limit' }` →
  outcome `{ ok: false, code: 'workspace_rate_limit' }`.
- Toast for code `workspace_rate_limit` uses the specified copy.
- Existing `cooldown_active` outcome is unchanged.

**Test scenarios** (integration / RPC via handler fake):

- The fake port's `resetForRetry` is stubbed to return the new kind;
  the handler's branch wiring is what we're asserting here. The RPC
  body itself is only exercised via manual verification below
  (the codebase has no SQL/PGlite test rig today).

**Verification:**

- `npm test -- retry` and `npm test -- RetryDocumentButton` green
  including new scenarios.
- `npx supabase db reset` applies Migrations 26 and 27 cleanly.
- `npm run seed` completes (no signature changes to RPCs called by
  seed).
- Manual end-to-end: create 6 failed documents in one workspace,
  click Retry on each as fast as possible. First 5 succeed (200 /
  202); 6th returns 429 with `Retry-After: 60` and the client
  toasts the new copy. After waiting 60 seconds, the 6th click
  succeeds.
- Manual check: `select count(*) from retry_events where
workspace_id = '<ws>'` reflects the intents (5 rows for the
  successful clicks; the rate-limited click did NOT insert).

---

## System-Wide Impact

- **Interaction graph:** Unit 1 is a pure response-code flip on
  `/api/extract`; QStash stops retrying `PipelineFailedError`
  outcomes. No other caller affected. Unit 2 extends the
  `reset_document_for_retry` RPC and the retry handler; every
  `POST /api/documents/[id]/retry` now also consults `retry_events`.
  One new table with one insert per successful retry.
- **Error propagation:** The new `workspace_rate_limit` code flows
  through the existing port → handler → toast chain without any
  new primitives. `Retry-After` header is new on the retry route
  for this one path.
- **State lifecycle risks:**
  - `retry_events` is append-only. No race concerns. The
    count + insert happens inside the RPC transaction so there is
    no TOCTOU window.
  - At demo volume the table grows slowly (< 100 rows/workspace/day).
    No cleanup in scope; monitor.
- **API surface parity:** Other routes are unaffected.
- **Integration coverage:** Handler tests cover the full response
  mapping including the new `Retry-After` header. The RPC itself
  is verified manually via the end-to-end scenario in Verification.
- **Unchanged invariants:**
  - QStash signature verification on `/api/extract` (unchanged).
  - Parent plan's `claim_token` invariant (unchanged).
  - Parent plan's per-document cooldown and cap (unchanged; the
    workspace rate limit is an additional layer above them, not a
    replacement).
  - `authenticated` column grants on `documents` (unchanged).
  - Every row in `retry_events` has `workspace_id` FK-cascading
    from `workspaces`; deleting a workspace removes its retry
    history (consistent with other workspace-scoped tables).

## Risks & Dependencies

| Risk                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PipelineFailedError` is thrown for a _transient_ Gemini failure (e.g., a 503 that the pipeline couldn't distinguish). Returning 200 loses QStash's transient-recovery retry. | The pipeline already calls `writeResult(id, 'failed', ...)` before throwing, so the row is user-visible as `failed` with an error message. User-initiated retry is the recovery path; that's the whole point of the parent plan. The rare transient-that-looks-deterministic case costs the user one click. Accepted. |
| `retry_events` grows unbounded over time.                                                                                                                                     | At demo volume, rate is < 100/workspace/day. Scheduled cleanup is listed in Deferred to Separate Tasks; monitor actual growth and add if/when warranted.                                                                                                                                                              |
| Rate-limit threshold (5/60s) too low for a legitimate bulk-triage session.                                                                                                    | 5 retries in 60 s means a reviewer can still clear a batch of 5 at once, wait a minute, clear 5 more. Single constant in the RPC; easy to raise with a minor migration if real usage shows a lower ceiling needed.                                                                                                    |
| Rate-limit threshold too high to actually bound cost.                                                                                                                         | 5 retries/min × 10 per-doc × 1 call each (post-Unit-1) = up to 50 Gemini calls/hour on a pathologically failing workspace. Real cost: ~$1/hour at current Gemini pricing. Bounded; acceptable for demo.                                                                                                               |
| Unit 1 lands without Unit 2 → workspace rate limit is deferred, cost story incomplete.                                                                                        | Both units are small; ship together or Unit 1 first (it's independent and already a net improvement).                                                                                                                                                                                                                 |
| Unit 2 lands without Unit 1 → ceiling still 40 per document even with 5/min rate limit.                                                                                       | Workspace cap still bounds aggregate by throttling burst; the per-doc ceiling just stays at 40. Acceptable interim state.                                                                                                                                                                                             |
| `Retry-After: 60` header isn't consumed by the current client (it just toasts).                                                                                               | Future admin/script clients that honor `Retry-After` get the benefit automatically. No downside to sending it.                                                                                                                                                                                                        |

## Documentation / Operational Notes

- No README or user-facing docs require changes.
- The parent plan's admin-recovery SQL notes apply here too; nothing
  new operationally.
- After merge, update the parent plan's "Deferred to Separate Tasks"
  section to mark these two items as completed (link here).
- Consider adding a short `docs/solutions/` entry on "Rate limiting
  via insert-and-count inside a SECURITY DEFINER RPC" if the pattern
  gets reused elsewhere. Not required for this PR.

## Sources & References

- **Origin document:** [docs/plans/2026-04-24-004-feat-pdf-retry-mechanism-plan.md](docs/plans/2026-04-24-004-feat-pdf-retry-mechanism-plan.md)
  (parent plan — the retry mechanism this hardens)
- **Grandparent requirements:** [docs/brainstorms/2026-04-24-pdf-upload-and-document-retry-requirements.md](docs/brainstorms/2026-04-24-pdf-upload-and-document-retry-requirements.md)
- **Related code:**
  - src/app/api/extract/route.ts (Unit 1 target)
  - src/lib/extract/pipeline.ts (PipelineFailedError semantics)
  - src/lib/documents/retry.ts (Unit 2 handler extension)
  - src/components/documents/RetryDocumentButton.tsx (Unit 2 toast)
  - src/lib/qstash.ts (retries:3 behavior the 200 response now bypasses)
- **Related docs/solutions/:**
  - docs/solutions/best-practices/multi-write-route-idempotency-and-rollback-2026-04-22.md
  - docs/solutions/best-practices/user-session-patch-with-status-scoped-toctou-guard-2026-04-23.md
  - docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md
  - docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md
- **Existing migrations referenced:**
  - supabase/migrations/20260421000022_documents_retry_columns.sql (parent plan)
  - supabase/migrations/20260421000024_reset_document_for_retry.sql (parent plan — replaced by this plan's Migration 27)
