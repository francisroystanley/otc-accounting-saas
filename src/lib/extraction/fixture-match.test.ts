import { describe, expect, it } from "vitest";
import { compareNumberField, compareStringField } from "@/lib/extraction/fixture-match";

describe("compareStringField", () => {
  it("is case-insensitive and whitespace-tolerant for name/address fields", () => {
    expect(compareStringField("employer_name", "JOHN DOE", "John Doe")).toBe(true);
    expect(compareStringField("employer_name", "  acme  corp  ", "Acme Corp")).toBe(true);
  });

  it("treats blank-equivalent tokens as interchangeable", () => {
    expect(compareStringField("employer_name", "", "N/A")).toBe(true);
    expect(compareStringField("employer_name", "—", "")).toBe(true);
    expect(compareStringField("employer_name", "none", "-")).toBe(true);
  });

  it("requires digit-only equality for identifier fields", () => {
    expect(compareStringField("employer_ein", "12-3456789", "123456789")).toBe(true);
    expect(compareStringField("employee_ssn", "123-45-6789", "123456789")).toBe(true);
    expect(compareStringField("partner_tin", "98-7654321", "987654321")).toBe(true);
    expect(compareStringField("employer_ein", "12-3456789", "12-3456780")).toBe(false);
  });

  it("fails when types differ", () => {
    expect(compareStringField("employer_name", "ACME", 0)).toBe(false);
    expect(compareStringField("employer_name", "ACME", null)).toBe(false);
  });

  it("fails when normalized values differ", () => {
    expect(compareStringField("employer_name", "ACME LLC", "ACME INC")).toBe(false);
  });
});

describe("compareNumberField", () => {
  it("matches within ±$0.01 tolerance", () => {
    expect(compareNumberField(12345, 12345)).toBe(true);
    expect(compareNumberField(12345, 12345.005)).toBe(true);
    expect(compareNumberField(12345, 12345.02)).toBe(false);
    expect(compareNumberField(0, 0)).toBe(true);
  });

  it("fails for non-finite or non-number got", () => {
    expect(compareNumberField(100, "100")).toBe(false);
    expect(compareNumberField(100, Number.NaN)).toBe(false);
    expect(compareNumberField(100, Infinity)).toBe(false);
    expect(compareNumberField(100, null)).toBe(false);
  });

  it("covers currency-parsed Gemini output (pre-coerced upstream)", () => {
    // Zod coerces "$12,345.67" → 12345.67 before the harness sees it,
    // so compareNumberField only has to handle the number side.
    expect(compareNumberField(12345.67, 12345.67)).toBe(true);
  });
});
