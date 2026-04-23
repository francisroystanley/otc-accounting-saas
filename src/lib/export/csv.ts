import { type DocType, FIELD_NAMES_BY_DOC_TYPE, SUPPORTED_DOC_TYPES } from "@/lib/documents/doc-types";

// RFC 4180 line terminator. Excel and Google Sheets both read plain \n CSVs but
// \r\n is the safe default for cross-platform consumption.
const LINE_TERMINATOR = "\r\n";

// Characters that trigger formula interpretation in Excel, LibreOffice Calc, and
// Google Sheets when they appear at the start of a CSV cell. Prefixing such cells
// with a single quote neutralizes the formula without changing the visible value
// — the spreadsheet treats the apostrophe as a leading text marker and hides it.
// Only string values are sanitized: a numeric `-1234` is parsed as a number, not
// a formula, so wrapping it would wrongly coerce it to text.
const FORMULA_PREFIX_CHARS = new Set<string>(["=", "+", "-", "@", "\t", "\r"]);

export type ExportedField = {
  value: string | number;
  confidence: number;
};

export type ExportableRow = {
  id: string;
  filename: string;
  doc_type: DocType;
  extracted_data: Record<string, ExportedField>;
};

const needsQuoting = (value: string): boolean => {
  return value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");
};

export const escapeCsvField = (value: string): string => {
  if (!needsQuoting(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
};

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

  return sanitizeStringCell(value);
};

const formatConfidence = (confidence: number): string => {
  if (!Number.isFinite(confidence)) {
    return "";
  }

  return String(confidence);
};

export const isExportedField = (value: unknown): value is ExportedField => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  if (!("value" in value) || !("confidence" in value)) {
    return false;
  }

  const hasValue = typeof value.value === "string" || typeof value.value === "number";
  const hasConfidence = typeof value.confidence === "number";

  return hasValue && hasConfidence;
};

export const headerRowFor = (docType: DocType): string[] => {
  const fields = FIELD_NAMES_BY_DOC_TYPE[docType];
  const header: string[] = ["document_id", "filename"];

  for (const fieldName of fields) {
    header.push(fieldName);
    header.push(`${fieldName}_confidence`);
  }

  return header;
};

const rowCellsFor = (docType: DocType, row: ExportableRow): string[] => {
  const fields = FIELD_NAMES_BY_DOC_TYPE[docType];
  // Filenames come from user upload and are a direct path to spreadsheet formula
  // execution; sanitize here in addition to formatFieldValue. row.id is a UUID —
  // it can't start with a formula prefix, so it's fine to pass through.
  const cells: string[] = [row.id, sanitizeStringCell(row.filename)];

  for (const fieldName of fields) {
    const field = row.extracted_data[fieldName];

    if (isExportedField(field)) {
      cells.push(formatFieldValue(field.value));
      cells.push(formatConfidence(field.confidence));
      continue;
    }

    cells.push("");
    cells.push("");
  }

  return cells;
};

export const buildCsvForDocType = (docType: DocType, rows: ReadonlyArray<ExportableRow>): string => {
  const lines: string[] = [headerRowFor(docType).map(escapeCsvField).join(",")];

  for (const row of rows) {
    lines.push(rowCellsFor(docType, row).map(escapeCsvField).join(","));
  }

  return lines.join(LINE_TERMINATOR) + LINE_TERMINATOR;
};

export type GroupedRows = Partial<Record<DocType, ExportableRow[]>>;

export const groupByDocType = (rows: ReadonlyArray<ExportableRow>): GroupedRows => {
  const grouped: GroupedRows = {};

  for (const row of rows) {
    const bucket = grouped[row.doc_type];

    if (bucket === undefined) {
      grouped[row.doc_type] = [row];
      continue;
    }

    bucket.push(row);
  }

  return grouped;
};

export type CsvFile = { name: string; content: string };

export const buildCsvFiles = (grouped: GroupedRows): CsvFile[] => {
  const files: CsvFile[] = [];

  // Iterate supported doc types in a stable declared order so the zip contents
  // are deterministic across invocations — easier to test and more predictable
  // for consumers unzipping the file.
  for (const docType of SUPPORTED_DOC_TYPES) {
    const rows = grouped[docType];

    if (rows === undefined || rows.length === 0) {
      continue;
    }

    files.push({ name: `${docType}.csv`, content: buildCsvForDocType(docType, rows) });
  }

  return files;
};
