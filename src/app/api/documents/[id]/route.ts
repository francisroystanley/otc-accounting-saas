import "server-only";
import { isSameOriginRequest } from "@/lib/auth/origin-check";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { type DocumentDeletePort, type RemoveStorageResult, handleDocumentDelete } from "@/lib/documents/delete";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";

const STORAGE_BUCKET = "documents";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStorageNotFoundError = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }

  const statusCode = error.statusCode;

  if (typeof statusCode === "string" && statusCode === "404") {
    return true;
  }

  if (typeof statusCode === "number" && statusCode === 404) {
    return true;
  }

  if (typeof error.message === "string" && error.message.toLowerCase().includes("not found")) {
    return true;
  }

  return false;
};

const describeStorageError = (error: unknown): string => {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return "unknown storage error";
};

const createRealPort = (): DocumentDeletePort => {
  const client = createSupabaseServiceRoleClient();

  return {
    getAuthContext: getAuthenticatedContext,
    checkOrigin: isSameOriginRequest,

    loadDocument: async documentId => {
      const { data, error } = await client
        .from("documents")
        .select("id, workspace_id, storage_path")
        .eq("id", documentId)
        .maybeSingle();

      if (error !== null || data === null) {
        return null;
      }

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        storagePath: data.storage_path,
      };
    },

    isWorkspaceMember: async (userId, workspaceId) => {
      const { data, error } = await client
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (error !== null) {
        console.error(`[documents/delete] membership lookup failed: ${error.message}`);

        return false;
      }

      return data !== null;
    },

    removeStorageObject: async (storagePath): Promise<RemoveStorageResult> => {
      const { data, error } = await client.storage.from(STORAGE_BUCKET).remove([storagePath]);

      if (error !== null) {
        if (isStorageNotFoundError(error)) {
          const message = describeStorageError(error);

          console.info(`[documents/delete] storage object already gone for ${storagePath}: ${message}`);

          return { ok: false, kind: "not_found", error: message };
        }

        return { ok: false, kind: "other", error: describeStorageError(error) };
      }

      // An empty data array with no error signals that the service-role request completed but
      // removed nothing. This is indistinguishable in the SDK from a genuine "already gone"
      // (older client versions did return an explicit 404 error; newer versions return []).
      // Treating it as `other` would abort before the row delete and leave zombie rows whose
      // PDFs are already gone. Treating it as `not_found` lets the handler proceed, which is
      // the safe choice at this RLS-bypassing level where the preceding workspace check has
      // already authorized the delete.
      if (data === null || data.length === 0) {
        console.info(`[documents/delete] storage remove returned empty data for ${storagePath}`);

        return { ok: false, kind: "not_found", error: "no matching storage object" };
      }

      return { ok: true };
    },

    deleteDocumentRow: async (documentId, workspaceId) => {
      const { error } = await client.from("documents").delete().eq("id", documentId).eq("workspace_id", workspaceId);

      if (error !== null) {
        return { ok: false, error: error.message };
      }

      return { ok: true };
    },
  };
};

export const DELETE = async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await context.params;

  return handleDocumentDelete(request, id, createRealPort());
};
