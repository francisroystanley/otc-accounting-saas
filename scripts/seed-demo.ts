// Seed script for two demo accounts (R4, R27). `npm run seed` creates a
// populated account (pre-extracted fixture PDFs) and an empty account (proves
// R3 workspace isolation side-by-side). Extraction runs inline —
// `extractFromPdfBytes` is called directly, bypassing QStash — so the script
// is self-contained and does not require the dev server to be up.
//
// Invocation mirrors `extract:report`: `--conditions=react-server` resolves
// the `server-only` module (imported transitively by
// `@/lib/supabase/service` and `@/lib/extraction/gemini`) to its empty stub
// instead of its throw-on-load default. `--env-file=.env.local` loads the
// Supabase + Gemini credentials.
//
// Idempotent: re-running finds existing demo users by email, clears their
// workspace's documents + storage objects, and re-seeds. Users and
// workspaces themselves are preserved (the U3 trigger only fires on
// auth.users INSERT, so deleting the user would force a workspace
// re-creation round-trip for no benefit).
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database, Json } from "@/lib/database.types";
import { DOC_TYPE_THRESHOLD } from "@/lib/extraction/config";
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import { ALL_DOC_TYPES, type ExtractionResult } from "@/lib/extraction/types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";
import { DEMO_USERS, type DemoUser } from "./lib/demo-users";

type Client = SupabaseClient<Database>;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures");
const STORAGE_BUCKET = "documents";

// Mirror src/lib/extract/supabase-port.ts exactly — the ExtractionResult
// discriminated union contains nested `{ value, confidence }` records that
// must round-trip through the `Json` shape the generated types expect.
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

// Paginate `admin.listUsers` until the target email is found or pages
// exhaust. Supabase GoTrue orders by `created_at DESC`, so demo users created
// weeks ago drop off page 1 once the project accumulates many signups.
// Iterating pages keeps the "idempotent re-seed" invariant honest at any scale.
const LIST_USERS_PER_PAGE = 200;

const findUserByEmail = async (client: Client, email: string): Promise<string | null> => {
  const target = email.toLowerCase();

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: LIST_USERS_PER_PAGE });

    if (error !== null) {
      throw new Error(`admin.listUsers page ${page} failed: ${error.message}`);
    }

    const match = data.users.find(u => {
      return u.email !== undefined && u.email.toLowerCase() === target;
    });

    if (match !== undefined) {
      return match.id;
    }

    if (data.users.length < LIST_USERS_PER_PAGE) {
      return null;
    }
  }
};

const resolveWorkspaceId = async (client: Client, userId: string): Promise<string | null> => {
  const { data, error } = await client
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`workspace_members lookup for ${userId} failed: ${error.message}`);
  }

  return data?.workspace_id ?? null;
};

const clearWorkspace = async (client: Client, workspaceId: string): Promise<void> => {
  const { data: objects, error: listError } = await client.storage
    .from(STORAGE_BUCKET)
    .list(workspaceId, { limit: 1000 });

  if (listError !== null) {
    throw new Error(`storage.list(${workspaceId}) failed: ${listError.message}`);
  }

  if (objects.length > 0) {
    const paths = objects.map(o => {
      return `${workspaceId}/${o.name}`;
    });

    const { error: removeError } = await client.storage.from(STORAGE_BUCKET).remove(paths);

    if (removeError !== null) {
      throw new Error(`storage.remove(${workspaceId}) failed: ${removeError.message}`);
    }
  }

  const { error: deleteError } = await client.from("documents").delete().eq("workspace_id", workspaceId);

  if (deleteError !== null) {
    throw new Error(`documents.delete(workspace_id=${workspaceId}) failed: ${deleteError.message}`);
  }
};

const ensureUser = async (client: Client, user: DemoUser): Promise<string> => {
  const existing = await findUserByEmail(client, user.email);

  if (existing !== null) {
    // Rotate the stored password to match the checked-in credential.
    // Prevents silent drift between what `run()` prints at the end (the
    // current DEMO_USERS password) and what auth.users actually accepts
    // (the password set on the original createUser call).
    const { error: updateError } = await client.auth.admin.updateUserById(existing, {
      password: user.password,
      email_confirm: true,
    });

    if (updateError !== null) {
      throw new Error(`admin.updateUserById(${user.email}) failed: ${updateError.message}`);
    }

    return existing;
  }

  const { data, error } = await client.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });

  if (error !== null) {
    throw new Error(`admin.createUser(${user.email}) failed: ${error.message}`);
  }

  if (data.user === null) {
    throw new Error(`admin.createUser(${user.email}) returned no user`);
  }

  return data.user.id;
};

// Mirror sampleIndex from scripts/extract-report.ts so sample2.pdf precedes
// sample10.pdf and the seed ingest order matches the accuracy harness.
const sampleIndex = (filename: string): number => {
  const match = filename.match(/sample(\d+)\.pdf$/i);

  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
};

const errorCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || !("code" in error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
};

