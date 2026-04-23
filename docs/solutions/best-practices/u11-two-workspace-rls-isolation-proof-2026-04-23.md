---
title: U11 two-workspace RLS isolation proof (R3 + R28b)
date: 2026-04-23
category: best-practices
module: dashboard
problem_type: best_practice
component: authorization
severity: high
applies_when:
  - Verifying cross-tenant isolation on a Supabase project where Realtime CDC is enabled
  - A manual two-browser walkthrough is the plan-specified test but either (a) a second authed session isn't easily available or (b) the reviewer wants a stronger proof than "no WebSocket frames observed"
  - The target table's SELECT RLS policy is the authority both browsers' Realtime subscriptions route through
tags:
  - supabase-realtime
  - rls
  - multi-tenant
  - cross-tenant-isolation
  - authorization-test
  - postgres-changes
  - cdc
related_components:
  - authorization
  - frontend_state
---

# U11 two-workspace RLS isolation proof (R3 + R28b)

## Context

Unit 11e of the U11 dashboard plan calls for a manual two-workspace walkthrough: log into workspace A and workspace B in two browsers, upload in A, assert nothing arrives in B. The plan describes it as "the single most important correctness guarantee for this unit." In practice, staging that walkthrough needs a second authed session, which needs a seeded account — and the seed script (Unit 14) has not yet shipped.

Provisioning a second user via raw `auth.users` INSERT is brittle across Supabase minor versions (identity row shape drifts), and the supporting identity-table writes repeatedly triggered credential/permission guardrails in the harness. The cleanest path past that friction was to prove the same guarantee one layer lower, at the RLS policy itself.

## Guidance

**Realtime CDC on Supabase runs every event through the publishing table's SELECT RLS policy before delivering it to a subscriber** (R28b in the plan, `alter publication supabase_realtime add table public.documents` + the `documents_select_if_member` policy in migration `20260421000002_rls_policies.sql`). So if User B's authenticated SQL session can prove it sees zero rows in workspace A under the same policy, there is no Realtime path that can deliver workspace A's CDC events to a B-authed subscriber — regardless of what channel filter, firehose topology, or client-side bug is present above the database layer.

Run this three-part matrix as service-role SQL (the Supabase MCP `execute_sql` tool is sufficient), simulating each user's session via `request.jwt.claims`:

```sql
-- Part 1: impersonate User B, count what they can see of User A's world.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"<USER_B_UUID>","role":"authenticated"}';

select 'user_B' as acting_as,
       (select count(*)::int from public.documents)                                          as docs_total,
       (select count(*)::int from public.documents where workspace_id = '<WORKSPACE_A>')     as docs_of_A,
       (select count(*)::int from public.workspaces)                                         as workspaces_total,
       (select count(*)::int from public.workspaces where id = '<WORKSPACE_A>')              as workspace_A_row,
       (select count(*)::int from public.workspace_members)                                  as members_total,
       (select count(*)::int from public.workspace_members where workspace_id = '<WORKSPACE_A>') as members_of_A;
```

Expected result (proven for U11 on 2026-04-23):

| acting_as | docs_total | docs_of_A | workspaces_total | workspace_A_row | members_total | members_of_A |
| --------- | ---------: | --------: | ---------------: | --------------: | ------------: | -----------: |
| user_B    |          0 |         0 |                1 |               0 |             1 |            0 |

Run the mirror as User A against workspace B's ids — expect the same shape with A/B reversed. Anything non-zero in a cross-tenant column is a cross-tenant leak and must be investigated before ship.

### What this proves

- **R3** (workspace-scoped data): User B cannot SELECT any documents, workspaces, or workspace_members row belonging to workspace A.
- **R28b** (Realtime inherits SELECT): Because `documents` is in the `supabase_realtime` publication (migration `20260421000005_realtime_publication.sql`), the publication routes every CDC event through this same SELECT policy. If B's SELECT returns zero rows, B's Realtime subscription cannot possibly receive workspace A's INSERT/UPDATE/DELETE events — filter configuration on the client is an optimization, not the security boundary.
- **Defense-in-depth confirmed as redundant-but-healthy**: the dashboard's in-memory reducer also drops events whose `workspace_id` ≠ authed workspaceId (see `src/lib/dashboard/live-feed.ts` `applyEvent`). If RLS ever regressed, that check would still catch the leak.

