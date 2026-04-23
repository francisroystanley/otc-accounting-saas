import { z } from "zod";
import type { DocType } from "@/lib/documents/doc-types";

// Per-doc-type form schemas describe the _edited_ shape — separate from the Gemini
// extraction schemas (`src/lib/extraction/schemas.ts`). The form works with string
// inputs and coerces numeric fields on submit; confidence is preserved from the
// original extraction and is not editable.

export { type DocType, SUPPORTED_DOC_TYPES, isDocType } from "@/lib/documents/doc-types";

export type FieldKind = "string" | "number";

export type FormFieldSpec = {
  name: string;
  label: string;
  kind: FieldKind;
};

export type DocTypeSpec = {
  label: string;
  fields: ReadonlyArray<FormFieldSpec>;
};

export const DOC_TYPE_SPECS: Record<DocType, DocTypeSpec> = {
  "w2": {
    label: "W-2",
    fields: [
      { name: "employee_ssn", label: "Employee SSN", kind: "string" },
      { name: "employer_ein", label: "Employer EIN", kind: "string" },
      { name: "employer_name", label: "Employer name", kind: "string" },
      { name: "employee_name", label: "Employee name", kind: "string" },
      { name: "wages", label: "Wages, tips, other comp", kind: "number" },
      { name: "federal_income_tax_withheld", label: "Federal income tax withheld", kind: "number" },
      { name: "social_security_wages", label: "Social security wages", kind: "number" },
      { name: "social_security_tax_withheld", label: "Social security tax withheld", kind: "number" },
      { name: "medicare_wages", label: "Medicare wages", kind: "number" },
      { name: "medicare_tax_withheld", label: "Medicare tax withheld", kind: "number" },
    ],
  },
  "1099_nec": {
    label: "1099-NEC",
    fields: [
      { name: "payer_name", label: "Payer name", kind: "string" },
      { name: "payer_tin", label: "Payer TIN", kind: "string" },
      { name: "recipient_name", label: "Recipient name", kind: "string" },
      { name: "recipient_tin", label: "Recipient TIN", kind: "string" },
      { name: "nonemployee_compensation", label: "Nonemployee compensation", kind: "number" },
      { name: "federal_income_tax_withheld", label: "Federal income tax withheld", kind: "number" },
    ],
  },
  "1099_misc": {
    label: "1099-MISC",
    fields: [
      { name: "payer_name", label: "Payer name", kind: "string" },
      { name: "payer_tin", label: "Payer TIN", kind: "string" },
      { name: "recipient_name", label: "Recipient name", kind: "string" },
      { name: "recipient_tin", label: "Recipient TIN", kind: "string" },
      { name: "rents", label: "Rents", kind: "number" },
      { name: "royalties", label: "Royalties", kind: "number" },
      { name: "other_income", label: "Other income", kind: "number" },
      { name: "federal_income_tax_withheld", label: "Federal income tax withheld", kind: "number" },
    ],
  },
  "k1": {
    label: "K-1",
    fields: [
      { name: "partnership_name", label: "Partnership name", kind: "string" },
      { name: "partnership_ein", label: "Partnership EIN", kind: "string" },
      { name: "partner_name", label: "Partner name", kind: "string" },
      { name: "partner_tin", label: "Partner TIN", kind: "string" },
      { name: "ordinary_business_income", label: "Ordinary business income", kind: "number" },
      { name: "net_rental_real_estate_income", label: "Net rental real estate income", kind: "number" },
      { name: "interest_income", label: "Interest income", kind: "number" },
      { name: "dividends", label: "Dividends", kind: "number" },
    ],
  },
};

// Form values are strings (HTML inputs are strings). Numeric fields are coerced at
// the submit/build boundary, not at the input.
export type FormValues = Record<string, string>;

// Per-field record as stored in `documents.extracted_data` after user save:
//   { [fieldName]: { value: string | number, confidence: number } }
// For user-picked `needs_review → complete` saves, confidence is 1 (user-verified).
export type StoredField = { value: string | number; confidence: number };

export type StoredExtractedData = Record<string, StoredField>;

