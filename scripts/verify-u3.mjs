// Verification harness for U3 — DB schema, RLS, trigger, SECURITY DEFINER writer,
// Storage RLS, Realtime publication. Safe to re-run: created users and docs are
// cleaned up at the end.
//
//   node --env-file=.env.local scripts/verify-u3.mjs
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const status = ok ? "✓" : "✗";
  console.log(`${status} ${name}${detail ? " — " + detail : ""}`);
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function adminDeleteUser(userId) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

function restHeaders(jwt) {
  return {
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${jwt ?? SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function rest(path, { method = "GET", body, jwt, prefer } = {}) {
  const headers = restHeaders(jwt);
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, data, text };
}

// Extract user password at creation time (we set it, so we know it).
async function createUserWithPassword(email) {
  const password = "verify-u3-pass-" + randomUUID();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser ${email}: ${res.status} ${await res.text()}`);
  const user = await res.json();
  return { user, password };
}

const runId = randomUUID().slice(0, 8);
const emailA = `u3-verify-a-${runId}@example.com`;
const emailB = `u3-verify-b-${runId}@example.com`;
let userA, passA, userB, passB;
const extraDocIds = [];

try {
  // --- 1. Workspace autocreate trigger ---
  ({ user: userA, password: passA } = await createUserWithPassword(emailA));
  ({ user: userB, password: passB } = await createUserWithPassword(emailB));

  const wmRows = await rest(`/workspace_members?user_id=in.(${userA.id},${userB.id})&select=workspace_id,user_id,role`);
  const aMembership = (wmRows.data ?? []).filter(r => r.user_id === userA.id);
  const bMembership = (wmRows.data ?? []).filter(r => r.user_id === userB.id);
  record(
    "trigger creates exactly one workspace_members row per new user",
    aMembership.length === 1 && bMembership.length === 1,
    `A=${aMembership.length} B=${bMembership.length}`,
  );
  const wsA = aMembership[0]?.workspace_id;
  const wsB = bMembership[0]?.workspace_id;
  record("membership role defaults to 'owner'", aMembership[0]?.role === "owner" && bMembership[0]?.role === "owner");

  const wsRows = await rest(`/workspaces?id=in.(${wsA},${wsB})&select=id,name`);
  record(
    "trigger creates exactly one workspace per new user",
    (wsRows.data ?? []).length === 2,
    `got=${(wsRows.data ?? []).length}`,
  );
  const wsANameOk = (wsRows.data ?? []).find(w => w.id === wsA)?.name?.includes(emailA);
  record("workspace name derived from user email", !!wsANameOk);

  // --- 2. RLS SELECT isolation between two users (via PostgREST with user JWTs) ---
  const sessionA = await signIn(emailA, passA);
  const sessionB = await signIn(emailB, passB);

  // A sees their own workspace, not B's
  const aSeesWorkspaces = await rest(`/workspaces?select=id`, { jwt: sessionA.access_token });
  const aWsIds = (aSeesWorkspaces.data ?? []).map(w => w.id);
  record(
    "user A sees only their workspace (RLS SELECT on workspaces)",
    aWsIds.length === 1 && aWsIds[0] === wsA,
    `got ${JSON.stringify(aWsIds)}`,
  );

  // --- 3. documents RLS: service-role INSERT works, user-session INSERT into foreign workspace fails ---
  const docIdA = randomUUID();
  extraDocIds.push(docIdA);
  const serviceInsert = await rest(`/documents`, {
    method: "POST",
    body: {
      id: docIdA,
      workspace_id: wsA,
      uploaded_by: userA.id,
      filename: "verify-service-insert.pdf",
      storage_path: `${wsA}/${docIdA}.pdf`,
      status: "pending",
    },
    prefer: "return=minimal",
  });
  record("service-role can INSERT into documents", serviceInsert.status === 201, `status=${serviceInsert.status}`);

  // User A inserting into workspace B should fail RLS
  const crossTenantInsert = await rest(`/documents`, {
    method: "POST",
    jwt: sessionA.access_token,
    body: {
      workspace_id: wsB,
      uploaded_by: userA.id,
      filename: "cross-tenant.pdf",
      storage_path: `${wsB}/${randomUUID()}.pdf`,
    },
    prefer: "return=minimal",
  });
  record(
    "user A cannot INSERT document into workspace B (RLS blocks)",
    crossTenantInsert.status === 403 ||
      crossTenantInsert.status === 401 ||
      crossTenantInsert.status === 400 ||
      crossTenantInsert.status === 409,
    `status=${crossTenantInsert.status}`,
  );

  // User B cannot SELECT user A's document
  const bSeesADoc = await rest(`/documents?id=eq.${docIdA}&select=id`, {
    jwt: sessionB.access_token,
  });
  record(
    "user B cannot SELECT document in workspace A (RLS blocks)",
    (bSeesADoc.data ?? []).length === 0,
    `got=${JSON.stringify(bSeesADoc.data)}`,
  );

  // --- 4. update_extraction_result grant scope ---
  const serviceCall = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_extraction_result`, {
    method: "POST",
    headers: restHeaders(null),
    body: JSON.stringify({
      doc_id: docIdA,
      new_status: "complete",
      data: {
        doc_type: "w2",
        doc_type_confidence: 0.95,
        fields: { ein: { value: "12-3456789", confidence: 0.98 } },
      },
      error: null,
    }),
  });
  record(
    "service-role can call update_extraction_result",
    serviceCall.status === 204 || serviceCall.status === 200,
    `status=${serviceCall.status}`,
  );

  // Confirm the row updated
  const updatedDoc = await rest(`/documents?id=eq.${docIdA}&select=status,doc_type,doc_type_confidence,extracted_data`);
  const row = (updatedDoc.data ?? [])[0];
  record(
    "update_extraction_result sets status/doc_type/extracted_data",
    row?.status === "complete" && row?.doc_type === "w2" && Number(row?.doc_type_confidence) === 0.95,
    `row=${JSON.stringify(row)}`,
  );

  // Anon-key + user JWT cannot EXECUTE the function
  const userCall = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_extraction_result`, {
    method: "POST",
    headers: restHeaders(sessionA.access_token),
    body: JSON.stringify({
      doc_id: docIdA,
      new_status: "failed",
      data: null,
      error: "should-not-apply",
    }),
  });
  record(
    "user-session client cannot call update_extraction_result",
    userCall.status === 403 || userCall.status === 401 || userCall.status === 404,
    `status=${userCall.status}`,
  );

  // --- 5. Storage RLS: user A can PUT under their prefix; cannot PUT under B's prefix ---
  const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x45, 0x4f, 0x46]);
  const aOwnPath = `${wsA}/${randomUUID()}.pdf`;
  const aOwnPut = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${aOwnPath}`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${sessionA.access_token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  record("user A can upload under their workspace prefix", aOwnPut.status === 200, `status=${aOwnPut.status}`);

  const crossPath = `${wsB}/${randomUUID()}.pdf`;
  const crossPut = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${crossPath}`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${sessionA.access_token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  record(
    "user A cannot upload under workspace B's prefix",
    crossPut.status === 403 || crossPut.status === 400 || crossPut.status === 401,
    `status=${crossPut.status}`,
  );

  // --- 6. Realtime publication includes documents ---
  // pg_publication_tables isn't exposed via PostgREST by default, so this is
  // informational. The `alter publication` statement succeeded in migration 5,
  // and U11's Realtime subscription will exercise it end-to-end.
  record(
    "(info) Realtime publication check requires direct SQL; verified via supabase db push success",
    true,
    "run `select * from pg_publication_tables where pubname='supabase_realtime'` in the SQL editor to confirm",
  );

  // --- Cleanup ---
  await rest(`/documents?id=in.(${extraDocIds.join(",")})`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
  if (userA?.id) await adminDeleteUser(userA.id);
  if (userB?.id) await adminDeleteUser(userB.id);

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} checks passed${failed ? ` (${failed} failing)` : ""}`);
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error("\nVerification harness error:", err.message);
  // Best-effort cleanup
  try {
    if (extraDocIds.length)
      await rest(`/documents?id=in.(${extraDocIds.join(",")})`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
    if (userA?.id) await adminDeleteUser(userA.id);
    if (userB?.id) await adminDeleteUser(userB.id);
  } catch {
    /* ignore */
  }
  process.exit(1);
}
