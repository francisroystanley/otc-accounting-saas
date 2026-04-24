---
title: "fix: Address ce-review findings for dropzone concurrent-batches change"
type: fix
status: active
date: 2026-04-24
---

# fix: Address ce-review findings for dropzone concurrent-batches change

## Overview

The `dropzone-concurrent-batches` worktree removed a blocking guard in `UploadDropzone.tsx` that prevented users from dropping new PDFs while a batch was uploading. The guard removal is correct and intended, but a ce-review pass surfaced seven follow-up findings that together tighten the component: dead refs left behind by the removed guard, always-true gate state that grows unbounded, a missing global cap, per-row toast storm, a missing unmount cleanup, a discarded `Promise.allSettled`, and missing test coverage for the new overlapping-batch happy path.

This plan addresses all seven findings with minimal, surgical edits in a single component file plus a small pure helper added to `client-batch.ts` for testability, following the project's existing convention of testing extracted pure functions instead of rendering components in test.

## Problem Frame

After the guard removal, `src/components/upload/UploadDropzone.tsx` still carries scaffolding that only existed to support the removed guard (`rowsRef`, `activeRowIdsRef`). Two concurrent batches can now produce: (a) a wall of sonner toasts because every settled row fires its own, (b) unbounded in-flight uploads because the per-batch cap of 10 was the only thing previously acting as a global ceiling, (c) late toast fires against an unmounted component, and (d) no test coverage for the newly reachable happy path. None of these are correctness-critical in isolation, but together they degrade the UX of the change that was just made.

## Requirements Trace

- **R1** — Remove `rowsRef` and its syncing `useEffect`. Their only reader was the removed `hasPendingRows(rowsRef.current)` guard. (P3 — maintainability + correctness reviewers.)
- **R2** — Remove `activeRowIdsRef` and the surrounding always-true `if` branch. The gate is meaningless (every `rowId` added is the same one checked) and grows unbounded. Prefer removal over wiring cleanup because there is no cancel/dismiss feature today. (P2 — correctness + frontend-races + maintainability.)
- **R3** — Bound concurrent in-flight uploads. Either a soft global ceiling enforced in `handleBatch` or a copy update — both. Current UI copy "Up to 10 files, 10 MB each" reads as a global cap and is now misleading. (P2 — correctness + frontend-races.)
- **R4** — Replace per-row success/error `toast` calls with one summary toast per batch. Row-level failures remain visible via the existing `OctagonXIcon` and stage text in the row list. (P2 — frontend-races.)
- **R5** — Add vitest coverage for the batch-summary aggregation behavior via an extracted pure helper in `src/lib/upload/client-batch.ts`. Follows the project convention set by `src/components/TopNavLinks.test.ts` (pure helper extracted from the component, tested in `.test.ts`). (P3 — all three reviewers.)
- **R6** — Gate `toast` calls on a `mountedRef` so late settles after route unmount do not announce into a dead tree. (P2 residual risk — frontend-races.)
- **R7** — Use the result of `Promise.allSettled(tasks)` to dispatch the aggregated summary toast, instead of discarding it with `void`. Couples cleanly with R4 and provides the per-batch boundary R4 needs. (P3 — frontend-races.)

## Scope Boundaries

- No "Clear completed" button. Row list continues to grow; out of scope.
- No row memoization. `ul` re-renders on every dispatch; acceptable for realistic volumes.
- No `requestAnimationFrame` progress throttling.
- No AbortController plumbed into `uploadOne` or into the signed-URL `PUT`. In-flight uploads continue after unmount; we only silence toasts.
- No refactor of `uploadOne` itself. Changes are confined to `UploadDropzone.tsx` and a new pure helper in `client-batch.ts`.
- No change to server routes, schema, or API contracts.

### Deferred to Separate Tasks

