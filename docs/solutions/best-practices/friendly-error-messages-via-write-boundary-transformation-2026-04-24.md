---
title: Friendly user-facing error copy via write-boundary transformation
date: 2026-04-24
category: best-practices
module: extraction
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - An engine/SDK layer throws errors whose raw messages will be persisted and rendered unchanged in UI
  - Multiple UI surfaces render the same persisted error string (dashboard cell, detail banner, export dialog, etc.)
  - A user-facing product (B2B, fintech, consumer) must not leak third-party vendor or SDK names
  - Errors have distinct user-actionable categories (retry now, re-upload, contact support)
  - The error type is already discriminated (or can be) via a kind/tag union
related_components:
  - testing_framework
  - frontend_stimulus
tags:
  - error-handling
  - user-facing-copy
  - discriminated-union
  - write-boundary
  - gemini
  - extraction
  - taxonomy
  - error-cause
---

# Friendly user-facing error copy via write-boundary transformation

## Context

The Gemini extraction pipeline (`src/lib/extract/pipeline.ts`) catches failures from the SDK call, parse, and schema-validation steps, then writes a string to `documents.error_message`. Two UI surfaces render that column unchanged:

- `src/app/(app)/dashboard/StatusCell.tsx` — failed-status tooltip on the dashboard table
- `src/app/(app)/documents/[id]/DocumentDetail.tsx` — failed banner on the document detail page

Before this pattern, the pipeline persisted whatever `error.message` happened to be — raw `@google/genai` `ApiError` copy, Zod stringifications, `SyntaxError: Unexpected token...`. That leaked SDK names, model identifiers, schema tokens, and stack-trace-adjacent phrasing to end users (accountants, in this B2B product). The obvious fix — "map errors to copy in the UI" — would have to be implemented twice (once per surface) and would drift. There was already prior art for the right shape: `src/lib/upload/client-batch.ts:190-225` maps upload error codes through a typed `USER_MESSAGES` record, and every consumer reads the already-finalized string. This guidance codifies that shape for the server-side extraction path, one boundary earlier (at the DB write rather than at a client-side boundary), and generalizes it.

## Guidance

Transform raw errors into user-facing copy at the **write boundary** — the single point where the string is persisted — and have every UI surface render that string unchanged. Implement it as four pieces.

### 1. A discriminated-union kind plus a `Readonly<Record<Kind, string>>` copy map

TypeScript enforces exhaustiveness — adding a kind without a copy entry is a compile error.

```ts
// src/lib/extraction/errors.ts
export type ExtractionErrorKind =
  | "sdk_retryable"
  | "sdk_unrecoverable"
  | "empty_response"
  | "invalid_json"
  | "schema_mismatch"
  | "pipeline_unknown";

const USER_MESSAGES: Readonly<Record<ExtractionErrorKind, string>> = {
  sdk_retryable:
    "Temporary issue reaching the extraction service. Try again in a moment; contact support if it keeps happening.",
  sdk_unrecoverable:
    "Couldn't process this PDF. Try re-uploading a clearer copy, or contact support if the file looks fine.",
  empty_response: "The extraction service couldn't read this PDF. Try re-uploading a clearer copy.",
  invalid_json: "Couldn't process this PDF. Try re-uploading; contact support if it keeps happening.",
  schema_mismatch:
    "Couldn't read this document's fields. The format may be unusual — try a clearer copy or contact support.",
  pipeline_unknown: "Extraction failed. Try again; contact support if this keeps happening.",
};

export const USER_MESSAGE_FALLBACK = "Extraction failed. Please try again.";

export function userMessageForExtractionKind(kind: ExtractionErrorKind): string;
export function userMessageForExtractionKind(kind: string): string;
export function userMessageForExtractionKind(kind: string): string {
  if (!Object.prototype.hasOwnProperty.call(USER_MESSAGES, kind)) {
    return USER_MESSAGE_FALLBACK;
  }
  return USER_MESSAGES[kind as ExtractionErrorKind];
}
```

The dual-signature overload lets typed callers get compile-time narrowing (`kind: ExtractionErrorKind` → always returns a real entry) while tests can still exercise the unknown-string fallback path.

### 2. A typed error class whose `message` is auto-derived from the kind

Callers pass only the kind (and optionally `cause`) — never a custom message. The typed taxonomy and the persisted string can't drift.

```ts
// src/lib/extraction/errors.ts
export type GeminiExtractionErrorKind = Exclude<ExtractionErrorKind, "pipeline_unknown">;

export class ExtractionError extends Error {
  readonly kind: GeminiExtractionErrorKind;

  constructor(kind: GeminiExtractionErrorKind, options?: ErrorOptions) {
    super(userMessageForExtractionKind(kind), options);
    this.name = "ExtractionError";
    this.kind = kind;
  }
}
```

Use the built-in `ErrorOptions` type rather than a hand-rolled `{ cause?: unknown }` — it communicates intent and stays in step with the `Error` constructor's own contract.

### 3. Structural, not `instanceof`, classification of third-party SDK errors

