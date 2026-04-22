import "server-only";
import { isSameOriginRequest } from "@/lib/auth/origin-check";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";
import { type UploadSignPort, handleUploadSign } from "@/lib/upload/sign";

const STORAGE_BUCKET = "documents";

const createRealPort = (): UploadSignPort => {
  const client = createSupabaseServiceRoleClient();

  return {
    getAuthContext: getAuthenticatedContext,
    checkOrigin: isSameOriginRequest,

    createSignedUploadUrl: async storagePath => {
      const { data, error } = await client.storage
        .from(STORAGE_BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false });

      if (error !== null || data === null) {
        return null;
      }

      return { signedUrl: data.signedUrl, token: data.token };
    },

    generateDocumentId: () => {
      return crypto.randomUUID();
    },
  };
};

export const POST = async (request: Request): Promise<Response> => {
  return handleUploadSign(request, createRealPort());
};
