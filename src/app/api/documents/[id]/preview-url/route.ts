import "server-only";
import { isSameOriginRequest } from "@/lib/auth/origin-check";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { type PreviewUrlPort, handlePreviewUrl } from "@/lib/documents/preview-url";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";

const STORAGE_BUCKET = "documents";

const createRealPort = (): PreviewUrlPort => {
  const client = createSupabaseServiceRoleClient();

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
        console.error(`[documents/preview-url] membership lookup failed: ${error.message}`);

        return false;
      }

      return data !== null;
    },

    createSignedReadUrl: async (storagePath, ttlSeconds) => {
      const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, ttlSeconds);

      if (error !== null || data === null) {
        console.error(`[documents/preview-url] createSignedUrl failed for ${storagePath}: ${error?.message}`);

        return null;
      }

      return data.signedUrl;
    },
  };
};

export const GET = async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
  const { id } = await context.params;

  return handlePreviewUrl(request, id, createRealPort());
};
