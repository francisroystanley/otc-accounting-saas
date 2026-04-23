import { describe, expect, it } from "vitest";
import {
  DOC_TYPE_SPECS,
  buildFormSchema,
  buildStoredExtractedData,
  emptyFormValuesFor,
  extractConfidenceMapFrom,
  extractFormValuesFrom,
  isDocType,
} from "@/app/(app)/documents/[id]/form-schemas";

describe("isDocType", () => {
  it("accepts the four supported doc types", () => {
    expect(isDocType("w2")).toBe(true);
    expect(isDocType("1099_nec")).toBe(true);
    expect(isDocType("1099_misc")).toBe(true);
    expect(isDocType("k1")).toBe(true);
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isDocType("unknown")).toBe(false);
    expect(isDocType("W-2")).toBe(false);
    expect(isDocType("")).toBe(false);
    expect(isDocType(null)).toBe(false);
    expect(isDocType(undefined)).toBe(false);
    expect(isDocType(42)).toBe(false);
  });
});

describe("DOC_TYPE_SPECS", () => {
  it("declares all 10 W-2 fields", () => {
    expect(DOC_TYPE_SPECS.w2.fields).toHaveLength(10);
  });

  it("declares all 6 1099-NEC fields", () => {
    expect(DOC_TYPE_SPECS["1099_nec"].fields).toHaveLength(6);
  });

  it("declares all 8 1099-MISC fields", () => {
    expect(DOC_TYPE_SPECS["1099_misc"].fields).toHaveLength(8);
  });

  it("declares all 8 K-1 fields", () => {
    expect(DOC_TYPE_SPECS.k1.fields).toHaveLength(8);
  });
});

describe("emptyFormValuesFor", () => {
  it("returns empty strings for every W-2 field", () => {
    const values = emptyFormValuesFor("w2");

    for (const field of DOC_TYPE_SPECS.w2.fields) {
      expect(values[field.name]).toBe("");
    }
  });
});

describe("buildFormSchema", () => {
  it("parses empty strings for all W-2 fields", () => {
    const schema = buildFormSchema("w2");
    const values = emptyFormValuesFor("w2");

    expect(schema.safeParse(values).success).toBe(true);
  });

  it("rejects non-numeric wages input", () => {
    const schema = buildFormSchema("w2");
    const values = { ...emptyFormValuesFor("w2"), wages: "not-a-number" };

    const result = schema.safeParse(values);

    expect(result.success).toBe(false);
  });

  it("accepts '$1,234.56' as a W-2 wages input (currency formatting)", () => {
    const schema = buildFormSchema("w2");
    const values = { ...emptyFormValuesFor("w2"), wages: "$1,234.56" };

    expect(schema.safeParse(values).success).toBe(true);
  });

  it("accepts an empty numeric input as valid (empty allowed)", () => {
    const schema = buildFormSchema("w2");
    const values = { ...emptyFormValuesFor("w2"), wages: "" };

    expect(schema.safeParse(values).success).toBe(true);
  });
});

describe("extractFormValuesFrom", () => {
  it("unwraps the wrapped ExtractionResult shape (pipeline-stored)", () => {
    const wrapped = {
      doc_type: "w2",
      doc_type_confidence: 0.95,
      fields: {
        wages: { value: 1000, confidence: 0.9 },
        employee_ssn: { value: "123-45-6789", confidence: 0.8 },
      },
    };

    const values = extractFormValuesFrom("w2", wrapped);

    expect(values.wages).toBe("1000");
    expect(values.employee_ssn).toBe("123-45-6789");
    expect(values.employer_name).toBe("");
  });

  it("reads the flat field bag shape (user-saved)", () => {
    const flat = {
      wages: { value: 1000, confidence: 0.9 },
      employee_ssn: { value: "123-45-6789", confidence: 1 },
    };

    const values = extractFormValuesFrom("w2", flat);

    expect(values.wages).toBe("1000");
    expect(values.employee_ssn).toBe("123-45-6789");
  });

  it("returns empty values when extracted_data is null", () => {
    const values = extractFormValuesFrom("w2", null);

    expect(values.wages).toBe("");
  });

  it("tolerates primitive field entries (e.g. plain strings) without throwing", () => {
    const values = extractFormValuesFrom("w2", { employee_ssn: "123-45-6789" });

    expect(values.employee_ssn).toBe("123-45-6789");
  });
});

describe("extractConfidenceMapFrom", () => {
  it("returns per-field confidence from the wrapped shape", () => {
    const wrapped = {
      doc_type: "w2",
      doc_type_confidence: 0.95,
      fields: {
        wages: { value: 1000, confidence: 0.9 },
        employee_ssn: { value: "ssn", confidence: 0.4 },
      },
    };

    const map = extractConfidenceMapFrom("w2", wrapped);

    expect(map.wages).toBe(0.9);
    expect(map.employee_ssn).toBe(0.4);
    expect(map.employer_name).toBeNull();
  });

  it("returns null entries for a null extracted_data", () => {
    const map = extractConfidenceMapFrom("w2", null);

    expect(map.wages).toBeNull();
  });

  it("treats non-numeric confidence as null", () => {
    const flat = { wages: { value: 1000, confidence: "high" } };
    const map = extractConfidenceMapFrom("w2", flat);

    expect(map.wages).toBeNull();
  });
});

describe("buildStoredExtractedData", () => {
  it("coerces numeric inputs with currency formatting to numbers", () => {
    const values = { ...emptyFormValuesFor("w2"), wages: "$1,234.56" };
    const confidence = { wages: 0.9, employee_ssn: null };

    const stored = buildStoredExtractedData("w2", values, confidence);

    expect(stored.wages).toEqual({ value: 1234.56, confidence: 0.9 });
  });

  it("preserves string field values verbatim", () => {
    const values = { ...emptyFormValuesFor("w2"), employee_ssn: "123-45-6789" };
    const confidence = { employee_ssn: 0.4 };

    const stored = buildStoredExtractedData("w2", values, confidence);

    expect(stored.employee_ssn.value).toBe("123-45-6789");
    expect(stored.employee_ssn.confidence).toBe(0.4);
  });

  it("defaults confidence to 1 when the map has null (user-picked needs_review save)", () => {
    const values = emptyFormValuesFor("1099_nec");
    const confidence: Record<string, number | null> = {};

    for (const field of DOC_TYPE_SPECS["1099_nec"].fields) {
      confidence[field.name] = null;
    }

    const stored = buildStoredExtractedData("1099_nec", values, confidence);

    expect(stored.payer_name.confidence).toBe(1);
  });

  it("persists empty numeric inputs as an empty string (distinguishable from a confirmed zero)", () => {
    const values = { ...emptyFormValuesFor("w2"), wages: "" };
    const confidence = { wages: 0.2 };

    const stored = buildStoredExtractedData("w2", values, confidence);

    expect(stored.wages.value).toBe("");
  });

  it("persists a user-confirmed zero as the number 0 (not empty string)", () => {
    const values = { ...emptyFormValuesFor("w2"), wages: "0" };
    const confidence = { wages: 0.2 };

    const stored = buildStoredExtractedData("w2", values, confidence);

    expect(stored.wages.value).toBe(0);
  });
});