Narrow with `"status" in error`, then switch on the numeric HTTP status. Don't couple to the SDK's class hierarchy — it survives renames and version drift.

```ts
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export const classifySdkError = (error: unknown): "sdk_retryable" | "sdk_unrecoverable" => {
  if (typeof error !== "object" || error === null) return "sdk_unrecoverable";
  if (!("status" in error)) return "sdk_retryable"; // connection/timeout/abort
  const { status } = error;
  if (status === undefined) return "sdk_retryable"; // declared-but-undefined
  if (typeof status !== "number") return "sdk_unrecoverable";
  if (RETRYABLE_HTTP_STATUSES.has(status) || status >= 500) return "sdk_retryable";
  return "sdk_unrecoverable";
};
```

The `status === undefined` branch matters: some SDK error classes declare `status` as an own property and set it to `undefined` on connection errors rather than omitting it. Treating both shapes as "no status" keeps retry guidance correct across SDK version drift.

### 4. A catch-all kind for non-domain throws at the pipeline boundary

When the pipeline catches something that isn't an `ExtractionError` (e.g., a Supabase Storage download failure), route it through a typed constant so the literal string stays pinned to the union.

```ts
// errors.ts
export const PIPELINE_UNKNOWN_KIND: ExtractionErrorKind = "pipeline_unknown";

// pipeline.ts
const extractMessage = (error: unknown): string => {
  if (error instanceof ExtractionError) return error.message;
  return userMessageForExtractionKind(PIPELINE_UNKNOWN_KIND);
};
```

The boundary (`src/lib/extraction/gemini.ts`) throws typed errors; the pipeline catches, derives the message, writes it, and re-throws. Operator debuggability is preserved by the built-in `Error.cause` chain: user-facing copy lives in `.message`, SDK/Zod detail lives in `.cause`, and route-boundary `console.error(prefix, error)` logs the full chain.

### 5. Test at the shape level, not the exact wording

Assert each kind returns a non-fallback, non-empty string with no leaky tokens (model name, SDK names, `"json"`, `"schema"`). Strip whitespace before substring-matching so spaced forms like `"generate content"` don't slip through. Writers can tune copy without rewriting tests.

```ts
const KINDS = [
  "sdk_retryable",
  "sdk_unrecoverable",
  "empty_response",
  "invalid_json",
  "schema_mismatch",
  "pipeline_unknown",
] as const;
const LEAKY = ["gemini", "generatecontent", "sdk", "schema", "json"];

for (const kind of KINDS) {
  const msg = userMessageForExtractionKind(kind);
  expect(msg).not.toBe(USER_MESSAGE_FALLBACK);
  expect(msg).toMatch(/\S/);
  const lower = msg.toLowerCase();
  const stripped = lower.replace(/\s+/g, "");
  for (const token of LEAKY) {
    expect(lower, `${kind} leaks ${token}`).not.toContain(token);
    expect(stripped, `${kind} leaks split ${token}`).not.toContain(token);
  }
}
```

## Why This Matters

- **Single source of truth.** The copy map is the only place user-facing strings exist. UI surfaces can't disagree because they never look up copy — they just render the persisted column.
- **Compile-time exhaustiveness.** `Record<Kind, string>` turns "forgot to add copy for a new kind" into a type error, not a fallback-string shipped to production.
- **No drift between kind and message.** Because `ExtractionError`'s constructor derives `.message` from `kind`, a caller cannot write `new ExtractionError("sdk_retryable", "oops")` and pin a wrong string next to a right kind.
- **No leaky SDK tokens.** Users never see "GoogleGenerativeAI Error", "Zod issue", "Unexpected token in JSON at position 42", model identifiers, or library names — they see curated, action-oriented copy.
- **Operator debuggability preserved.** `Error.cause` keeps the original error intact for server logs. The user-facing transformation is purely additive.
- **SDK version drift is absorbed.** `classifySdkError` narrows on `"status" in error` and switches on numbers — no `instanceof ApiError` coupling. Library renames and class-hierarchy reshuffles don't break classification.
- **Connection-error edge case handled.** `status: undefined` (declared-but-undefined) routes to `sdk_retryable` the same as "no status property at all".
- **Catch-all kind prevents escape hatches.** `pipeline_unknown` stops raw `error.message` from bypassing the taxonomy when a non-domain layer (storage, DB) throws.

## When to Apply

Apply this pattern when **all** of the following hold:

- An error is persisted to a single column (e.g., `documents.error_message`) and multiple UI surfaces render it unchanged.
- The surfaces only need to display copy — no retry button, no kind-specific icon, no per-kind branching.
- Errors originate at a small set of well-defined boundaries (SDK call, parse, schema validation, plus a catch-all) that can each be mapped to a discrete kind.
- You want compile-time coverage of "every kind has copy" and want writers to edit strings without touching types or tests.

**Don't apply (or shift further) when:**

