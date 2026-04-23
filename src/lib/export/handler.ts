import { type DocType, isDocType } from "@/lib/documents/doc-types";
import {
  type CsvFile,
  type ExportableRow,
  type ExportedField,
  buildCsvFiles,
  groupByDocType,
  isExportedField,
} from "@/lib/export/csv";

// Dashboard-aligned search vocabulary: the server reruns the same q predicate as
// the client-side filter so `/api/export?q=...` yields the same row set the user
// saw in the dashboard table.
const SEARCHED_EXTRACTED_KEYS: ReadonlyArray<string> = ["payer", "employer", "tin"];

export type ExportAuth = {
  userId: string;
  workspaceId: string;
};

// The handler takes a narrow, already-projected row shape. The route adapter is
// responsible for fetching `DocumentRow` from the DB, scoping to the caller's
// workspace, and projecting into `ExportableSource`. Keeping the pure handler
// free of the wider Supabase row type makes it trivial to unit-test.
export type ExportableSource = {
  id: string;
  filename: string;
  doc_type: DocType;
  extracted_data: unknown;
};

// Document-status vocabulary mirrored from the dashboard. Declared here as an
// `as const` tuple so `.includes` narrows `string` to `KnownStatus` without a
// separate type guard.
const KNOWN_STATUSES = ["pending", "processing", "complete", "failed", "needs_review"] as const;

export type KnownStatus = (typeof KNOWN_STATUSES)[number];

export type ExportFilters = {
  type: DocType | null;
  status: KnownStatus | null;
  q: string | null;
};

export type ExportPort = {
  getAuthContext: () => Promise<ExportAuth | null>;
  checkOrigin: (request: Request) => boolean;
  // Pre-filters to `status='complete'` at the DB boundary so needs_review, pending,
  // processing, and failed rows never leave persistence for the export path (R14a).
  // Optionally narrows by `doc_type` when the caller passed `type=...`.
  loadCompleteDocuments: (workspaceId: string, docType: DocType | null) => Promise<ExportableSource[]>;
  // Return ArrayBuffer rather than Uint8Array so the result is directly assignable
  // to `BodyInit`. TS 5+'s stricter generics split Uint8Array into views over
  // `ArrayBufferLike`, which is not structurally a `BufferSource`.
  buildZipBuffer: (files: ReadonlyArray<CsvFile>) => Promise<ArrayBuffer>;
  now: () => Date;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const projectExtractedData = (raw: unknown): Record<string, ExportedField> => {
  if (!isRecord(raw)) {
    return {};
  }

  const out: Record<string, ExportedField> = {};

  for (const [key, candidate] of Object.entries(raw)) {
    if (isExportedField(candidate)) {
      out[key] = { value: candidate.value, confidence: candidate.confidence };
    }
  }

  return out;
};

const toExportableRow = (source: ExportableSource): ExportableRow => {
  return {
    id: source.id,
    filename: source.filename,
    doc_type: source.doc_type,
    extracted_data: projectExtractedData(source.extracted_data),
  };
};

const firstParam = (value: string | null): string | null => {
  if (value === null || value === "") {
    return null;
  }

  return value;
};

const parseTypeParam = (raw: string | null): { ok: true; value: DocType | null } | { ok: false } => {
  if (raw === null || raw === "all") {
    return { ok: true, value: null };
  }

  if (isDocType(raw)) {
    return { ok: true, value: raw };
  }

  return { ok: false };
};

const isKnownStatus = (raw: string): raw is KnownStatus => {
  // Iterate the tuple literally rather than calling `.includes` on a widened
  // `ReadonlyArray<string>` — the lint rule forbids the type assertion that
  // `.includes` would need for TS to accept `string` against the literal union.
  for (const status of KNOWN_STATUSES) {
    if (status === raw) {
      return true;
    }
  }

  return false;
};

const parseStatusParam = (raw: string | null): { ok: true; value: KnownStatus | null } | { ok: false } => {
  if (raw === null || raw === "all") {
    return { ok: true, value: null };
  }

  if (isKnownStatus(raw)) {
    return { ok: true, value: raw };
  }

  return { ok: false };
};

export const parseExportFilters = (searchParams: URLSearchParams): ExportFilters | null => {
  const rawType = firstParam(searchParams.get("type"));
  const rawStatus = firstParam(searchParams.get("status"));
  const rawQuery = firstParam(searchParams.get("q"));

  const typeResult = parseTypeParam(rawType);

  if (!typeResult.ok) {
    return null;
  }

  const statusResult = parseStatusParam(rawStatus);

  if (!statusResult.ok) {
    return null;
  }

  return { type: typeResult.value, status: statusResult.value, q: rawQuery };
};

const matchesQuery = (row: ExportableRow, query: string): boolean => {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return true;
  }

  if (row.filename.toLowerCase().includes(needle)) {
    return true;
  }

  for (const key of SEARCHED_EXTRACTED_KEYS) {
    const field = row.extracted_data[key];

    if (field === undefined) {
      continue;
    }

    const candidate = field.value;

    if (typeof candidate === "string" && candidate.toLowerCase().includes(needle)) {
      return true;
    }
  }

  return false;
};

const pad2 = (value: number): string => {
  return value.toString().padStart(2, "0");
};

export const buildExportFilename = (when: Date): string => {
  const year = when.getFullYear().toString();
  const month = pad2(when.getMonth() + 1);
  const day = pad2(when.getDate());
  const hour = pad2(when.getHours());
  const minute = pad2(when.getMinutes());

  return `otc-export-${year}${month}${day}-${hour}${minute}.zip`;
};

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

export const handleExport = async (request: Request, port: ExportPort): Promise<Response> => {
  if (!port.checkOrigin(request)) {
    return json({ error: "forbidden_origin" }, 403);
  }

  const auth = await port.getAuthContext();

  if (auth === null) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const filters = parseExportFilters(url.searchParams);

  if (filters === null) {
    return json({ error: "invalid_filters" }, 400);
  }

  // If the caller narrowed status to anything other than complete, no rows can
  // satisfy the export constraint (R14a, R22). Short-circuit before touching the DB.
  if (filters.status !== null && filters.status !== "complete") {
    return json({ error: "no_documents_match" }, 400);
  }

  const sources = await port.loadCompleteDocuments(auth.workspaceId, filters.type);
  const exportable = sources.map(toExportableRow);
  const query = filters.q;

  const filtered =
    query === null
      ? exportable
      : exportable.filter(row => {
          return matchesQuery(row, query);
        });

  if (filtered.length === 0) {
    return json({ error: "no_documents_match" }, 400);
  }

  const grouped = groupByDocType(filtered);
  const files = buildCsvFiles(grouped);

  if (files.length === 0) {
    // Defense in depth: grouped has rows but none matched a supported doc_type.
    // Should not happen in practice since the DB query ties off `status='complete'`
    // and `isDocType` gates inbound projection, but surface it cleanly if it does.
    return json({ error: "no_documents_match" }, 400);
  }

  const body = await port.buildZipBuffer(files);
  const filename = buildExportFilename(port.now());

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
};
