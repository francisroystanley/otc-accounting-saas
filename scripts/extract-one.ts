// Dev-only scratch script to exercise /api/extract end-to-end before U9 lands.
//
// The npm script passes `--conditions=react-server` so Node resolves the
// `server-only` module (imported by src/lib/supabase/service.ts and by
// src/lib/extraction/gemini.ts) to its empty stub instead of its throw-on-load
// default. The script runs in plain Node, not a Next.js RSC runtime — the
// condition flag is the intentional bypass, not a claim that this is a server
// context.
//
// Usage:
//   npm run extract:one -- --pdf fixtures/w2/sample1.pdf
//   npm run extract:one -- --pdf path/to/file.pdf --workspace <uuid>
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleExtract } from "@/app/api/extract/route";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";

type CliArgs = {
  pdfPath: string;
  workspaceId: string | null;
};

type ServiceClient = ReturnType<typeof createSupabaseServiceRoleClient>;

const parseArgs = (argv: readonly string[]): CliArgs => {
  let pdfPath: string | null = null;
  let workspaceId: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--pdf") {
      pdfPath = argv[i + 1] ?? null;
      i += 1;
    } else if (token === "--workspace") {
      workspaceId = argv[i + 1] ?? null;
      i += 1;
    }
  }

  if (pdfPath === null) {
    throw new Error("Missing --pdf <path>");
  }

  return { pdfPath, workspaceId };
};

const resolveWorkspaceId = async (client: ServiceClient, explicit: string | null): Promise<string> => {
  if (explicit !== null) {
    return explicit;
  }

  const { data, error } = await client.from("workspaces").select("id").limit(1).maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to find a workspace: ${error.message}`);
  }

  if (data === null) {
    throw new Error("No workspaces exist. Sign up a user first, or pass --workspace <uuid>.");
  }

  return data.id;
};

const uploadPdf = async (client: ServiceClient, storagePath: string, bytes: Uint8Array): Promise<void> => {
  const { error } = await client.storage.from("documents").upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error !== null) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }
};

const insertDocumentRow = async (
  client: ServiceClient,
  args: { documentId: string; workspaceId: string; storagePath: string; filename: string }
): Promise<void> => {
  const { error } = await client.from("documents").insert({
    id: args.documentId,
    workspace_id: args.workspaceId,
    storage_path: args.storagePath,
    filename: args.filename,
    status: "pending",
  });

  if (error !== null) {
    throw new Error(`Failed to insert documents row: ${error.message}`);
  }
};

const fetchDocumentState = async (
  client: ServiceClient,
  documentId: string
): Promise<{ status: string; doc_type: string | null; error_message: string | null }> => {
  const { data, error } = await client
    .from("documents")
    .select("status, doc_type, error_message")
    .eq("id", documentId)
    .maybeSingle();

  if (error !== null || data === null) {
    throw new Error(`Failed to fetch final state: ${error?.message ?? "row not found"}`);
  }

  return data;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const pdfAbsolutePath = path.isAbsolute(args.pdfPath)
    ? args.pdfPath
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", args.pdfPath);
  const pdfBytes = await fs.readFile(pdfAbsolutePath);
  const filename = path.basename(pdfAbsolutePath);
  const client = createSupabaseServiceRoleClient();
  const workspaceId = await resolveWorkspaceId(client, args.workspaceId);
  const documentId = randomUUID();
  const storagePath = `${workspaceId}/${documentId}.pdf`;

  process.stdout.write(`[extract-one] workspace=${workspaceId} documentId=${documentId}\n`);

  await uploadPdf(client, storagePath, pdfBytes);
  await insertDocumentRow(client, { documentId, workspaceId, storagePath, filename });

  const request = new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
  const response = await handleExtract(request);
  const responseText = await response.text();

  process.stdout.write(`[extract-one] handler status=${response.status.toString()}\n`);
  process.stdout.write(`[extract-one] handler body=${responseText}\n`);

  const finalState = await fetchDocumentState(client, documentId);

  process.stdout.write(`[extract-one] final row=${JSON.stringify(finalState)}\n`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`[extract-one] ERROR: ${message}\n`);
  process.exit(1);
});