- Full React-level overlap test (two interleaved `handleBatch` renders with staggered promise resolution): covered indirectly by browser/e2e tests run later in the LFG pipeline. A component-render test would require introducing React Testing Library, which the project does not currently use.

## Context & Research

### Relevant Code and Patterns

- `src/components/upload/UploadDropzone.tsx` — component under change. Current state after the guard removal has `rowsRef` (writer-only), `activeRowIdsRef` (always-true gate), and per-row `toast` calls inside each task.
- `src/lib/upload/client-batch.ts` — existing module that owns `uploadOne`, `preCheckBatch`, `UploadOneResult`, and `userMessageForCode`. This is where the new `summarizeBatchResults` helper belongs.
- `src/lib/upload/client-batch.test.ts` — existing vitest file. Follows a `makeFile`/`makePort` helper pattern. New tests for the summary helper go here.
- `src/components/TopNavLinks.test.ts` — canonical example in this repo of the "extract pure function, test in `.test.ts`" pattern. The component itself is not rendered; only `isActive` is tested.

### Institutional Learnings

- `docs/solutions/best-practices/testable-client-component-via-di-port-and-thin-adapter-2026-04-22.md` — project has a settled pattern of dependency-injected ports for testable client components, used in `UploadDropzone`'s `UploadBatchPort`. This plan extends the boundary (pure helper in `client-batch.ts`) rather than plumbing new DI.
- `docs/solutions/best-practices/friendly-error-messages-via-write-boundary-transformation-2026-04-24.md` — `userMessageForCode` is the single place where error codes become user-facing strings. The summary helper reuses it rather than inlining copy.

### External References

None — no new framework surface. Uses existing `react`, `sonner`, and `vitest`.

## Key Technical Decisions

- **Compute in-flight count from reducer state, not a new ref.** `rows.filter(r => !isTerminal(r.status)).length` is the single source of truth. Avoids adding another piece of mutable ref state that can drift from `rows`. Cap = 20 (2× `MAX_FILES_PER_BATCH`). When `inFlight + accepted.length > 20`, reject the new batch with a single toast.
- **Extract `summarizeBatchResults(results)` as a pure helper in `client-batch.ts`.** The component calls it with the `Promise.allSettled(tasks)` output after mapping to `UploadOneResult`. Returns `{ succeeded: number; failed: number; message: string }`. Colocating with `uploadOne` and `userMessageForCode` matches the file's role as "upload orchestration primitives."
- **Keep one summary toast per batch; drop per-row success/error toasts.** Row-level errors remain visible via `OctagonXIcon` and the stage label already rendered in each `li`. Summary messages: all-success `"Queued N files"`, mixed `"Queued N of M; K failed"`, all-failure `"All M uploads failed"`. Uses existing `toast.success` / `toast.error` with `sonner` (already imported).
- **Use a ref-based mounted flag, not state.** `mountedRef.current = false` set in effect cleanup. Check before calling `toast.*` in the post-`allSettled` summary step. State would re-render; ref is correct here.
- **Copy change:** "Up to 10 files, 10 MB each" → "Up to 10 files per drop, 10 MB each". Minimal, truthful, stops suggesting a global cap.

## Open Questions

### Resolved During Planning

- _Should we re-add a hard global cap (effectively restoring the old guard)?_ — No. The whole point of the parent diff is to allow concurrent batches. Soft cap of 20 (2× per-batch) lets typical users queue twice in quick succession without friction, while still protecting against a pathological drop-20-times-rapidly burst.
- _Should mixed-result toasts enumerate failed filenames?_ — No. Filenames can be long and the row list already shows per-file failure via icon + stage. Keep the summary terse.
- _Should we wire `activeRowIdsRef` cleanup instead of deleting it?_ — No (per R2). There is no cancel/dismiss feature to gate today, so a wired-up Set would be correct-but-unused infrastructure. Delete now; re-introduce if/when a cancel feature ships.

### Deferred to Implementation

