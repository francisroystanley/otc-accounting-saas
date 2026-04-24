---
title: React — use a synchronous counter ref for cap/quota gates in event handlers, not a useEffect-synced ref
date: 2026-04-24
category: best-practices
module: upload
problem_type: best_practice
component: frontend_state
severity: medium
applies_when:
  - A React Client Component uses an event handler (onDrop, onClick, onChange, etc.) that must read "how many X are already in flight" to decide whether to accept more
  - The in-flight count is derived from reducer/state that updates asynchronously
  - Users can fire the event rapidly (drag-and-drop batches, paste bursts, keyboard repeats, rage-clicks)
  - The gate is a soft UX cap — not a security boundary — but being bypassed still matters
tags:
  - react
  - useref
  - useeffect
  - async-timing
  - race-condition
  - next-app-router
  - client-component
---

## Context

A React Client Component needs to enforce a ceiling on concurrent work (e.g., "max 20 uploads in flight"), gated inside an event handler that reads a count derived from reducer state. The tempting pattern is to mirror the state into a ref via `useEffect([rows])` and read the ref inside the handler:

```tsx
const [rows, dispatch] = useReducer(rowsReducer, []);
const rowsRef = useRef<RowState[]>([]);

useEffect(() => {
  rowsRef.current = rows; // synced one render behind the handler
}, [rows]);

const handleBatch = useCallback((files: File[]) => {
  const inFlight = rowsRef.current.filter(r => !isTerminal(r.status)).length;
  if (inFlight + files.length > CEILING) {
    toast.error("Too many in flight");
    return;
  }
  dispatch({ type: "add", rows: seed(files) });
  // start async tasks that eventually dispatch "settle"
}, []);
```

This compiles, passes tests, and works under "click once, wait, click again" manual use. It fails under rapid fire.

## Guidance

For any state that the handler _writes to_ via dispatch and _reads from_ in the same tick to make a gate decision, use a dedicated `useRef` counter that the handler mutates synchronously — not a state-mirror ref synced via effect.

```tsx
const [rows, dispatch] = useReducer(rowsReducer, []);
const inFlightRef = useRef(0);

const handleBatch = useCallback((files: File[]) => {
  if (inFlightRef.current + files.length > CEILING) {
    toast.error("Too many in flight");
    return;
  }
  inFlightRef.current += files.length; // synchronous, before dispatch
  dispatch({ type: "add", rows: seed(files) });

  void Promise.allSettled(tasks)
    .then(settled => {
      /* ...render-affecting work... */
    })
    .finally(() => {
      inFlightRef.current -= files.length; // pairs with the increment
    });
}, []);
```

Key rules:

1. **Increment synchronously** before any `dispatch` or async kick-off that the handler can be re-entered before.
2. **Decrement in a `.finally()`** (or equivalent terminal hook) so the counter stays balanced even when the `.then()` body throws.
3. **Pair by a fixed quantity** captured at the call site (e.g., `files.length`), not by counting results downstream. Decoupling avoids off-by-one when rejected/synthetic results arrive.
4. **Keep state (reducer rows) as the render source of truth.** The counter is only for the gate — it does not replace state, and it is not read during render.

## Why This Matters

`useEffect([state])` runs **after** the commit phase. When an event handler fires, dispatches, and the same user fires the handler again before the browser paints, the second handler reads the ref that the first handler _did not yet sync_ — because the effect for render N+1 has not run. On throttled CPU or during concurrent rendering, the gap is wide enough to miss even single-digit milliseconds of rapid-fire events.

Concrete failure seen in this repo's dropzone on 2026-04-24: `MAX_FILES_PER_BATCH = 10` per drop, `GLOBAL_IN_FLIGHT_CEILING = 20`. Two rapid drops (2×10 = 20) stay at the ceiling. A third rapid drop before React commits the first reads `rowsRef.current.length === 10` (only the committed batch is visible), computes `10 + 10 = 20`, passes the `> 20` check, and lands 30 uploads in flight. The cap is silently bypassed by a factor of N where N is the number of drops that land before the first commit.

A synchronous counter ref closes the window entirely because the increment and the read are both in the same handler's synchronous body — no render cycle, no effect, no commit between them.

## When to Apply

- Soft caps / ceilings / rate limits on user-initiated async work
- Debounce / coalesce gates that need "am I already busy?" inside the same handler
- "One flight at a time" semaphores around modal openings, auto-save, etc.
- Any handler where a decision depends on state the same handler is about to change

## When NOT to Apply

- Security boundaries (use the server for those — client caps are cosmetic)
- Values that need to trigger re-render when they change — use `useState`/`useReducer`
- State that is also read during render — refs do not trigger renders; using a ref as the render source will produce stale UI

## Examples

**Observed failure pattern** (from the dropzone):

```tsx
// rowsRef is synced via useEffect([rows]) — one render behind
const inFlight = rowsRef.current.filter(r => !isTerminal(r.status)).length;
if (inFlight + accepted.length > GLOBAL_IN_FLIGHT_CEILING) {
  toast.error("Too many uploads in flight...");
  return;
}
// ...dispatch, start tasks...
```

Under three rapid drops (200ms apart on a throttled 4× CPU), `inFlight` was observed at 0, 10, 10 instead of 0, 10, 20 — allowing 30 concurrent uploads against a 20 ceiling.

**Fixed pattern**:

```tsx
const inFlightRef = useRef(0);

if (inFlightRef.current + accepted.length > GLOBAL_IN_FLIGHT_CEILING) {
  toast.error("Too many uploads in flight...");
  return;
}
inFlightRef.current += accepted.length;
// ...dispatch, start tasks...

void Promise.allSettled(tasks)
  .then(settled => {
    /* summary toast, etc. */
  })
  .finally(() => {
    inFlightRef.current -= accepted.length;
  });
```

Same three-drop sequence now reads 0, 10, 20 synchronously — the third drop's `20 + 10 = 30 > 20` check fails and the toast fires as intended.

## Related

- `docs/solutions/best-practices/supabase-realtime-buffer-hydrate-race-2026-04-22.md` — different timing pitfall (subscription events arriving before initial fetch resolves) but shares the "`useEffect` runs after commit, events can land before" mental model.
- `docs/solutions/best-practices/testable-client-component-via-di-port-and-thin-adapter-2026-04-22.md` — same component (`UploadDropzone`), testability context. The counter-ref fix is _not_ unit-testable without React Testing Library; covered by the component's integration path and by ce-review's analysis.
