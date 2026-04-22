// Pure helpers for the U7 extraction-accuracy harness. Separated from
// `extract-report.ts` so they can be unit-tested under vitest without
// pulling in the `server-only`-guarded gemini module.
import type { DocType } from "@/lib/extraction/types";

export type GroundTruth = {
  doc_type: DocType | "unknown";
  fields?: Record<string, string | number>;
};

export type FieldComparison = {
  field: string;
  expected: string | number;
  got: string | number | null;
  matched: boolean;
  confidence: number;
};

export type SweepRow = {
  threshold: number;
  flagged: number;
  errors_total: number;
  flagged_errors: number;
  // null when no fields were flagged (precision is undefined) or no errors exist (recall is undefined).
  precision: number | null;
  recall: number | null;
};

export const THRESHOLD_SWEEP = [0.7, 0.8, 0.85, 0.9] as const;

export const VALID_DOC_TYPES: ReadonlySet<string> = new Set<string>(["w2", "1099_nec", "1099_misc", "k1", "unknown"]);

const isValidDocType = (raw: unknown): raw is DocType | "unknown" => {
  return typeof raw === "string" && VALID_DOC_TYPES.has(raw);
};

export const parseGroundTruth = (raw: unknown, source: string): GroundTruth => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Ground truth at ${source} is not a JSON object`);
  }

  const record: Record<string, unknown> = { ...raw };

  if (!isValidDocType(record.doc_type)) {
    throw new Error(`Ground truth at ${source} has invalid doc_type: ${String(record.doc_type)}`);
  }

  const fieldsRaw = record.fields;
  let fields: Record<string, string | number> | undefined;

  if (fieldsRaw !== undefined && fieldsRaw !== null) {
    if (typeof fieldsRaw !== "object" || Array.isArray(fieldsRaw)) {
      throw new Error(`Ground truth at ${source} has non-object "fields"`);
    }

    const entries = Object.entries(fieldsRaw);
    const validated: Record<string, string | number> = {};

    for (const [key, value] of entries) {
      if (key.startsWith("_")) {
        continue;
      }

      if (typeof value !== "string" && typeof value !== "number") {
        throw new Error(`Ground truth at ${source} has non-scalar field "${key}"`);
      }

      validated[key] = value;
    }

    fields = validated;
  }

  return { doc_type: record.doc_type, fields };
};

export const thresholdSweep = (allComparisons: FieldComparison[]): SweepRow[] => {
  const totalErrors = allComparisons.filter(c => {
    return !c.matched;
  }).length;

  return THRESHOLD_SWEEP.map(threshold => {
    const flagged = allComparisons.filter(c => {
      return c.confidence < threshold;
    });

    const flaggedErrors = flagged.filter(c => {
      return !c.matched;
    }).length;

    const precision = flagged.length === 0 ? null : flaggedErrors / flagged.length;
    const recall = totalErrors === 0 ? null : flaggedErrors / totalErrors;

    return {
      threshold,
      flagged: flagged.length,
      errors_total: totalErrors,
      flagged_errors: flaggedErrors,
      precision,
      recall,
    };
  });
};

export const isBlankBaseline = (comparisons: FieldComparison[]): boolean => {
  if (comparisons.length === 0) {
    return true;
  }

  return comparisons.every(c => {
    return c.expected === "" || c.expected === 0;
  });
};
