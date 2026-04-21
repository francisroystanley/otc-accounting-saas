---
title: Cross-tenant document teleport via RLS UPDATE when user has multi-workspace membership
date: 2026-04-21
category: security-issues
module: supabase-rls-documents
problem_type: security_issue
component: database
symptoms:
  - PATCH /rest/v1/documents setting a new workspace_id succeeds for a user who is a member of both the source and destination workspaces
  - Document row (filename, extracted_data PII, storage_path) silently relocates from workspace A to workspace B
  - storage_path still references the source workspace's storage prefix, leaving a cross-workspace dangling pointer
  - RLS USING clause evaluates against the OLD row and WITH CHECK against the NEW row; a symmetric membership predicate passes both sides
  - No tenant-isolation test covered mutation of tenant-scoping columns, so the teleport was invisible to the existing RLS harness
root_cause: missing_permission
resolution_type: migration
severity: high
related_components:
  - database
  - authentication
tags:
  - rls
  - postgres
  - postgrest
  - supabase
  - multi-tenancy
  - column-level-grants
  - tenant-isolation
  - workspace-isolation
---

# Cross-tenant document teleport via RLS UPDATE when user has multi-workspace membership

## Problem

Supabase RLS on `public.documents` permitted a cross-tenant "teleport": a user who belongs to both workspace A and workspace B could PATCH a document's `workspace_id` from A to B via PostgREST, silently relocating PII (filename, `extracted_data`) while leaving `storage_path` dangling in the original workspace's storage prefix.

## Symptoms

- `PATCH /rest/v1/documents?id=eq.<docA> { "workspace_id": "<wsB>" }` returns `204 No Content` when the caller is a member of both workspaces.
- The row's `workspace_id` now references wsB, but `storage_path` still points under wsA's prefix. The cross-workspace pointer is invalid by convention but structurally intact.
- No audit signal: the `documents_update_if_member` policy passes because USING (OLD-row membership check) and WITH CHECK (NEW-row membership check) are both satisfied by a multi-membership user.
- Latent in the current single-workspace-per-user prototype (the workspace-autocreate trigger yields exactly one membership per user), but the RLS pattern ships as-is to any future multi-membership flow (invites, admin seeding, support tooling).

## What Didn't Work

- **Relying on the RLS policy alone.** The initial correctness-focused review graded this finding as _"not exploitable"_ on the reasoning that "user A is only in workspace A, cannot set `workspace_id` to workspace B." That framing missed the multi-membership case entirely; the adversarial-review pass overturned it with a constructed scenario where the same user holds memberships in both workspaces. (session history — prior review pass on 2026-04-21)
- **Tightening the WITH CHECK to `new.workspace_id = old.workspace_id`.** RLS UPDATE policies do distinguish OLD (evaluated by USING) from NEW (evaluated by WITH CHECK), but a single policy expression cannot reference both simultaneously — so "this column must not change" cannot be expressed as a policy predicate.
- **A BEFORE UPDATE trigger raising on `workspace_id` change.** Workable but imperative, more expensive per row, and still overridable by future policy drift. Rejected in favor of a declarative privilege-layer gate. (session history — the adversarial reviewer listed this as an alternative to the chosen column-grant fix)

## Solution

Revoke table-level UPDATE from `authenticated` and re-grant UPDATE only on the columns user sessions legitimately edit. Non-granted columns — including `workspace_id`, `storage_path`, `uploaded_by`, `filename`, `created_at`, `doc_type_confidence`, and `error_message` — become structurally immutable for user-session JWTs. Service-role writers bypass the gate via role (`service_role` has `bypassrls` and is unaffected by `authenticated` grants).

Migration — `supabase/migrations/20260421000008_documents_column_grants.sql`:

```sql
-- Revoke table-level UPDATE so column-level grants become authoritative
revoke update on public.documents from authenticated;

-- Re-grant UPDATE only on the columns user-driven edit flows need
grant update (status, doc_type, extracted_data, edited_fields, updated_at)
  on public.documents to authenticated;
```

Harness assertions — `scripts/verify-u3.mjs`:

```javascript
// Teleport blocked at the privilege layer
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

// Legitimate edit path still works
const legitPatch = await rest(`/documents?id=eq.${docIdA}`, {
  method: "PATCH",
  jwt: sessionA.access_token,
  body: {
    extracted_data: {
      fields: {
        /* ... */
      },
    },
  },
  prefer: "return=minimal",
});
record(
  "user A can still PATCH extracted_data on own document",
  legitPatch.status === 204,
  `status=${legitPatch.status}`
);
```

