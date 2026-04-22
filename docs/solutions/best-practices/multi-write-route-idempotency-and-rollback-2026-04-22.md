---
title: Multi-write route handlers — idempotent unique-violation + symmetric rollback
date: 2026-04-22
category: best-practices
module: upload
problem_type: best_practice
component: tooling
severity: high
tags:
  - nextjs
  - route-handler
  - idempotency
  - rollback
  - orphan-cleanup
  - supabase-storage
  - qstash
  - port-adapter
  - unique-violation
  - typescript
applies_when:
  - Route handler chains two or more external writes (e.g. Storage upload + DB insert + queue publish) where partial success can strand state
  - At least one write is guarded by a unique constraint or idempotency key (SQLSTATE 23505, natural key, content hash)
  - Client can plausibly retry — browser reload, double-click, at-least-once queue delivery, webhook replay
  - A terminal-step failure would leave earlier committed state stranded with no automated recovery
related_components:
  - database
  - background_job
---

# Multi-write route handlers — idempotent unique-violation + symmetric rollback

## Context

U9 added `POST /api/upload/finalize` (pure handler in `src/lib/upload/finalize.ts`, thin adapter in `src/app/api/upload/finalize/route.ts`). The route is a multi-step external-write chain:

1. **Supabase Storage** — verify the client-uploaded object exists and passes the size + PDF magic-bytes gate (`info()` + partial `download()`).
2. **Postgres** — insert a row into `documents` (guarded by `documents_storage_path_workspace_unique`).
3. **QStash** — publish an extract message so the document moves out of `pending`.

This shape — Storage → DB → Queue, reached through a DI port per [`testable-next-route-via-di-port-and-thin-adapter-2026-04-22`](./testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md) — is a general pattern for any finalize/commit handler that crosses more than one infrastructure boundary. The U9 ce:review pass surfaced **two P1 orphan-cleanup traps** that are easy to write and hard to notice because the happy path keeps working. This doc captures the invariants that make the chain safe under retries, duplicate requests, and transient terminal-step failures.

## Guidance

Apply these four rules together; they only work as a set.

### 1. Return a discriminated union from the insert — not a boolean

The adapter knows Postgres error codes; the pure handler does not. Collapse that knowledge at the port boundary into a typed result that distinguishes duplicate (unique-violation) from other failures.

```ts
// src/lib/upload/finalize.ts
export type UploadFinalizeInsertResult =
  | { ok: true }
  | { ok: false; kind: "duplicate"; error: string }
  | { ok: false; kind: "other"; error: string };

// src/app/api/upload/finalize/route.ts — adapter maps SQLSTATE 23505 to kind: "duplicate"
const POSTGRES_UNIQUE_VIOLATION = "23505";

insertDocumentRow: async row => {
  const { error } = await client.from("documents").insert({ /* ... */ });

  if (error !== null) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return { ok: false, kind: "duplicate", error: error.message };
    }

    return { ok: false, kind: "other", error: error.message };
  }

  return { ok: true };
},
```

### 2. Treat `duplicate` as idempotent success — do nothing, return 200

A duplicate insert on `{documentId, storagePath}` means a prior finalize already succeeded. The storage object belongs to that prior call and the extract job has already been published. Do **not** delete the object, do **not** republish, do **not** return an error.

```ts
if (!insertResult.ok) {
  if (insertResult.kind === "duplicate") {
    return json({ ok: true, documentId, idempotent: true }, 200);
  }
  // Transient DB failure: storage object is still valid; caller can retry /finalize.
  return json({ ok: false, code: "insert_failed" }, 500);
}
```

For `kind: "other"` (transient DB blip), also do not delete. Deleting would force a re-upload for a transient failure.

### 3. Symmetric rollback on terminal-step failure

When the **last** write (here, `publishExtract`) fails after the DB row is committed, the row is stranded in `pending` with no queue message to advance it. Rollback both the row and the storage object so the caller can retry cleanly from `/sign`. This requires adding `deleteDocumentRow` to the port.

