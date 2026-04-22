import { type Schema, Type } from "@google/genai";
import { z } from "zod";
import type { ExtractionResult } from "@/lib/extraction/types";

const confidence = z.number().min(0).max(1);

const stringField = z.object({
  value: z.string(),
  confidence,
});

const coerceNumericValue = z.preprocess((raw: unknown): unknown => {
  if (typeof raw === "number") {
    return raw;
  }

  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");

    if (cleaned === "") {
      return raw;
    }

    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : raw;
  }

  return raw;
}, z.number());

const numberField = z.object({
  value: coerceNumericValue,
  confidence,
});

const w2FieldsSchema = z.object({
  employee_ssn: stringField,
  employer_ein: stringField,
  employer_name: stringField,
  employee_name: stringField,
  wages: numberField,
  federal_income_tax_withheld: numberField,
  social_security_wages: numberField,
  social_security_tax_withheld: numberField,
  medicare_wages: numberField,
  medicare_tax_withheld: numberField,
});

const nec1099FieldsSchema = z.object({
  payer_name: stringField,
  payer_tin: stringField,
  recipient_name: stringField,
  recipient_tin: stringField,
  nonemployee_compensation: numberField,
  federal_income_tax_withheld: numberField,
});

const misc1099FieldsSchema = z.object({
  payer_name: stringField,
  payer_tin: stringField,
  recipient_name: stringField,
  recipient_tin: stringField,
  rents: numberField,
  royalties: numberField,
  other_income: numberField,
  federal_income_tax_withheld: numberField,
});

const k1FieldsSchema = z.object({
  partnership_name: stringField,
  partnership_ein: stringField,
  partner_name: stringField,
  partner_tin: stringField,
  ordinary_business_income: numberField,
  net_rental_real_estate_income: numberField,
  interest_income: numberField,
  dividends: numberField,
});

const extractionResultSchema = z.discriminatedUnion("doc_type", [
  z.object({
    doc_type: z.literal("w2"),
    doc_type_confidence: confidence,
    fields: w2FieldsSchema,
  }),
  z.object({
    doc_type: z.literal("1099_nec"),
    doc_type_confidence: confidence,
    fields: nec1099FieldsSchema,
  }),
  z.object({
    doc_type: z.literal("1099_misc"),
    doc_type_confidence: confidence,
    fields: misc1099FieldsSchema,
  }),
  z.object({
    doc_type: z.literal("k1"),
    doc_type_confidence: confidence,
    fields: k1FieldsSchema,
  }),
  z.object({
    doc_type: z.literal("unknown"),
    doc_type_confidence: confidence,
    // Accept both `null` (preferred) and `{}` (what the Gemini OBJECT schema may emit
    // for a nullable field) — normalize to null to match ExtractionResult's shape.
    fields: z.preprocess((raw: unknown): unknown => {
      if (raw === null) {
        return null;
      }

      if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0) {
        return null;
      }

      return raw;
    }, z.null()),
  }),
]);

export const parseExtractionResult = (raw: unknown): ExtractionResult => {
  return extractionResultSchema.parse(raw);
};

// ---------- Gemini responseSchema (OpenAPI 3.0 subset) ----------
//
// Mirrors the Zod schema. `anyOf` discriminates on the `doc_type` enum literal
// (see origin plan: "responseSchema with anyOf across doc types, discriminated
// by the doc_type enum"). If Day-1 fixture calibration shows `anyOf` is
// unreliable for discriminated unions on Gemini 3 Flash Preview, fall back to
// `responseJsonSchema` with `oneOf` — contained entirely in this file.

const stringFieldSchema: Schema = {
  type: Type.OBJECT,
  required: ["value", "confidence"],
  properties: {
    value: { type: Type.STRING },
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
  },
};

const numberFieldSchema: Schema = {
  type: Type.OBJECT,
  required: ["value", "confidence"],
  properties: {
    value: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
  },
};

const buildFieldsObject = (fields: Record<string, Schema>): Schema => {
  return {
    type: Type.OBJECT,
    required: Object.keys(fields),
    properties: fields,
  };
};

const docTypeConfidence: Schema = { type: Type.NUMBER, minimum: 0, maximum: 1 };

const w2ResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["doc_type", "doc_type_confidence", "fields"],
  properties: {
    doc_type: { type: Type.STRING, format: "enum", enum: ["w2"] },
    doc_type_confidence: docTypeConfidence,
    fields: buildFieldsObject({
      employee_ssn: stringFieldSchema,
      employer_ein: stringFieldSchema,
      employer_name: stringFieldSchema,
      employee_name: stringFieldSchema,
      wages: numberFieldSchema,
      federal_income_tax_withheld: numberFieldSchema,
      social_security_wages: numberFieldSchema,
      social_security_tax_withheld: numberFieldSchema,
      medicare_wages: numberFieldSchema,
      medicare_tax_withheld: numberFieldSchema,
    }),
  },
};

const nec1099ResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["doc_type", "doc_type_confidence", "fields"],
  properties: {
    doc_type: { type: Type.STRING, format: "enum", enum: ["1099_nec"] },
    doc_type_confidence: docTypeConfidence,
    fields: buildFieldsObject({
      payer_name: stringFieldSchema,
      payer_tin: stringFieldSchema,
      recipient_name: stringFieldSchema,
      recipient_tin: stringFieldSchema,
      nonemployee_compensation: numberFieldSchema,
      federal_income_tax_withheld: numberFieldSchema,
    }),
  },
};

const misc1099ResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["doc_type", "doc_type_confidence", "fields"],
  properties: {
    doc_type: { type: Type.STRING, format: "enum", enum: ["1099_misc"] },
    doc_type_confidence: docTypeConfidence,
    fields: buildFieldsObject({
      payer_name: stringFieldSchema,
      payer_tin: stringFieldSchema,
      recipient_name: stringFieldSchema,
      recipient_tin: stringFieldSchema,
      rents: numberFieldSchema,
      royalties: numberFieldSchema,
      other_income: numberFieldSchema,
      federal_income_tax_withheld: numberFieldSchema,
    }),
  },
};

const k1ResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["doc_type", "doc_type_confidence", "fields"],
  properties: {
    doc_type: { type: Type.STRING, format: "enum", enum: ["k1"] },
    doc_type_confidence: docTypeConfidence,
    fields: buildFieldsObject({
      partnership_name: stringFieldSchema,
      partnership_ein: stringFieldSchema,
      partner_name: stringFieldSchema,
      partner_tin: stringFieldSchema,
      ordinary_business_income: numberFieldSchema,
      net_rental_real_estate_income: numberFieldSchema,
      interest_income: numberFieldSchema,
      dividends: numberFieldSchema,
    }),
  },
};

const unknownResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["doc_type", "doc_type_confidence", "fields"],
  properties: {
    doc_type: { type: Type.STRING, format: "enum", enum: ["unknown"] },
    doc_type_confidence: docTypeConfidence,
    fields: { type: Type.OBJECT, nullable: true, properties: {} },
  },
};

export const geminiResponseSchema: Schema = {
  anyOf: [w2ResponseSchema, nec1099ResponseSchema, misc1099ResponseSchema, k1ResponseSchema, unknownResponseSchema],
};
