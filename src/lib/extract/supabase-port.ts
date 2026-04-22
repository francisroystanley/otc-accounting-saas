import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import type { Database, Json } from "@/lib/database.types";
import type { DocumentSnapshot, DocumentStatus, ExtractionDataPort, FinalizedStatus } from "@/lib/extract/pipeline";
import type { ExtractionResult } from "@/lib/extraction/types";

const STORAGE_BUCKET = "documents";

const toJsonValue = (value: unknown): Json => {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): Json => {
      return toJsonValue(item);
    });
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    const result: { [key: string]: Json } = {};

    for (const [key, rawEntry] of entries) {
      if (rawEntry !== undefined) {
        result[key] = toJsonValue(rawEntry);
      }
    }

    return result;
  }

  throw new Error(`Cannot serialize value of type ${typeof value} to Json`);
};

const toUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const buffer = await blob.arrayBuffer();

  return new Uint8Array(buffer);
};

const toDocumentStatus = (raw: string): DocumentStatus => {
  if (raw === "pending" || raw === "processing" || raw === "complete" || raw === "failed" || raw === "needs_review") {
    return raw;
  }

  throw new Error(`Unexpected document status from DB: ${raw}`);
};

export const createSupabaseExtractionPort = (client: SupabaseClient<Database>): ExtractionDataPort => {
  return {
    loadDocument: async (documentId): Promise<DocumentSnapshot | null> => {
      const { data, error } = await client
        .from("documents")
        .select("id, workspace_id, storage_path, status")
        .eq("id", documentId)
        .maybeSingle();

      if (error !== null) {
        throw new Error(`loadDocument failed: ${error.message}`);
      }

      if (data === null) {
        return null;
      }

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        storagePath: data.storage_path,
        status: toDocumentStatus(data.status),
      };
    },

    claimForProcessing: async (documentId): Promise<boolean> => {
      const { data, error } = await client
        .from("documents")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", documentId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (error !== null) {
        throw new Error(`claimForProcessing failed: ${error.message}`);
      }

      return data !== null;
    },

    downloadPdf: async (storagePath): Promise<Uint8Array> => {
      const { data, error } = await client.storage.from(STORAGE_BUCKET).download(storagePath);

      if (error !== null) {
        throw new Error(`downloadPdf failed for ${storagePath}: ${error.message}`);
      }

      if (data === null) {
        throw new Error(`downloadPdf returned no data for ${storagePath}`);
      }

      return toUint8Array(data);
    },

    writeResult: async (
      documentId,
      status: FinalizedStatus,
      data: ExtractionResult | null,
      errorMessage: string | null
    ): Promise<void> => {
      const dataArg: Json | undefined = data === null ? undefined : toJsonValue(data);
      const errorArg: string | undefined = errorMessage === null ? undefined : errorMessage;
      const { error } = await client.rpc("update_extraction_result", {
        doc_id: documentId,
        new_status: status,
        data: dataArg,
        error: errorArg,
      });

      if (error !== null) {
        throw new Error(`update_extraction_result RPC failed: ${error.message}`);
      }
    },
  };
};