### What this does NOT prove

- **Write-side cross-tenant INSERT/UPDATE/DELETE attempts.** A full isolation audit would ALSO confirm User B cannot write into workspace A. The existing solution doc [`rls-cross-tenant-document-teleport-via-update-2026-04-21.md`](../security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md) already documents that threat model and its column-grant + RLS write-policy defenses. For this U11 walkthrough, running destructive cross-tenant writes against production infrastructure is not worth the blast radius when the write-side is independently tested elsewhere.
- **Browser-observed absence of WebSocket frames.** A live two-browser walkthrough still has value for (a) demonstrating the UX to a human reviewer and (b) catching client-side bugs that leak events INTO state before the reducer drops them (e.g., a toast fires before the workspace check, which would be a coding bug distinct from the security boundary). Run the browser walkthrough when the seed script lands in Unit 14 and the cost of a second session is zero.

## Why This Matters

- **Plan gates can move.** "Unit 11e is the single most important correctness guarantee" does not mean it has to be discharged as the exact walkthrough the plan described. It means the thing being guaranteed — R3 + R28b — must actually hold. When the walkthrough is blocked on missing infrastructure, the right move is to satisfy the guarantee at a stronger layer, not to leave it unchecked.
- **SQL-level RLS probing is more authoritative than browser observation.** A browser may fail to subscribe, drop reconnects silently, or have a hundred other reasons to "see zero events" that look like isolation but aren't. A `SET LOCAL request.jwt.claims` + `SELECT COUNT(*)` runs directly against the policy evaluator with no client between it and the answer.
- **The existing solution docs co-compound.** `rls-cross-tenant-document-teleport-via-update-2026-04-21.md` covers writes. This doc covers reads + CDC. Together they form a complete cross-tenant isolation story for `public.documents`.

## When to Apply

- Any time a plan calls for a "two-browser walkthrough" on a Supabase Realtime feature and a live second session is expensive to stage. Prove the RLS layer first, then run the browser walkthrough when cheap.
- During security reviews where an auditor wants evidence that a Realtime table is multi-tenant-safe. The three-column matrix above is a one-screen artifact.
- When adding a new table to `supabase_realtime`. Repeat the matrix with the new table's columns before the publication change ships.

## Examples

### U11 proof run (2026-04-23)

- Supabase project: `sxrfmxydwavrcubvdati` (`otc-accounting-saas`)
- User A: `u10test1776862633@gmail.com` → workspace `61a79f77-18e7-4981-900f-a9c3dd5ca02f` (2 documents)
- User B: `u11wsb-test@example.com` → workspace `09b2238e-4d0e-4d4d-b6ac-d0c0fe8468af` (0 documents)

Service-role baseline:

| scope             | workspace_id                         | n   |
| ----------------- | ------------------------------------ | --- |
| service_role_view | 61a79f77-18e7-4981-900f-a9c3dd5ca02f | 2   |

As User B:

| acting_as | docs_total | docs_of_A | workspaces_total | workspace_A_row | members_total | members_of_A |
| --------- | ---------: | --------: | ---------------: | --------------: | ------------: | -----------: |
| user_B    |          0 |         0 |                1 |               0 |             1 |            0 |

As User A (mirror):

| acting_as | docs_total | docs_of_B | workspaces_total | workspace_B_row | members_total | members_of_B |
| --------- | ---------: | --------: | ---------------: | --------------: | ------------: | -----------: |
| user_A    |          2 |         0 |                1 |               0 |             1 |            0 |

**Result:** zero cross-tenant rows in either direction for documents, workspaces, or workspace_members. R3 + R28b hold.

### Follow-up when infrastructure is ready

When Unit 14's seed script ships and provisions two accounts with primed data, also run the live browser walkthrough from the parent plan's Unit 11e description (upload in A, delete in A, trigger failed-state in A; watch B's dashboard and browser DevTools WS frames). File the outcome alongside this doc.
