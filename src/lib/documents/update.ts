import { z } from "zod";
import { type DocType, SUPPORTED_DOC_TYPES, allowedFieldsFor, isDocType } from "@/lib/documents/doc-types";

// Hard cap on individual string values to keep a single user save from bloating the
// jsonb column. 500 characters comfortably accommodates names, TINs, SSNs, and free-text
// while refusing obvious abuse payloads.
const MAX_STRING_VALUE_LEN = 500;

// Per-field record as it lands in `documents.extracted_data` after a user save.
const storedFieldSchema = z.object({
  value: z.union([z.string().max(MAX_STRING_VALUE_LEN), z.number()]),
  confidence: z.number().min(0).max(1),
});

// `edited_fields` is a sparse record — only edited field names appear, each with value `true`.
const editedFieldsSchema = z.record(z.string(), z.literal(true));

const complete_edit_body = z.object({
  action: z.literal("edit"),
  extracted_data: z.record(z.string(), storedFieldSchema),
  edited_fields: editedFieldsSchema,
});

const needs_review_complete_body = z.object({
  action: z.literal("complete_from_needs_review"),
  doc_type: z.enum(SUPPORTED_DOC_TYPES),
  extracted_data: z.record(z.string(), storedFieldSchema),
});

const updateRequestSchema = z.discriminatedUnion("action", [complete_edit_body, needs_review_complete_body]);

export type UpdateRequest = z.infer<typeof updateRequestSchema>;

export type UpdateAuth = {
  userId: string;
  workspaceId: string;
};

export type UpdateLoadedDocument = {
  id: string;
  workspaceId: string;
  status: "pending" | "processing" | "complete" | "failed" | "needs_review";
  docType: DocType | null;
};

// `saveEdit` and `saveNeedsReviewComplete` return a discriminated result so the handler
// can distinguish a transport error (db_error → 500) from a no-matching-row result
// (conflict → 409). A zero-row UPDATE indicates the row's status changed between
// loadDocument and the UPDATE — the adapter scopes the UPDATE with an equality predicate
// on status so it can detect the TOCTOU safely.
export type UpdateWriteResult =
  | { ok: true }
  | { ok: false; kind: "conflict" }
  | { ok: false; kind: "error"; error: string };

export type DocumentUpdatePort = {
  getAuthContext: () => Promise<UpdateAuth | null>;
  checkOrigin: (request: Request) => boolean;
  loadDocument: (documentId: string) => Promise<UpdateLoadedDocument | null>;
  saveEdit: (
    documentId: string,
    extractedData: Record<string, { value: string | number; confidence: number }>,
    editedFields: Record<string, true>
  ) => Promise<UpdateWriteResult>;
  saveNeedsReviewComplete: (
    documentId: string,
    docType: DocType,
    extractedData: Record<string, { value: string | number; confidence: number }>
  ) => Promise<UpdateWriteResult>;
};

const documentIdSchema = z.uuid();

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const findUnknownKeys = (data: Record<string, unknown>, allowed: ReadonlySet<string>): string[] => {
  const unknown: string[] = [];

  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      unknown.push(key);
    }
  }

  return unknown;
};

export const handleDocumentUpdate = async (
  request: Request,
  documentId: string,
  port: DocumentUpdatePort
): Promise<Response> => {
  if (!port.checkOrigin(request)) {
    return json({ error: "forbidden_origin" }, 403);
  }

  const parsedId = documentIdSchema.safeParse(documentId);

  if (!parsedId.success) {
    return json({ error: "invalid_document_id" }, 400);
  }

  const auth = await port.getAuthContext();

  if (auth === null) {
    return json({ error: "unauthorized" }, 401);
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const parsed = updateRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return json({ error: "invalid_payload", issues: parsed.error.issues }, 400);
  }

  const document = await port.loadDocument(parsedId.data);

  if (document === null) {
    return json({ error: "not_found" }, 404);
  }

  if (document.workspaceId !== auth.workspaceId) {
    // 404 (not 403) — don't leak cross-tenant existence.
    return json({ error: "not_found" }, 404);
  }

  const body = parsed.data;

  if (body.action === "edit") {
    if (document.status !== "complete") {
      return json({ error: "invalid_status_transition", from: document.status, expected: "complete" }, 409);
    }

    if (!isDocType(document.docType)) {
      // A `complete` row with a null or off-vocab doc_type is malformed state — refuse
      // to accept user edits against it rather than silently allowing arbitrary keys.
      return json({ error: "unsupported_doc_type" }, 409);
    }

    const allowed = allowedFieldsFor(document.docType);
    const unknownData = findUnknownKeys(body.extracted_data, allowed);
    const unknownEdited = findUnknownKeys(body.edited_fields, allowed);

    if (unknownData.length > 0 || unknownEdited.length > 0) {
      return json({ error: "unknown_fields", fields: [...unknownData, ...unknownEdited] }, 400);
    }

    const result = await port.saveEdit(document.id, body.extracted_data, body.edited_fields);

    if (result.ok) {
      return json({ ok: true }, 200);
    }

    if (result.kind === "conflict") {
      return json({ error: "conflict_status_changed", from: document.status }, 409);
    }

    console.error(`[documents/update] saveEdit failed for ${document.id}: ${result.error}`);

    return json({ error: "db_error" }, 500);
  }

  if (document.status !== "needs_review") {
    return json({ error: "invalid_status_transition", from: document.status, expected: "needs_review" }, 409);
  }

  const allowed = allowedFieldsFor(body.doc_type);
  const unknownData = findUnknownKeys(body.extracted_data, allowed);

  if (unknownData.length > 0) {
    return json({ error: "unknown_fields", fields: unknownData }, 400);
  }

  const result = await port.saveNeedsReviewComplete(document.id, body.doc_type, body.extracted_data);

  if (result.ok) {
    return json({ ok: true }, 200);
  }

  if (result.kind === "conflict") {
    return json({ error: "conflict_status_changed", from: document.status }, 409);
  }

  console.error(`[documents/update] saveNeedsReviewComplete failed for ${document.id}: ${result.error}`);

  return json({ error: "db_error" }, 500);
};
