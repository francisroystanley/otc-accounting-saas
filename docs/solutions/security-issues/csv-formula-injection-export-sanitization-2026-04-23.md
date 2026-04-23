---
title: CSV formula injection via extracted string fields and user-uploaded filenames
date: 2026-04-23
category: security-issues
module: export
problem_type: security_issue
component: csv-export
severity: high
symptoms:
  - A downloaded /api/export zip opened in Excel, LibreOffice Calc, or Google Sheets executes formulas supplied by attacker-controlled cell values
  - Cells whose value begins with "=", "+", "-", "@", tab, or CR are interpreted as formulas instead of text when the spreadsheet opens the CSV
  - Exfiltration vectors: =HYPERLINK('evil'), =WEBSERVICE(), =IMPORTDATA(), +cmd|calc via DDE on old Excel
root_cause: missing_validation
resolution_type: code_fix
tags:
  - csv-injection
  - formula-injection
  - export
  - owasp
  - spreadsheet
  - sanitization
---

# CSV formula injection via extracted string fields and user-uploaded filenames

## Problem

RFC 4180 only covers _structural_ CSV escaping (commas, quotes, newlines). It says nothing about cells that begin with characters spreadsheets treat as formula triggers — so an attacker who controls any string field in an exported CSV can run formulas in the victim's spreadsheet when they open the download.

In U13 (CSV zip export), two attacker-reachable string fields land in CSV cells unsanitized:

1. `row.filename` — user-supplied at upload, written as cell 2 per row.
2. `extracted_data.<field>.value` — string-typed fields (employer_name, payer_name, recipient_name, TINs/SSNs) come from Gemini's transcription of the PDF, which an attacker can craft.

## Solution

Prefix any _string_ cell whose first character is a formula trigger with a single quote (`'`). The spreadsheet then treats the value as literal text and hides the apostrophe in the displayed cell. Numeric cells pass through unchanged — `-1234.56` is a number to the spreadsheet, not a formula.

```ts
// src/lib/export/csv.ts
const FORMULA_PREFIX_CHARS = new Set<string>(["=", "+", "-", "@", "\t", "\r"]);

export const sanitizeStringCell = (value: string): string => {
  if (value.length === 0) {
    return value;
  }

  const first = value[0];

  if (FORMULA_PREFIX_CHARS.has(first)) {
    return `'${value}`;
  }

  return value;
};

const formatFieldValue = (value: string | number): string => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  return sanitizeStringCell(value); // strings only
};

const rowCellsFor = (docType: DocType, row: ExportableRow): string[] => {
  const fields = FIELD_NAMES_BY_DOC_TYPE[docType];
  const cells: string[] = [row.id, sanitizeStringCell(row.filename)];
  // ... formatFieldValue handles per-field sanitization for string values
};
```

Apply RFC 4180 escaping _after_ the formula-prefix sanitization so the apostrophe survives as part of the cell value.

## Why this works

Excel, LibreOffice Calc, and Google Sheets all share the rule that a cell starting with an apostrophe is displayed as text and never evaluated. The leading apostrophe is not shown in the cell, so downstream copy-paste workflows see the intended value. Numeric cells like `-1234.56` stay numeric because spreadsheets parse them as numbers directly — they were never formula candidates in the first place.

Sanitizing _numeric_ values would break the export: negative dollar amounts would become text-typed `-1234.56` cells that the user can't sum or chart.

## Prevention

- **Apply the check at the single CSV serialization boundary.** Per-field conditional sanitization at the call site accumulates drift as new string-typed fields are added.
- **Sanitize filenames too.** They feel "trusted" because the app generates most of them, but user-supplied originals flow straight into the CSV cell.
- **Only sanitize strings.** Numbers can be formula-like literals (`-5`) but spreadsheets parse them as numeric values. Prefixing would incorrectly coerce them to text.
- **Tests should cover every trigger character.** Missing even one prefix (e.g., forgetting `@` because it's less commonly known) leaves an exploitable gap.

```ts
// src/lib/export/csv.test.ts
describe("sanitizeStringCell", () => {
  it("prefixes values starting with '+', '-', '@', tab, or carriage return", () => {
    expect(sanitizeStringCell("+cmd|calc")).toBe("'+cmd|calc");
    expect(sanitizeStringCell("-SUM(A:A)")).toBe("'-SUM(A:A)");
    expect(sanitizeStringCell("@AppleScript")).toBe("'@AppleScript");
    expect(sanitizeStringCell("\t=WEBSERVICE()")).toBe("'\t=WEBSERVICE()");
    expect(sanitizeStringCell("\rformula")).toBe("'\rformula");
  });

  it("does not change numeric values — negative numbers stay numeric", () => {
    // Exported as ",-1234.56," — no apostrophe prefix.
  });
});
```

## When this applies

Any code path that writes user-supplied or LLM-extracted string content into a CSV, TSV, or other format that spreadsheets auto-open by double-click. Web exports are the typical trigger, but the same rule applies to emailed CSV attachments and S3-hosted CSV reports.

## Related

- U13 implementation: `src/lib/export/csv.ts`, tests in `src/lib/export/csv.test.ts`
- OWASP: [CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- R14a in the plan already constrains exported rows to `status='complete'`, so the surface is scoped to already-extracted documents — but that does not reduce the formula-injection risk.
