---
title: Idempotent Supabase seed scripts that share the production extraction write boundary
module: scripts/seed-demo
date: 2026-04-23
problem_type: best_practice
component: tooling
severity: medium
related_components:
  - src/lib/extract/pipeline
  - src/lib/extract/supabase-port
  - src/lib/extraction/types
  - src/app/api/upload/finalize
  - supabase/migrations (update_extraction_result)
tags:
  - supabase
  - seed-script
  - idempotency
  - service-role
  - admin-api
  - extraction-pipeline
  - cli
applies_when: >
  Writing a Node-based seed script that must create pre-verified demo users,
  stage realistic data by running through the same DB/Storage write paths
  production uses, and stay safely re-runnable without creating duplicate
  rows or leaking Storage objects.
---

# Idempotent Supabase seed scripts via the production write boundary

## Context

U14 needed an `npm run seed` script that pre-populated a "happy path" demo
account and a fresh empty account for R3 workspace-isolation side-by-side
tests. Two temptations to avoid:

1. **Insert rows directly with service-role, skipping the production
   extraction pipeline.** Diverges from the real write path the app
   exercises; a reviewer's populated account would look different from what
   upload-then-QStash-then-`/api/extract` produces.
2. **Delete the demo users on every re-run and let the trigger
   re-create everything.** Adds a workspace-autocreate round-trip plus
   cleanup of `workspace_members` rows for no actual benefit.

## Guidance

### 1. Reuse the production write boundary, skip only the transport

The extraction pipeline has three consumers: `/api/extract` (QStash callback),
`scripts/extract-report.ts` (accuracy harness), and the seed script. All three
share the same Gemini call (`extractFromPdfBytes`) and the same DB write
(`update_extraction_result` RPC). The seed just skips the QStash hop:

```ts
// Inline extraction — same write boundary as production, no QStash.
const bytes = await fs.readFile(fixturePath);

// 1. Upload to Storage (same path format as src/lib/upload/validate.ts).
await client.storage.from("documents").upload(`${workspaceId}/${documentId}.pdf`, bytes, {
  contentType: "application/pdf",
  upsert: false,
});

// 2. Insert pending row (same columns as src/lib/upload/finalize.ts).
await client.from("documents").insert({
  id: documentId,
  workspace_id: workspaceId,
  uploaded_by: userId,
  filename,
  storage_path: `${workspaceId}/${documentId}.pdf`,
  status: "pending",
});

// 3. Claim → processing (mirror claimForProcessing, including rows-affected).
const { data: claimed } = await client
  .from("documents")
  .update({ status: "processing", updated_at: new Date().toISOString() })
  .eq("id", documentId)
  .eq("status", "pending")
  .select("id")
  .maybeSingle();

if (claimed === null) {
  throw new Error(`Claim found no pending row — unexpected state after insert`);
}

// 4. Extract + write via the SECURITY DEFINER RPC (same as production).
const extraction = await extractFromPdfBytes(bytes);
const finalStatus =
  extraction.doc_type === "unknown" || extraction.doc_type_confidence < DOC_TYPE_THRESHOLD
    ? "needs_review"
    : "complete";

await client.rpc("update_extraction_result", {
  doc_id: documentId,
  new_status: finalStatus,
  data: toJsonValue(extraction),
});
```

Include the rows-affected assertion on the claim UPDATE even though the row
was just inserted as `pending` by the same client. The assertion catches
future RLS or constraint changes that would silently no-op the UPDATE — and
it keeps the "mirrors production exactly" comment honest.

### 2. Idempotency: preserve users, reset workspace data

Don't delete the users — they were created by `auth.admin.createUser`, which
fired the `handle_new_user` trigger, which created the workspace and
`workspace_members` row. Re-seeding means you want the same user id with a
clean workspace:

```ts
const ensureUser = async (client, user) => {
  const existing = await findUserByEmail(client, user.email);

  if (existing !== null) {
    // Rotate the stored password to match the checked-in credential.
    // Prevents silent drift between what the script prints at the end
    // and what auth.users actually accepts.
    await client.auth.admin.updateUserById(existing, {
      password: user.password,
      email_confirm: true,
    });
    return existing;
  }

  const { data } = await client.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  return data.user.id;
};

const clearWorkspace = async (client, workspaceId) => {
  // Storage first — if the rows deleted first, a live row would briefly
  // point at a dead blob (user-visible 404 on preview).
  const { data: objects } = await client.storage.from("documents").list(workspaceId, { limit: 1000 });

  if (objects.length > 0) {
    await client.storage.from("documents").remove(objects.map(o => `${workspaceId}/${o.name}`));
  }

  await client.from("documents").delete().eq("workspace_id", workspaceId);
};
```

