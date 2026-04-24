---
title: Replace Gemini SDK strings with friendly extraction error copy
type: feat
status: active
date: 2026-04-24
origin: docs/brainstorms/2026-04-24-gemini-error-messages-requirements.md
---

# Replace Gemini SDK Strings with Friendly Extraction Error Copy

## Overview

The extraction failure path currently surfaces raw Gemini SDK strings (e.g. "Gemini generateContent failed") in the dashboard status tooltip and the document detail banner. This plan replaces those strings with a kind-mapped user-copy layer, mirroring the existing upload-side `USER_MESSAGES` pattern in `src/lib/upload/client-batch.ts`. It also splits the overloaded `sdk_error` kind into retryable vs unrecoverable by reading the HTTP status on `@google/genai`'s `ApiError`, so the surfaced copy can actually guide the user's next action.

## Problem Frame

Four engineer-centric strings leak the model name and SDK internals into an accountant-facing B2B UI:

- "Gemini generateContent failed"
- "Gemini returned an empty response"
- "Gemini response was not valid JSON"
- "Gemini response did not match expected schema"

Plus a fifth fallback — "Extraction pipeline failed" from `src/lib/extract/pipeline.ts` — fires for non-`ExtractionError` throws (e.g. Supabase Storage download errors) and shares the same display path.

Because the pipeline writes `error.message` verbatim into the `documents.error_message` column, and two UI surfaces render that column unmodified, the user sees these raw strings on every extraction failure. The origin document (`docs/brainstorms/2026-04-24-gemini-error-messages-requirements.md`) establishes: tailored copy per kind, keep operator detail in server logs via the existing `console.error` at the route boundary, no schema changes, no i18n, no UI surface changes.

## Requirements Trace

- R1. No user-facing surface contains the words "Gemini", "generateContent", "SDK", "schema", or "JSON" (see origin: Success Criteria).
- R2. Each of the 6 kinds (`sdk_retryable`, `sdk_unrecoverable`, `empty_response`, `invalid_json`, `schema_mismatch`, `pipeline_unknown`) renders its mapped string verbatim in both `src/app/(app)/dashboard/StatusCell.tsx` and `src/app/(app)/documents/[id]/DocumentDetail.tsx`.
- R3. The raw underlying SDK error (including `cause`) remains visible in Vercel function logs via the existing `console.error` in `src/app/api/extract/route.ts:57`.
- R4. `sdk_error` is split into `sdk_retryable` and `sdk_unrecoverable` by inspecting `ApiError.status` on the caught error.
- R5. Unit test coverage for the status → kind classifier and for the kind → copy map.
- R6. The upload flow's `client-batch.ts` kind → copy pattern is mirrored for consistency.

## Scope Boundaries

- No changes to the `documents` schema — the friendly copy reuses the existing `error_message` column.
- No changes to `/api/extract`'s route-level error logging — the existing `console.error` already captures the raw cause.
- No changes to the two UI surfaces that render `row.error_message` — they already render arbitrary strings.
- No i18n / multi-language support.
- No new retry button or surface — copy only.

## Context & Research

### Relevant Code and Patterns

- `src/lib/upload/client-batch.ts:190-217` — `USER_MESSAGES: Readonly<Record<KnownCode, string>>`, `USER_MESSAGE_FALLBACK`, `userMessageForCode(code: string): string`, and `isKnownCode` type guard. This is the pattern to mirror.
- `src/lib/upload/client-batch.test.ts:365-413` — the exact test shape: one spot-check for tone, one loop asserting every enumerated code returns a non-fallback non-empty string, one case for unknown code → fallback.
- `src/lib/extraction/gemini.ts` — single SDK boundary. Currently declares `ExtractionErrorKind` and the `ExtractionError` class inline; both are used only inside this file (verified via grep — no downstream consumers).
- `src/lib/extract/pipeline.ts:55-61` — `extractMessage(error: unknown): string`, the helper that picks the string written to `documents.error_message`. Returns `error.message` for any Error, else "Extraction pipeline failed".
- `node_modules/@google/genai/dist/genai.d.ts:335` — `ApiError` class with `status: number`. Subclasses include `RateLimitError (429)`, `InternalServerError`, `BadRequestError (400)`, `AuthenticationError (401)`, `PermissionDeniedError (403)`, `NotFoundError (404)`, `UnprocessableEntityError (422)`, `APIConnectionError`, `APIConnectionTimeoutError`. The `status` field (or its absence for connection/timeout errors) is the classification signal.
- `src/lib/extract/pipeline.test.ts:347-411` — existing coverage for the extraction failure path. Cases where `extract` throws and where the failure-path writer also throws. New test case slots in alongside these.

