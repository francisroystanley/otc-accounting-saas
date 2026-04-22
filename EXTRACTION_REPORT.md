# Extraction accuracy report

_Generated: 2026-04-22T05:00:46.467Z_
_Model: `gemini-3-flash-preview`_
_Fixtures root: `fixtures/` — see [fixtures/README.md](fixtures/README.md) for provenance, schema, and the Day-1 curation backlog._

> **Baseline-only:** Every ground-truth field in this run is empty/zero (blank IRS forms). Field accuracy here measures schema conformance, not real extraction quality. See `fixtures/README.md` "Day-1 curation backlog" for the filled-fixture TODO.

## Summary

| Doc type    | Fixtures | Classification | Field accuracy |
| ----------- | -------- | -------------- | -------------- |
| `w2`        | 1        | 1/1 (100.0%)   | 10/10 (100.0%) |
| `1099_nec`  | 1        | 1/1 (100.0%)   | 6/6 (100.0%)   |
| `1099_misc` | 1        | 1/1 (100.0%)   | 8/8 (100.0%)   |
| `k1`        | 1        | 1/1 (100.0%)   | 8/8 (100.0%)   |

Mean per-field self-reported confidence across fixtures: **1.00**. A value close to 1.00 on a blank-fixture baseline indicates the model is not penalizing confidence for empty boxes — this is expected for blank forms but would be a calibration red flag if it persists on filled fixtures.

## K-1 inclusion decision

K-1 decision deferred — blank-fixture baseline shows 100.0% trivially. Re-run after filled K-1 fixtures land; if accuracy stays < 80%, drop K-1 from `src/lib/extraction/types.ts`/`schemas.ts` and propagate to U14 (CSV export).

## Recommended thresholds

- `CONFIDENCE_THRESHOLD`: **0.85**
- `DOC_TYPE_THRESHOLD`: **0.70**

Rationale:

- Zero field errors across fixtures — keeping the origin default 0.85 for CONFIDENCE_THRESHOLD until filled fixtures land.
- Doc-type classification was 100% across fixtures — keeping DOC_TYPE_THRESHOLD at 0.70.

## Threshold sweep

Per-field confidence from all fixtures. "Flagged" = fields where the model's self-reported confidence was below the threshold. Precision/recall measure whether the threshold cleanly separates errors from correct extractions — high recall means the threshold catches most errors; high precision means most flags actually are errors.

| Threshold | Flagged fields | Flagged errors / Total errors | Precision | Recall |
| --------- | -------------- | ----------------------------- | --------- | ------ |
| 0.70      | 0              | 0/0                           | 0.0%      | 0.0%   |
| 0.80      | 0              | 0/0                           | 0.0%      | 0.0%   |
| 0.85      | 0              | 0/0                           | 0.0%      | 0.0%   |
| 0.90      | 0              | 0/0                           | 0.0%      | 0.0%   |

## Per-fixture detail

### `w2`

#### `fixtures/w2/sample1.pdf`

- Classification: expected `w2`, got `w2` (doc_type_confidence 1.00) — ✓
- Fields:
  - `employee_ssn`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `employer_ein`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `employer_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `employee_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `wages`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `federal_income_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `social_security_wages`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `social_security_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `medicare_wages`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `medicare_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)

### `1099_nec`

#### `fixtures/1099_nec/sample1.pdf`

- Classification: expected `1099_nec`, got `1099_nec` (doc_type_confidence 1.00) — ✓
- Fields:
  - `payer_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `payer_tin`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `recipient_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `recipient_tin`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `nonemployee_compensation`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `federal_income_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)

### `1099_misc`

#### `fixtures/1099_misc/sample1.pdf`

- Classification: expected `1099_misc`, got `1099_misc` (doc_type_confidence 1.00) — ✓
- Fields:
  - `payer_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `payer_tin`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `recipient_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `recipient_tin`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `rents`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `royalties`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `other_income`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `federal_income_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)

### `k1`

#### `fixtures/k1/sample1.pdf`

- Classification: expected `k1`, got `k1` (doc_type_confidence 1.00) — ✓
- Fields:
  - `partnership_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `partnership_ein`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `partner_name`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `partner_tin`: ✓ — expected `""`, got `""` (confidence 1.00)
  - `ordinary_business_income`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `net_rental_real_estate_income`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `interest_income`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `dividends`: ✓ — expected `0`, got `0` (confidence 1.00)

## Known limitations

- Baseline fixtures are blank IRS forms; see `fixtures/README.md` "Day-1 curation backlog" for the filled-fixture TODO that gates the ≥ 90% success criterion.
- `_note` keys in ground-truth files are ignored by the harness; they exist to document fixture provenance alongside the expected values.
