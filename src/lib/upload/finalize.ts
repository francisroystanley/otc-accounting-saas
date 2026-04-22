import { z } from "zod";
import {
  PDF_MAGIC_BYTES,
  hasPdfMagicBytes,
  isWithinSizeLimit,
  storagePathForDocument,
  validateFilename,
} from "@/lib/upload/validate";

const finalizeRequestSchema = z.object({
  documentId: z.uuid(),
  filename: z.string(),
  storagePath: z.string(),
});

export type UploadFinalizeInsertRow = {
  id: string;
  workspaceId: string;
  uploadedBy: string;
  filename: string;
  storagePath: string;
};

export type UploadFinalizeInsertResult =
  | { ok: true }
  | { ok: false; kind: "duplicate"; error: string }
  | { ok: false; kind: "other"; error: string };

export type UploadFinalizePort = {
  getAuthContext: () => Promise<{ userId: string; workspaceId: string } | null>;
  checkOrigin: (request: Request) => boolean;
  getObjectSize: (storagePath: string) => Promise<number | null>;
  getObjectHead: (storagePath: string, byteCount: number) => Promise<Uint8Array | null>;
  deleteObject: (storagePath: string) => Promise<void>;
  insertDocumentRow: (row: UploadFinalizeInsertRow) => Promise<UploadFinalizeInsertResult>;
  deleteDocumentRow: (documentId: string) => Promise<void>;
  publishExtract: (documentId: string) => Promise<void>;
};

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const safeDelete = async (port: UploadFinalizePort, storagePath: string): Promise<void> => {
  try {
    await port.deleteObject(storagePath);
  } catch (error) {
    console.error(`[upload/finalize] failed to delete orphaned object ${storagePath}`, error);
  }
};

const safeDeleteRow = async (port: UploadFinalizePort, documentId: string): Promise<void> => {
  try {
    await port.deleteDocumentRow(documentId);
  } catch (error) {
    console.error(`[upload/finalize] failed to delete orphaned row ${documentId}`, error);
  }
};

export const handleUploadFinalize = async (request: Request, port: UploadFinalizePort): Promise<Response> => {
  if (!port.checkOrigin(request)) {
    return json({ ok: false, code: "forbidden_origin" }, 403);
  }

  const auth = await port.getAuthContext();

  if (auth === null) {
    return json({ ok: false, code: "unauthorized" }, 401);
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return json({ ok: false, code: "invalid_json_body" }, 400);
  }

  const parsed = finalizeRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return json({ ok: false, code: "invalid_payload" }, 400);
  }

  const { documentId, filename, storagePath } = parsed.data;
  const filenameError = validateFilename(filename);

  if (filenameError !== null) {
    return json({ ok: false, code: filenameError }, 400);
  }

  const expectedPath = storagePathForDocument(auth.workspaceId, documentId);

  if (storagePath !== expectedPath) {
    return json({ ok: false, code: "forbidden_path" }, 400);
  }

  const size = await port.getObjectSize(storagePath);

  if (size === null) {
    return json({ ok: false, code: "storage_object_missing" }, 400);
  }

  if (size === 0) {
    await safeDelete(port, storagePath);

    return json({ ok: false, code: "empty_upload" }, 400);
  }

  if (!isWithinSizeLimit(size)) {
    await safeDelete(port, storagePath);

    return json({ ok: false, code: "oversize" }, 400);
  }

  const head = await port.getObjectHead(storagePath, PDF_MAGIC_BYTES.length);

  if (head === null || !hasPdfMagicBytes(head)) {
    await safeDelete(port, storagePath);

    return json({ ok: false, code: "magic_bytes_mismatch" }, 400);
  }

  const insertResult = await port.insertDocumentRow({
    id: documentId,
    workspaceId: auth.workspaceId,
    uploadedBy: auth.userId,
    filename,
    storagePath,
  });

  if (!insertResult.ok) {
    if (insertResult.kind === "duplicate") {
      // A prior finalize for this (documentId, storagePath) already succeeded. Treat as idempotent —
      // do NOT delete the storage object (it belongs to the first successful row) and do NOT
      // republish; the original QStash message is already in flight or processed.
      return json({ ok: true, documentId, idempotent: true }, 200);
    }

    console.error(`[upload/finalize] insert failed for ${documentId}: ${insertResult.error}`);

    return json({ ok: false, code: "insert_failed" }, 500);
  }

  try {
    await port.publishExtract(documentId);
  } catch (error) {
    console.error(`[upload/finalize] publishExtract failed for ${documentId}`, error);
    await safeDeleteRow(port, documentId);
    await safeDelete(port, storagePath);

    return json({ ok: false, code: "publish_failed" }, 500);
  }

  return json({ ok: true, documentId }, 200);
};
