import "server-only";
import { isSameOriginRequest } from "@/lib/auth/origin-check";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { publishExtract } from "@/lib/qstash";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";
import { type UploadFinalizePort, handleUploadFinalize } from "@/lib/upload/finalize";

const STORAGE_BUCKET = "documents";
const POSTGRES_UNIQUE_VIOLATION = "23505";

const createRealPort = (): UploadFinalizePort => {
  const client = createSupabaseServiceRoleClient();

  return {
    getAuthContext: getAuthenticatedContext,
    checkOrigin: isSameOriginRequest,

    getObjectSize: async storagePath => {
      const { data, error } = await client.storage.from(STORAGE_BUCKET).info(storagePath);

      if (error !== null || data === null || typeof data.size !== "number") {
        return null;
      }

      return data.size;
    },

    getObjectHead: async (storagePath, byteCount) => {
      const { data, error } = await client.storage.from(STORAGE_BUCKET).download(storagePath);

      if (error !== null || data === null) {
        return null;
      }

      const slice = await data.slice(0, byteCount).arrayBuffer();

      return new Uint8Array(slice);
    },

    deleteObject: async storagePath => {
      await client.storage.from(STORAGE_BUCKET).remove([storagePath]);
    },

    insertDocumentRow: async row => {
      const { error } = await client.from("documents").insert({
        id: row.id,
        workspace_id: row.workspaceId,
        uploaded_by: row.uploadedBy,
        filename: row.filename,
        storage_path: row.storagePath,
        status: "pending",
      });

      if (error !== null) {
        if (error.code === POSTGRES_UNIQUE_VIOLATION) {
          return { ok: false, kind: "duplicate", error: error.message };
        }

        return { ok: false, kind: "other", error: error.message };
      }

      return { ok: true };
    },

    deleteDocumentRow: async documentId => {
      await client.from("documents").delete().eq("id", documentId);
    },

    publishExtract,
  };
};

export const POST = async (request: Request): Promise<Response> => {
  return handleUploadFinalize(request, createRealPort());
};
