---
title: Testable Next.js Client Component via DI port and thin adapter
date: 2026-04-22
category: best-practices
module: upload
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - A Next.js App Router Client Component ("use client") orchestrates multi-step network I/O that warrants unit tests
  - The repo's vitest is Node-only (no jsdom, no React Testing Library installed)
  - The component imports browser-only modules (Supabase browser client, `window.crypto`, DOM APIs) that cannot load in vitest's Node environment
  - Project ESLint bans `any`, bare `as` casts (`consistent-type-assertions: never`), and non-null assertions
  - Error-branch coverage is load-bearing (per-file failure isolation, error-code → user-message mapping, step short-circuiting)
tags:
  - next-app-router
  - use-client
  - dependency-injection
  - port-adapter
  - vitest
  - node-only-tests
  - client-side-orchestration
  - zod
related_components:
  - frontend_stimulus
  - testing_framework
---

# Testable Next.js Client Component via DI port and thin adapter

## Context

A `"use client"` component (e.g., an upload dropzone) needs to do real orchestration: call a signed-URL API, PUT bytes to object storage through a browser SDK, call a finalize API, and map every success/failure code to a user-visible toast. That logic has real branching — step short-circuits on failure, thrown-vs-returned error normalization, 5xx-vs-schema-failure code mapping, per-file pre-checks, batch-cap enforcement — and a regression in any branch is user-visible.

First instinct: test the Client Component with React Testing Library + jsdom. In this repo that doesn't work because `vitest.config.ts` sets `environment: "node"`, RTL isn't installed, and importing the component transitively pulls in `createSupabaseBrowserClient`, `window.crypto`, and DOM event types that blow up in Node. Switching environments mid-suite or installing jsdom is a larger investment than the demo-window justifies, and even then RTL tests over drag-and-drop are brittle.

The dead end is telling. What's actually worth testing isn't the JSX — it's the orchestration. The orchestration has no React, no DOM, and no server-only imports if you extract it correctly.

This mirrors the server-side pattern documented in [testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md](./testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md) — same structural move, applied one layer higher.

## Guidance

Split the Client Component into two layers. The pure layer has no React, no `"use client"`, no browser-only imports, and is trivially testable in Node vitest. The Client Component is the thin adapter that wires DOM events + browser SDKs + toasts + state into the pure layer's port.

### Layer 1 — Pure orchestration (no React, no browser)

File: `src/lib/upload/client-batch.ts`

Define a **port** interface listing exactly the side effects the orchestration needs, and export one or more pure functions that depend only on the port:

```ts
export type UploadBatchPort = {
  signUpload: (filename: string) => Promise<SignResult>;
  putToStorage: (token: string, file: File, storagePath: string) => Promise<PutResult>;
  finalizeUpload: (args: { documentId: string; filename: string; storagePath: string }) => Promise<FinalizeResult>;
  onProgress: (stage: UploadStage, percent: number) => void;
};

export const uploadOne = async (file: File, port: UploadBatchPort): Promise<UploadOneResult> => {
  // ...sign → put → finalize, with per-step try/catch normalization
};

export const preCheckFile = (file: File): PreCheckFailure | null => {
  /* ... */
};
export const preCheckBatch = (files: File[]): BatchPreCheck => {
  /* ... */
};
export const userMessageForCode = (code: string): string => {
  /* ... */
};
```

Constraints on the pure layer:

- **Zero React.** No hooks, no JSX, no `"use client"` directive.
- **Zero browser imports.** No `createSupabaseBrowserClient`, no `window.*`, no DOM event types.
- **`File` and `FileList` are fine** — they exist as globals in Node 20+ and vitest exposes them.
- **Named types for every port return.** Use discriminated unions (`{ ok: true, ... } | { ok: false, code: string }`) so exhaustiveness is compile-checked in every consumer.

### Layer 2 — Thin Client Component adapter

File: `src/components/upload/UploadDropzone.tsx`

The component's only responsibilities:

