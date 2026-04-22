# Extraction fixtures

PDFs and hand-keyed ground-truth files used by `npm run extract:report` to measure Gemini extraction accuracy. The harness lives at [`scripts/extract-report.ts`](../scripts/extract-report.ts) and writes [`EXTRACTION_REPORT.md`](../EXTRACTION_REPORT.md) at the repo root.

## Provenance and PII policy (R35)

Source PDFs **must** come from public IRS materials — blank published forms (`irs.gov/pub/irs-pdf/`) or filled-in samples from IRS instruction booklets. Never commit real taxpayer data. The blank forms in this tree are downloaded verbatim from:

| File                             | Source                                         |
| -------------------------------- | ---------------------------------------------- |
| `fixtures/w2/sample1.pdf`        | <https://www.irs.gov/pub/irs-pdf/fw2.pdf>      |
| `fixtures/1099_nec/sample1.pdf`  | <https://www.irs.gov/pub/irs-pdf/f1099nec.pdf> |
| `fixtures/1099_misc/sample1.pdf` | <https://www.irs.gov/pub/irs-pdf/f1099msc.pdf> |
| `fixtures/k1/sample1.pdf`        | <https://www.irs.gov/pub/irs-pdf/f1065sk1.pdf> |

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

## Day-1 curation backlog

Blank forms measure classification + schema conformance but cannot stress-test field extraction — unfilled boxes trivially match. Before the ≥ 90% success criterion can be demonstrated end-to-end, add **filled-in** samples sourced from IRS instruction booklets (e.g. Publication 17 appendices, `i1099gi.pdf`, `i1065.pdf`) and hand-key their ground truth. The harness will then produce a meaningful accuracy number instead of a baseline.
