import { z } from "zod";
import { storagePathForDocument, validateFilename } from "@/lib/upload/validate";

const signRequestSchema = z.object({
  filename: z.string(),
});

export type UploadSignPort = {
  getAuthContext: () => Promise<{ userId: string; workspaceId: string } | null>;
  checkOrigin: (request: Request) => boolean;
  createSignedUploadUrl: (storagePath: string) => Promise<{ signedUrl: string; token: string } | null>;
  generateDocumentId: () => string;
};

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

export const handleUploadSign = async (request: Request, port: UploadSignPort): Promise<Response> => {
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

  const parsed = signRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return json({ ok: false, code: "invalid_payload", issues: parsed.error.issues }, 400);
  }

  const filenameError = validateFilename(parsed.data.filename);

  if (filenameError !== null) {
    return json({ ok: false, code: filenameError }, 400);
  }

  const documentId = port.generateDocumentId();
  const storagePath = storagePathForDocument(auth.workspaceId, documentId);
  const signed = await port.createSignedUploadUrl(storagePath);

  if (signed === null) {
    return json({ ok: false, code: "signed_url_failed" }, 500);
  }

  return json(
    {
      ok: true,
      signedUrl: signed.signedUrl,
      token: signed.token,
      documentId,
      storagePath,
    },
    200
  );
};
