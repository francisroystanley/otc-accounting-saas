import { z } from "zod";

export type DocumentDeleteAuth = {
  userId: string;
  workspaceId: string;
  email: string | null;
};

export type LoadedDocument = {
  id: string;
  workspaceId: string;
  storagePath: string;
};

export type RemoveStorageResult =
  | { ok: true }
  | { ok: false; kind: "not_found"; error: string }
  | { ok: false; kind: "other"; error: string };

export type DeleteRowResult = { ok: true } | { ok: false; error: string };

export type DocumentDeletePort = {
  getAuthContext: () => Promise<DocumentDeleteAuth | null>;
  checkOrigin: (request: Request) => boolean;
  loadDocument: (documentId: string) => Promise<LoadedDocument | null>;
  isWorkspaceMember: (userId: string, workspaceId: string) => Promise<boolean>;
  removeStorageObject: (storagePath: string) => Promise<RemoveStorageResult>;
  deleteDocumentRow: (documentId: string, workspaceId: string) => Promise<DeleteRowResult>;
};

const documentIdSchema = z.uuid();

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const noContent = (): Response => {
  return new Response(null, { status: 204 });
};

export const handleDocumentDelete = async (
  request: Request,
  documentId: string,
  port: DocumentDeletePort
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

  const document = await port.loadDocument(parsedId.data);

  if (document === null) {
    return json({ error: "not_found" }, 404);
  }

  if (document.workspaceId !== auth.workspaceId) {
    // Deliberately 404 (not 403) to avoid leaking cross-tenant existence.
    return json({ error: "not_found" }, 404);
  }

  // Defense-in-depth: the service-role client bypasses RLS, so the handler — not the DB —
  // is the authorization fence. The `workspace_id === auth.workspaceId` equality check above
  // is authoritative given how `getAuthenticatedContext` is scoped today; this second
  // membership query catches the case where membership has been revoked mid-session and the
  // JWT claim is still cached.
  const isMember = await port.isWorkspaceMember(auth.userId, document.workspaceId);

  if (!isMember) {
    return json({ error: "not_found" }, 404);
  }

  const storageResult = await port.removeStorageObject(document.storagePath);

  if (!storageResult.ok && storageResult.kind === "other") {
    console.error(`[documents/delete] storage remove failed for ${document.id}: ${storageResult.error}`);

    return json({ error: "storage_error" }, 500);
  }

  if (!storageResult.ok && storageResult.kind === "not_found") {
    // Idempotent retry path: a prior call already removed the object but may have failed before
    // deleting the row. Proceed to row delete — the next ``Delete`` click will no-op.
    console.info(`[documents/delete] storage object already gone for ${document.id}: ${storageResult.error}`);
  }

  const rowResult = await port.deleteDocumentRow(document.id, document.workspaceId);

  if (!rowResult.ok) {
    console.error(`[documents/delete] row delete failed for ${document.id}: ${rowResult.error}`);

    return json({ error: "db_error" }, 500);
  }

  return noContent();
};
