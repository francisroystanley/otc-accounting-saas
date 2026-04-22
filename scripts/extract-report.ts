// Extraction-accuracy harness. See fixtures/README.md for fixture shape.
//
// The npm script passes `--conditions=react-server` so Node resolves the
// `server-only` module (imported by src/lib/extraction/gemini.ts) to its
// empty stub instead of its throw-on-load default. The harness runs in plain
// Node, not a Next.js RSC runtime — the condition flag is the intentional
// bypass, not a claim that this is a server context.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareNumberField, compareStringField } from "@/lib/extraction/fixture-match";
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import type { DocType } from "@/lib/extraction/types";
import {
  type FieldComparison,
  type GroundTruth,
  type SweepRow,
  isBlankBaseline,
  parseGroundTruth,
  thresholdSweep,
} from "./extract-report-helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures");
const REPORT_PATH = path.join(REPO_ROOT, "EXTRACTION_REPORT.md");

const DOC_TYPES: readonly DocType[] = ["w2", "1099_nec", "1099_misc", "k1"] as const;

type FixtureOutcome = {
  pdf_path: string;
  expected_doc_type: DocType | "unknown";
  actual_doc_type: DocType | "unknown" | "error";
  classification_match: boolean;
  doc_type_confidence: number;
  field_comparisons: FieldComparison[];
  error?: string;
};

type DocTypeSummary = {
  doc_type: DocType;
  fixtures: number;
  classification_matches: number;
  total_fields: number;
  field_matches: number;
  field_accuracy: number;
  classification_accuracy: number;
};

const readJsonUnknown = async (filePath: string): Promise<unknown> => {
  const raw = await fs.readFile(filePath, "utf8");

  return JSON.parse(raw);
};

const fileExists = async (filePath: string): Promise<boolean> => {
  return fs
    .stat(filePath)
    .then(() => {
      return true;
    })
    .catch(() => {
      return false;
    });
};

type GeminiField = { value: string | number; confidence: number };

const isGeminiField = (raw: unknown): raw is GeminiField => {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }

  const record: Record<string, unknown> = { ...raw };
  const valueType = typeof record.value;
  const confidenceType = typeof record.confidence;

  return (valueType === "string" || valueType === "number") && confidenceType === "number";
};

const compareFields = (
  expected: Record<string, string | number>,
  actual: Record<string, unknown>
): FieldComparison[] => {
  return Object.entries(expected).map(([field, expectedValue]) => {
    const actualEntry = actual[field];
    const hasEntry = isGeminiField(actualEntry);
    const gotValue = hasEntry ? actualEntry.value : null;
    const confidence = hasEntry ? actualEntry.confidence : 0;

    let matched = false;

    if (hasEntry) {
      if (typeof expectedValue === "string") {
        matched = compareStringField(field, expectedValue, actualEntry.value);
      } else {
        matched = compareNumberField(expectedValue, actualEntry.value);
      }
    }

    return {
      field,
      expected: expectedValue,
      got: gotValue,
      matched,
      confidence,
    };
  });
};