```ts
export type UploadFinalizePort = {
  // ... other ops
  insertDocumentRow: (row: UploadFinalizeInsertRow) => Promise<UploadFinalizeInsertResult>;
  deleteDocumentRow: (documentId: string) => Promise<void>; // NEW
  publishExtract: (documentId: string) => Promise<void>;
};

try {
  await port.publishExtract(documentId);
} catch (error) {
  console.error(`[upload/finalize] publishExtract failed for ${documentId}`, error);
  await safeDeleteRow(port, documentId);
  await safeDelete(port, storagePath);

  return json({ ok: false, code: "publish_failed" }, 500);
}
```

### 4. Wrap every cleanup in `safeDelete` / `safeDeleteRow`

Cleanup itself can fail — and most often fails mid-outage, exactly when you need it. A throwing cleanup must not mask the original error returned to the client. Log and swallow.

```ts
const safeDelete = async (port: UploadFinalizePort, storagePath: string): Promise<void> => {
  try {
    await port.deleteObject(storagePath);
  } catch (error) {
    console.error(`[upload/finalize] failed to delete orphaned object ${storagePath}`, error);
  }
};
```

## Why This Matters

Without these rules, transient infrastructure blips get converted into **permanent data corruption**, with no attacker required.

### Trap 1 — the double-finalize orphan-delete (unconditional-cleanup anti-pattern)

```ts
// WRONG — deletes an object that belongs to a PRIOR successful call
const insertResult = await port.insertDocumentRow({
  /* ... */
});
if (!insertResult.ok) {
  await safeDelete(port, storagePath);
  return json({ ok: false, code: "insert_failed" }, 500);
}
```

A client double-click, dropped 200 response, or page reload mid-upload produces two `/finalize` calls for the same `{documentId, storagePath}`. The first commits. The second passes every pre-insert check (the storage object still exists), then hits the unique constraint. The handler deletes the storage object — which belongs to the first, already-successful row. The QStash worker later fails to download it and flips the document to `failed`. **Silent data loss.**

### Trap 2 — the stuck-pending-on-publish-fail

```ts
// WRONG — row committed, no queue message, no retry machinery can advance it
try {
  await port.publishExtract(documentId);
} catch (error) {
  return json({ ok: false, code: "publish_failed" }, 500);
}
```

`publishExtract` throws (QStash 5xx, env misconfig, direct-invoke Gemini failure). The row is committed in `pending`, but nothing will ever advance it because QStash never accepted the message. The document is stuck forever. If the client retries, **Trap 1 fires** and deletes the storage object belonging to the stuck row — now the document is permanently broken in two dimensions.

### The broader principle

When a handler chains multiple external writes, for each failure branch ask:

- _"What orphan does this leave?"_
- _"Is the cleanup I'm about to do definitely tied to THIS call?"_

Unique-constraint violations are the canonical counterexample to the second question — by definition, the conflicting resource belongs to a prior call, not this one.

## When to Apply

Apply this pattern whenever a route handler:

- Chains two or more external writes (Storage, Postgres, Queue/QStash, third-party APIs) within a single request.
- Has at least one write guarded by a **unique constraint** (or any uniqueness boundary — idempotency key, natural key, content hash).
- Is reachable by clients that can plausibly **retry** — browsers, mobile apps, queue consumers, webhook senders, anything with at-least-once delivery semantics.
- Has a **terminal step** whose failure leaves earlier steps' state stranded (DB row with no queue message, queue message with no DB row).

Prime examples beyond the current codebase: `checkout → charge → record`, `sign → upload → notify`, `enqueue → schedule → commit`, any inbox/outbox pattern.

## Examples

### Before — the buggy version (both traps live)

```ts
// src/lib/upload/finalize.ts — DO NOT DO THIS
const insertResult = await port.insertDocumentRow({
  /* ... */
});
if (!insertResult.ok) {
  await safeDelete(port, storagePath); // Trap 1: deletes a prior call's object
  return json({ ok: false, code: "insert_failed" }, 500);
}

try {
  await port.publishExtract(documentId);
} catch (error) {
  console.error(/* ... */);
  return json({ ok: false, code: "publish_failed" }, 500);
  // Trap 2: row committed, no queue message, stuck in pending forever
}
```