1. Import `uploadOne` + the port interface from the pure module.
2. Construct a concrete port inline using browser APIs:
   - `signUpload` wraps `fetch('/api/upload/sign', ...)` with Zod response parsing and `response.ok` gating for 5xx.
   - `putToStorage` wraps `createSupabaseBrowserClient().storage.from(...).uploadToSignedUrl(...)`.
   - `finalizeUpload` wraps `fetch('/api/upload/finalize', ...)`.
   - `onProgress` dispatches into a local `useReducer`.
3. Handle DOM events (drag-enter counter, drop, file-input change) and feed accepted files into `uploadOne`.
4. Fire toasts from the settled `UploadOneResult`.

```ts
const UploadDropzone = (): React.ReactElement => {
  const [rows, dispatch] = useReducer(rowsReducer, []);

  const handleBatch = useCallback((fileList: FileList | null): void => {
    // pre-check, guard against in-flight batches, seed rows
    const port: UploadBatchPort = {
      signUpload: signUploadViaApi,         // fetch + Zod
      putToStorage,                          // Supabase browser client
      finalizeUpload: finalizeUploadViaApi,  // fetch + Zod
      onProgress: (stage, percent) => dispatch({ type: "progress", ... }),
    };
    void Promise.allSettled(accepted.map(f => uploadOne(f, port)));
  }, []);
  // ...JSX
};
```

### Layer 3 — Tests against fake ports

File: `src/lib/upload/client-batch.test.ts`

Build a `makePort` helper that returns a configurable fake:

```ts
const makePort = (overrides?: Partial<UploadBatchPort>): UploadBatchPort => {
  return {
    signUpload: async () => ({ ok: true, signedUrl: "...", token: "...", documentId: "...", storagePath: "..." }),
    putToStorage: async () => ({ ok: true }),
    finalizeUpload: async () => ({ ok: true, documentId: "..." }),
    onProgress: () => {
      return;
    },
    ...overrides,
  };
};

it("short-circuits when signUpload returns ok:false and does not call put/finalize", async () => {
  const putSpy = vi.fn();
  const finalizeSpy = vi.fn();
  const port = makePort({
    signUpload: async () => ({ ok: false, code: "unauthorized" }),
    putToStorage: putSpy,
    finalizeUpload: finalizeSpy,
  });
  const result = await uploadOne(makeFile(), port);
  expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "unauthorized" });
  expect(putSpy).not.toHaveBeenCalled();
  expect(finalizeSpy).not.toHaveBeenCalled();
});
```

Every error branch — returned `ok: false`, thrown exception, step short-circuit, progress-stage sequencing, batch-cap enforcement, error-code → message mapping — gets a direct test with no DOM, no RTL, no browser emulation.

### Typed error-code exhaustiveness (adjacent technique)

The pure module also hosts the `userMessageForCode` map that the Client Component consumes. To make "a new server error code without a matching user message" a compile-time failure rather than a silent runtime fallback, type the map key by a `ClientOnlyCode | ServerCode` union instead of `string`:

```ts
export type KnownCode = ClientOnlyCode | ServerCode;

const USER_MESSAGES: Readonly<Record<KnownCode, string>> = {
  // every enum member must appear or TS fails compilation
  forbidden_origin: "...",
  // ...
};
```

Then the exhaustiveness test asserts `.not.toBe(USER_MESSAGE_FALLBACK)` per code, so it actually fails when a key is removed (rather than passing through the fallback string).

The same `Record<Kind, string>` shape applies one boundary deeper — at the DB write where the extraction pipeline persists user-facing error copy. See [friendly-error-messages-via-write-boundary-transformation](./friendly-error-messages-via-write-boundary-transformation-2026-04-24.md) for the server-side application: a typed `ExtractionError` whose message is auto-derived from its kind, paired with structural SDK-error classification and `Error.cause` preservation for operator logs.

## Why This Matters

The instinct to mock at the component boundary or install jsdom is the wrong reach. It costs more and tests less. The pure-orchestration layer is already the part you actually want coverage on — the error-path matrix, the port-call sequencing, the step short-circuits, the user-message mapping. The Client Component is 80% rendering and event wiring, which React's own invariants cover.