- Exact wording of the "too many in flight" toast — finalize during implementation based on how it reads in context; directional copy: `"Too many uploads in flight. Wait for some to finish before dropping more."`
- Whether the summary helper should accept `UploadOneResult[]` or a discriminated `{ succeeded: UploadOneResult[]; failed: UploadOneResult[] }` — decide in implementation; the test contract only depends on the returned shape.

## Implementation Units

- [x] **Unit 1: Remove dead guard scaffolding (rowsRef and activeRowIdsRef)**

**Goal:** Delete the two refs and supporting code that existed solely to serve the removed `hasPendingRows` guard. Result is a smaller component with no dead ref state.

**Requirements:** R1, R2

**Dependencies:** None — this is a pure deletion pass that precedes the behavioral fixes.

**Files:**

- Modify: `src/components/upload/UploadDropzone.tsx`

**Approach:**

- Remove `rowsRef` declaration and its syncing `useEffect`.
- Remove `activeRowIdsRef` declaration, the `for (const row of seededRows) activeRowIdsRef.current.add(row.rowId)` loop that populates it, and the `if (activeRowIdsRef.current.has(rowId))` branch — but preserve the body that fires `toast.success`/`toast.error` for now; the toast consolidation happens in Unit 3 which intentionally replaces those calls.

**Patterns to follow:**

- Match the style of the prior guard removal — delete code that has no remaining reader, no compatibility shims.

**Test scenarios:**

- Test expectation: none — pure deletion of unreferenced state. Existing test suite (330 tests) must continue to pass.

**Verification:**

- `npm run lint` clean (tsc + eslint).
- `npm test` green.
- No remaining references to `rowsRef`, `activeRowIdsRef`, or `hasPendingRows` in the worktree.

- [x] **Unit 2: Add summarizeBatchResults helper with vitest coverage**

**Goal:** Introduce a pure helper in `client-batch.ts` that turns a batch's `UploadOneResult[]` into a user-facing summary. Fully unit-tested. Unused by the component at the end of this unit; wired up in Unit 3.

**Requirements:** R5

**Dependencies:** Unit 1 (to avoid diff overlap; not logically required).

**Files:**

- Modify: `src/lib/upload/client-batch.ts`
- Modify: `src/lib/upload/client-batch.test.ts`

**Approach:**

- Export a new function:
  - Name: `summarizeBatchResults`
  - Input: `UploadOneResult[]`
  - Output: `{ succeeded: number; failed: number; message: string; tone: "success" | "error" }`
  - `tone` drives whether the caller uses `toast.success` or `toast.error`.
- Message construction:
  - All succeeded (`failed === 0`, `succeeded > 0`): `"Queued N files"` (singular: `"Queued 1 file"`); `tone: "success"`.
  - All failed (`succeeded === 0`, `failed > 0`): `"All N uploads failed"`; `tone: "error"`.
  - Mixed (`succeeded > 0 && failed > 0`): `"Queued N of M; K failed"`; `tone: "error"` (any failure lands as an error toast so it demands attention).
  - Empty input (`succeeded === 0 && failed === 0`): `tone: "success"`, `message: ""` — caller should not show a toast. Not expected in real flow but documented by the test.

**Execution note:** Test-first. Write the test scenarios below, watch them fail, then implement the helper.

**Patterns to follow:**

- `userMessageForCode` in the same file — pure, table-driven, no side effects.
- `preCheckBatch` — pure, uses typed inputs/outputs, easy to test.
- `src/lib/upload/client-batch.test.ts` existing structure — `describe` blocks per function, `it` scenarios with specific inputs.

**Test scenarios:**

