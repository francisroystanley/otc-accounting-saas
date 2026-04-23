import JSZip from "jszip";
import "server-only";
import { isSameOriginRequest } from "@/lib/auth/origin-check";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { isDocType } from "@/lib/documents/doc-types";
import { type CsvFile } from "@/lib/export/csv";
import { type ExportPort, type ExportableSource, handleExport } from "@/lib/export/handler";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createRealPort = async (): Promise<ExportPort> => {
  // User-session client: RLS restricts the read to the caller's workspace. A service-role
  // client is not required for export — the data is being returned to the same user who
  // owns it, and relying on RLS matches the rest of the read path (see dashboard/page.tsx).
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

    loadCompleteDocuments: async (workspaceId, docType): Promise<ExportableSource[]> => {
      let query = userClient
        .from("documents")
        .select("id, filename, doc_type, extracted_data")
        .eq("workspace_id", workspaceId)
        .eq("status", "complete");

      if (docType !== null) {
        query = query.eq("doc_type", docType);
      }

      const { data, error } = await query.order("created_at", { ascending: true });

      if (error !== null || data === null) {
        if (error !== null) {
          console.error(`[api/export] loadCompleteDocuments failed: ${error.message}`);
        }

        return [];
      }

      const rows: ExportableSource[] = [];

      for (const row of data) {
        // A null or off-vocab doc_type on a `complete` row is malformed state; drop it
        // rather than emitting a CSV under an unknown doc type name.
        if (!isDocType(row.doc_type)) {
          continue;
        }

        rows.push({
          id: row.id,
          filename: row.filename,
          doc_type: row.doc_type,
          extracted_data: row.extracted_data,
        });
      }

      return rows;
    },

    buildZipBuffer: async (files: ReadonlyArray<CsvFile>): Promise<ArrayBuffer> => {
      const zip = new JSZip();

      for (const file of files) {
        zip.file(file.name, file.content);
      }

      return zip.generateAsync({ type: "arraybuffer" });
    },

    now: () => {
      return new Date();
    },
  };
};

export const GET = async (request: Request): Promise<Response> => {
  const port = await createRealPort();

  return handleExport(request, port);
};
