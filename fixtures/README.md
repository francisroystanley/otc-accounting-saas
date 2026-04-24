# Extraction fixtures

PDFs and hand-keyed ground-truth files used by `npm run extract:report` to measure Gemini extraction accuracy. The harness lives at [`scripts/extract-report.ts`](../scripts/extract-report.ts) and writes [`docs/EXTRACTION_REPORT.md`](../docs/EXTRACTION_REPORT.md).

## Provenance and PII policy (R35)

Source PDFs **must** come from public IRS materials — blank published forms (`irs.gov/pub/irs-pdf/`), filled-in samples from IRS instruction booklets, or synthetic-filled derivatives of the blanks produced by `scripts/generate-filled-fixtures.mjs` (the base PDF remains the public IRS template; the script only writes AcroForm text fields, with fabricated non-PII values). Never commit real taxpayer data. The blank forms in this tree are downloaded verbatim from:

| File                             | Source                                         |
| -------------------------------- | ---------------------------------------------- |
| `fixtures/w2/sample1.pdf`        | <https://www.irs.gov/pub/irs-pdf/fw2.pdf>      |
| `fixtures/1099_nec/sample1.pdf`  | <https://www.irs.gov/pub/irs-pdf/f1099nec.pdf> |
| `fixtures/1099_misc/sample1.pdf` | <https://www.irs.gov/pub/irs-pdf/f1099msc.pdf> |
| `fixtures/k1/sample1.pdf`        | <https://www.irs.gov/pub/irs-pdf/f1065sk1.pdf> |

`sample2.pdf` in each directory is a synthetic-filled version produced from `sample1.pdf`. To regenerate after editing the generator's synthetic values:

```bash
node scripts/generate-filled-fixtures.mjs
```

## Adding a new fixture

1. Drop the PDF under `fixtures/<doc_type>/sampleN.pdf` where `<doc_type>` ∈ `{w2, 1099_nec, 1099_misc, k1}` and `N` is the next integer.
2. Create `fixtures/<doc_type>/sampleN.ground_truth.json` with the hand-keyed expected extraction (see schema below).
3. Re-run `npm run extract:report`. The harness picks up the new fixture automatically.

The plan budgets ~8 fixtures total (2 per doc type) to keep the RPD cost of a full report run at 8 live Gemini calls.

## Ground-truth schema

Each `sampleN.ground_truth.json` file is a single JSON object whose shape mirrors the expected extraction:

```json
{
  "doc_type": "w2",
  "fields": {
    "employee_ssn": "123-45-6789",
    "employer_ein": "12-3456789",
    "employer_name": "ACME Corp",
    "employee_name": "Jane Doe",
    "wages": 50000,
    "federal_income_tax_withheld": 5000,
    "social_security_wages": 50000,
    "social_security_tax_withheld": 3100,
    "medicare_wages": 50000,
    "medicare_tax_withheld": 725
  }
}
```

The exact field set depends on `doc_type`. See [`src/lib/extraction/types.ts`](../src/lib/extraction/types.ts) for the full per-doc-type field list.

- **Blank forms:** leave string fields as `""` and numeric fields as `0`. The harness counts an extracted blank as a match.
- **Unknowns:** set `"doc_type": "unknown"` and omit `fields` to assert Gemini should fail-soft classify the document.

## Comparison rules (enforced by the harness)

- **String fields:** case-insensitive, whitespace-collapsed, punctuation-tolerant for names/addresses; exact match for SSN/EIN/TIN after stripping non-digits.
- **Numeric fields:** tolerance of ±$0.01.
- **Blank value:** an empty string in ground truth matches any of `""`, `"N/A"`, or `"—"` from Gemini; `0` in ground truth matches `0`.
- **Confidence:** not compared — we measure extraction accuracy, not calibration. Calibration is the separate threshold-sweep section of the report.

## Curation backlog

Initial filled fixtures are now in place (`sample2.pdf` per doc type) via `scripts/generate-filled-fixtures.mjs`. Next iterations:

- Add filled specimens from IRS instruction booklets (e.g. Publication 17 appendices, `i1099gi.pdf`, `i1065.pdf`) to cover handwritten / scanned visual styles that AcroForm-filled PDFs don't stress-test.
- Grow to 3–5 filled fixtures per doc type so the threshold sweep has enough field-count to produce non-trivial precision/recall.
- Add `unknown` fixtures (receipts, non-tax docs) to stress-test the fail-soft classifier branch.