The `updateUserById` call on the existing-user branch is the non-obvious
fix: without it, rotating the checked-in demo password silently desyncs
between what the script prints and what auth.users accepts.

### 3. Paginate `admin.listUsers` — page 1 is not enough

GoTrue's `admin.listUsers` returns users ordered by `created_at DESC`. The
demo users created weeks ago drop off page 1 once the project accumulates
~200 newer signups. A fixed `page: 1, perPage: 200` call silently returns
`null` from `findUserByEmail` → `createUser` fails on duplicate email →
seed aborts with a confusing error. Iterate pages:

```ts
for (let page = 1; ; page += 1) {
  const { data } = await client.auth.admin.listUsers({ page, perPage: 200 });
  const match = data.users.find(u => u.email?.toLowerCase() === target);
  if (match !== undefined) return match.id;
  if (data.users.length < 200) return null;
}
```

### 4. Share doc-type constants between scripts and production

Both `scripts/seed-demo.ts` and `scripts/extract-report.ts` iterate the same
real doc types (`w2`, `1099_nec`, `1099_misc`, `k1`). Hardcoding the list in
each script means dropping K-1 (per the accuracy report's K-1 inclusion
gate) requires editing every consumer. Instead, export the canonical list
from `src/lib/extraction/types.ts`:

```ts
export const ALL_DOC_TYPES: readonly Exclude<DocType, "unknown">[] = ["w2", "1099_nec", "1099_misc", "k1"] as const;
```

Then scripts import the constant. When K-1 drops out of the discriminated
union, the TypeScript compiler tells every consumer.

### 5. Node invocation: mirror `extract:report`

The seed script imports `@/lib/supabase/service` and `@/lib/extraction/gemini`,
both of which transitively import `server-only`. Running the script as plain
Node would throw. The existing `extract:report` npm script solves this with
`--conditions=react-server`, which resolves `server-only` to its empty stub:

```json
"seed": "node --conditions=react-server --env-file=.env.local --import tsx scripts/seed-demo.ts"
```

Same flags, same behavior. Don't reinvent the invocation shape.

## Why This Matters

- **Write-boundary parity.** When the seed runs through the same RPC +
  state machine as production, a reviewer's populated account matches
  what a fresh upload would produce. Diverging code paths for "staging
  data" are a classic source of bugs where demos pass and production
  fails (or vice versa).
- **Idempotency without complexity.** Preserving users + resetting
  workspaces is fewer API calls and fewer race windows than
  delete-and-recreate. The `ensureUser` password-rotation step closes
  the only leak (silent credential drift).
- **Pagination silent failures.** A seed script that stops working once
  the Supabase project grows past 200 users is a time bomb — the
  failure mode is a confusing "already registered" error, not a
  seed-specific message.
- **Constant deduplication.** The smallest refactors that kill the
  biggest class of drift are the "extract a shared constant" ones.
  Adding `ALL_DOC_TYPES` to `types.ts` made the next change (dropping
  K-1) a one-line edit instead of three.

## When to Apply

- Seed scripts for Supabase projects with RLS and auth triggers.
- Any ops tooling that needs to create pre-verified users and write
  data through the production write boundary.
- CLIs that need to import `server-only` modules — use
  `--conditions=react-server` (Node ≥ 20.6).

## Examples

See `scripts/seed-demo.ts` in this repo. Canonical companion patterns:

- `scripts/extract-report.ts` — accuracy harness (same Node invocation
  shape, same `ALL_DOC_TYPES` import).
- `src/lib/extract/supabase-port.ts` — production's `claimForProcessing`
  and `writeResult` functions; the seed mirrors both.
- `src/lib/upload/finalize.ts` — production's row-insert columns; the
  seed's `documents.insert` mirrors the shape exactly.
- `supabase/migrations/20260421000010_update_extraction_result_arg_defaults.sql` —
  the shared RPC both production and the seed write through.
- `docs/solutions/best-practices/server-only-bypass-from-node-and-vitest-2026-04-22.md` —
  background on the `--conditions=react-server` pattern.