const collectFixturePaths = async (): Promise<string[]> => {
  const paths: string[] = [];

  for (const docType of ALL_DOC_TYPES) {
    const dir = path.join(FIXTURES_DIR, docType);
    let entries: string[];

    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        continue;
      }

      throw error;
    }

    const pdfs = entries
      .filter(name => {
        return name.toLowerCase().endsWith(".pdf");
      })
      .sort((a, b) => {
        return sampleIndex(a) - sampleIndex(b);
      });

    for (const pdf of pdfs) {
      paths.push(path.join(dir, pdf));
    }
  }

  return paths;
};

const resolveFinalStatus = (extraction: ExtractionResult): "complete" | "needs_review" => {
  const belowThreshold = extraction.doc_type_confidence < DOC_TYPE_THRESHOLD;
  const isUnknown = extraction.doc_type === "unknown";

  return isUnknown || belowThreshold ? "needs_review" : "complete";
};

const seedFixture = async (client: Client, workspaceId: string, userId: string, fixturePath: string): Promise<void> => {
  const documentId = crypto.randomUUID();
  const filename = path.basename(fixturePath);
  const storagePath = `${workspaceId}/${documentId}.pdf`;
  const bytes = await fs.readFile(fixturePath);

  const { error: uploadError } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });

  if (uploadError !== null) {
    throw new Error(`storage.upload(${storagePath}) failed: ${uploadError.message}`);
  }

  const { error: insertError } = await client.from("documents").insert({
    id: documentId,
    workspace_id: workspaceId,
    uploaded_by: userId,
    filename,
    storage_path: storagePath,
    status: "pending",
  });

  if (insertError !== null) {
    throw new Error(`documents.insert(${documentId}) failed: ${insertError.message}`);
  }

  // Mirror claimForProcessing from src/lib/extract/supabase-port.ts so the
  // status machine transition matches production exactly — same `WHERE
  // status='pending'` guard and same rows-affected assertion. Guaranteed to
  // succeed because the row was just inserted as `pending` by this same
  // client; the assertion catches future RLS or constraint changes that
  // would silently no-op the UPDATE.
  const { data: claimed, error: claimError } = await client
    .from("documents")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimError !== null) {
    throw new Error(`documents claim(${documentId}) failed: ${claimError.message}`);
  }

  if (claimed === null) {
    throw new Error(`documents claim(${documentId}) found no pending row — unexpected state after insert`);
  }

  let extraction: ExtractionResult;

  try {
    extraction = await extractFromPdfBytes(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { error: rpcError } = await client.rpc("update_extraction_result", {
      doc_id: documentId,
      new_status: "failed",
      error: message,
    });

    if (rpcError !== null) {
      console.error(`[seed] update_extraction_result(failed) for ${filename}: ${rpcError.message}`);
    }

    console.warn(`  → ${filename}: failed (${message})`);

    return;
  }

  const finalStatus = resolveFinalStatus(extraction);
  const { error: rpcError } = await client.rpc("update_extraction_result", {
    doc_id: documentId,
    new_status: finalStatus,
    data: toJsonValue(extraction),
  });

  if (rpcError !== null) {
    throw new Error(`update_extraction_result(${finalStatus}) failed: ${rpcError.message}`);
  }

  console.log(`  → ${filename}: ${finalStatus} (doc_type=${extraction.doc_type})`);
};

const seedDemoUser = async (client: Client, user: DemoUser, fixturePaths: string[]): Promise<void> => {
  console.log(`\n=== ${user.label} account (${user.email}) ===`);
  const userId = await ensureUser(client, user);
  const workspaceId = await resolveWorkspaceId(client, userId);

  if (workspaceId === null) {
    throw new Error(
      `Workspace not found for ${user.email} (user_id=${userId}). The U3 handle_new_user trigger should have created one on signup — verify the trigger is installed.`
    );
  }

  await clearWorkspace(client, workspaceId);

  if (user.label === "empty") {
    console.log(`  empty workspace ready (workspace_id=${workspaceId})`);

    return;
  }

  if (fixturePaths.length === 0) {
    throw new Error(
      `No fixture PDFs found under ${path.relative(REPO_ROOT, FIXTURES_DIR)} — populated account would be empty, defeating R27. Verify the repo is fully checked out and npm run seed is run from the repo root.`
    );
  }

  for (const fixturePath of fixturePaths) {
    await seedFixture(client, workspaceId, userId, fixturePath);
  }
};

const REQUIRED_ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"] as const;

const assertEnv = (): void => {
  const missing = REQUIRED_ENV_VARS.filter(name => {
    return !process.env[name];
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required env var${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Run via \`npm run seed\` (which loads .env.local) or ensure these are set in the shell.`
    );
  }
};

const run = async (): Promise<void> => {
  assertEnv();
  const client = createSupabaseServiceRoleClient();
  const fixturePaths = await collectFixturePaths();

  for (const user of DEMO_USERS) {
    await seedDemoUser(client, user, fixturePaths);
  }

  console.log(`\nDemo credentials (email to reviewer per R27):`);

  const labelWidth = Math.max(
    ...DEMO_USERS.map(u => {
      return u.label.length;
    })
  );

  for (const user of DEMO_USERS) {
    console.log(`  ${user.label.padEnd(labelWidth)} — ${user.email} / ${user.password}`);
  }
};

run().catch((error: unknown) => {
  console.error("seed-demo failed:", error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