### Institutional Learnings

- `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md` — the extraction pipeline uses dependency injection (`ExtractFn` port), so `gemini.ts` can be unit-tested in isolation without mocking Supabase or the SDK runtime.
- `docs/solutions/best-practices/zod-null-vs-empty-object-gemini-nullable-schema-2026-04-22.md` — confirms `schema_mismatch` fires on real user-facing edge cases (Gemini emitting `{}` for nullable OBJECT fields). Copy for `schema_mismatch` must be tolerant: this is not a bug, it's an unusual document. The proposed copy ("This document didn't match any supported format. It may still be useful — open it to review and fill in fields manually.") already handles this framing.

### External References

- None. Classifier is grounded in the locally-installed `@google/genai` type declarations; copy pattern is grounded in the existing `client-batch.ts` module.

## Key Technical Decisions

- **Classifier lives in `gemini.ts`, copy map lives in a new `error-messages.ts` module.** The SDK coupling (checking `ApiError.status`) is already in `gemini.ts`; keeping it there avoids leaking `@google/genai` imports outward. The copy map is pure data — isolating it in its own small module keeps `gemini.ts` focused on SDK I/O and makes the copy table independently testable.
- **Transform error copy at write time, not read time.** Write the friendly string into `documents.error_message` at the pipeline boundary so both existing UI surfaces render it unchanged. No schema change, no UI change. Trade-off: the DB row loses structured `error_kind` info, but no current or planned feature needs it. Revisit only if a future feature wants per-kind UI affordances (retry button on retryable failures, etc.).
- **Preserve the original SDK error via `cause`.** `ExtractionError` already accepts `{ cause }` and `src/app/api/extract/route.ts:57` already logs the whole error via `console.error`, so operator debuggability in Vercel logs is preserved automatically — no changes needed to the route.
- **Six kinds, not five.** Add an explicit `pipeline_unknown` kind to the copy map so the non-`ExtractionError` fallback (e.g. Storage download failure) has first-class, friendly copy rather than a verbatim `error.message`. The kind itself does not need to exist on the `ExtractionError` class — it lives only in the copy map and is looked up by `pipeline.ts` when it catches a non-`ExtractionError`.
- **Classifier groups by user impact, not by HTTP semantics.** `sdk_retryable` = no status (network/timeout/abort) OR status in {408, 429} OR status >= 500. Everything else (including `401`, `403`, `404`, `413`, `422`, safety blocks) collapses into `sdk_unrecoverable`. Rationale: from the user's perspective, a misconfigured API key and a content-filter block are identical — neither is fixable by clicking retry; both mean "contact support or re-upload." Finer gradation would require copy that reveals which config is wrong, which would leak implementation detail again.

## Open Questions

### Resolved During Planning

- **Where does the classifier live?** Inside `gemini.ts`. Keeps `@google/genai` imports contained to the single SDK-boundary module.
- **Where does the copy map live?** New module `src/lib/extraction/error-messages.ts`, mirroring the way `client-batch.ts` co-locates its `USER_MESSAGES` + `userMessageForCode` pair near the upload logic but as a pure-data unit.
- **Transform at write time or read time?** Write time. No schema or UI change required; future features can still shift to read-time mapping by adding an `error_kind` column later.

### Deferred to Implementation

