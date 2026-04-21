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
    "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY"
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

// Idempotent cleanup of artifacts from crashed prior runs. All harness-
// created artifacts share the `u3-verify-` name prefix, so a name match
// uniquely identifies them. Safe against real users / real workspaces:
// nothing without that prefix is ever touched.
async function sweepLeftoversFromPriorRuns() {
  const swept = { workspaces: 0, users: 0, objects: 0 };

  const ws = await rest(`/workspaces?name=like.u3-verify-*&select=id`);
  const wsIds = (ws.data ?? []).map(w => w.id);

  for (const id of wsIds) {
    const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/documents`, {
      method: "POST",
      headers: restHeaders(null),
      body: JSON.stringify({ prefix: `${id}/`, limit: 1000 }),
    });
    if (listRes.ok) {
      const objs = await listRes.json();
      if (Array.isArray(objs) && objs.length > 0) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/documents`, {
          method: "DELETE",
          headers: restHeaders(null),
          body: JSON.stringify({ prefixes: objs.map(o => `${id}/${o.name}`) }),
        });
        swept.objects += objs.length;
      }
    }
  }

  if (wsIds.length) {
    await rest(`/workspaces?id=in.(${wsIds.join(",")})`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    swept.workspaces += wsIds.length;
  }

  let page = 1;
  while (page < 20) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) break;
    const body = await res.json();
    const users = Array.isArray(body?.users) ? body.users : [];
    if (users.length === 0) break;
    const targets = users.filter(
      u => typeof u.email === "string" && u.email.startsWith("u3-verify-") && u.email.endsWith("@example.com")
    );
    for (const u of targets) {
      await adminDeleteUser(u.id);
      swept.users += 1;
    }
    if (users.length < 200) break;
    page += 1;
  }

  const total = swept.users + swept.workspaces + swept.objects;
  if (total) {
    console.log(
      `Swept ${swept.users} user(s), ${swept.workspaces} workspace(s), ${swept.objects} storage object(s) from prior runs.\n`
    );
  }
}

