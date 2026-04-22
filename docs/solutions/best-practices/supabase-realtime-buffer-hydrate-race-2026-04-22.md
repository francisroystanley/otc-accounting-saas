---
title: Supabase Realtime buffer-then-hydrate race in Client Components
date: 2026-04-22
category: best-practices
module: dashboard
problem_type: best_practice
component: frontend_state
severity: high
applies_when:
  - A Next.js Client Component opens a Supabase Realtime `postgres_changes` subscription AND fetches an initial list via the browser Supabase client to avoid the Server-Component pre-fetch race
  - The subscription buffers events until hydration completes, then "drains" the buffer into state
  - Buffered events can carry user-visible side effects (toast notifications, analytics, focus changes) that must fire exactly once per event
  - Multiple sources agree state is the source of truth for rendering — so silently dropping a buffered event that the user has already been toasted about is a correctness bug
tags:
  - supabase-realtime
  - next-app-router
  - use-client
  - client-side-orchestration
  - state-machine
  - hydration-race
  - postgres-changes
  - cdc
related_components:
  - frontend_state
  - testing_framework
---

# Supabase Realtime buffer-then-hydrate race in Client Components

## Context

A dashboard Client Component needs a live list of rows. The standard recipe:

1. Server Component pre-fetches for first paint.
2. Client Component also subscribes to Supabase Realtime `postgres_changes` filtered by workspace, and also re-fetches via the browser client — so both the subscription and the list come from the same clock. The parent plan and every public guide recommend this pattern.
3. Between `channel.subscribe()` and the moment the initial fetch lands, incoming CDC events are pushed into a `buffer: FeedEvent[]`.
4. When the fetch completes, `mergeEvents(data, buffer, workspaceId)` folds the buffered events onto the fetched rows and `setRows(merged)` commits the reconciled list.
5. From that point forward, events skip the buffer and call `applyEvent` directly.

The subtle trap is the ORDER of steps 4 → `hydrated = true` → `buffer.length = 0`. The intuitive layout is:

```ts
// WRONG — the race lives here
const merged = mergeEvents(data, buffer, workspaceId);
setRows(merged); // 1. commit merged state
hydrated = true; // 2. flip flag so new events stop buffering
for (const event of buffer) {
  if (event.kind !== "delete") maybeToastFailed(event.row); // 3. toast from buffered events
}
buffer.length = 0; // 4. clear the buffer
```

A CDC event arriving between statement 1 and statement 2 is pushed into `buffer` (still `!hydrated`), then iterated over by statement 3 (so it fires a toast), then discarded by statement 4 — but it was NOT in the snapshot that `mergeEvents` saw in statement 1. The user sees "Extraction failed: invoice.pdf", the row never appears in the table, and manual refresh is the only recovery.

This race is small but real. We saw it reviewed as "hydration race" by the correctness persona and "composition-failure" twice by the adversarial persona in the U11 review. No integration test caught it because `DashboardTable.tsx` is orchestration-inside-a-Client-Component and vitest is Node-only in this repo.

## Guidance

Treat the buffer as a consumable queue with atomic swap semantics. The FIRST statement in the hydrate path must be to drain the buffer into a local array; THEN flip `hydrated = true` BEFORE touching state or firing side effects. Anything that wants to arrive after the flip will correctly skip the now-empty buffer and apply directly.

```ts
// CORRECT — atomic swap: drain → flip → merge → toast
const hydrate = async (): Promise<void> => {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (cancelled) return;

  if (error !== null || data === null) {
    hydrated = true; // still flip — direct-apply is the recovery path
    toast.error("Couldn't refresh — reconnecting…");
    return;
  }

  const pending = buffer.splice(0); // (1) drain buffer atomically; any event arriving
  //     during this statement still goes into buffer —
  //     but because `hydrated` is still false the
  //     push happens BEFORE the next line, and the
  //     splice() above has already taken its snapshot.
  hydrated = true; // (2) flip — from here on events skip the buffer
  const merged = mergeEvents(data, pending, workspaceId);
  setRows(merged); // (3) commit reconciled state
  for (const event of pending) {
    // (4) fire side effects from the drained batch only
    if (event.kind !== "delete") maybeToastFailed(event.row);
  }
};
```

The single-threaded event loop is what makes this work: `buffer.splice(0)` and `hydrated = true` run in the same turn of the loop. A CDC callback cannot interleave mid-expression. By the time the next turn runs, either:

