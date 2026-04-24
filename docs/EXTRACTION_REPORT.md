# Extraction accuracy report

_Generated: 2026-04-24T09:49:27.167Z_
_Model: `gemini-3-flash-preview`_
_Fixtures root: `fixtures/` — see [fixtures/README.md](../fixtures/README.md) for provenance, schema, and the Day-1 curation backlog._

## Summary

| Doc type    | Fixtures | Classification | Field accuracy |
| ----------- | -------- | -------------- | -------------- |
| `w2`        | 2        | 2/2 (100.0%)   | 20/20 (100.0%) |
| `1099_nec`  | 2        | 2/2 (100.0%)   | 11/12 (91.7%)  |
| `1099_misc` | 2        | 2/2 (100.0%)   | 16/16 (100.0%) |
| `k1`        | 2        | 2/2 (100.0%)   | 16/16 (100.0%) |

Mean per-field self-reported confidence across fixtures: **0.94**. A value close to 1.00 on a blank-fixture baseline indicates the model is not penalizing confidence for empty boxes — this is expected for blank forms but would be a calibration red flag if it persists on filled fixtures.

## K-1 inclusion decision

K-1 kept in the discriminated union — measured accuracy 100.0% ≥ 80%.

## Recommended thresholds

- `CONFIDENCE_THRESHOLD`: **0.70**
- `DOC_TYPE_THRESHOLD`: **0.70**

Rationale:

- Chose CONFIDENCE_THRESHOLD=0.70 as the sweep row that flagged the most field errors without drowning the reviewer.
- Doc-type classification was 100% across fixtures — keeping DOC_TYPE_THRESHOLD at 0.70.

## Threshold sweep

Per-field confidence from all fixtures. "Flagged" = fields where the model's self-reported confidence was below the threshold. Precision/recall measure whether the threshold cleanly separates errors from correct extractions — high recall means the threshold catches most errors; high precision means most flags actually are errors.

| Threshold | Flagged fields | Flagged errors / Total errors | Precision | Recall |
| --------- | -------------- | ----------------------------- | --------- | ------ |
| 0.70      | 4              | 0/1                           | 0.0%      | 0.0%   |
| 0.80      | 4              | 0/1                           | 0.0%      | 0.0%   |
| 0.85      | 4              | 0/1                           | 0.0%      | 0.0%   |
| 0.90      | 4              | 0/1                           | 0.0%      | 0.0%   |

## Per-fixture detail

### `w2`

#### `fixtures/w2/sample1.pdf`

- Classification: expected `w2`, got `w2` (doc_type_confidence 1.00) — ✓
- Fields:
  - `employee_ssn`: ✓ — expected `""`, got `""` (confidence 0.10)
  - `employer_ein`: ✓ — expected `""`, got `""` (confidence 0.10)
  - `employer_name`: ✓ — expected `""`, got `""` (confidence 0.10)
  - `employee_name`: ✓ — expected `""`, got `""` (confidence 0.10)
  - `wages`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `federal_income_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `social_security_wages`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `social_security_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `medicare_wages`: ✓ — expected `0`, got `0` (confidence 1.00)
  - `medicare_tax_withheld`: ✓ — expected `0`, got `0` (confidence 1.00)

#### `fixtures/w2/sample2.pdf`

- Classification: expected `w2`, got `w2` (doc_type_confidence 1.00) — ✓
- Fields:
  - `employee_ssn`: ✓ — expected `"321-54-9876"`, got `"321-54-9876"` (confidence 1.00)
  - `employer_ein`: ✓ — expected `"87-6543210"`, got `"87-6543210"` (confidence 1.00)
  - `employer_name`: ✓ — expected `"Northwind Traders Inc"`, got `"Northwind Traders Inc"` (confidence 1.00)
  - `employee_name`: ✓ — expected `"Riley Nakamura"`, got `"Riley Nakamura"` (confidence 1.00)
  - `wages`: ✓ — expected `72500.5`, got `72500.5` (confidence 1.00)
  - `federal_income_tax_withheld`: ✓ — expected `8125.4`, got `8125.4` (confidence 1.00)
  - `social_security_wages`: ✓ — expected `72500.5`, got `72500.5` (confidence 1.00)
  - `social_security_tax_withheld`: ✓ — expected `4495.03`, got `4495.03` (confidence 1.00)
  - `medicare_wages`: ✓ — expected `72500.5`, got `72500.5` (confidence 1.00)
  - `medicare_tax_withheld`: ✓ — expected `1051.26`, got `1051.26` (confidence 1.00)

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

