import { describe, expect, it } from "vitest";
import type { FieldComparison } from "./extract-report-helpers";
import { parseGroundTruth, thresholdSweep } from "./extract-report-helpers";

describe("parseGroundTruth", () => {
  it("returns a GroundTruth for a valid w2 record", () => {
    const parsed = parseGroundTruth({ doc_type: "w2", fields: { wages: 50000 } }, "fixture.json");

    expect(parsed.doc_type).toBe("w2");
    expect(parsed.fields).toEqual({ wages: 50000 });
  });

  it("strips underscore-prefixed keys from fields", () => {
    const parsed = parseGroundTruth({ doc_type: "w2", fields: { _note: "commentary", wages: 100 } }, "fixture.json");

    expect(parsed.fields).toEqual({ wages: 100 });
  });

  it("accepts a top-level _note key without including it in the output", () => {
    const parsed = parseGroundTruth(
      { _note: "blank baseline", doc_type: "1099_nec", fields: { nonemployee_compensation: 0 } },
      "fixture.json"
    );

    expect(parsed.doc_type).toBe("1099_nec");
    expect(parsed.fields).toEqual({ nonemployee_compensation: 0 });
  });

  it("accepts an unknown doc_type with no fields", () => {
    const parsed = parseGroundTruth({ doc_type: "unknown" }, "fixture.json");

    expect(parsed.doc_type).toBe("unknown");
    expect(parsed.fields).toBeUndefined();
  });

  it("throws on non-object input", () => {
    expect(() => {
      return parseGroundTruth("not-an-object", "fixture.json");
    }).toThrow(/not a JSON object/);

    expect(() => {
      return parseGroundTruth(null, "fixture.json");
    }).toThrow(/not a JSON object/);
  });

  it("throws when the top-level input is an array", () => {
    expect(() => {
      return parseGroundTruth([], "fixture.json");
    }).toThrow(/not a JSON object/);
  });

  it("throws on invalid doc_type", () => {
    expect(() => {
      return parseGroundTruth({ doc_type: "W-2", fields: {} }, "fixture.json");
    }).toThrow(/invalid doc_type/);

    expect(() => {
      return parseGroundTruth({ doc_type: 42, fields: {} }, "fixture.json");
    }).toThrow(/invalid doc_type/);
  });

  it("throws when fields is an array (not a plain object)", () => {
    expect(() => {
      return parseGroundTruth({ doc_type: "w2", fields: ["some-value", "another"] }, "fixture.json");
    }).toThrow(/non-object "fields"/);
  });

  it("throws on non-scalar field values", () => {
    expect(() => {
      return parseGroundTruth({ doc_type: "w2", fields: { wages: { nested: true } } }, "fixture.json");
    }).toThrow(/non-scalar field/);
  });
});

describe("thresholdSweep", () => {
  it("returns null precision when no fields are flagged (division-by-zero guard)", () => {
    const comparisons: FieldComparison[] = [
      { field: "a", expected: 0, got: 0, matched: true, confidence: 0.95 },
      { field: "b", expected: "", got: "", matched: true, confidence: 1.0 },
    ];

    const rows = thresholdSweep(comparisons);

    expect(
      rows.every((r: { flagged: number }) => {
        return r.flagged === 0;
      })
    ).toBe(true);
    expect(
      rows.every((r: { precision: number | null }) => {
        return r.precision === null;
      })
    ).toBe(true);
    expect(
      rows.every((r: { recall: number | null }) => {
        return r.recall === null;
      })
    ).toBe(true);
  });

  it("computes precision and recall for mixed flagged/unflagged comparisons", () => {
    const comparisons: FieldComparison[] = [
      { field: "a", expected: 0, got: 0, matched: true, confidence: 0.5 },
      { field: "b", expected: 10, got: 20, matched: false, confidence: 0.4 },
      { field: "c", expected: 0, got: 0, matched: true, confidence: 0.95 },
      { field: "d", expected: 5, got: 50, matched: false, confidence: 0.95 },
    ];

    const rows = thresholdSweep(comparisons);

    const at080 = rows.find((r: { threshold: number }) => {
      return r.threshold === 0.8;
    });

    // At 0.80, fields with confidence < 0.8 are flagged → a (matched) and b (errored).
    expect(at080?.flagged).toBe(2);
    expect(at080?.flagged_errors).toBe(1);
    expect(at080?.errors_total).toBe(2);
    expect(at080?.precision).toBeCloseTo(0.5, 5);
    expect(at080?.recall).toBeCloseTo(0.5, 5);
  });

  it("returns null recall when there are zero total errors", () => {
    const comparisons: FieldComparison[] = [
      { field: "a", expected: 0, got: 0, matched: true, confidence: 0.5 },
      { field: "b", expected: 0, got: 0, matched: true, confidence: 0.95 },
    ];

    const rows = thresholdSweep(comparisons);

    expect(
      rows.every((r: { recall: number | null }) => {
        return r.recall === null;
      })
    ).toBe(true);
  });
});
