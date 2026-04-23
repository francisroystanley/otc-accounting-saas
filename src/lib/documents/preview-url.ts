import { z } from "zod";

export const PREVIEW_URL_TTL_SECONDS = 60 * 15;

export type PreviewUrlAuth = {
  userId: string;
  workspaceId: string;
};

export type PreviewUrlLoadedDocument = {
  id: string;
  workspaceId: string;
  storagePath: string;
};

export type PreviewUrlPort = {
  getAuthContext: () => Promise<PreviewUrlAuth | null>;
  checkOrigin: (request: Request) => boolean;
  loadDocument: (documentId: string) => Promise<PreviewUrlLoadedDocument | null>;
  isWorkspaceMember: (userId: string, workspaceId: string) => Promise<boolean>;
  createSignedReadUrl: (storagePath: string, ttlSeconds: number) => Promise<string | null>;
};

const documentIdSchema = z.uuid();

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

export const handlePreviewUrl = async (
  request: Request,
  documentId: string,
  port: PreviewUrlPort
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
    return json({ error: "not_found" }, 404);
  }

  const isMember = await port.isWorkspaceMember(auth.userId, document.workspaceId);

  if (!isMember) {
    return json({ error: "not_found" }, 404);
  }

  const signedUrl = await port.createSignedReadUrl(document.storagePath, PREVIEW_URL_TTL_SECONDS);

  if (signedUrl === null) {
    return json({ error: "signed_url_failed" }, 500);
  }

  return json({ signedUrl, expiresInSeconds: PREVIEW_URL_TTL_SECONDS }, 200);
};
