---
title: Synthetic-filled PDF fixtures via AcroForm for extraction accuracy gates
date: 2026-04-24
category: docs/solutions/best-practices
module: extraction-harness
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - A conditional feature ships behind an accuracy gate measured by a fixture harness
  - Sourcing real filled specimens from the upstream publisher is hard or privacy-sensitive
  - The upstream publisher distributes blank forms as AcroForm (fillable) PDFs
tags:
  - fixtures
  - extraction
  - gemini
  - pdf-lib
  - acroform
  - irs-forms
---

# Synthetic-filled PDF fixtures via AcroForm for extraction accuracy gates

## Context

`R13/U7` introduced a "K-1 inclusion decision gate" — drop K-1 from the discriminated union if live extraction accuracy falls below 80%. The gate was deferred from day one because the only K-1 fixture was a blank IRS Schedule K-1 PDF, and "100% match on blank fields" is a schema-conformance signal, not an extraction-quality signal.

The obvious first instinct is "wait until we can curate real filled K-1s from IRS instruction booklets." In practice that blocks indefinitely: the IRS publishes filled specimens as embedded images inside large instruction PDFs (`i1065.pdf`, Publication 17 appendices), not as standalone form PDFs the harness can consume. Meanwhile, the README kept carrying an accepted-risk row the product didn't need to live with.

## Guidance

When the base PDF is an AcroForm (fillable) form, generate filled fixtures by writing synthetic values into the form's named text fields programmatically. The IRS publishes every current tax form as an AcroForm, so a one-time `pdf-lib` script replaces a backlog of hand-keyed specimens.

**Workflow:**

1. **Inspect field names once.** AcroForm fields have semantic names (`topmostSubform[0].CopyA[0].Col_Right[0].Box1_ReadOrder[0].f1_09[0]` for W-2 Box 1 wages). Dump them with `pdf-lib` and map them to your schema:

```js
import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

const pdf = await PDFDocument.load(await fs.readFile("fixtures/w2/sample1.pdf"));
for (const f of pdf.getForm().getFields()) {
  console.log(f.constructor.name, "|", f.getName());
}
```

2. **Fill with a single source of truth.** Declare the synthetic values as one constant and use it for both the PDF fill and the ground-truth JSON. This makes the two literally impossible to disagree:

```js
const W2 = {
  employee_ssn: "321-54-9876",
  wages: 72500.5,
  // ...
};

setText(form, ".../Box1_ReadOrder[0].f1_09[0]", W2.wages.toFixed(2));
// later, the same W2 object is serialized into ground_truth.json
```

3. **`form.flatten()` before saving.** Flattening renders the filled fields as static text and strips the AcroForm layer. Skip this and the extractor sees an editable form widget rather than a visually filled document, which degrades classification.

```js
form.flatten();
await fs.writeFile("fixtures/w2/sample2.pdf", await pdf.save());
```

4. **Extend the PII policy explicitly.** The fabricated values are not real taxpayer data, but anyone reading `fixtures/README.md` needs to see that synthetic-fill is an allowed category — otherwise the next contributor may assume the `sample2.pdf` files came from a private source and panic. The base PDF is still a public IRS template; only the text content is fabricated.

5. **Run the harness once to validate the field mapping.** A wrong mapping shows up as a specific field miss in the report. Gemini extracting `"Summit Consulting LLC 77 Industrial Blvd, Denver CO 80202"` for `payer_name` on 1099-NEC revealed that the IRS 1099-NEC form puts PAYER name and address in a single AcroForm text field — a fixture limitation, not a model failure. Document it; don't try to fix it by forging the ground truth.

## Why This Matters

- **Unblocks the decision gate.** K-1 went from "100% on blank fixture (trivially)" to "100% on filled fixture" in one harness run. The accepted-risk row in the README dropped out.
- **Generator is reproducible.** The `sample2.pdf` files are derived artifacts. Anyone can rerun `node scripts/generate-filled-fixtures.mjs` to rebuild them from the committed blanks if the IRS template changes, values need updating, or a reviewer wants to reassure themselves the process is deterministic.
- **No PII risk.** The fabricated SSNs/EINs/names are structurally valid but point to nobody. This is strictly better than sourcing "real" samples from public filings, which can leak identities.
- **Fills a testing gap the blank baseline couldn't.** Blank fixtures prove classification and schema conformance; filled fixtures prove the extractor can actually parse values, not just return the right shape. Both are useful — keep both.

## When to Apply

- A conditional feature is gated on extraction accuracy and the fixture set is blank-only.
- The base documents are AcroForm PDFs. (Scanned/flattened PDFs without form fields need a different approach — text overlays via `pdf-lib`'s `drawText`, coordinate math, and font embedding.)
- The cost of hand-curating real filled specimens is larger than the cost of writing the generator.

Don't apply this when the accuracy question specifically needs scan/noise/handwriting artifacts — those stress-test OCR behavior, and AcroForm-filled PDFs render as perfectly clean typography. Both kinds of fixtures complement each other; this pattern covers the "clean filled" half.

## Examples

**Before:** `docs/EXTRACTION_REPORT.md` showed `k1: 8/8 (100%)` but the K-1 fixture (`fixtures/k1/sample1.pdf`) was blank. The report banner called itself out as "Baseline-only: every ground-truth field in this run is empty/zero." The README accepted-risks table carried:

> K-1 inclusion decision deferred — K-1 fixtures are still blank baselines. Current build keeps K-1 in the discriminated union.

**After:** `scripts/generate-filled-fixtures.mjs` writes `sample2.pdf` per doc type from the committed blanks with synthetic values. One harness run produces:

```
| `w2`        | 2 | 2/2 (100.0%) | 20/20 (100.0%) |
| `1099_nec`  | 2 | 2/2 (100.0%) | 11/12 (91.7%)  |
| `1099_misc` | 2 | 2/2 (100.0%) | 16/16 (100.0%) |
| `k1`        | 2 | 2/2 (100.0%) | 16/16 (100.0%) |

K-1 kept in the discriminated union — measured accuracy 100.0% ≥ 80%.
```

The README row is gone; a smaller "small fixture set" row replaces it because 2 fixtures per doc type isn't enough for statistically converged precision/recall, but that's a different risk with a different mitigation.

**Gotcha worth remembering:** the harness doesn't retry on transient Gemini errors. A single service blip on one fixture sets its classification to `error`, which the decision formula `(field_accuracy + classification_accuracy) / 2` reads as a 50% classification rate for that doc type, which can falsely flip the K-1 gate to "drop." When a run reports `ExtractionError: Temporary issue reaching the extraction service`, rerun once before trusting the verdict.

**Environment gotcha:** `.env.local` may override `GEMINI_MODEL` away from `.env.example`'s default (`gemini-3-flash-preview`). The report header prints the model it used — check that before comparing accuracy numbers across runs. Lite-model runs on blank fixtures hallucinate form watermarks (`"22222"`, `"RECIPIENT'S name"`) where preview returns empty strings.

## Related

- `fixtures/README.md` — provenance and PII policy extended to cover synthetic-fill
- `scripts/generate-filled-fixtures.mjs` — the generator
- `docs/EXTRACTION_REPORT.md` — harness output (regenerated on demand via `npm run extract:report`)
- `docs/solutions/best-practices/idempotent-supabase-seed-via-production-write-boundary-2026-04-23.md` — same "script owns the generation, committed output is the artifact" pattern applied to seed data
