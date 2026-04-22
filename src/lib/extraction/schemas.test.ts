import { describe, expect, it } from "vitest";
import { parseExtractionResult } from "@/lib/extraction/schemas";

const validW2 = {
  doc_type: "w2",
  doc_type_confidence: 0.95,
  fields: {
    employee_ssn: { value: "123-45-6789", confidence: 0.9 },
    employer_ein: { value: "12-3456789", confidence: 0.92 },
    employer_name: { value: "Acme Corp", confidence: 0.99 },
    employee_name: { value: "Jane Doe", confidence: 0.98 },
    wages: { value: 75000, confidence: 0.97 },
    federal_income_tax_withheld: { value: 9000, confidence: 0.96 },
    social_security_wages: { value: 75000, confidence: 0.97 },
    social_security_tax_withheld: { value: 4650, confidence: 0.96 },
    medicare_wages: { value: 75000, confidence: 0.97 },
    medicare_tax_withheld: { value: 1087.5, confidence: 0.96 },
  },
};

const valid1099Nec = {
  doc_type: "1099_nec",
  doc_type_confidence: 0.93,
  fields: {
    payer_name: { value: "Big Payer LLC", confidence: 0.95 },
    payer_tin: { value: "98-7654321", confidence: 0.9 },
    recipient_name: { value: "John Smith", confidence: 0.94 },
    recipient_tin: { value: "111-22-3333", confidence: 0.92 },
    nonemployee_compensation: { value: 12500, confidence: 0.97 },
    federal_income_tax_withheld: { value: 0, confidence: 0.99 },
  },
};

const valid1099Misc = {
  doc_type: "1099_misc",
  doc_type_confidence: 0.9,
  fields: {
    payer_name: { value: "Rental Holdings Inc", confidence: 0.95 },
    payer_tin: { value: "55-5555555", confidence: 0.9 },
    recipient_name: { value: "Jane Doe", confidence: 0.94 },
    recipient_tin: { value: "222-33-4444", confidence: 0.92 },
    rents: { value: 24000, confidence: 0.97 },
    royalties: { value: 0, confidence: 0.99 },
    other_income: { value: 0, confidence: 0.99 },
    federal_income_tax_withheld: { value: 0, confidence: 0.99 },
  },
};

const validK1 = {
  doc_type: "k1",
  doc_type_confidence: 0.88,
  fields: {
    partnership_name: { value: "Greenfield Partners", confidence: 0.95 },
    partnership_ein: { value: "77-1234567", confidence: 0.9 },
    partner_name: { value: "Jane Doe", confidence: 0.94 },
    partner_tin: { value: "333-44-5555", confidence: 0.92 },
    ordinary_business_income: { value: 15000, confidence: 0.85 },
    net_rental_real_estate_income: { value: 0, confidence: 0.95 },
    interest_income: { value: 250, confidence: 0.92 },
    dividends: { value: 0, confidence: 0.95 },
  },
};

const validUnknown = {
  doc_type: "unknown",
  doc_type_confidence: 0.4,
  fields: null,
};

describe("parseExtractionResult — happy path", () => {
  it("parses a valid W-2 payload", () => {
    const result = parseExtractionResult(validW2);

    expect(result.doc_type).toBe("w2");

    if (result.doc_type === "w2") {
      expect(result.fields.wages.value).toBe(75000);
      expect(result.doc_type_confidence).toBe(0.95);
    }
  });

  it("parses a valid 1099-NEC payload", () => {
    const result = parseExtractionResult(valid1099Nec);

    expect(result.doc_type).toBe("1099_nec");

    if (result.doc_type === "1099_nec") {
      expect(result.fields.nonemployee_compensation.value).toBe(12500);
    }
  });

  it("parses a valid 1099-MISC payload", () => {
    const result = parseExtractionResult(valid1099Misc);

    expect(result.doc_type).toBe("1099_misc");

    if (result.doc_type === "1099_misc") {
      expect(result.fields.rents.value).toBe(24000);
    }
  });

  it("parses a valid Schedule K-1 payload", () => {
    const result = parseExtractionResult(validK1);

    expect(result.doc_type).toBe("k1");

    if (result.doc_type === "k1") {
      expect(result.fields.ordinary_business_income.value).toBe(15000);
    }
  });
});

describe("parseExtractionResult — error paths", () => {
  it("throws on malformed JSON (missing doc_type)", () => {
    const malformed = { doc_type_confidence: 0.9, fields: {} };

    expect(() => {
      return parseExtractionResult(malformed);
    }).toThrow();
  });

  it("throws when doc_type='k1' is missing required K-1 fields", () => {
    const partialK1 = {
      doc_type: "k1",
      doc_type_confidence: 0.9,
      fields: {
        partnership_name: { value: "Greenfield Partners", confidence: 0.95 },
        // Missing every other required K-1 field.
      },
    };

    expect(() => {
      return parseExtractionResult(partialK1);
    }).toThrow();
  });

  it("throws when doc_type_confidence is out of [0, 1]", () => {
    const badConfidence = { ...validUnknown, doc_type_confidence: 1.5 };

    expect(() => {
      return parseExtractionResult(badConfidence);
    }).toThrow();
  });

  it("throws when a leaf field confidence is out of [0, 1]", () => {
    const badLeafConfidence = {
      ...validW2,
      fields: {
        ...validW2.fields,
        wages: { value: 75000, confidence: 1.2 },
      },
    };

    expect(() => {
      return parseExtractionResult(badLeafConfidence);
    }).toThrow();
  });
});

describe("parseExtractionResult — edge cases", () => {
  it("accepts doc_type='unknown' with fields=null", () => {
    const result = parseExtractionResult(validUnknown);

    expect(result.doc_type).toBe("unknown");
    expect(result.fields).toBeNull();
  });

  it("normalizes doc_type='unknown' with fields={} to fields=null", () => {
    const result = parseExtractionResult({ ...validUnknown, fields: {} });

    expect(result.doc_type).toBe("unknown");
    expect(result.fields).toBeNull();
  });

  it("coerces '$12,345.67' to 12345.67 on numeric fields", () => {
    const withStringNumber = {
      ...validW2,
      fields: {
        ...validW2.fields,
        wages: { value: "$12,345.67", confidence: 0.9 },
      },
    };
    const result = parseExtractionResult(withStringNumber);

    if (result.doc_type === "w2") {
      expect(result.fields.wages.value).toBe(12345.67);
    } else {
      throw new Error(`Expected w2, got ${result.doc_type}`);
    }
  });

  it("coerces a plain numeric string '0' to 0", () => {
    const withStringZero = {
      ...valid1099Misc,
      fields: {
        ...valid1099Misc.fields,
        royalties: { value: "0", confidence: 0.99 },
      },
    };
    const result = parseExtractionResult(withStringZero);

    if (result.doc_type === "1099_misc") {
      expect(result.fields.royalties.value).toBe(0);
    } else {
      throw new Error(`Expected 1099_misc, got ${result.doc_type}`);
    }
  });

  it("throws when a numeric-coerced field is non-numeric garbage", () => {
    const withGarbage = {
      ...validW2,
      fields: {
        ...validW2.fields,
        wages: { value: "N/A", confidence: 0.9 },
      },
    };

    expect(() => {
      return parseExtractionResult(withGarbage);
    }).toThrow();
  });
});