- **Exact copy wording.** The origin document proposes starting drafts for all six kinds. Final wording can be tightened during implementation; the tests assert shape (non-fallback, non-empty, no leaky tokens) rather than exact strings so copy tweaks don't break tests.
- **Whether to expose `ExtractionErrorKind` from `error-messages.ts` or `gemini.ts`.** Either works. Decide during implementation based on which keeps imports simplest.

## Implementation Units

- [ ] **Unit 1: New copy map module**

**Goal:** Introduce the kind taxonomy and user-copy table as a standalone, pure-data module that both `gemini.ts` and `pipeline.ts` can import.

**Requirements:** R1, R2, R6.

**Dependencies:** None.

**Files:**

- Create: `src/lib/extraction/error-messages.ts`
- Create: `src/lib/extraction/error-messages.test.ts`

**Approach:**

- Export `ExtractionErrorKind` as a string-literal union: `"sdk_retryable" | "sdk_unrecoverable" | "empty_response" | "invalid_json" | "schema_mismatch" | "pipeline_unknown"`.
- Export `USER_MESSAGES: Readonly<Record<ExtractionErrorKind, string>>` with the six strings from the origin doc (exact wording open to last-minute tweak during implementation).
- Export `USER_MESSAGE_FALLBACK` constant for the "truly unknown" case (shouldn't fire with the type-safe map, but matches the `client-batch.ts` shape and protects against unchecked callers).
- Export `userMessageForExtractionKind(kind: ExtractionErrorKind): string` — direct lookup; returns fallback only if the kind is unknown at runtime.
- Do not import anything from `@google/genai` or `ExtractionError` here. Keep the module pure-data / pure-lookup.

**Patterns to follow:**

- `src/lib/upload/client-batch.ts:190-217` for the `USER_MESSAGES` + `USER_MESSAGE_FALLBACK` + lookup helper shape.

**Test scenarios:**

- Happy path: `userMessageForExtractionKind("sdk_retryable")` returns a string that does not equal `USER_MESSAGE_FALLBACK` and does not contain any of the tokens "Gemini", "generateContent", "SDK", "schema", "JSON" (case-insensitive).
- Happy path: for each of the six kinds, `userMessageForExtractionKind(kind)` returns a non-empty string matching `/\S/` and not equal to `USER_MESSAGE_FALLBACK`.
- Happy path: for each of the six kinds, the returned string passes the leaky-token check above — assert this in the same loop so new kinds added later can't silently reintroduce leakage.
- Error path: `userMessageForExtractionKind("totally_made_up" as ExtractionErrorKind)` returns `USER_MESSAGE_FALLBACK`.

**Verification:**

- `src/lib/extraction/error-messages.test.ts` passes under the project's existing Vitest setup.
- Grepping the new module's copy for "Gemini", "generateContent", "SDK", "schema", or "JSON" yields zero matches.

- [ ] **Unit 2: Classify SDK errors and throw friendly copy from `gemini.ts`**

**Goal:** Replace the four raw throw messages in `gemini.ts` with kind-mapped copy, and split `sdk_error` into `sdk_retryable` / `sdk_unrecoverable` based on the SDK error's HTTP status.

**Requirements:** R1, R2, R3, R4, R5, R6.

**Dependencies:** Unit 1.

**Files:**

- Modify: `src/lib/extraction/gemini.ts`
- Create: `src/lib/extraction/gemini.test.ts`

**Approach:**

- Remove the local `ExtractionErrorKind` declaration from `gemini.ts` and import it (plus `userMessageForExtractionKind`) from `src/lib/extraction/error-messages.ts`.
- Keep the `ExtractionError` class in `gemini.ts` (its constructor now accepts the widened `ExtractionErrorKind`).
- Add a `classifySdkError(error: unknown): "sdk_retryable" | "sdk_unrecoverable"` helper inside `gemini.ts`. Logic: if the error has a numeric `status` property, return `sdk_retryable` for status `408`, `429`, or `>= 500`, else `sdk_unrecoverable`. If no status is present (network/timeout/abort — `APIConnectionError`, `APIConnectionTimeoutError`), return `sdk_retryable`.
- Read the `status` field structurally (`typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"`) rather than via `instanceof ApiError`, so the classifier is robust to SDK version changes that might rename or restructure the class hierarchy.
- At the four throw sites, replace the hardcoded string with `userMessageForExtractionKind(kind)` where `kind` is derived per site:
  - `.catch` after `generateContent`: `const kind = classifySdkError(error); throw new ExtractionError(kind, userMessageForExtractionKind(kind), { cause: error });`
  - empty response: `throw new ExtractionError("empty_response", userMessageForExtractionKind("empty_response"));`
  - invalid JSON: `throw new ExtractionError("invalid_json", userMessageForExtractionKind("invalid_json"), { cause: error });`
  - schema mismatch: `throw new ExtractionError("schema_mismatch", userMessageForExtractionKind("schema_mismatch"), { cause: error });`
- Preserve the `cause` on all SDK-origin throws so the route-level `console.error` keeps logging the underlying stack.

**Patterns to follow:**

- Existing `ExtractionError` class shape in `src/lib/extraction/gemini.ts:11-19`.
- Pure-function classifier with structural type-guard, similar to `isKnownCode` in `src/lib/upload/client-batch.ts:219`.

**Test scenarios:**

- Happy path: `classifySdkError({ status: 500, message: "boom" })` returns `"sdk_retryable"`. Repeat for statuses 502, 503, 504, 429, 408.
- Happy path: `classifySdkError({ status: 400 })` returns `"sdk_unrecoverable"`. Repeat for 401, 403, 404, 413, 422.
- Edge case: `classifySdkError(new Error("network down"))` — no `status` field — returns `"sdk_retryable"` (connection/timeout errors from `@google/genai` have no HTTP status).
- Edge case: `classifySdkError(null)` and `classifySdkError(undefined)` return `"sdk_unrecoverable"` — if we can't inspect it, don't encourage a doomed retry (this is a judgment call; the alternative of retryable is defensible but riskier).
- Edge case: `classifySdkError("some string")` (non-object) returns `"sdk_unrecoverable"`.
- Edge case: `classifySdkError({ status: "500" })` (string status, not number) returns `"sdk_unrecoverable"` — strict type guard.
- Integration: an `ExtractionError` thrown from the `.catch` path has `kind` matching the classifier output and `message` equal to the corresponding `USER_MESSAGES` entry; `cause` is the original SDK error.
- Integration: an `ExtractionError` from each of the other three throw sites (empty response, invalid JSON, schema mismatch) has `kind` and `message` matching the copy map, and `cause` is set when the throw site has one.

**Verification:**

- `src/lib/extraction/gemini.test.ts` passes.
- Grepping `src/lib/extraction/gemini.ts` for the literal strings "Gemini generateContent failed", "Gemini returned", "Gemini response" yields zero matches.
- The pipeline tests (`src/lib/extract/pipeline.test.ts`) still pass without modification — their assertions use `toBeInstanceOf(PipelineFailedError)` and are not sensitive to message content.

- [ ] **Unit 3: Friendly fallback for non-`ExtractionError` throws in the pipeline**

**Goal:** Ensure a Supabase Storage download failure (or any other non-`ExtractionError` throw inside the pipeline try block) surfaces friendly copy rather than a raw stack-trace-derived message.

**Requirements:** R1, R2.

**Dependencies:** Unit 1.

**Files:**

- Modify: `src/lib/extract/pipeline.ts`
- Modify: `src/lib/extract/pipeline.test.ts`

**Approach:**

- Update the `extractMessage(error: unknown): string` helper in `src/lib/extract/pipeline.ts:55-61`: if the error is an `ExtractionError`, return `error.message` (already friendly from Unit 2); otherwise return `userMessageForExtractionKind("pipeline_unknown")`.
- Keep `PipelineFailedError` constructed with the same `extractMessage(error)` output, so the message that gets written to the DB and the message that propagates to the route handler stay consistent.
- No change to the route handler — its `console.error` still receives the full error object with `cause`, independent of the `message` string.

**Patterns to follow:**

- Existing `extractMessage` in `src/lib/extract/pipeline.ts:55-61` — same shape, just a different default branch.
- `instanceof ExtractionError` check: import the class from `@/lib/extraction/gemini`.

**Test scenarios:**

- Happy path: when `extract` throws an `ExtractionError("schema_mismatch", "...")`, `writeResult` is called with the ExtractionError's friendly message as the fourth argument. Piggyback on the existing "writes 'failed' and rethrows PipelineFailedError when extract throws" test at `src/lib/extract/pipeline.test.ts:347` — add an assertion on the message written.
- Error path: when `port.downloadPdf` throws a generic `new Error("supabase network error")`, `writeResult` is called with `userMessageForExtractionKind("pipeline_unknown")` rather than `"supabase network error"`. Add a new test case adjacent to the existing ones.
- Edge case: when a non-Error value is thrown (e.g. a string), `writeResult` is called with the `pipeline_unknown` fallback — `extractMessage`'s non-Error branch now routes to the fallback rather than its old generic literal.

**Verification:**

- `src/lib/extract/pipeline.test.ts` passes.
- Grepping `src/lib/extract/pipeline.ts` for the literal "Extraction pipeline failed" yields zero matches.

## System-Wide Impact

- **Interaction graph:** The three touched files form a tight triangle — `error-messages.ts` (new, pure data) ← `gemini.ts` (throws) ← `pipeline.ts` (catches and writes). Downstream UI consumers (`StatusCell.tsx`, `DocumentDetail.tsx`) remain untouched because they render the DB column unmodified.
- **Error propagation:** The `cause` chain stays intact from SDK → `ExtractionError` → `PipelineFailedError` → route handler → `console.error`. Only the user-visible `message` string changes.
- **State lifecycle risks:** None. The `documents.error_message` column is written once per failure; no migration, no backfill, no partial-write concerns. Existing failed rows retain their old raw strings — acceptable per origin doc (no backfill called for).
- **Integration coverage:** The pipeline tests already exercise the ExtractionError-catch path via mocks. Unit 3's test extension covers the new non-`ExtractionError` branch. End-to-end UI rendering is not newly tested because the UI surfaces render arbitrary strings and were not modified.
- **Unchanged invariants:** `ExtractionError`'s class shape, `PipelineFailedError`'s class shape, `ExtractionDataPort`'s writer signature, the route handler's response contract, and the `documents` schema are all unchanged.

## Risks & Dependencies

| Risk                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@google/genai` changes its error class shape in a future version and the structural status check stops working. | The classifier uses a structural `"status" in error` guard rather than `instanceof ApiError`, so it's robust to class renames. If the field is renamed or removed in a future version, the classifier degrades gracefully to `sdk_unrecoverable` (safe default — no bad retry loop). A unit test pins the structural contract so a regression shows up locally before shipping. |
| Existing failed rows in the DB keep their old raw strings after deploy, creating UX inconsistency in the demo.   | Accepted per origin doc (no schema change, no backfill). The demo seed (`scripts/seed-demo.ts`) creates successful rows; pre-existing failed rows are rare in dev data and will age out. A `UPDATE documents SET error_message = <friendly>` backfill could be added later if it matters, but is out of scope.                                                                  |
| A future change adds a new `ExtractionErrorKind` and forgets to update `USER_MESSAGES`.                          | The `Readonly<Record<ExtractionErrorKind, string>>` type means TypeScript fails the build if a kind is missing from the map. The "every enumerated kind returns non-fallback" test in Unit 1 catches the remaining case (a kind added without a corresponding entry in the test loop).                                                                                          |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-24-gemini-error-messages-requirements.md](../brainstorms/2026-04-24-gemini-error-messages-requirements.md)
- Pattern reference: `src/lib/upload/client-batch.ts` (upload-side kind → copy map)
- SDK reference: `node_modules/@google/genai/dist/genai.d.ts` (`ApiError`, `APIConnectionError`, `APIConnectionTimeoutError`, `RateLimitError`, etc.)
- Related prior solution: `docs/solutions/best-practices/zod-null-vs-empty-object-gemini-nullable-schema-2026-04-22.md` (informs `schema_mismatch` copy tone)
