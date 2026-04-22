import type { ExtractionResult } from "@/lib/extraction/types";

export type DocumentStatus = "pending" | "processing" | "complete" | "failed" | "needs_review";

export type FinalizedStatus = "complete" | "failed" | "needs_review";

export type DocumentSnapshot = {
  id: string;
  workspaceId: string;
  storagePath: string;
  status: DocumentStatus;
};

export type ExtractionDataPort = {
  loadDocument: (documentId: string) => Promise<DocumentSnapshot | null>;
  claimForProcessing: (documentId: string) => Promise<boolean>;
  downloadPdf: (storagePath: string) => Promise<Uint8Array>;
  writeResult: (
    documentId: string,
    status: FinalizedStatus,
    data: ExtractionResult | null,
    errorMessage: string | null
  ) => Promise<void>;
};

export type ExtractFn = (bytes: Uint8Array) => Promise<ExtractionResult>;

export type UnauthorizedReason = "document_not_found" | "storage_path_mismatch";

export type PipelineOutcome =
  | { kind: "unauthorized"; reason: UnauthorizedReason }
  | { kind: "already_processed"; status: DocumentStatus }
  | { kind: "complete"; finalStatus: "complete" | "needs_review" };

export class PipelineFailedError extends Error {
  readonly documentId: string;
  readonly originalError: unknown;

  constructor(documentId: string, originalError: unknown, message: string) {
    super(message);
    this.name = "PipelineFailedError";
    this.documentId = documentId;
    this.originalError = originalError;
  }
}

export type RunExtractPipelineDeps = {
  port: ExtractionDataPort;
  extract: ExtractFn;
  docTypeThreshold: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const extractMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Extraction pipeline failed";
};

export const runExtractPipeline = async (
  deps: RunExtractPipelineDeps,
  input: { documentId: string }
): Promise<PipelineOutcome> => {
  const { port, extract, docTypeThreshold } = deps;
  const { documentId } = input;

  const document = await port.loadDocument(documentId);

  if (document === null) {
    return { kind: "unauthorized", reason: "document_not_found" };
  }

  if (!UUID_PATTERN.test(document.workspaceId)) {
    return { kind: "unauthorized", reason: "storage_path_mismatch" };
  }

  const expectedPath = `${document.workspaceId}/${document.id}.pdf`;

  if (document.storagePath !== expectedPath) {
    return { kind: "unauthorized", reason: "storage_path_mismatch" };
  }

  const claimed = await port.claimForProcessing(documentId);

  if (!claimed) {
    return { kind: "already_processed", status: document.status };
  }

  let extractionResult: ExtractionResult;

  try {
    const bytes = await port.downloadPdf(document.storagePath);

    extractionResult = await extract(bytes);
  } catch (error) {
    const message = extractMessage(error);

    try {
      await port.writeResult(documentId, "failed", null, message);
    } catch {
      // Writer errors during the failure path are intentionally swallowed;
      // we surface the original cause so QStash can retry.
    }

    throw new PipelineFailedError(documentId, error, message);
  }

  const belowThreshold = extractionResult.doc_type_confidence < docTypeThreshold;
  const isUnknown = extractionResult.doc_type === "unknown";
  const finalStatus: "complete" | "needs_review" = isUnknown || belowThreshold ? "needs_review" : "complete";

  await port.writeResult(documentId, finalStatus, extractionResult, null);

  return { kind: "complete", finalStatus };
};