const coerceNumberFromInput = (raw: string): number | null => {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");

  if (cleaned === "") {
    return null;
  }

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
};

export const buildFormSchema = (docType: DocType): z.ZodType<FormValues> => {
  const spec = DOC_TYPE_SPECS[docType];
  const shape: Record<string, z.ZodType<string>> = {};

  for (const field of spec.fields) {
    if (field.kind === "number") {
      shape[field.name] = z.string().refine(
        (raw: string) => {
          if (raw.trim() === "") {
            return true;
          }

          return coerceNumberFromInput(raw) !== null;
        },
        { message: "Must be a number (empty allowed)" }
      );
    } else {
      shape[field.name] = z.string();
    }
  }

  return z.object(shape);
};

export const emptyFormValuesFor = (docType: DocType): FormValues => {
  const values: FormValues = {};

  for (const field of DOC_TYPE_SPECS[docType].fields) {
    values[field.name] = "";
  }

  return values;
};

// Extract an initial FormValues map from a row's `extracted_data`. Works whether the
// DB stored the wrapped ExtractionResult (`{doc_type, doc_type_confidence, fields}`)
// or the flat post-edit shape (`{[fieldName]: {value, confidence}}`). Missing fields
// default to empty string.
export const extractFormValuesFrom = (docType: DocType, extractedData: unknown): FormValues => {
  const values = emptyFormValuesFor(docType);
  const source = readFieldBag(extractedData);

  if (source === null) {
    return values;
  }

  for (const field of DOC_TYPE_SPECS[docType].fields) {
    const entry = source[field.name];

    if (entry === undefined) {
      continue;
    }

    if (isFieldEntry(entry)) {
      values[field.name] = String(entry.value);
      continue;
    }

    if (typeof entry === "string" || typeof entry === "number") {
      values[field.name] = String(entry);
    }
  }

  return values;
};

// Extract the confidence map from a row's `extracted_data`. Fields without a numeric
// confidence return null (treated as "no badge").
export const extractConfidenceMapFrom = (docType: DocType, extractedData: unknown): Record<string, number | null> => {
  const map: Record<string, number | null> = {};
  const source = readFieldBag(extractedData);

  for (const field of DOC_TYPE_SPECS[docType].fields) {
    map[field.name] = null;
  }

  if (source === null) {
    return map;
  }

  for (const field of DOC_TYPE_SPECS[docType].fields) {
    const entry = source[field.name];

    if (isFieldEntry(entry) && typeof entry.confidence === "number" && !Number.isNaN(entry.confidence)) {
      map[field.name] = entry.confidence;
    }
  }

  return map;
};

// Build the flat StoredExtractedData payload the PATCH handler writes. Numeric fields
// are coerced; empty numeric inputs persist as `""` (the empty string) so downstream
// can distinguish a user-cleared field from a user-confirmed zero.
export const buildStoredExtractedData = (
  docType: DocType,
  values: FormValues,
  confidenceMap: Record<string, number | null>
): StoredExtractedData => {
  const out: StoredExtractedData = {};

  for (const field of DOC_TYPE_SPECS[docType].fields) {
    const raw = values[field.name] ?? "";
    const confidence = confidenceMap[field.name] ?? 1;

    if (field.kind === "number") {
      const coerced = coerceNumberFromInput(raw);

      out[field.name] = { value: coerced === null ? "" : coerced, confidence };
      continue;
    }

    out[field.name] = { value: raw, confidence };
  }

  return out;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFieldEntry = (value: unknown): value is { value: string | number; confidence: number } => {
  if (!isRecord(value)) {
    return false;
  }

  const v = value.value;

  if (typeof v !== "string" && typeof v !== "number") {
    return false;
  }

  return true;
};

// Unwraps either the flat field bag or the ExtractionResult `{fields: {...}}` wrapper.
// Falls back to the top-level record for shapes we don't recognize.
const readFieldBag = (extractedData: unknown): Record<string, unknown> | null => {
  if (!isRecord(extractedData)) {
    return null;
  }

  if (isRecord(extractedData.fields)) {
    return extractedData.fields;
  }

  return extractedData;
};