### After — typed union + idempotent duplicate + symmetric rollback

```ts
// src/lib/upload/finalize.ts
const insertResult = await port.insertDocumentRow({
  /* ... */
});
if (!insertResult.ok) {
  if (insertResult.kind === "duplicate") {
    // Prior finalize already succeeded. Object belongs to that row; queue already published.
    return json({ ok: true, documentId, idempotent: true }, 200);
  }
  // Transient DB failure. Object is still valid; caller retries /finalize. Do NOT delete.
  return json({ ok: false, code: "insert_failed" }, 500);
}

try {
  await port.publishExtract(documentId);
} catch (error) {
  console.error(`[upload/finalize] publishExtract failed for ${documentId}`, error);
  // Terminal step failed. Symmetric rollback so caller can retry cleanly from /sign.
  await safeDeleteRow(port, documentId);
  await safeDelete(port, storagePath);

  return json({ ok: false, code: "publish_failed" }, 500);
}
```

### Test evidence

From `src/lib/upload/finalize.test.ts` — the two invariants are pinned by direct assertions against a fake port:

```ts
it("treats a duplicate insert as idempotent 200 and does not delete the storage object", async () => {
  const store = makeStore();
  const port = makePort(store, {
    insertDocumentRow: async () => {
      return { ok: false, kind: "duplicate", error: "duplicate key value violates unique constraint" };
    },
  });

  const response = await handleUploadFinalize(buildRequest(validBody()), port);

  expect(response.status).toBe(200);
  expect(store.deletions).toEqual([]); // invariant: never delete on duplicate
  expect(store.rowDeletions).toEqual([]);
  expect(store.published).toEqual([]);
});

it("rolls back the inserted row and deletes the storage object when publishExtract throws", async () => {
  const store = makeStore();
  const port = makePort(store, {
    publishExtract: async () => {
      throw new Error("qstash 503");
    },
  });

  const response = await handleUploadFinalize(buildRequest(validBody()), port);

  expect(response.status).toBe(500);
  expect(store.inserts).toHaveLength(1);
  expect(store.rowDeletions).toEqual([DOCUMENT_ID]); // both rollbacks fire
  expect(store.deletions).toEqual([STORAGE_PATH]);
});
```

## Related

- [testable-next-route-via-di-port-and-thin-adapter-2026-04-22](./testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md) — structural parent. U9 applies the same DI-port + thin-adapter shape to a multi-step write route and adds three extensions that pattern does not cover:
  1. **Typed insert-result union** that surfaces `duplicate` vs `other` across the port boundary so the pure handler can make the idempotency decision.
  2. **Port-level `deleteDocumentRow`** for symmetric rollback when the terminal step fails.
  3. **The "don't delete an orphan unless you're sure it's yours" invariant** — the single rule that prevents unconditional-cleanup from converting a retry into data loss.

  The U8 doc explicitly flags "Stuck processing rows" as an unsolved hazard under _What this pattern does NOT solve_. U9's publish-failure rollback is a concrete pattern for the structurally analogous "stuck pending rows" on the upload side. Candidate for a one-line refresh on the U8 doc to cross-link here.

- [supabase-clients-and-proxy-next16-2026-04-22](./supabase-clients-and-proxy-next16-2026-04-22.md) — the three-client partition. The `/api/upload/finalize` adapter uses the **service-role** client so it can both insert the `documents` row and mutate `storage.objects` on the rollback path without the row-not-yet-exists RLS chicken-and-egg.
- [rls-cross-tenant-document-teleport-via-update-2026-04-21](../security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md) — tenant-isolation context for `public.documents`. Because the service-role client bypasses RLS and column grants, the workspace scoping on `storage_path` must be enforced in application code (via server-generated `{workspaceId}/{documentId}.pdf` + exact-equality check against the body's `storagePath`).
