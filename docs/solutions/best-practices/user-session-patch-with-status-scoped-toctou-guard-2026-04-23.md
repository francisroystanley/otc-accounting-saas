---
title: "User-session PATCH with status-scoped TOCTOU guard and row-count verify"
module: "api/documents"
date: 2026-04-23
problem_type: best_practice
component: authentication
related_components: [database, service_object]
severity: high
applies_when:
  - Adding a PATCH/PUT/DELETE route where an authenticated user edits their own data
  - The same row can be mutated concurrently by a background process (extraction, webhook retry, another tab)
  - RLS is enforced at the column level but the handler still needs to detect a conflict cleanly
tags:
  - supabase
  - rls
  - toctou
  - user-session-client
  - next-route-handler
  - optimistic-concurrency
---

# User-session PATCH with status-scoped TOCTOU guard and row-count verify

## Context

In a multi-writer system (user UI + background extraction + webhook retries all mutate the same row), a naive `user_session_client.from("documents").update({...}).eq("id", id)` succeeds without distinguishing between "I wrote the row I intended to" and "the row moved to a state where I no longer have business permission to write." Silent success here is the failure mode: the user sees "Saved" while their edits overwrite a fresher extraction result, or a webhook retry clobbers a manual correction.

This doc captures the pattern U12 landed (after ce:review's adversarial pass surfaced adv-u12-01, adv-u12-06, rel-7) for safely writing user edits on RLS-protected tables.

## Guidance

Four layers stacked:

1. **User-session Supabase client for user writes** — not service-role. RLS is the authorization fence.
2. **Column grant on `authenticated`** — the underlying table GRANT UPDATE lists only the columns a user may touch (in our case: `status, doc_type, extracted_data, edited_fields, updated_at`). Everything else (`workspace_id`, `storage_path`, `uploaded_by`, `doc_type_confidence`, `error_message`) is unreachable by user-session clients by GRANT, independent of RLS.
3. **Status-scoped UPDATE** — the update's WHERE clause includes `.eq("status", expectedStatus)` so a row that transitioned out of the expected state matches zero rows instead of silently accepting the write.
4. **Row-count verify with `.select("id").maybeSingle()`** — Supabase `update()` returns `{data: null, error: null}` when no rows matched. Round-trip the id and treat `data === null` as a conflict, distinct from a transport error.

The handler returns a discriminated result so the route adapter can map "no row matched" → **409 conflict** and "transport error" → **500 db_error**. Never collapse them into a single `ok: false`.

### Port signature

```ts
// Transport error vs no-row-matched must be distinguishable.
export type UpdateWriteResult =
  | { ok: true }
  | { ok: false; kind: "conflict" }
  | { ok: false; kind: "error"; error: string };

export type DocumentUpdatePort = {
  getAuthContext: () => Promise<UpdateAuth | null>;
  checkOrigin: (request: Request) => boolean;
  loadDocument: (id: string) => Promise<UpdateLoadedDocument | null>;
  saveEdit: (
    id: string,
    extractedData: Record<string, { value: string | number; confidence: number }>,
    editedFields: Record<string, true>
  ) => Promise<UpdateWriteResult>;
  // Analogous signature for every expected status → target-status transition
};
```

### Adapter (Supabase user-session client)

```ts
saveEdit: async (id, extractedData, editedFields) => {
  // Status-scoped WHERE + .select("id").maybeSingle() round-trips the matched row
  // so the handler can detect zero-row updates and return 409 instead of falsely
  // reporting success. A background retry of /api/extract or another tab saving
  // the same row will flip status to processing/needs_review and this UPDATE
  // will match zero rows.
  const { data, error } = await userClient
    .from("documents")
    .update({
      extracted_data: extractedDataToJson(extractedData),
      edited_fields: editedFieldsToJson(editedFields),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "complete")
    .select("id")
    .maybeSingle();

  if (error !== null) return { ok: false, kind: "error", error: error.message };
  if (data === null) return { ok: false, kind: "conflict" };
  return { ok: true };
};
```

### Handler dispatch

```ts
const result = await port.saveEdit(document.id, body.extracted_data, body.edited_fields);

if (result.ok) return json({ ok: true }, 200);

if (result.kind === "conflict") {
  return json({ error: "conflict_status_changed", from: document.status }, 409);
}

return json({ error: "db_error" }, 500);
```

## Why This Matters

**Without the status predicate**, the UPDATE matches any row with that id, including ones that just transitioned to `processing` by a QStash redelivery. The user's save overwrites machine-written state the user never saw.

**Without the row-count verify**, the transport-level UPDATE succeeds against zero rows and returns `{error: null}`. The handler has no way to know nothing happened and returns `{ok: true}`. The client shows "Saved", the user moves on, and the write is silently lost.

**With both**, the contract is:

- Row in the expected state → UPDATE runs, `.select("id")` returns the row, handler returns `200 {ok: true}`.
- Row transitioned out of the expected state → UPDATE matches zero rows, `.select().maybeSingle()` returns `data: null`, handler returns `409 conflict_status_changed` with the current `from:` status. The client can reload the row and decide how to merge.
- Transport failure (network, RLS denied, grant missing) → `error !== null`, handler returns `500 db_error`.

The three responses map to three different client actions: retry with fresh data (409), retry as-is later (500), or move on (200). Collapsing them into `ok: false` hides the retry strategy from the UI.

## When to Apply

- Any Next.js / Supabase route handler where an authenticated user writes a row they own
- Any table that has concurrent writers (webhook retries, background jobs, multi-tab UI)
- Any transition-heavy state machine where "in the expected state at save time" is a business precondition
- Any mutation that must fail closed on races — silent success is a correctness bug, not a UX annoyance

Skip this pattern for:

- Pure inserts where id collision is the only race
- Single-writer tables (audit logs, event logs) where TOCTOU is not reachable
- Service-role writes where the system already holds the authoritative view of the row state

## Examples

### Needs-review → complete transition

The same pattern applied to a different expected status:

```ts
saveNeedsReviewComplete: async (id, docType, extractedData) => {
  const { data, error } = await userClient
    .from("documents")
    .update({
      status: "complete",
      doc_type: docType,
      extracted_data: extractedDataToJson(extractedData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "needs_review") // ← only transition from the expected state
    .select("id")
    .maybeSingle();

  if (error !== null) return { ok: false, kind: "error", error: error.message };
  if (data === null) return { ok: false, kind: "conflict" };
  return { ok: true };
};
```

### Live smoke tests against the deployed worktree

```text
# Valid transition from `complete`:
PATCH /api/documents/<id>  → 200 {"ok":true}

# Invalid transition (action=complete_from_needs_review on a complete row):
PATCH /api/documents/<id>  → 409 {"error":"invalid_status_transition","from":"complete","expected":"needs_review"}

# Body violates per-doc-type allow-list:
PATCH /api/documents/<id>  → 400 {"error":"unknown_fields","fields":["malicious_key"]}

# Oversized string value:
PATCH /api/documents/<id>  → 400 {"error":"invalid_payload","issues":[{"origin":"string","code":"too_big","maximum":500,...}]}
```

### Test harness

Every port method returns a discriminated result so handler tests can pin the conflict path explicitly:

```ts
it("returns 409 with conflict_status_changed when the row's status changes between loadDocument and UPDATE (TOCTOU)", async () => {
  const port = makePort({
    saveEdit: async () => ({ ok: false, kind: "conflict" }),
  });
  const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);
  expect(response.status).toBe(409);
});
```

## Related

- [RLS cross-tenant teleport via UPDATE](../security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md) — the column-grant fence this pattern depends on
- [Supabase clients and proxy (Next 16)](./supabase-clients-and-proxy-next16-2026-04-22.md) — user-session vs service-role client partitioning
- [Testable Next route via DI port and thin adapter](./testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md) — the port/adapter pattern this builds on
