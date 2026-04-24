---
date: 2026-04-24
topic: gemini-error-messages
status: ready-for-planning
---

# Friendly Extraction Error Messages

## Problem Frame

When Gemini extraction fails, users see raw SDK strings in the dashboard status tooltip and on the document detail page:

- "Gemini generateContent failed"
- "Gemini returned an empty response"
- "Gemini response was not valid JSON"
- "Gemini response did not match expected schema"

These leak the model name and SDK internals into a B2B accountant-facing UI, and they tell the user nothing about whether the problem is transient, whether to retry, whether the PDF was unreadable, or whether to contact support.

The upload flow already solved the equivalent problem with a kind → human-copy map at `src/lib/upload/client-batch.ts:191` — we should mirror that pattern for extraction.

## Current Flow (verified)

1. `src/lib/extraction/gemini.ts:53` throws `ExtractionError("sdk_error", "Gemini generateContent failed", { cause })` on any SDK failure. Three sibling throws cover empty response, invalid JSON, and schema mismatch.
2. `src/lib/extract/pipeline.ts:99-102` extracts `error.message` verbatim and persists it to `documents.error_message` (via `port.writeResult`).
3. Two UI surfaces render `row.error_message` directly:
   - `src/app/(app)/dashboard/StatusCell.tsx:52` — failed-status tooltip
   - `src/app/(app)/documents/[id]/DocumentDetail.tsx:230` — failed banner on document detail
4. `src/app/api/extract/route.ts:57` already logs the raw error (including `cause`) via `console.error`, so operator debuggability via Vercel logs is already preserved.

The `@google/genai` SDK exports `ApiError` with a `status: number` field (`node_modules/@google/genai/dist/genai.d.ts:335`) — the HTTP status is inspectable, which enables the retryable/non-retryable split.

## Scope

**In scope:**

- Replace all 4 user-facing extraction error strings with tailored, non-leaky copy.
- Split the current `sdk_error` kind into `sdk_retryable` and `sdk_unrecoverable` by inspecting the SDK error's HTTP status.
- Also replace the generic "Extraction pipeline failed" fallback (pipeline.ts:60) for non-`ExtractionError` throws (e.g. Storage download failure) with a single friendly fallback, since it shares the same display path.

**Out of scope:**

- Schema changes (e.g. adding a structured `error_kind` column). The friendly copy is written to the existing `error_message` column.
- Changes to operator-side logging — `console.error` at the route boundary already captures the `cause` for Vercel logs.
- Multi-language / i18n. Copy is English only, matching the rest of the app.
- UI surfaces or retry buttons. This change only alters the text that the existing UI surfaces already display.

## Error Kind Taxonomy

| Kind                | When it fires                                                                                           | Retryable? |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| `sdk_retryable`     | SDK throw with no HTTP status (network/timeout/abort), or status `408`, `429`, or `>= 500`              | Yes        |
| `sdk_unrecoverable` | SDK throw with any other status (`400`, `401`, `403`, `404`, `413`, `422`, safety/content blocks, etc.) | No         |
| `empty_response`    | SDK returned, but `response.text` was empty                                                             | Maybe      |
| `invalid_json`      | Response text failed `JSON.parse`                                                                       | Maybe      |
| `schema_mismatch`   | JSON parsed but failed Zod validation                                                                   | No         |
| `pipeline_unknown`  | Any non-`ExtractionError` thrown inside the pipeline try block (e.g. Storage download failure)          | Unknown    |

The "Maybe" cases are grouped with unrecoverable copy for messaging, since the user's action is the same (re-upload or contact support).

## Proposed Copy

Copy targets an accountant reader — terse, professional, action-oriented. No apologies, no emoji, no model names, no SDK jargon. Each string ends with an actionable next step.

- `sdk_retryable` → **"Temporary issue reaching the extraction service. We'll retry shortly; if this keeps happening, contact support."**
- `sdk_unrecoverable` → **"Couldn't process this PDF. Try re-uploading a clearer copy, or contact support if the file looks fine."**
- `empty_response` → **"The extraction service couldn't read this PDF. Try re-uploading a clearer copy."**
- `invalid_json` → **"Couldn't process this PDF. Try re-uploading, or contact support if it keeps happening."**
- `schema_mismatch` → **"This document didn't match any supported format. It may still be useful — open it to review and fill in fields manually."**
- `pipeline_unknown` → **"Extraction failed. Try again; contact support if this keeps happening."**

(Exact wording is open to iteration — these are starting drafts.)

## Success Criteria

- No user-facing surface contains the words "Gemini", "generateContent", "SDK", "schema", or "JSON".
- Each of the 6 kinds renders its mapped string verbatim in both the dashboard tooltip (`StatusCell.tsx`) and the document detail banner (`DocumentDetail.tsx`).
- The raw underlying SDK error (and its `cause`) remains visible in Vercel function logs for the `/api/extract` route.
- Unit test coverage for the error classifier (status → kind) and the kind → copy map.
- The upload flow's `client-batch.ts` pattern is followed so the two error-copy maps feel consistent.

## Open Questions for Planning

1. **Where does the classifier live?** Inside `gemini.ts` (throw the refined kind at the source), or in a small helper module imported by both `gemini.ts` and `pipeline.ts`? Leaning toward the first — keeps the SDK coupling contained to one file.
2. **Copy location.** Export the map from `src/lib/extraction/error-messages.ts` (new) or co-locate with `gemini.ts`? Should be decided based on whether any other callers might need the copy (e.g. the future agent flow).
3. **Transform at write time or read time?** Proposed: write the friendly copy to `documents.error_message` at the pipeline boundary (simplest — UI needs no change). Revisit only if a future UI surface needs structured error info.