const runFixture = async (pdfPath: string, groundTruth: GroundTruth): Promise<FixtureOutcome> => {
  const bytes = await fs.readFile(pdfPath);
  const relPath = path.relative(REPO_ROOT, pdfPath).replace(/\\/g, "/");

  try {
    const result = await extractFromPdfBytes(new Uint8Array(bytes));
    const actualDocType = result.doc_type;
    const classificationMatch = actualDocType === groundTruth.doc_type;

    let fieldComparisons: FieldComparison[] = [];

    if (groundTruth.fields && result.fields !== null) {
      const actualFields: Record<string, unknown> = result.fields;

      fieldComparisons = compareFields(groundTruth.fields, actualFields);
    }

    return {
      pdf_path: relPath,
      expected_doc_type: groundTruth.doc_type,
      actual_doc_type: actualDocType,
      classification_match: classificationMatch,
      doc_type_confidence: result.doc_type_confidence,
      field_comparisons: fieldComparisons,
    };
  } catch (error) {
    return {
      pdf_path: relPath,
      expected_doc_type: groundTruth.doc_type,
      actual_doc_type: "error",
      classification_match: false,
      doc_type_confidence: 0,
      field_comparisons: [],
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
};

const sampleIndex = (filename: string): number => {
  const match = filename.match(/sample(\d+)\.pdf$/i);

  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
};

const collectFixtures = async (docType: DocType): Promise<{ pdf: string; ground_truth: string }[]> => {
  const dir = path.join(FIXTURES_DIR, docType);

  if (!(await fileExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir);

  const pdfs = entries
    .filter(name => {
      return name.toLowerCase().endsWith(".pdf");
    })
    .sort((a, b) => {
      return sampleIndex(a) - sampleIndex(b);
    });

  return Promise.all(
    pdfs.map(async name => {
      const pdfPath = path.join(dir, name);
      const groundTruthPath = path.join(dir, name.replace(/\.pdf$/i, ".ground_truth.json"));

      if (!(await fileExists(groundTruthPath))) {
        throw new Error(`Missing ground truth for ${pdfPath} — expected ${groundTruthPath}`);
      }

      return { pdf: pdfPath, ground_truth: groundTruthPath };
    })
  );
};

const summarizeDocType = (docType: DocType, outcomes: FixtureOutcome[]): DocTypeSummary => {
  const classificationMatches = outcomes.filter(o => {
    return o.classification_match;
  }).length;

  const totalFields = outcomes.reduce((acc, o) => {
    return acc + o.field_comparisons.length;
  }, 0);

  const fieldMatches = outcomes.reduce((acc, o) => {
    return (
      acc +
      o.field_comparisons.filter(f => {
        return f.matched;
      }).length
    );
  }, 0);

  const fieldAccuracy = totalFields === 0 ? 0 : fieldMatches / totalFields;
  const classificationAccuracy = outcomes.length === 0 ? 0 : classificationMatches / outcomes.length;

  return {
    doc_type: docType,
    fixtures: outcomes.length,
    classification_matches: classificationMatches,
    total_fields: totalFields,
    field_matches: fieldMatches,
    field_accuracy: fieldAccuracy,
    classification_accuracy: classificationAccuracy,
  };
};

const pct = (value: number): string => {
  return `${(value * 100).toFixed(1)}%`;
};

const pctOrNA = (value: number | null): string => {
  return value === null ? "N/A" : pct(value);
};

const renderSummaryTable = (summaries: DocTypeSummary[]): string => {
  const rows = summaries.map(s => {
    return `| \`${s.doc_type}\` | ${s.fixtures} | ${s.classification_matches}/${s.fixtures} (${pct(s.classification_accuracy)}) | ${s.field_matches}/${s.total_fields} (${pct(s.field_accuracy)}) |`;
  });

  return [
    "| Doc type | Fixtures | Classification | Field accuracy |",
    "| -------- | -------- | -------------- | -------------- |",
    ...rows,
  ].join("\n");
};

const renderPerFixture = (outcomes: FixtureOutcome[]): string => {
  return outcomes
    .map(o => {
      const header = `#### \`${o.pdf_path}\``;

      if (o.error) {
        return `${header}\n\nExtraction error — ${o.error}`;
      }

      const classLine = `- Classification: expected \`${o.expected_doc_type}\`, got \`${o.actual_doc_type}\` (doc_type_confidence ${o.doc_type_confidence.toFixed(2)}) — ${o.classification_match ? "✓" : "✗"}`;

      const fieldLines = o.field_comparisons.map(f => {
        return `  - \`${f.field}\`: ${f.matched ? "✓" : "✗"} — expected \`${JSON.stringify(f.expected)}\`, got \`${JSON.stringify(f.got)}\` (confidence ${f.confidence.toFixed(2)})`;
      });

      return [header, "", classLine, "- Fields:", ...fieldLines, ""].join("\n");
    })
    .join("\n");
};

const renderThresholdSweep = (rows: SweepRow[]): string => {
  const body = rows.map(r => {
    return `| ${r.threshold.toFixed(2)} | ${r.flagged} | ${r.flagged_errors}/${r.errors_total} | ${pctOrNA(r.precision)} | ${pctOrNA(r.recall)} |`;
  });

  return [
    "| Threshold | Flagged fields | Flagged errors / Total errors | Precision | Recall |",
    "| --------- | -------------- | ----------------------------- | --------- | ------ |",
    ...body,
  ].join("\n");
};

const recommendThresholds = (
  summaries: DocTypeSummary[],
  sweep: SweepRow[]
): { confidence: number; docType: number; notes: string[] } => {
  const notes: string[] = [];

  const bestByRecall = [...sweep]
    .filter(r => {
      return r.errors_total > 0 && r.recall !== null;
    })
    .sort((a, b) => {
      const aRecall = a.recall ?? 0;
      const bRecall = b.recall ?? 0;

      if (bRecall !== aRecall) {
        return bRecall - aRecall;
      }

      return (b.precision ?? 0) - (a.precision ?? 0);
    })[0];

  const confidence = bestByRecall?.threshold ?? 0.85;

  if (!bestByRecall) {
    notes.push(
      "Zero field errors across fixtures — keeping the origin default 0.85 for CONFIDENCE_THRESHOLD until filled fixtures land."
    );
  } else {
    notes.push(
      `Chose CONFIDENCE_THRESHOLD=${confidence.toFixed(2)} as the sweep row that flagged the most field errors without drowning the reviewer.`
    );
  }

  const classificationFailures = summaries.filter(s => {
    return s.classification_accuracy < 1;
  });

  if (classificationFailures.length === 0) {
    notes.push("Doc-type classification was 100% across fixtures — keeping DOC_TYPE_THRESHOLD at 0.70.");
  } else {
    notes.push(
      "Classification failed on at least one fixture — leaving DOC_TYPE_THRESHOLD at 0.70 pending richer fixtures."
    );
  }

  return { confidence, docType: 0.7, notes };
};

const decideK1Inclusion = (summary: DocTypeSummary | undefined, outcomes: FixtureOutcome[]): string => {
  if (!summary || summary.fixtures === 0) {
    return "K-1 decision deferred — no K-1 fixtures measured yet.";
  }

  const overallAccuracy = (summary.field_accuracy + summary.classification_accuracy) / 2;

  const k1Comparisons = outcomes.flatMap(o => {
    return o.field_comparisons;
  });

  if (isBlankBaseline(k1Comparisons)) {
    return `K-1 decision deferred — K-1 fixtures are still blank baselines (${pct(overallAccuracy)} trivially). Re-run after filled K-1 fixtures land; if accuracy stays < 80%, drop K-1 from \`src/lib/extraction/types.ts\`/\`schemas.ts\` and propagate to U14 (CSV export).`;
  }

  if (overallAccuracy >= 0.8) {
    return `K-1 kept in the discriminated union — measured accuracy ${pct(overallAccuracy)} ≥ 80%.`;
  }

  return `K-1 accuracy ${pct(overallAccuracy)} < 80% — drop K-1 from \`src/lib/extraction/types.ts\`/\`schemas.ts\` and propagate to U14 (CSV export).`;
};

const runReport = async (): Promise<void> => {
  const outcomesByType = new Map<DocType, FixtureOutcome[]>();

  for (const docType of DOC_TYPES) {
    const fixtures = await collectFixtures(docType);
    const outcomes: FixtureOutcome[] = [];

    for (const { pdf, ground_truth } of fixtures) {
      const raw = await readJsonUnknown(ground_truth);
      const gt = parseGroundTruth(raw, ground_truth);

      process.stdout.write(`  → ${path.relative(REPO_ROOT, pdf).replace(/\\/g, "/")} `);
      const outcome = await runFixture(pdf, gt);

      outcomes.push(outcome);
      process.stdout.write(
        outcome.error ? "ERROR\n" : outcome.classification_match ? "ok\n" : "classification drift\n"
      );
    }

    outcomesByType.set(docType, outcomes);
  }

  const summaries = DOC_TYPES.map(docType => {
    return summarizeDocType(docType, outcomesByType.get(docType) ?? []);
  });

  const allComparisons = summaries.flatMap(s => {
    const outcomes = outcomesByType.get(s.doc_type) ?? [];

    return outcomes.flatMap(o => {
      return o.field_comparisons;
    });
  });

  const sweep = thresholdSweep(allComparisons);
  const recommendation = recommendThresholds(summaries, sweep);

  const k1Summary = summaries.find(s => {
    return s.doc_type === "k1";
  });

  // Overall banner triggers when every comparison across every doc type is blank-baseline,
  // or when there are zero comparisons at all (every fixture was unknown-type).
  const allBlankBaseline =
    allComparisons.length === 0 ||
    allComparisons.every(c => {
      return c.expected === "" || c.expected === 0;
    });

  const k1Outcomes = outcomesByType.get("k1") ?? [];
  const k1Decision = decideK1Inclusion(k1Summary, k1Outcomes);

  const avgConfidence =
    allComparisons.length === 0
      ? 0
      : allComparisons.reduce((acc, c) => {
          return acc + c.confidence;
        }, 0) / allComparisons.length;

  const timestamp = new Date().toISOString();
  const model = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";

  const sections: string[] = [];

  const baselineBanner = allBlankBaseline
    ? `> **Baseline-only:** Every ground-truth field in this run is empty/zero (blank IRS forms). Field accuracy here measures schema conformance, not real extraction quality. See \`fixtures/README.md\` "Day-1 curation backlog" for the filled-fixture TODO.`
    : "";

  sections.push(`# Extraction accuracy report

_Generated: ${timestamp}_
_Model: \`${model}\`_
_Fixtures root: \`fixtures/\` — see [fixtures/README.md](fixtures/README.md) for provenance, schema, and the Day-1 curation backlog._

${baselineBanner}

## Summary

${renderSummaryTable(summaries)}

Mean per-field self-reported confidence across fixtures: **${avgConfidence.toFixed(2)}**. A value close to 1.00 on a blank-fixture baseline indicates the model is not penalizing confidence for empty boxes — this is expected for blank forms but would be a calibration red flag if it persists on filled fixtures.

## K-1 inclusion decision

${k1Decision}

## Recommended thresholds

- \`CONFIDENCE_THRESHOLD\`: **${recommendation.confidence.toFixed(2)}**
- \`DOC_TYPE_THRESHOLD\`: **${recommendation.docType.toFixed(2)}**

Rationale:

${recommendation.notes
  .map(n => {
    return `- ${n}`;
  })
  .join("\n")}

## Threshold sweep

Per-field confidence from all fixtures. "Flagged" = fields where the model's self-reported confidence was below the threshold. Precision/recall measure whether the threshold cleanly separates errors from correct extractions — high recall means the threshold catches most errors; high precision means most flags actually are errors.

${renderThresholdSweep(sweep)}

## Per-fixture detail

`);

  for (const docType of DOC_TYPES) {
    const outcomes = outcomesByType.get(docType) ?? [];

    sections.push(`### \`${docType}\``);

    if (outcomes.length === 0) {
      sections.push(`_No fixtures — add PDFs under \`fixtures/${docType}/\`._\n`);
      continue;
    }

    sections.push(renderPerFixture(outcomes));
  }

  sections.push(`## Known limitations

- Baseline fixtures are blank IRS forms; see \`fixtures/README.md\` "Day-1 curation backlog" for the filled-fixture TODO that gates the ≥ 90% success criterion.
- \`_note\` keys in ground-truth files are ignored by the harness; they exist to document fixture provenance alongside the expected values.
`);

  const report = sections.join("\n");

  await fs.writeFile(REPORT_PATH, report, "utf8");

  const passedSummaries = summaries.filter(s => {
    return s.fixtures > 0;
  });

  const passedCount = passedSummaries.reduce((acc, s) => {
    return acc + s.field_matches + s.classification_matches;
  }, 0);

  const totalCount = passedSummaries.reduce((acc, s) => {
    return acc + s.total_fields + s.fixtures;
  }, 0);

  const allOutcomes = Array.from(outcomesByType.values()).flat();

  const erroredCount = allOutcomes.filter(o => {
    return o.error !== undefined;
  }).length;

  console.log(`\nReport written to ${path.relative(REPO_ROOT, REPORT_PATH).replace(/\\/g, "/")}`);
  console.log(`Overall match count: ${passedCount}/${totalCount}`);

  if (allOutcomes.length > 0 && erroredCount === allOutcomes.length) {
    console.error(
      `\nAll ${allOutcomes.length} fixtures errored — report written, but exiting non-zero so CI/callers notice.`
    );
    process.exit(1);
  }
};

runReport().catch((error: unknown) => {
  console.error("extract-report failed:", error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
