// Single source of truth for the supported document types and their field names.
// Kept in `src/lib/documents/` (not `src/app/.../form-schemas`) so both the form layer
// and the PATCH handler can import it without a Client/Server boundary crossing.
//
// Field names MUST stay in lockstep with the Gemini extraction schemas in
// `src/lib/extraction/schemas.ts` — a user edit that accepts an out-of-spec field would
// be dropped on the next re-extraction, and an extraction that writes an out-of-spec
// field would fail the PATCH allow-list check here.

export type DocType = "w2" | "1099_nec" | "1099_misc" | "k1";

export const SUPPORTED_DOC_TYPES: ReadonlyArray<DocType> = ["w2", "1099_nec", "1099_misc", "k1"];

export const isDocType = (value: unknown): value is DocType => {
  if (typeof value !== "string") {
    return false;
  }

  for (const supported of SUPPORTED_DOC_TYPES) {
    if (value === supported) {
      return true;
    }
  }

  return false;
};

export const FIELD_NAMES_BY_DOC_TYPE: Record<DocType, ReadonlyArray<string>> = {
  "w2": [
    "employee_ssn",
    "employer_ein",
    "employer_name",
    "employee_name",
    "wages",
    "federal_income_tax_withheld",
    "social_security_wages",
    "social_security_tax_withheld",
    "medicare_wages",
    "medicare_tax_withheld",
  ],
  "1099_nec": [
    "payer_name",
    "payer_tin",
    "recipient_name",
    "recipient_tin",
    "nonemployee_compensation",
    "federal_income_tax_withheld",
  ],
  "1099_misc": [
    "payer_name",
    "payer_tin",
    "recipient_name",
    "recipient_tin",
    "rents",
    "royalties",
    "other_income",
    "federal_income_tax_withheld",
  ],
  "k1": [
    "partnership_name",
    "partnership_ein",
    "partner_name",
    "partner_tin",
    "ordinary_business_income",
    "net_rental_real_estate_income",
    "interest_income",
    "dividends",
  ],
};

export const allowedFieldsFor = (docType: DocType): ReadonlySet<string> => {
  return new Set(FIELD_NAMES_BY_DOC_TYPE[docType]);
};