#### `fixtures/1099_nec/sample2.pdf`

- Classification: expected `1099_nec`, got `1099_nec` (doc_type_confidence 1.00) — ✓
- Fields:
  - `payer_name`: ✗ — expected `"Summit Consulting LLC"`, got `"Summit Consulting LLC 77 Industrial Blvd, Denver CO 80202"` (confidence 1.00)
  - `payer_tin`: ✓ — expected `"45-6789012"`, got `"45-6789012"` (confidence 1.00)
  - `recipient_name`: ✓ — expected `"Avery Okonkwo"`, got `"Avery Okonkwo"` (confidence 1.00)
  - `recipient_tin`: ✓ — expected `"456-78-9012"`, got `"456-78-9012"` (confidence 1.00)
  - `nonemployee_compensation`: ✓ — expected `18400`, got `18400` (confidence 1.00)
  - `federal_income_tax_withheld`: ✓ — expected `920`, got `920` (confidence 1.00)

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

#### `fixtures/1099_misc/sample2.pdf`

- Classification: expected `1099_misc`, got `1099_misc` (doc_type_confidence 1.00) — ✓
- Fields:
  - `payer_name`: ✓ — expected `"Harborview Realty Co"`, got `"Harborview Realty Co"` (confidence 1.00)
  - `payer_tin`: ✓ — expected `"91-2345678"`, got `"91-2345678"` (confidence 1.00)
  - `recipient_name`: ✓ — expected `"Morgan Delacroix"`, got `"Morgan Delacroix"` (confidence 1.00)
  - `recipient_tin`: ✓ — expected `"789-01-2345"`, got `"789-01-2345"` (confidence 1.00)
  - `rents`: ✓ — expected `24000`, got `24000` (confidence 1.00)
  - `royalties`: ✓ — expected `1500`, got `1500` (confidence 1.00)
  - `other_income`: ✓ — expected `350`, got `350` (confidence 1.00)
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

#### `fixtures/k1/sample2.pdf`

- Classification: expected `k1`, got `k1` (doc_type_confidence 1.00) — ✓
- Fields:
  - `partnership_name`: ✓ — expected `"Cascade Bay Partners LP"`, got `"Cascade Bay Partners LP"` (confidence 1.00)
  - `partnership_ein`: ✓ — expected `"34-5678901"`, got `"34-5678901"` (confidence 1.00)
  - `partner_name`: ✓ — expected `"Jordan Castellanos"`, got `"Jordan Castellanos"` (confidence 1.00)
  - `partner_tin`: ✓ — expected `"234-56-7890"`, got `"234-56-7890"` (confidence 1.00)
  - `ordinary_business_income`: ✓ — expected `42500`, got `42500` (confidence 1.00)
  - `net_rental_real_estate_income`: ✓ — expected `3200`, got `3200` (confidence 1.00)
  - `interest_income`: ✓ — expected `875`, got `875` (confidence 1.00)
  - `dividends`: ✓ — expected `1240`, got `1240` (confidence 1.00)

## Known limitations

- Baseline fixtures are blank IRS forms; see [fixtures/README.md](../fixtures/README.md) "Day-1 curation backlog" for the filled-fixture TODO that gates the ≥ 90% success criterion.
- `_note` keys in ground-truth files are ignored by the harness; they exist to document fixture provenance alongside the expected values.
