import "server-only";
import { isSameOriginRequest } from "@/lib/auth/origin-check";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import type { Json } from "@/lib/database.types";
import { type DocumentDeletePort, type RemoveStorageResult, handleDocumentDelete } from "@/lib/documents/delete";
import { isDocType } from "@/lib/documents/doc-types";
import {
  type DocumentUpdatePort,
  type UpdateLoadedDocument,
  type UpdateWriteResult,
  handleDocumentUpdate,
} from "@/lib/documents/update";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

const toUpdateStatus = (raw: string): UpdateLoadedDocument["status"] => {
  if (raw === "pending" || raw === "processing" || raw === "complete" || raw === "failed" || raw === "needs_review") {
    return raw;
  }

  throw new Error(`Unexpected document status from DB: ${raw}`);
};

const extractedDataToJson = (data: Record<string, { value: string | number; confidence: number }>): Json => {
  const out: { [key: string]: Json } = {};

  for (const [key, field] of Object.entries(data)) {
    out[key] = { value: field.value, confidence: field.confidence };
  }

  return out;
};

const editedFieldsToJson = (edited: Record<string, true>): Json => {
  const out: { [key: string]: Json } = {};

  for (const key of Object.keys(edited)) {
    out[key] = true;
  }

  return out;
};

const createUpdatePort = async (): Promise<DocumentUpdatePort> => {
  // User-session client — RLS enforces workspace membership on UPDATE. Direct UPDATE
  // (not update_extraction_result) because that function is service_role-only; user
  // saves belong on the user-session client where RLS is the authorization fence.
  const userClient = await createSupabaseServerClient();

  return {
    getAuthContext: async () => {
      const ctx = await getAuthenticatedContext();

      if (ctx === null) {
        return null;
      }

      return { userId: ctx.userId, workspaceId: ctx.workspaceId };
    },
    checkOrigin: isSameOriginRequest,

    loadDocument: async documentId => {
      const { data, error } = await userClient
        .from("documents")
        .select("id, workspace_id, status, doc_type")
        .eq("id", documentId)
        .maybeSingle();

      if (error !== null || data === null) {
        return null;
      }

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        status: toUpdateStatus(data.status),
        docType: isDocType(data.doc_type) ? data.doc_type : null,
      };
    },

    saveEdit: async (documentId, extractedData, editedFields): Promise<UpdateWriteResult> => {
      // Status-scoped UPDATE defends against a TOCTOU: between loadDocument and here
      // the row could have been re-classified by a retry of /api/extract or another user.
      // `.select("id").maybeSingle()` round-trips the matched row so the handler can
      // detect zero-row updates and return 409 instead of falsely reporting success.
      const { data, error } = await userClient
        .from("documents")
        .update({
          extracted_data: extractedDataToJson(extractedData),
          edited_fields: editedFieldsToJson(editedFields),
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("status", "complete")
        .select("id")
        .maybeSingle();

      if (error !== null) {
        return { ok: false, kind: "error", error: error.message };
      }

      if (data === null) {
        return { ok: false, kind: "conflict" };
      }

      return { ok: true };
    },

    saveNeedsReviewComplete: async (documentId, docType, extractedData): Promise<UpdateWriteResult> => {
      const { data, error } = await userClient
        .from("documents")
        .update({
          status: "complete",
          doc_type: docType,
          extracted_data: extractedDataToJson(extractedData),
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("status", "needs_review")
        .select("id")
        .maybeSingle();

      if (error !== null) {
        return { ok: false, kind: "error", error: error.message };
      }

      if (data === null) {
        return { ok: false, kind: "conflict" };
      }

      return { ok: true };
    },
  };
};

export const PATCH = async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await context.params;
  const port = await createUpdatePort();

  return handleDocumentUpdate(request, id, port);
};