- Happy path — all succeed: 3 successful results → `{ succeeded: 3, failed: 0, message: "Queued 3 files", tone: "success" }`.
- Happy path — single success: 1 successful result → `"Queued 1 file"`, `tone: "success"`.
- Edge case — all fail: 2 failed results → `"All 2 uploads failed"`, `tone: "error"`.
- Edge case — mixed: 1 success + 2 failures → `"Queued 1 of 3; 2 failed"`, `tone: "error"`.
- Edge case — single success with single failure: `"Queued 1 of 2; 1 failed"`, `tone: "error"`.
- Edge case — empty input: `[]` → `{ succeeded: 0, failed: 0, message: "", tone: "success" }`.
- Edge case — grammatical correctness for "1 file" vs "N files" in the all-success path (covered by the two happy-path scenarios above, called out here so the implementer writes both).

**Verification:**

- New tests appear in `npm test` output and pass.
- `npm run lint` clean.
- `summarizeBatchResults` is exported but not yet imported by `UploadDropzone.tsx` (Unit 3 does the wiring).

- [x] **Unit 3: Rewire handleBatch — soft cap, mounted gate, aggregated toast**

**Goal:** Consume `summarizeBatchResults` from the component; add the soft global cap; add the `mountedRef` toast gate; update the UI copy. Single unit because the four changes all touch `handleBatch` and the component JSX, and they compose (the summary toast needs the mount gate; the soft cap uses the same reducer-derived in-flight count that the summary runs against).

**Requirements:** R3, R4, R6, R7

**Dependencies:** Unit 2 (needs `summarizeBatchResults`).

**Files:**

- Modify: `src/components/upload/UploadDropzone.tsx`

**Approach:**

- **mountedRef:** Add `const mountedRef = useRef(true);` plus a `useEffect(() => () => { mountedRef.current = false; }, [])` cleanup. Gate the batch-summary `toast.*` call on `mountedRef.current`. Per-file error toasts raised from `preCheckBatch` rejects happen synchronously inside the user-gesture-driven `handleBatch` call, so the mount ref need not gate them.
- **Soft global cap:** At the top of `handleBatch`, after the empty-file short-circuit and before `preCheckBatch`, compute `inFlight = rows.filter(r => !isTerminal(r.status)).length` using a `rowsRef` — note: we deleted the previous `rowsRef` in Unit 1, so reintroduce a tiny one here scoped to this purpose, or read `rows` via a fresh `useRef` synced in a new effect. Preferred: lift the count into the closure via a fresh `rowsRef` (the previous one was dead; a new one with a clear single purpose is fine). Define `GLOBAL_CEILING = 20` as a module constant. If `inFlight + accepted.length > GLOBAL_CEILING`, show `toast.error("Too many uploads in flight. Wait for some to finish before dropping more.")` and return. Implementation detail: check after `preCheckBatch` so you gate on accepted, not on raw input.
- **Aggregated toast:** Replace the per-row `toast.success`/`toast.error` inside each task with nothing (the task just returns its result). After `Promise.allSettled(tasks)`, normalize to `UploadOneResult[]` (each settled entry is `fulfilled` because each task returns a result rather than rejecting), call `summarizeBatchResults`, and fire one toast — gated by `mountedRef.current` and skipped when `message === ""`.
- **Copy update:** Change the subtitle `<span>` text from `"Up to 10 files, 10 MB each"` to `"Up to 10 files per drop, 10 MB each"`.

**Patterns to follow:**

- Keep `handleBatch` as a single `useCallback` with empty deps, matching the current structure.
- Reuse `isTerminal` for the in-flight count (already in the file).
- Continue using `toast.error` for the per-file preCheckBatch rejection loop — those are synchronous user feedback, not the batch summary.

**Test scenarios:**

- Test expectation: none at the unit level — component-level overlap testing is deferred to browser tests per Scope Boundaries. The pure logic being introduced (`summarizeBatchResults`) is covered by Unit 2; the component wiring around it is straightforward glue.

**Verification:**