try {
  await sweepLeftoversFromPriorRuns();

  // --- 1. Workspace autocreate trigger ---
  ({ user: userA, password: passA } = await createUserWithPassword(emailA));
  ({ user: userB, password: passB } = await createUserWithPassword(emailB));

  const wmRows = await rest(`/workspace_members?user_id=in.(${userA.id},${userB.id})&select=workspace_id,user_id,role`);
  const aMembership = (wmRows.data ?? []).filter(r => r.user_id === userA.id);
  const bMembership = (wmRows.data ?? []).filter(r => r.user_id === userB.id);
  record(
    "trigger creates exactly one workspace_members row per new user",
    aMembership.length === 1 && bMembership.length === 1,
    `A=${aMembership.length} B=${bMembership.length}`
  );
  const wsA = aMembership[0]?.workspace_id;
  const wsB = bMembership[0]?.workspace_id;
  record("membership role defaults to 'owner'", aMembership[0]?.role === "owner" && bMembership[0]?.role === "owner");

  const wsRows = await rest(`/workspaces?id=in.(${wsA},${wsB})&select=id,name`);
  record(
    "trigger creates exactly one workspace per new user",
    (wsRows.data ?? []).length === 2,
    `got=${(wsRows.data ?? []).length}`
  );
  const wsANameOk = (wsRows.data ?? []).find(w => w.id === wsA)?.name?.includes(emailA);
  record("workspace name derived from user email", !!wsANameOk);

  // Atomicity invariant: every workspace created by handle_new_user has a
  // matching workspace_members row. Scoped to harness-pattern workspaces so
  // manually-created rows (if any exist in this project) don't interfere.
  // If this ever fails, the trigger has lost transactional atomicity.
  const testWsRows = await rest(`/workspaces?name=like.u3-verify-*&select=id`);
  const testWsIds = (testWsRows.data ?? []).map(w => w.id);
  let orphanWsCount = -1;
  if (testWsIds.length > 0) {
    const memberRows = await rest(`/workspace_members?workspace_id=in.(${testWsIds.join(",")})&select=workspace_id`);
    const memberWsIds = new Set((memberRows.data ?? []).map(m => m.workspace_id));
    orphanWsCount = testWsIds.filter(id => !memberWsIds.has(id)).length;
  }
  record(
    "no orphan test workspaces (handle_new_user atomicity invariant)",
    orphanWsCount === 0,
    `testWorkspaces=${testWsIds.length}, orphans=${orphanWsCount}`
  );

  // --- 2. RLS SELECT isolation between two users (via PostgREST with user JWTs) ---
  const sessionA = await signIn(emailA, passA);
  const sessionB = await signIn(emailB, passB);

  // A sees their own workspace, not B's
  const aSeesWorkspaces = await rest(`/workspaces?select=id`, { jwt: sessionA.access_token });
  const aWsIds = (aSeesWorkspaces.data ?? []).map(w => w.id);
  record(
    "user A sees only their workspace (RLS SELECT on workspaces)",
    aWsIds.length === 1 && aWsIds[0] === wsA,
    `got ${JSON.stringify(aWsIds)}`
  );

  const bSeesWorkspaces = await rest(`/workspaces?select=id`, { jwt: sessionB.access_token });
  const bWsIds = (bSeesWorkspaces.data ?? []).map(w => w.id);
  record(
    "user B sees only their workspace (RLS SELECT on workspaces)",
    bWsIds.length === 1 && bWsIds[0] === wsB,
    `got ${JSON.stringify(bWsIds)}`
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
    crossTenantInsert.status === 403,
    `status=${crossTenantInsert.status}`
  );

  // User B cannot SELECT user A's document
  const bSeesADoc = await rest(`/documents?id=eq.${docIdA}&select=id`, {
    jwt: sessionB.access_token,
  });
  record(
    "user B cannot SELECT document in workspace A (RLS blocks)",
    (bSeesADoc.data ?? []).length === 0,
    `got=${JSON.stringify(bSeesADoc.data)}`
  );

  // User B cannot DELETE user A's document. RLS filters the row out of the
  // USING clause, so DELETE matches 0 rows and the document persists.
  const bDeleteAttempt = await rest(`/documents?id=eq.${docIdA}`, {
    method: "DELETE",
    jwt: sessionB.access_token,
    prefer: "return=representation",
  });
  const bDeletedRows = Array.isArray(bDeleteAttempt.data) ? bDeleteAttempt.data.length : -1;
  const docAfterDelete = await rest(`/documents?id=eq.${docIdA}&select=id`);
  record(
    "user B cannot DELETE user A's document (RLS matches zero rows)",
    bDeletedRows === 0 && (docAfterDelete.data ?? []).length === 1,
    `deleted=${bDeletedRows}, stillExists=${(docAfterDelete.data ?? []).length}`
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
  record("service-role can call update_extraction_result", serviceCall.status === 204, `status=${serviceCall.status}`);

  // Confirm the row updated
  const updatedDoc = await rest(`/documents?id=eq.${docIdA}&select=status,doc_type,doc_type_confidence,extracted_data`);
  const row = (updatedDoc.data ?? [])[0];
  record(
    "update_extraction_result sets status/doc_type/extracted_data",
    row?.status === "complete" && row?.doc_type === "w2" && Number(row?.doc_type_confidence) === 0.95,
    `row=${JSON.stringify(row)}`
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
    userCall.status === 403,
    `status=${userCall.status}`
  );

  // --- Fault tolerance: off-vocab doc_type writes 'failed', not wedged ---
  // Migration 9 catches check_violation from within update_extraction_result
  // and records a clean failure so QStash redelivery can't loop on a bad
  // payload forever.
  const badCall = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_extraction_result`, {
    method: "POST",
    headers: restHeaders(null),
    body: JSON.stringify({
      doc_id: docIdA,
      new_status: "complete",
      data: { doc_type: "W-2", doc_type_confidence: 0.9, fields: {} },
      error: null,
    }),
  });
  record(
    "off-vocab doc_type payload does not raise out of update_extraction_result",
    badCall.status === 204,
    `status=${badCall.status}`
  );

  const failedRow = await rest(`/documents?id=eq.${docIdA}&select=status,error_message`);
  const failedDoc = (failedRow.data ?? [])[0];
  record(
    "off-vocab doc_type leaves row in 'failed' with diagnostic error_message",
    failedDoc?.status === "failed" &&
      typeof failedDoc?.error_message === "string" &&
      failedDoc.error_message.includes("W-2"),
    `row=${JSON.stringify(failedDoc)}`
  );

  // Preserve-prior branch: data present but missing doc_type key → CASE
  // falls to `else doc_type`, existing classification must survive.
  const preservePriorCall = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_extraction_result`, {
    method: "POST",
    headers: restHeaders(null),
    body: JSON.stringify({
      doc_id: docIdA,
      new_status: "complete",
      data: { fields: { ein: { value: "00-0000000", confidence: 0.5 } } },
    }),
  });
  const preservedRow = await rest(`/documents?id=eq.${docIdA}&select=status,doc_type,doc_type_confidence`);
  const preserved = (preservedRow.data ?? [])[0];
  record(
    "update_extraction_result preserves prior doc_type when data omits the key",
    preservePriorCall.status === 204 && preserved?.doc_type === "w2" && Number(preserved?.doc_type_confidence) === 0.95,
    `rpc=${preservePriorCall.status}, row=${JSON.stringify(preserved)}`
  );

  // data=null + error: the /api/extract failure path per R12. Must set
  // status='failed' with the error_message, preserve prior doc_type.
  const failedPathCall = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_extraction_result`, {
    method: "POST",
    headers: restHeaders(null),
    body: JSON.stringify({
      doc_id: docIdA,
      new_status: "failed",
      error: "gemini-429",
    }),
  });
  const failedPathRow = await rest(`/documents?id=eq.${docIdA}&select=status,error_message,doc_type`);
  const failedPath = (failedPathRow.data ?? [])[0];
  record(
    "update_extraction_result(data=null,error=msg) records failure and preserves doc_type",
    failedPathCall.status === 204 &&
      failedPath?.status === "failed" &&
      failedPath?.error_message === "gemini-429" &&
      failedPath?.doc_type === "w2",
    `rpc=${failedPathCall.status}, row=${JSON.stringify(failedPath)}`
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
    crossPut.status === 400 || crossPut.status === 403,
    `status=${crossPut.status}`
  );

  // Migration 11 hardens storage RLS against malformed/traversal keys.
  const traversalPath = `${wsA}/../${wsB}/${randomUUID()}.pdf`;
  const traversalPut = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${traversalPath}`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${sessionA.access_token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  record(
    "user A cannot upload with `..` in the storage key",
    traversalPut.status === 400 || traversalPut.status === 403,
    `status=${traversalPut.status}`
  );

  const nestedPath = `${wsA}/subfolder/${randomUUID()}.pdf`;
  const nestedPut = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${nestedPath}`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${sessionA.access_token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  record(
    "user A cannot upload to a nested folder (flat-structure only)",
    nestedPut.status === 400 || nestedPut.status === 403,
    `status=${nestedPut.status}`
  );

  const malformedPath = `not-a-uuid/${randomUUID()}.pdf`;
  const malformedPut = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${malformedPath}`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${sessionA.access_token}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });
  record(
    "user A cannot upload with non-UUID first segment (denies without raising)",
    malformedPut.status === 400 || malformedPut.status === 403,
    `status=${malformedPut.status}`
  );

  // Cross-tenant DELETE defense: service-role seeds a canary under wsB,
  // then sessionA attempts to DELETE it. RLS must block even when the
  // object actually exists.
  const canaryPath = `${wsB}/canary-${randomUUID()}.pdf`;
  await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${canaryPath}`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });

  const crossDeleteAttempt = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${canaryPath}`, {
    method: "DELETE",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${sessionA.access_token}`,
    },
  });

  const canaryProbe = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${canaryPath}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });

  record(
    "user A cannot DELETE storage objects under workspace B's prefix",
    crossDeleteAttempt.status !== 200 && canaryProbe.status === 200,
    `deleteStatus=${crossDeleteAttempt.status}, probeStatus=${canaryProbe.status}`
  );

  // --- Teleport defense: user cannot PATCH immutable columns ---
  // Migration 8 revokes table-level UPDATE from authenticated and re-grants
  // only the R14/R19 columns. workspace_id/storage_path/uploaded_by are now
  // structurally immutable from the user-session client; RLS is the second
  // line of defense.
  const teleportAttempt = await rest(`/documents?id=eq.${docIdA}`, {
    method: "PATCH",
    jwt: sessionA.access_token,
    body: { workspace_id: wsB },
    prefer: "return=minimal",
  });
  record(
    "user A cannot PATCH workspace_id on own document (column UPDATE blocked)",
    teleportAttempt.status === 403,
    `status=${teleportAttempt.status}`
  );

  const legitPatch = await rest(`/documents?id=eq.${docIdA}`, {
    method: "PATCH",
    jwt: sessionA.access_token,
    body: {
      extracted_data: {
        fields: { ein: { value: "99-9999999", confidence: 0.99 } },
      },
    },
    prefer: "return=minimal",
  });
  record(
    "user A can still PATCH extracted_data on own document",
    legitPatch.status === 204,
    `status=${legitPatch.status}`
  );

  // --- 6. Realtime publication includes documents ---
  // Goes through the public.publication_has_documents() SECURITY DEFINER
  // helper (migration 7) so we can assert membership via REST. A regression
  // in migration 5 (or a Supabase platform change that strips the table from
  // supabase_realtime) now fails the harness loudly instead of silently.
  const pubCheck = await rest(`/rpc/publication_has_documents`, {
    method: "POST",
    body: {},
  });
  record(
    "Realtime publication includes public.documents",
    pubCheck.status === 200 && pubCheck.data === true,
    `status=${pubCheck.status} body=${JSON.stringify(pubCheck.data)}`
  );

  // --- Cleanup ---
  // Order: storage objects → workspaces (cascades docs + workspace_members)
  // → users. Workspaces have no FK cascade from auth.users, so skipping the
  // explicit workspace DELETE would leak the two workspaces created by the
  // trigger on every successful run.
  for (const wsId of [wsA, wsB].filter(Boolean)) {
    const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/documents`, {
      method: "POST",
      headers: restHeaders(null),
      body: JSON.stringify({ prefix: `${wsId}/`, limit: 1000 }),
    });
    if (listRes.ok) {
      const objs = await listRes.json();
      if (Array.isArray(objs) && objs.length > 0) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/documents`, {
          method: "DELETE",
          headers: restHeaders(null),
          body: JSON.stringify({ prefixes: objs.map(o => `${wsId}/${o.name}`) }),
        });
      }
    }
  }
  await rest(`/workspaces?id=in.(${[wsA, wsB].filter(Boolean).join(",")})`, {
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