The existing `documents_update_if_member` policy is left in place as defense-in-depth behind the column-grant gate.

A related follow-on finding (migration 18, `20260421000018_storage_path_tenant_scoping.sql`) adds `CHECK (storage_path like workspace_id::text || '/%')` so `storage_path` can't be set to reference another tenant's prefix either. Migration 8 prevents `workspace_id` from changing; migration 18 prevents `storage_path` from pointing at another tenant. The two together close the full composition the adversarial review described. (session history — same review pass)

## Why This Works

Postgres evaluates privileges _before_ RLS policy expressions. `REVOKE UPDATE ON <table> FROM <role>` removes the table-wide privilege; `GRANT UPDATE (col, ...) ON <table> TO <role>` permits UPDATE only when every targeted column is in the grant set. An UPDATE that SETs `workspace_id` is rejected with SQLSTATE `42501` (insufficient_privilege) _before_ the policy expression ever runs.

The fix reframes the problem from "write an RLS predicate that can detect a column change" (which RLS cannot express) to "enumerate the columns user sessions may change" (which the privilege layer enforces natively).

Service-role writers — the `update_extraction_result` SECURITY DEFINER function, the seed script — are unaffected because Supabase grants `service_role` broad table privileges at project init (separate from its `bypassrls` attribute, which only skips RLS policy evaluation, not privilege checks). Our `REVOKE UPDATE ... FROM authenticated` doesn't touch `service_role`'s table-wide UPDATE grant, and the privilege check is scoped to the invoking role, so the extraction pipeline continues to write all columns.

## Prevention

- **Default to column-level grants on tenant-scoped tables.** Revoke table-level UPDATE from `authenticated` and explicitly enumerate the mutable columns. Easier to add a column to the grant than to audit every possible UPDATE shape.
- **Keep privileged writes in `SECURITY DEFINER` functions** with `SET search_path = ''` and explicit `REVOKE ALL ... FROM public, authenticated, anon; GRANT EXECUTE TO service_role` patterns. User-session roles should not hold raw write privileges on sensitive columns.
- **Test both denial and legit paths in the harness.** A single "teleport returns 403" assertion catches any regression that re-grants table-level UPDATE; the paired "extracted_data PATCH returns 204" assertion prevents the fix from over-tightening.
- **Design RLS assuming multi-membership exists, even when the current product enforces one workspace per user.** Invite flows, admin seeding, and support tooling all activate this surface. Writing defenses that only hold under single-membership is a time bomb.
- **Treat identity/provenance columns as a first-class class.** `workspace_id`, `storage_path`, `uploaded_by`, `created_at` are identity/provenance fields and should not appear in any user-session grant set.
- **Pair this with a structural prefix CHECK on `storage_path`.** Column-level UPDATE grants prevent mutation, but an INSERT can still set a mismatched prefix. See migration 18 (`documents_storage_path_prefix_check`).
- **Audit INSERT and DELETE policies with the same lens.** Column-grant gates UPDATE only. A multi-membership user can still compose the teleport via `DELETE` in wsA plus `INSERT` with the same payload in wsB (RLS INSERT + DELETE policies are the relevant gate there; confirm they also enforce membership). Whenever column-level UPDATE grants change on a tenant-scoped table, review the INSERT/DELETE policy surface too.
- **Remember Storage is a separate authorization surface.** The row is now teleport-proof, but the actual PDF blob in `storage.objects` is gated by its own policies (migrations 4 and 11). Row-level fixes don't propagate; verify Storage RLS prevents the adjacent "copy the blob across prefixes" attack.
- **Add a CI lint against future regressions.** A `GRANT ALL` or `GRANT UPDATE ON <tenant_table>` (without columns) in any future migration silently restores the table-level privilege and undoes this fix. A grep rule in CI or pre-merge review against `supabase/migrations/*.sql` is cheap insurance.

## Related Issues

- Migration 8: `supabase/migrations/20260421000008_documents_column_grants.sql` — the fix itself.
- Migration 18: `supabase/migrations/20260421000018_storage_path_tenant_scoping.sql` — companion constraint preventing `storage_path` from referencing another tenant's prefix.
- Migrations 4 and 11: Storage RLS policies on `storage.objects`, which gate the adjacent "copy the blob" attack.
