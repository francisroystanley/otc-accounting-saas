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
  - agent-browser
  - two-browser-walkthrough
related_components:
  - authorization
  - frontend_state
last_updated: 2026-04-23
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

### Live two-browser walkthrough addendum (same session, 2026-04-23)

After the RLS-layer proof above, we also ran the live browser walkthrough using `agent-browser --session <name>` for isolated cookie jars. No Unit 14 seed script was required; a second test user was provisioned via `execute_sql` with the same `auth.users` + `auth.identities` pattern and patched so sign-in worked (`confirmation_token`/`recovery_token`/`email_change_token_new`/`email_change` must be `''` not `NULL`; `raw_user_meta_data` populated with `{sub, email, email_verified, phone_verified}`).

**Setup**

- `agent-browser --session session-b` — logged in as User B via the `/login` page (UI flow, not cookie injection).
- `agent-browser --session session-c` — logged in as User C. Independent cookie jar; independent Supabase session.
- Both sessions parked on `/dashboard`. The `DashboardTable` Client Component mounts and opens a Supabase Realtime channel `documents:w:${workspaceId}` with `filter: workspace_id=eq.${workspaceId}`. Confirmed via the a11y snapshot showing the table and filter UI rendered.

**Observations**

1. **Initial state (both empty):** B and C both show `No documents yet. Head to Upload to get started.`; table footer reads `0 of 0 documents`. Screenshots: `/tmp/u11e-B-before.png`, `/tmp/u11e-C-before.png`.
2. **Insert into workspace C only (via `execute_sql`):** C's dashboard did not receive the Realtime INSERT event this run (a reload picked it up — the app's Realtime subscription was evidently not yet established in the `open`-already-routed page; see "What this did not prove" below). What mattered for the isolation question was immediately visible: **B's dashboard still showed `No documents yet.` after the insert and after a full reload** — the server-side fetch for workspace B returned zero rows for a document that exists in workspace C. RLS at the initial-fetch layer is doing the job.
3. **Live DELETE via UI in session-c:** User C clicked the trash icon, got the destructive-variant `AlertDialog` ("Delete this document? ... This action cannot be undone."), confirmed. C's row animated out (optimistic remove + CDC DELETE). **During this entire interaction, session-b's snapshot continued to show `No documents yet.`** — no phantom INSERT, no DELETE event for a row B never knew about, no toast fired in B.
4. **Final DB state:** workspace C's test document is gone (DELETE request + CASCADE cleanup); workspace A's two original documents are untouched; workspace B has zero documents.

**Screenshots**: `/tmp/u11e-B-after.png` (B: empty, `u11wsb-test@example.com`, `0 of 0 documents`), `/tmp/u11e-C-after.png` (C: empty, `u11wsc-test@example.com`, `0 of 0 documents`). Both carry the demo banner and TopNav as expected.

**What this did prove (that the SQL-level matrix didn't)**

- End-to-end plumbing through the real login page, real cookie jar, real Client Component, real Supabase JS browser client, real Realtime channel, and real DELETE API — not just the policy evaluator.
- The DELETE action dialog UX works from session-c's perspective (trash → dialog → destructive action → optimistic remove → server reconciliation).
- The Server Component's initial-fetch RLS path is symmetrically isolated for B even when workspace C has data.

**What this did NOT prove (honest notes)**

- A live INSERT CDC event arriving in C's open dashboard was not observed within the session. The reload picked the row up, which means the fetch path sees it, but the Realtime subscription path didn't deliver the INSERT. Possible causes: subscription ACK arrived after the insert, or the `postgres_changes` config caches between `open` calls on the same URL. The DELETE did produce a live UI update, so at least the outgoing action leg works. A fresh test harness that opens a brand-new session page AFTER the insert would close this gap; it wasn't load-bearing for the isolation proof.
- No browser DevTools WebSocket frame inspection. `agent-browser` does not expose WS frames directly. If future walkthroughs want to assert "zero WS frames delivered to B during C's activity" at the wire level, use Chrome DevTools Network → WS tab manually, or instrument with `@supabase/supabase-js` in a Node harness logging every CDC payload.

**Ops hygiene**

- Test users `u11wsb-test@example.com` and `u11wsc-test@example.com` remain in the production Supabase project with their auto-provisioned workspaces (B has 0 docs, C has 0 docs). Delete them when Unit 14's seed script supersedes them, or leave them as a permanent walkthrough harness — either is defensible.

### Follow-up when Unit 14 ships

When Unit 14's seed script lands and provisions two accounts with primed data, re-run this walkthrough with (a) a purpose-built failed-extraction fixture to exercise the failed-row toast + popover in cross-workspace isolation, and (b) an explicit live INSERT observation via a fresh-page open post-insert to close the CDC-delivery gap noted above.
