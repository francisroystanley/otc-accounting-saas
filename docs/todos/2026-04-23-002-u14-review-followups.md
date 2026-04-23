---
title: U14 ce:review follow-ups
created: 2026-04-23
status: ready
priority: p2
owner: downstream-resolver
source: .context/compound-engineering/ce-review/u14-20260423/summary.md
notes: 5 of 8 items resolved inline during LFG pipeline; 3 items remain (1 P2 dedupe refactor, 2 P3 — tests and Gemini timeout)
---

# U14 ce:review follow-ups

Audit trail for the ce:review pass on U14 (seed script). Autofix-mode fixes
landed in the U14 commit; the items below are `gated_auto` and `advisory`
findings deliberately deferred.

## Resolved during ce:review autofix

- [x] **Narrowed `collectFixturePaths` catch to `ENOENT` only.** Other I/O
      errors now propagate instead of silently skipping a fixture directory.
      (kt-003, T3 → `scripts/seed-demo.ts`)

- [x] **Numeric-aware fixture sort.** Mirrors `sampleIndex` from
      `scripts/extract-report.ts` so `sample2.pdf` precedes `sample10.pdf` and
      seed ingest order matches the accuracy harness.
      (kt-004 → `scripts/seed-demo.ts`)

- [x] **Computed `labelWidth` from `DEMO_USERS`.** Removed the hardcoded
      `padEnd(9)` that coupled alignment to the current label strings.
      (kt-002 → `scripts/seed-demo.ts`)

- [x] **Hard-fail when fixtures missing for populated account.** Previously
      warned and produced an empty workspace, defeating R27. Now throws with
      an actionable message.
      (T3, T8 → `scripts/seed-demo.ts`)

- [x] **Pass `Buffer` directly to `extractFromPdfBytes`.** `Buffer` extends
      `Uint8Array`; the `new Uint8Array(bytes)` wrapper was a copy, not a view.
      (u14-correctness-6 → `scripts/seed-demo.ts`)

## Resolved during todo-resolve

- [x] **#2 — `listUsers` paginated until email found or pages exhaust.**
      Replaces the fixed `page:1,perPage:200` call. Honors the idempotent-re-seed
      invariant at any project scale. (→ `scripts/seed-demo.ts`)

- [x] **#3 — Claim `UPDATE` now asserts rows-affected.** Added
      `.select('id').maybeSingle()` and a null-check that throws a specific
      error when no pending row is matched. Matches
      `src/lib/extract/supabase-port.ts` exactly; future RLS or constraint
      changes that silently no-op the UPDATE will now surface.
      (→ `scripts/seed-demo.ts`)

- [x] **#4 — Password rotation propagates to existing users.** On the
      existing-user branch, `ensureUser` now calls `auth.admin.updateUserById`
      to force the stored password to match `DEMO_USERS`. Fixes silent drift
      between the printed reviewer creds and the actual auth.users password.
      (→ `scripts/seed-demo.ts`)

- [x] **#6 — Fail-fast env precondition.** `assertEnv()` runs at the top of
      `run()`, checking `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      and `GEMINI_API_KEY`. Missing vars throw a seed-specific actionable
      error mentioning `.env.local`.
      (→ `scripts/seed-demo.ts`)

- [x] **#8 — Unified `ALL_DOC_TYPES` in `src/lib/extraction/types.ts`.** Both
      `scripts/seed-demo.ts` and `scripts/extract-report.ts` import from the
      single source. Dropping K-1 now happens in one place.
      (→ `src/lib/extraction/types.ts`, `scripts/seed-demo.ts`,
      `scripts/extract-report.ts`)

## P2

### [ ] 1. De-duplicate `toJsonValue` and `resolveFinalStatus` across seed + production

- **Origin:** maintainability maint-1, kieran-ts kt-001, testing T2 (three
  independent reviewers flagged this).
- **Symptom:** `toJsonValue` is copy-pasted from `src/lib/extract/supabase-port.ts`
  (with a comment saying "Mirror exactly"), and `resolveFinalStatus` in the seed
  duplicates the status-derivation logic from `src/lib/extract/pipeline.ts`
  (lines 116–118). The "mirror exactly" invariant is only held by a human
  reading a comment — the next time `ExtractionResult` grows a nested shape or
  `DOC_TYPE_THRESHOLD` semantics shift, one copy will drift silently.
- **Why not autofixed:** Fix requires extracting helpers into a new
  non-`server-only` module and modifying the production write boundary
  (`supabase-port.ts`). That's a cross-script/production refactor outside
  autofix scope.
- **Fix sketch:**
  - Create `src/lib/extract/to-json-value.ts` (no `server-only` import) exporting
    `toJsonValue`.
  - Create `src/lib/extract/final-status.ts` (or add to an existing file)
    exporting `resolveFinalStatus(extraction, docTypeThreshold)`.
  - Re-import from `supabase-port.ts`, `pipeline.ts`, and `seed-demo.ts`.
  - Add a table-driven unit test for `resolveFinalStatus` covering
    `unknown`, below-threshold, at-threshold, and above-threshold.

## P3

### [ ] 5. Seed script has no automated tests

- **Origin:** testing T1, T4.
- **Symptom:** Plan U14 explicitly accepts manual verification for the happy
  path + idempotency + Gemini-failure edge case + two-browser isolation test.
  No `scripts/seed-demo.test.ts` exists.
- **Why deferred:** Plan-level decision; demo timeline prioritizes shipping.
  Extracting a `SeedPort` and adding tests mirroring
  `src/lib/extract/pipeline.test.ts` is the correct long-term shape but is
  out of scope for U14.
- **Fix sketch (when followed up):**
  - Extract `SeedPort` interface (listUsers, upload, insert, claim, rpc).
  - Add `FakeSeedStore` mirroring `pipeline.test.ts`'s FakeStore.
  - Test: idempotency (run twice → same row/object counts), Gemini-failure
    continues to next fixture, missing-env preconditions, missing-fixtures
    hard-fail.

### [ ] 7. No Gemini call timeout

- **Origin:** reliability rel-u14-001.
- **Symptom:** `extractFromPdfBytes` has no timeout or AbortSignal; a hung
  SDK call on deadline day has no natural backstop.
- **Fix sketch:** Wrap `extractFromPdfBytes` in `Promise.race` with an
  `AbortSignal.timeout(60_000)` or equivalent. Low priority for a manual
  seed — operator can Ctrl-C.

## Advisory (no action; for awareness)

- **Hardcoded demo credentials checked in.** R27-approved. Demo banner warns
  reviewers this is a prototype environment.
- **Final `console.log` prints credentials to stdout.** Intentional per R27
  workflow (operator copy/pastes into reviewer email). Flag if CI ever
  captures seed logs.
- **Ctrl-C between `storage.upload` and `documents.insert` orphans a Storage
  object.** Self-heals on the next `clearWorkspace` — storage.list picks up
  orphans regardless of row state.
- **RPC failure after successful Gemini extraction aborts the run.** The
  documents row is left in `processing`; next seed wipes and restarts. Costs
  re-spending Gemini budget on fixtures that already completed.
- **No retries on transient `admin.listUsers` / `storage.upload` /
  `admin.createUser` / RPC failures.** Acceptable for a manual ops script;
  operator re-runs.