- `npm run lint` clean.
- `npm test` green.
- Manual smoke (performed later in the LFG pipeline via `test-browser`): drop 2 PDFs, while they upload drop 3 more; see 2 rows progress, then 3 more append; see a single summary toast per batch; unmount mid-upload and confirm no late toast.
- Drop 20+ files in rapid batches — the 21st file (or whichever exceeds the ceiling) triggers the "too many in flight" toast and is not enqueued.

## System-Wide Impact

- **Interaction graph:** The component is the sole caller of `uploadOne` from the client. `uploadOne` continues to behave exactly as before (no changes to `client-batch.ts` except the new exported helper). No callbacks or middleware are affected.
- **Error propagation:** Per-file failures still surface in the row UI (stage label + `OctagonXIcon`). The batch summary toast categorizes the overall result. No new error codes; no change to `USER_MESSAGES`.
- **State lifecycle risks:** The `mountedRef` gate prevents post-unmount toast calls, but the in-flight `uploadOne` requests continue (no AbortController). Server-side documents may be created for a user who has left the page. This is unchanged from current behavior and out of scope — called out here for awareness.
- **API surface parity:** `summarizeBatchResults` is exported from `client-batch.ts` but is consumed only by `UploadDropzone.tsx`. No other surfaces need to update.
- **Integration coverage:** The existing 330-test suite must remain green. Browser tests in step 6 of the LFG pipeline cover the end-to-end overlap path.
- **Unchanged invariants:** `preCheckBatch`'s `MAX_FILES_PER_BATCH = 10`, the `UploadBatchPort` contract, `uploadOne`'s progress stages, and the reducer's per-row semantics are all unchanged.

## Risks & Dependencies

| Risk                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GLOBAL_CEILING = 20` feels arbitrary and may frustrate users who drop many files quickly                                                                                     | 20 = 2× the existing per-batch cap, giving a typical user two in-flight drops of headroom. Toast message tells them to wait rather than silently dropping files. Tune if user feedback warrants.                                                                             |
| Removing per-row success toasts could feel less responsive for single-file uploads                                                                                            | Row list still shows per-row stage transitions and final icon. For single-file uploads the summary reads `"Queued 1 file"`, which is equivalent information with less noise.                                                                                                 |
| Reintroducing a `rowsRef` (for the in-flight count) one unit after deleting it could read as churn                                                                            | Unit 1 deletes an unused ref; Unit 3 introduces a new ref with a single explicit purpose. Keeping them in separate units makes the commit history and diff narrative cleaner than threading them together.                                                                   |
| Mixed-result toasts using `tone: "error"` may feel heavy when only 1 of 10 failed                                                                                             | Any failure demands user attention (they may want to retry). `tone: "error"` surfaces via sonner's higher-contrast styling; the message itself names the success count so positive progress is visible.                                                                      |
| `Promise.allSettled` is treated as always resolving per-task with a `UploadOneResult` because each task catches internally — if a task ever throws, the summary will be wrong | The task closure returns explicit results on every code path including `catch` blocks. A defensive `settled.status === "fulfilled" ? settled.value : { ok: false, filename: "?", code: "network_error" }` unwrap in the summary site keeps the invariant explicit and cheap. |

## Documentation / Operational Notes

- No public docs change. Internal: after merge, worth considering a short note in `docs/solutions/best-practices/` if anything novel emerges during implementation; let ce-compound decide.
- No rollout or feature flag. Single behavioral change lands with the merge.

## Sources & References

- Review synthesis (in-session ce-review on worktree `dropzone-concurrent-batches`, 2026-04-24) — finding table covering R1–R7.
- Related code: `src/components/upload/UploadDropzone.tsx`, `src/lib/upload/client-batch.ts`, `src/lib/upload/client-batch.test.ts`, `src/components/TopNavLinks.test.ts`.
- Related institutional learnings: `docs/solutions/best-practices/testable-client-component-via-di-port-and-thin-adapter-2026-04-22.md`, `docs/solutions/best-practices/friendly-error-messages-via-write-boundary-transformation-2026-04-24.md`.
