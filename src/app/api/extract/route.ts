import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { z } from "zod";
import { PipelineFailedError, runExtractPipeline } from "@/lib/extract/pipeline";
import { createSupabaseExtractionPort } from "@/lib/extract/supabase-port";
import { DOC_TYPE_THRESHOLD } from "@/lib/extraction/config";
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";

const extractRequestSchema = z.object({
  documentId: z.uuid(),
});

const json = (body: unknown, status: number): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

export const handleExtract = async (request: Request): Promise<Response> => {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const parsed = extractRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return json({ error: "invalid_payload", issues: parsed.error.issues }, 400);
  }

  const { documentId } = parsed.data;
  const port = createSupabaseExtractionPort(createSupabaseServiceRoleClient());

  try {
    const outcome = await runExtractPipeline(
      { port, extract: extractFromPdfBytes, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId }
    );

    if (outcome.kind === "unauthorized") {
      const status = outcome.reason === "document_not_found" ? 404 : 403;

      return json({ error: outcome.reason, documentId }, status);
    }

    if (outcome.kind === "already_processed") {
      return json({ status: "noop", reason: "already_processed", documentStatus: outcome.status }, 200);
    }

    return json({ status: "ok", finalStatus: outcome.finalStatus, documentId }, 200);
  } catch (error) {
    if (error instanceof PipelineFailedError) {
      return json({ error: "extraction_failed", documentId, message: error.message }, 500);
    }

    throw error;
  }
};

export const POST = verifySignatureAppRouter(handleExtract);