Extracting the orchestration into a DI port gives four compounding benefits:

1. **Tests run in Node vitest** — no environment switch, no RTL, no browser emulation cost.
2. **Strict ESLint compatibility** — fake ports implement the typed interface, so no `as`, no `any`, no `vi.mock` type-safety escapes.
3. **The component becomes a readable adapter** — new contributors understand the file in one pass.
4. **Agent parity** — an AI agent scripting the same flow against the HTTP API (bypassing the browser UI) naturally composes the same three port operations.

This is the same structural move as the server-side learning (`testable-next-route-via-di-port-and-thin-adapter`): the problem is always "module X can't be imported by test harness Y." The answer is always "extract the logic worth testing into a module that doesn't import X."

## When to Apply

- Any Client Component with multi-step network orchestration (upload flows, multi-step checkout, OAuth handshake, import wizards).
- Any Client Component whose failure-branch matrix is load-bearing for UX correctness (per-file failure isolation, retry eligibility, error-code-dependent copy).
- Any Client Component whose testability is currently blocked by a Node-only vitest environment + missing RTL.

Skip it (keep the logic inline in the component) when:

- The component is purely presentational — no network I/O, no multi-step state machine.
- The orchestration is a single `fetch` + toast with no error branching worth testing.
- The repo already has RTL + jsdom wired up and the team prefers component-level tests.

## Examples

### Before: untestable orchestration inside the Client Component

```tsx
"use client";
const UploadDropzone = () => {
  const onDrop = async (files: File[]) => {
    for (const file of files) {
      const sign = await fetch("/api/upload/sign", ...);
      if (!sign.ok) { toast.error("sign failed"); continue; }
      const { signedUrl, token, ... } = await sign.json();
      const put = await supabase.storage.from("documents").uploadToSignedUrl(...);
      if (put.error) { toast.error("upload failed"); continue; }
      const finalize = await fetch("/api/upload/finalize", ...);
      // ...dozens of branches, all untestable without jsdom + RTL
    }
  };
  return <div onDrop={onDrop} />;
};
```

Testing this requires jsdom, RTL, `vi.mock("@/lib/supabase/browser")`, `vi.mock` of global fetch, and manually dispatched drag events. Every test fights types and environment.

### After: pure port + thin adapter

`src/lib/upload/client-batch.ts` (pure — Node-testable):

```ts
export type UploadBatchPort = { signUpload; putToStorage; finalizeUpload; onProgress };
export const uploadOne = async (file, port) => {
  /* ...orchestration... */
};
```

`src/components/upload/UploadDropzone.tsx` (adapter — no test):

```tsx
"use client";
const port: UploadBatchPort = {
  signUpload: signUploadViaApi,
  putToStorage,
  finalizeUpload: finalizeUploadViaApi,
  onProgress: (stage, percent) => dispatch({ type: "progress", stage, percent }),
};
void Promise.allSettled(accepted.map(f => uploadOne(f, port)));
```

`src/lib/upload/client-batch.test.ts` (covers the error-branch matrix — 20+ tests, zero DOM):

```ts
it("normalizes thrown errors in signUpload to network_error and logs them", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const port = makePort({
    signUpload: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  const result = await uploadOne(makeFile(), port);
  expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "network_error" });
  expect(errorSpy).toHaveBeenCalled();
});
```

## Related

- [testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md](./testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md) — the server-side mirror of this pattern (QStash-signed route handlers).
- [multi-write-route-idempotency-and-rollback-2026-04-22.md](./multi-write-route-idempotency-and-rollback-2026-04-22.md) — consumed by this pattern: the client-side adapter relies on the server's symmetric rollback rather than implementing client-side cleanup.
- [server-only-bypass-from-node-and-vitest-2026-04-22.md](./server-only-bypass-from-node-and-vitest-2026-04-22.md) — the vitest-environment constraints that make this pattern load-bearing.
