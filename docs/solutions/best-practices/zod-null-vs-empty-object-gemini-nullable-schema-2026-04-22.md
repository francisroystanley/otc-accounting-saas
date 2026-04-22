---
title: Zod `z.null()` is insufficient when a Gemini `responseSchema` declares a nullable OBJECT
date: 2026-04-22
category: best-practices
module: extraction
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Building a Gemini `@google/genai` extraction pipeline with a Zod validator at the I/O boundary
  - The Gemini `responseSchema` (OpenAPI 3.0 subset) includes a nullable `OBJECT` property (for example, `{ type: OBJECT, nullable: true, properties: {} }`)
  - The Zod counterpart uses `z.null()` alone to validate that the same property is null
  - Any `anyOf`/`oneOf` branch in `responseSchema` uses the word "unknown" / "empty" / "none" to represent "no fields extracted"
tags:
  - gemini
  - google-genai
  - zod
  - responseschema
  - structured-output
  - nullable
  - defensive-normalization
related_components:
  - tooling
---

# Zod `z.null()` is insufficient when a Gemini `responseSchema` declares a nullable OBJECT

## Context

We built the shared extraction module (U6 of the OTC prototype plan) with a discriminated-union over five `doc_type` values: `w2`, `1099_nec`, `1099_misc`, `k1`, and `unknown`. For the `unknown` branch, the TypeScript type declared `fields: null` — the intent was that Gemini returns no extracted fields when it cannot confidently classify.

The Zod schema mirrored this directly:

```ts
z.object({
  doc_type: z.literal("unknown"),
  doc_type_confidence: confidence,
  fields: z.null(),
});
```

The matching Gemini `responseSchema` declared:

```ts
fields: { type: Type.OBJECT, nullable: true, properties: {} }
```

Correctness review flagged that these two shapes silently disagree: `nullable: true` on an `OBJECT` Schema tells Gemini it **may** emit `null`, but it does not prevent Gemini from emitting `{}` (a valid instance of an empty OBJECT). When Gemini picks `{}`, Zod's `z.null()` throws `schema_mismatch`, and the `unknown` branch — the exact branch whose job is to absorb low-confidence classifications — fails with a schema error instead of normalizing cleanly.

This is the single highest-risk path in the pipeline per the plan, because it fires on precisely the inputs the `unknown` branch exists to handle.

## Guidance

When the Gemini `responseSchema` declares a nullable OBJECT, validate the Zod side with a `z.preprocess` that normalizes both `null` and `{}` to `null` before passing to `z.null()`. The pattern is symmetric for any nullable aggregate (OBJECT, ARRAY) where Gemini may pick the empty form over the null form.

```ts
fields: z.preprocess((raw: unknown): unknown => {
  if (raw === null) {
    return null;
  }

  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) {
    return null;
  }

  return raw;
}, z.null());
```

Two additional hardenings travel with this pattern:

1. **Set `format: "enum"` on every Gemini Schema `enum` declaration.** The `@google/genai` SDK's JSDoc (`Schema.enum`) notes that `enum` is a hard constraint only when paired with `format: "enum"`. Without it, the model may emit `"W2"` or `"1099-NEC"` spelling variants that Zod's `z.literal()` will reject downstream.

   ```ts
   doc_type: { type: Type.STRING, format: "enum", enum: ["unknown"] }
   ```

2. **Pin the normalization with a test.** A single-line test prevents a future refactor from reverting to `z.null()`:

   ```ts
   it("normalizes doc_type='unknown' with fields={} to fields=null", () => {
     const result = parseExtractionResult({ ...validUnknown, fields: {} });
     expect(result.fields).toBeNull();
   });
   ```

## Why This Matters

Structured-output validators live on the failure boundary between an LLM and downstream code. The cost of a false-negative validation error here is not "a test fails" — it is "a user-visible doc silently fails extraction for exactly the documents we designed the `unknown` branch to handle." The `needs_review` status machine (R14 in the plan) assumes the `unknown` branch is a valid, parseable result. If it throws instead, the row lands in `failed` with a confusing `schema_mismatch` error message, and the reviewer workflow never gets a chance to reclassify the doc.

Nullable OBJECT / ARRAY schema shapes are a recurring footgun with Gemini structured output because the API allows two legal representations (`null` vs `{}` / `[]`) for the same semantic value. Any code that reads the output across those two representations must normalize.

The `format: "enum"` gotcha is a distinct but related class: `responseSchema` is documented as OpenAPI 3.0 subset, but not every OpenAPI idiom carries over with the same semantics. Treat SDK JSDoc as authoritative over generic OpenAPI knowledge.

## When to Apply

- You are validating Gemini structured output with Zod (or another runtime validator) at the I/O boundary.
- The Gemini `responseSchema` has a nullable aggregate field (OBJECT or ARRAY) anywhere in the tree.
- Your Zod counterpart uses `z.null()` (or any narrow type) for that field.
- You have `anyOf` / `oneOf` discriminated unions where one branch semantically means "no data extracted."
- You declare `enum` arrays on any `responseSchema` field — pair them with `format: "enum"` always.

## Examples

**Before (silently wrong):**

```ts
// schemas.ts — Zod side
z.object({
  doc_type: z.literal("unknown"),
  doc_type_confidence: confidence,
  fields: z.null(), // throws schema_mismatch when Gemini emits `{}`
})

// schemas.ts — Gemini responseSchema side
{
  doc_type: { type: Type.STRING, enum: ["unknown"] }, // treated as hint, not constraint
  fields: { type: Type.OBJECT, nullable: true, properties: {} },
}
```

**After:**

```ts
// schemas.ts — Zod side
z.object({
  doc_type: z.literal("unknown"),
  doc_type_confidence: confidence,
  fields: z.preprocess((raw: unknown): unknown => {
    if (raw === null) return null;
    if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) return null;
    return raw;
  }, z.null()),
})

// schemas.ts — Gemini responseSchema side
{
  doc_type: { type: Type.STRING, format: "enum", enum: ["unknown"] }, // hard constraint
  fields: { type: Type.OBJECT, nullable: true, properties: {} },
}
```

Both fixes are localized to `src/lib/extraction/schemas.ts`. See `src/lib/extraction/schemas.ts:103-118` for the preprocess normalization and `src/lib/extraction/schemas.ts:165,186,203,222,241` for the `format: "enum"` declarations.

## Related

- `docs/solutions/best-practices/nextjs-supabase-shadcn-scaffolding-defaults-2026-04-21.md` — strict-ESLint scaffolding gotchas from the same project
- Plan unit U6 `docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md` — the originating implementation unit