- A UI surface needs structured error info — retry button on retryable kinds, different icon per kind, filterable dashboard counts. That's the signal to split into an `error_kind` column and do the copy mapping at the **read boundary** instead. Document the trade-off, but don't pre-build.
- Error copy needs localization — the `USER_MESSAGES` record becomes the hook point for an i18n layer, but the consumer contract changes (surfaces have to resolve against the user's locale, not render the raw column).

**One import constraint:** if the errors module must be importable from vitest for unit tests, it must not transitively import `"server-only"`. Keep the pure taxonomy (types, copy map, classifier, error class) in a sibling module free of server-only imports — see [server-only-bypass-from-node-and-vitest](./server-only-bypass-from-node-and-vitest-2026-04-22.md). In this codebase `src/lib/extraction/errors.ts` stays server-only-free while `src/lib/extraction/gemini.ts` keeps the `"server-only"` guard.

## Examples

### Before — per-UI mapping with raw SDK strings leaking

```ts
// pipeline.ts (hypothetical old shape)
try {
  extractionResult = await extract(bytes);
} catch (error) {
  const message = error instanceof Error ? error.message : "Extraction failed";
  await port.writeResult(documentId, "failed", null, message);
  throw error;
}
// Result persisted to documents.error_message:
// "[GoogleGenerativeAI Error]: [400 Bad Request] Request contains an invalid argument."
// or: "Unexpected token 'F', \"Failed to p\"... is not valid JSON"
```

```tsx
// StatusCell.tsx (old) — each surface tries to sanitize
<p>
  {row.error_message?.includes("GoogleGenerativeAI")
    ? "The extraction service is having trouble. Try again."
    : row.error_message?.includes("JSON")
      ? "Couldn't process this PDF."
      : (row.error_message ?? "Extraction failed.")}
</p>
```

Two surfaces, two slightly different sanitization ladders, neither exhaustive, and "GoogleGenerativeAI" still leaks when the SDK changes prefix.

### After — typed throws at the boundary, single write-boundary mapping, UI renders the column unchanged

```ts
// gemini.ts — every failure path throws a typed ExtractionError
.catch((error: unknown): never => {
  throw new ExtractionError(classifySdkError(error), { cause: error });
});
// ...
if (typeof text !== "string" || text.length === 0) {
  throw new ExtractionError("empty_response");
}
try { raw = JSON.parse(text); }
catch (error) { throw new ExtractionError("invalid_json", { cause: error }); }
try { return parseExtractionResult(raw); }
catch (error) { throw new ExtractionError("schema_mismatch", { cause: error }); }
```

```ts
// pipeline.ts — the ONE place the persisted string is chosen
const extractMessage = (error: unknown): string => {
  if (error instanceof ExtractionError) return error.message;
  return userMessageForExtractionKind(PIPELINE_UNKNOWN_KIND);
};

const message = extractMessage(error);
await port.writeResult(documentId, "failed", null, message);
throw new PipelineFailedError(documentId, error, message);
```

```tsx
// StatusCell.tsx — renders unchanged
<p>{row.error_message ?? "No error details available."}</p>;

// DocumentDetail.tsx — renders unchanged
{
  row.error_message !== null ? <p className="text-muted-foreground mt-1 wrap-break-word">{row.error_message}</p> : null;
}
```

Now a 500 from Gemini surfaces as `"Temporary issue reaching the extraction service. Try again in a moment; contact support if it keeps happening."` on both surfaces, the raw `ApiError` remains on `error.cause` for server logs, adding a new kind (e.g., `quota_exceeded`) is a one-line union change plus one copy entry (compile error until the entry is added), and neither UI surface ever has to change again.

## Related

- [Testable Next.js Client Component via DI port and thin adapter](./testable-client-component-via-di-port-and-thin-adapter-2026-04-22.md) — documents the upload-side prior art (`src/lib/upload/client-batch.ts`'s `USER_MESSAGES`/`userMessageForCode` pair) that this extraction-side pattern mirrors at the DB-write boundary.
- [Testable Next.js route via DI port and thin adapter](./testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md) — the pipeline's DI port shape that provides the architectural seam where the `errors.ts` module plugs in.
- [Invoking a `server-only`-guarded module from plain Node or vitest](./server-only-bypass-from-node-and-vitest-2026-04-22.md) — explains why `errors.ts` must live outside `gemini.ts` (which imports `"server-only"`) so the kind map, classifier, and error class remain Node-testable.
- [Zod nullable OBJECT/ARRAY vs `{}` in Gemini structured output](./zod-null-vs-empty-object-gemini-nullable-schema-2026-04-22.md) — addresses how the `schema_mismatch` kind can fire incorrectly upstream. Complementary: this doc says how `schema_mismatch`'s user copy is resolved; that doc says how to prevent the kind from firing on legitimate inputs.

Different sense of "write boundary" from [idempotent-supabase-seed-via-production-write-boundary](./idempotent-supabase-seed-via-production-write-boundary-2026-04-23.md) — that doc's boundary is the seed-script's parity with production DB/Storage writes; this doc's boundary is the error-write moment on the extraction row.
