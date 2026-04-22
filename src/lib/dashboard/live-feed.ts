import type { Tables } from "@/lib/database.types";

export type DocumentRow = Tables<"documents">;

export type FeedEvent =
  | { kind: "insert"; row: DocumentRow }
  | { kind: "update"; row: DocumentRow }
  | { kind: "delete"; id: string; workspaceId: string };

export type DocTypeParam = "w2" | "1099_nec" | "1099_misc" | "k1";
export type StatusParam = "pending" | "processing" | "complete" | "failed" | "needs_review";

export type DashboardSearchParams = {
  type: DocTypeParam | null;
  status: StatusParam | null;
  q: string | null;
};

const SEARCHED_EXTRACTED_KEYS: ReadonlyArray<string> = ["payer", "employer", "tin"];

const isDocTypeParam = (raw: string): raw is DocTypeParam => {
  return raw === "w2" || raw === "1099_nec" || raw === "1099_misc" || raw === "k1";
};

const isStatusParam = (raw: string): raw is StatusParam => {
  return raw === "pending" || raw === "processing" || raw === "complete" || raw === "failed" || raw === "needs_review";
};

const eventWorkspaceId = (event: FeedEvent): string => {
  if (event.kind === "delete") {
    return event.workspaceId;
  }

  return event.row.workspace_id;
};

const upsertNewer = (rows: ReadonlyArray<DocumentRow>, incoming: DocumentRow): DocumentRow[] => {
  const index = rows.findIndex(existing => {
    return existing.id === incoming.id;
  });

  if (index === -1) {
    return [incoming, ...rows];
  }

  const existing = rows[index];

  if (existing === undefined) {
    return [incoming, ...rows];
  }

  const winner = incoming.updated_at >= existing.updated_at ? incoming : existing;
  const next = rows.slice();

  next[index] = winner;

  return next;
};

const removeById = (rows: ReadonlyArray<DocumentRow>, id: string): DocumentRow[] => {
  const filtered = rows.filter(row => {
    return row.id !== id;
  });

  if (filtered.length === rows.length) {
    return rows.slice();
  }

  return filtered;
};

export const applyEvent = (
  rows: ReadonlyArray<DocumentRow>,
  event: FeedEvent,
  authedWorkspaceId: string
): DocumentRow[] => {
  if (eventWorkspaceId(event) !== authedWorkspaceId) {
    return rows.slice();
  }

  if (event.kind === "delete") {
    return removeById(rows, event.id);
  }

  return upsertNewer(rows, event.row);
};

export const mergeEvents = (
  initial: ReadonlyArray<DocumentRow>,
  events: ReadonlyArray<FeedEvent>,
  authedWorkspaceId: string
): DocumentRow[] => {
  let accumulator: DocumentRow[] = initial.slice();

  for (const event of events) {
    accumulator = applyEvent(accumulator, event, authedWorkspaceId);
  }

  return accumulator;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const extractConfidence = (field: unknown): number | null => {
  if (!isRecord(field)) {
    return null;
  }

  const confidence = field.confidence;

  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return null;
  }

  return confidence;
};

export const countLowConfidence = (row: DocumentRow, threshold: number): number => {
  if (row.status !== "complete") {
    return 0;
  }

  const data = row.extracted_data;

  if (!isRecord(data)) {
    return 0;
  }

  const edited = isRecord(row.edited_fields) ? row.edited_fields : {};

  let count = 0;

  for (const [key, field] of Object.entries(data)) {
    const confidence = extractConfidence(field);

    if (confidence === null) {
      continue;
    }

    if (confidence >= threshold) {
      continue;
    }

    if (edited[key] === true) {
      continue;
    }

    count += 1;
  }

  return count;
};

const normalizeQuery = (query: string): string => {
  return query.trim().toLowerCase();
};

const stringsUnderSearchedKeys = (data: Record<string, unknown>): string[] => {
  const found: string[] = [];

  for (const key of SEARCHED_EXTRACTED_KEYS) {
    const value = data[key];

    if (typeof value === "string") {
      found.push(value);
      continue;
    }

    if (isRecord(value) && typeof value.value === "string") {
      found.push(value.value);
    }
  }

  return found;
};

export const matchesSearch = (row: DocumentRow, query: string): boolean => {
  const normalized = normalizeQuery(query);

  if (normalized === "") {
    return true;
  }

  if (row.filename.toLowerCase().includes(normalized)) {
    return true;
  }

  const data = row.extracted_data;

  if (!isRecord(data)) {
    return false;
  }

  for (const candidate of stringsUnderSearchedKeys(data)) {
    if (candidate.toLowerCase().includes(normalized)) {
      return true;
    }
  }

  return false;
};

export type FilterInput = {
  type: string | null | undefined;
  status: string | null | undefined;
};

export const filterByParams = (rows: ReadonlyArray<DocumentRow>, params: FilterInput): DocumentRow[] => {
  const typeFilter = params.type === "all" || params.type === undefined ? null : params.type;
  const statusFilter = params.status === "all" || params.status === undefined ? null : params.status;

  return rows.filter(row => {
    if (typeFilter !== null && typeFilter !== undefined && row.doc_type !== typeFilter) {
      return false;
    }

    if (statusFilter !== null && statusFilter !== undefined && row.status !== statusFilter) {
      return false;
    }

    return true;
  });
};

const firstEntry = (raw: string | string[] | undefined): string | null => {
  if (raw === undefined) {
    return null;
  }

  if (Array.isArray(raw)) {
    const first = raw[0];

    return typeof first === "string" && first !== "" ? first : null;
  }

  return raw === "" ? null : raw;
};

export const parseDashboardSearchParams = (
  raw: Record<string, string | string[] | undefined>
): DashboardSearchParams => {
  const rawType = firstEntry(raw.type);
  const rawStatus = firstEntry(raw.status);
  const rawQuery = firstEntry(raw.q);

  const type = rawType === null || rawType === "all" || !isDocTypeParam(rawType) ? null : rawType;
  const status = rawStatus === null || rawStatus === "all" || !isStatusParam(rawStatus) ? null : rawStatus;
  const q = rawQuery === null ? null : rawQuery;

  return { type, status, q };
};