- The callback sees `hydrated === true` and applies directly (good), or
- `buffer.splice(0)` already grabbed it (also good — it's in `pending` and merged).

The buffer must not be cleared twice and must not be used as both the producer queue and the iteration source during drain — that's what invites the window. One `splice(0)` does both jobs.

### Companion fixes that belong with this pattern

Three correctness issues travel with the hydration race. Fix them together:

1. **Unmount guard.** `hydrate()` is fire-and-forget inside `useEffect`. If the user navigates away during the `await`, the later `setRows` / `toast` calls still run. Capture `let cancelled = false` and check it after the await. Return `cancelled = true` from the cleanup.

2. **Seed the "already-toasted" set from the Server-Component-supplied initial rows.** If the failed toast is a `Set<string>` keyed by row id and only populated on post-hydration UPDATE events, a Realtime reconnect that replays a terminal `failed` row fires the toast a second time — even though the user saw it pre-page-load. Seeding the set from `initialRows.filter(r => r.status === 'failed').map(r => r.id)` closes this.

3. **Narrow the DELETE-event payload guard.** A full-row type guard on the DELETE payload couples it to the server's `REPLICA IDENTITY FULL` setting. If an operator flips the table back to default REPLICA IDENTITY, the payload only contains the primary key and the full-row guard silently rejects every DELETE. Split the validation: INSERT/UPDATE require the full shape, DELETE only requires `id + workspace_id`.

## Why This Matters

- **Correctness of user-visible events.** Toasts, notifications, and focus changes are user trust signals. Dropping a row while showing its failure toast is worse than either on its own — it looks like a phantom bug.
- **Tight race window, but real.** The buffer is in memory and the `mergeEvents → setRows → flag` sequence is microseconds. It only fires when a CDC event lands in that exact window. At demo scale (~100 docs/workspace) you may not hit it in manual testing; a bulk seed, a multi-tab session, or a browser under load makes it reliably reproducible.
- **Reviewer signal convergence.** Two personas flagged it independently (correctness and adversarial, twice) before the code ever shipped. When two unrelated review lenses converge on the same race, that's a load-bearing pattern, not a nit.
- **Cheap to fix, impossible to test retroactively.** The fix is a two-line reordering. The pattern should be internalized so every future "buffered subscription + hydrate" implementation gets it right the first time.

## When to Apply

- Any Client Component that subscribes to a channel (Supabase Realtime, WebSocket, Server-Sent Events) AND does an initial HTTP fetch from the same clock.
- Any place a buffer bridges two async producers (e.g., subscription events + REST fetch, or two concurrent API calls).
- When the buffered events carry side effects that must fire exactly once — toasts, analytics, accessibility announcements, focus moves.
- When the buffer is consumed outside React's reducer (i.e., as a raw array mutation), because React's batching does NOT protect this ordering — the race is in the non-React closure, not in the render path.

Not applicable when the buffer is merely "initial state" with no side-effect loop; a simple `setState(merge(data, buffer))` with no post-merge iteration is race-free because there is nothing to leak.

## Examples

### Concrete U11 site

- Race site: `src/app/(app)/dashboard/DashboardTable.tsx` `useEffect` on `workspaceId`.
- Pure reducer (where `mergeEvents`/`applyEvent` live, never inside React): `src/lib/dashboard/live-feed.ts`.
- The reducer must validate `event.workspaceId === authedWorkspaceId` before applying, as a belt-and-suspenders check on top of the channel's `filter: workspace_id=eq.${workspaceId}` and the RLS-filtered CDC publication. The hydration-race fix does not replace this check — RLS is still the security boundary.

### Side quirk captured same session: Supabase Storage `remove()` empty-array response

While wiring the row-level delete, the DELETE route had to classify `storage.remove([path])` responses. Supabase returns `{ data: [], error: null }` for both "the object didn't exist" (older clients raised an explicit 404) and, in rarer edge cases, silent no-op failures (policy filtered the delete, bucket name drift). Treating empty-array as `other` (fatal) aborts the row delete and leaves a zombie row whose PDF is already gone; treating it as `not_found` lets the idempotent retry path proceed but can mask silent misconfig. We chose `not_found` (the safer path, given the preceding workspace check has already authorized the delete) AND added `console.info` logging so silent failures are traceable. See `src/app/api/documents/[id]/route.ts:removeStorageObject`.

### Pattern to follow on the next dashboard

When you build the next "live list" Client Component (e.g., a notifications panel, activity log, a search-results stream):

1. Put all merge logic in a pure module (`src/lib/<feature>/live-feed.ts`) with `mergeEvents(initial, events, authId)` and `applyEvent(rows, event, authId)`. Test it in Node vitest.
2. In the Client Component:
   - Open the channel, buffer events until `hydrated=true`.
   - In `hydrate()`: `await` the initial fetch, check `cancelled`, `splice(0)` the buffer into `pending`, flip `hydrated`, call `mergeEvents(data, pending)`, call `setRows`, fire side effects from `pending`.
   - Seed any "already-notified" Sets from `initialRows` before the subscription opens.
   - Narrow DELETE payloads by PK only, not full row shape.

This is the shape the U11 dashboard ended at after ce:review autofix, and it is the one we should start at next time.
