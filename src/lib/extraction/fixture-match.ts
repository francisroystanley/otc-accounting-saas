// Comparison helpers used by the U7 fixture harness (`scripts/extract-report.ts`).
// Kept separate so the pure matching logic can be unit-tested without touching
// Gemini or the filesystem. Rules mirror `fixtures/README.md`.

const IDENTIFIER_FIELDS = new Set([
  "employee_ssn",
  "employer_ein",
  "payer_tin",
  "recipient_tin",
  "partnership_ein",
  "partner_tin",
]);

const BLANK_STRING_EQUIVALENTS = new Set(["", "n/a", "none", "-", "—"]);

export const NUMBER_TOLERANCE = 0.01;

export const normalizeString = (raw: string): string => {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
};

export const stripNonDigits = (raw: string): string => {
  return raw.replace(/\D+/g, "");
};

export const compareStringField = (field: string, expected: string, got: unknown): boolean => {
  if (typeof got !== "string") {
    return false;
  }

  if (IDENTIFIER_FIELDS.has(field)) {
    return stripNonDigits(expected) === stripNonDigits(got);
  }

  const normExpected = normalizeString(expected);
  const normGot = normalizeString(got);

  if (BLANK_STRING_EQUIVALENTS.has(normExpected) && BLANK_STRING_EQUIVALENTS.has(normGot)) {
    return true;
  }

  return normExpected === normGot;
};

// Floating-point diffs like 12345.01 - 12345 can land fractionally above 0.01.
// The extra 1e-10 slop makes the "inclusive at the boundary" contract in
// fixtures/README.md robust to that without loosening the real ±$0.01 limit.
const FP_EPSILON = 1e-10;

export const compareNumberField = (expected: number, got: unknown): boolean => {
  if (typeof got !== "number" || !Number.isFinite(got)) {
    return false;
  }

  return Math.abs(expected - got) <= NUMBER_TOLERANCE + FP_EPSILON;
};
