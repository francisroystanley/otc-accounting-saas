---
title: Testable Next.js 16 Route Handlers via DI port and thin adapter
date: 2026-04-22
category: best-practices
module: extraction
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - A Next.js 16 App Router route handler must call `server-only`-guarded modules (Supabase service-role client, Gemini SDK, or any module with `import "server-only"` at the top)
  - Project ESLint bans `any`, `as` casts (`consistent-type-assertions: never`), and non-null assertions, so `vi.mock` scaffolding and `payload as Json` shortcuts are closed
  - Real unit coverage of orchestration logic is wanted without standing up Supabase or calling the LLM
  - The route is invoked by a signed webhook (QStash, Inngest, cron) and a local-dev direct-invoke bypass is also wanted
tags:
  - next-app-router
  - server-only
  - dependency-injection
  - port-adapter
  - qstash
  - vitest
  - strict-eslint
  - typescript
related_components:
  - authentication
  - testing_framework
---

# Testable Next.js 16 Route Handlers via DI port and thin adapter

## Context

A webhook endpoint (e.g. `POST /api/extract`) needs to do real work: verify an HMAC signature, load a row from Supabase via the service-role client, download a PDF from Storage, call Gemini for structured extraction, write results back through a `SECURITY DEFINER` RPC. All three external seams (`src/lib/supabase/service.ts`, `src/lib/extraction/gemini.ts`, any adapter that imports them) declare `import "server-only"` so they cannot leak into a client bundle.

The first instinct is `route.test.ts` with `vi.mock("@/lib/supabase/service")` and `vi.mock("@/lib/extraction/gemini")`. It doesn't work here for three reasons:

1. `server-only` throws at import time in vitest's default Node environment. A `vi.mock("server-only", () => ({}))` sidesteps that, but only if nothing the route transitively imports throws first.
2. The repo's ESLint config (`@typescript-eslint/no-explicit-any: error`, `consistent-type-assertions: never`, `no-non-null-assertion: error`) means the return types of `vi.mock` factories collide with strict type checking at the first non-trivial mock.
3. `--conditions=react-server` works for CLI scripts (see [server-only-bypass-from-node-and-vitest-2026-04-22.md](./server-only-bypass-from-node-and-vitest-2026-04-22.md)) but is a Node invocation flag that does not propagate into vitest's loader or CI.

Every obvious shortcut is closed. The way out is structural.

## Guidance

Split the route into three layers. The pure layer has no `server-only` imports and is trivially testable. The adapter layer is the only place `server-only` lives. The route is a thin wrapper that wires them together.

### Layer 1 — Pure pipeline (no `server-only`)

File: `src/lib/extract/pipeline.ts`

Define a **port** interface listing exactly the operations the pipeline needs from the outside world, and export one orchestration function that depends only on the port and a pluggable extract function:

```ts
export type ExtractionDataPort = {
  loadDocument: (documentId: string) => Promise<DocumentSnapshot | null>;
  claimForProcessing: (documentId: string) => Promise<boolean>;
  downloadPdf: (storagePath: string) => Promise<Uint8Array>;
  writeResult: (
    documentId: string,
    status: FinalizedStatus,
    data: ExtractionResult | null,
    errorMessage: string | null
  ) => Promise<void>;
};

export type ExtractFn = (bytes: Uint8Array) => Promise<ExtractionResult>;

export const runExtractPipeline = async (
  deps: { port: ExtractionDataPort; extract: ExtractFn; docTypeThreshold: number },
  input: { documentId: string }
): Promise<PipelineOutcome> => {
  const document = await deps.port.loadDocument(input.documentId);
  if (document === null) return { kind: "unauthorized", reason: "document_not_found" };
  // ... workspace UUID + storage path authorization checks ...
  const claimed = await deps.port.claimForProcessing(input.documentId);
  if (!claimed) return { kind: "already_processed", status: document.status };
  // ... downloadPdf, extract, writeResult, threshold gate ...
};
```

Keep the port surface minimal — four operations, not fourteen. The smaller the port, the smaller the fake in tests.

### Layer 2 — Server-only adapter

File: `src/lib/extract/supabase-port.ts`

This is the **only** file that imports `server-only` in the extraction path. It wraps a real `SupabaseClient<Database>` and implements the port:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import type { Database, Json } from "@/lib/database.types";
import type { ExtractionDataPort, FinalizedStatus } from "@/lib/extract/pipeline";
import type { ExtractionResult } from "@/lib/extraction/types";

export const createSupabaseExtractionPort = (client: SupabaseClient<Database>): ExtractionDataPort => {
  return {
    loadDocument: async documentId => {
      /* SELECT ... maybeSingle() */
    },
    claimForProcessing: async documentId => {
      const { data } = await client
        .from("documents")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", documentId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      return data !== null;
    },
    downloadPdf: async storagePath => {
      /* storage.download -> Uint8Array */
    },
    writeResult: async (documentId, status, data, errorMessage) => {
      const dataArg: Json | undefined = data === null ? undefined : toJsonValue(data);
      await client.rpc("update_extraction_result", {
        doc_id: documentId,
        new_status: status,
        data: dataArg,
        error: errorMessage ?? undefined,
      });
    },
  };
};
```

Note the `toJsonValue` helper. `ExtractionResult` is a discriminated union; Supabase's generated RPC type wants `Json`. Under `consistent-type-assertions: never` you cannot write `value as Json`, and `JSON.parse(JSON.stringify(...))` returns `any` which trips `no-unsafe-return`. A recursive walker is the clean path:

```ts
const toJsonValue = (value: unknown): Json => {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const result: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) result[k] = toJsonValue(v);
    }
    return result;
  }
  throw new Error(`Cannot serialize value of type ${typeof value} to Json`);
};
```

### Layer 3 — Thin route adapter + named inner export

File: `src/app/api/extract/route.ts`

Zod-validates the body, builds the real port, calls the pipeline, maps `PipelineOutcome` to HTTP. Exports **both** the wrapped POST handler and the unwrapped inner function:

```ts
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { z } from "zod";
import { PipelineFailedError, runExtractPipeline } from "@/lib/extract/pipeline";
import { createSupabaseExtractionPort } from "@/lib/extract/supabase-port";
import { DOC_TYPE_THRESHOLD } from "@/lib/extraction/config";
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";

const extractRequestSchema = z.object({ documentId: z.uuid() });

export const handleExtract = async (request: Request): Promise<Response> => {
  const parsed = extractRequestSchema.safeParse(await request.json());
  if (!parsed.success) return json({ error: "invalid_payload" }, 400);

  const port = createSupabaseExtractionPort(createSupabaseServiceRoleClient());
  const outcome = await runExtractPipeline(
    { port, extract: extractFromPdfBytes, docTypeThreshold: DOC_TYPE_THRESHOLD },
    { documentId: parsed.data.documentId }
  );

  if (outcome.kind === "unauthorized") {
    const status = outcome.reason === "document_not_found" ? 404 : 403;
    return json({ error: outcome.reason }, status);
  }
  if (outcome.kind === "already_processed") return json({ status: "noop" }, 200);
  return json({ status: "ok", finalStatus: outcome.finalStatus }, 200);
};

export const POST = verifySignatureAppRouter(handleExtract);
```

The dual export is the agent-native seam. Production traffic arrives through `POST` with signature verification. Local-dev scripts, CI integration tests, and a publisher dev-bypass call `handleExtract` directly.

### Publisher dev bypass

File: `src/lib/qstash.ts`

```ts
export const publishExtract = async (documentId: string): Promise<void> => {
  if (isQstashDisabled()) {
    const { handleExtract } = await import("@/app/api/extract/route");
    const response = await handleExtract(
      new Request("http://localhost/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      })
    );
    if (response.status >= 500) {
      throw new Error(`Direct handleExtract invocation failed with status ${response.status}`);
    }
    return;
  }
  await qstashClient.publishJSON({
    url: resolveExtractEndpointUrl(),
    body: { documentId },
    flowControl: { key: "extract", parallelism: 2 },
    retries: 3,
  });
};
```

`USE_QSTASH=false` in `.env.local` drives the full code path end-to-end without QStash. Dynamic import is required because `route.ts` transitively pulls in `server-only`.

### The payoff — pipeline tests with no infrastructure mocks

File: `src/lib/extract/pipeline.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { type ExtractionDataPort, runExtractPipeline } from "@/lib/extract/pipeline";

const makePort = (store: FakeStore): ExtractionDataPort => ({
  loadDocument: async id => {
    /* in-memory */
  },
  claimForProcessing: async id => {
    /* CAS on status === "pending" */
  },
  downloadPdf: async path => {
    /* return Uint8Array from map */
  },
  writeResult: async (id, status, data, err) => {
    /* push onto array */
  },
});

it("handles simultaneous duplicate deliveries: exactly one extract, exactly one terminal write", async () => {
  const store = makeStore();
  const port = makePort(store);
  // w2Result must be typed as ExtractionResult (not a narrower literal) so the
  // factory return type satisfies ExtractFn.
  const extract: ExtractFn = vi.fn(async () => w2Result);

  const results = await Promise.allSettled([
    runExtractPipeline({ port, extract, docTypeThreshold: 0.7 }, { documentId }),
    runExtractPipeline({ port, extract, docTypeThreshold: 0.7 }, { documentId }),
  ]);

  // Narrow PromiseSettledResult before reading .value.
  const kinds = results.flatMap(r => (r.status === "fulfilled" ? [r.value.kind] : [])).sort();
  expect(kinds).toEqual(["already_processed", "complete"]);
  expect(extract).toHaveBeenCalledTimes(1);
  expect(store.documents.get(documentId)?.writes).toHaveLength(1);
});
```

15 tests cover happy paths, authorization (not-found, storage-path mismatch, non-UUID workspace), idempotent claim under concurrency, terminal states (complete/failed/needs_review), and error propagation — all with a fake port and a stubbed extract. **No** `vi.mock("server-only")`, no Supabase mocks, no Gemini mocks. Runs under `npm test` in vitest's default Node environment with no `--conditions` flag.

## Why This Matters

**What this pattern gives you:**

- Real unit coverage of orchestration logic without provisioning Supabase, QStash, or Gemini keys in test environments
- Full lint compliance — `toJsonValue` is the only place the strict-casting rule has teeth, and one explicit recursive walker is better than scattered `as Json` escape hatches
- A dev-time direct-invoke path that exercises the production route without a signed QStash hop; the dual export is the seam
- Architectural parity for agents: anything a future UI upload (U9/U10) can trigger, an agent can trigger via `npm run extract:one -- --pdf <path>` or by calling `publishExtract` with `USE_QSTASH=false`

**What this pattern does NOT solve** (hazards to track separately):

- **Stuck `processing` rows.** If the function crashes after `claimForProcessing` succeeds but before `writeResult` runs, the row is stuck — no retry can reclaim it because the idempotent claim only matches `status = 'pending'`. The pattern defers this to operational reconciliation (a cron that resets stuck `processing` rows past a TTL) or to a refactor that keeps the row `pending` until terminal write.
- **Transient vs. terminal error conflation.** Writing `status = 'failed'` on any extract error (including Gemini 429 / 503) makes QStash's retry budget useless — the next retry returns 200 no-op. Distinguish retryable errors and leave the row `pending` on those.
- **`USE_QSTASH=false` in production.** `isQstashDisabled()` is not gated on `NODE_ENV`. A misconfigured env silently skips signature verification. Add a startup assertion: `if (NODE_ENV === "production" && isQstashDisabled()) throw ...`.
- **Untested adapter.** `pipeline.test.ts` proves the orchestration is correct; `supabase-port.ts` still has zero unit tests. The port adapter is thin but not trivial (`toJsonValue`, `toDocumentStatus`, download blob-to-bytes conversion) — integration coverage or targeted adapter tests close this.

## When to Apply

Apply this pattern to any Next.js App Router endpoint that satisfies **all three** of:

1. Transitively imports a `server-only`-guarded module (Supabase service-role client, Gemini/OpenAI SDK, Stripe secret client, any internal helper with `import "server-only"`)
2. Has strict ESLint banning `any`, `as` casts, and non-null assertions — so `vi.mock` + `as unknown as T` shortcuts are closed
3. Contains enough orchestration logic (auth check, CAS write, external call, terminal write) that "just run a browser test" leaves too much uncovered

Not limited to webhooks. The same structure fits Inngest functions, Vercel Cron handlers, internal background workers, and any endpoint whose correctness hinges on orchestration between multiple external seams.

Skip the pattern when the route is one-line (`return NextResponse.json({ok: true})`) or a pure data passthrough — the indirection costs more than the test gain.

## Examples

### Before — route that inlines everything (untestable under strict lint)

```ts
// src/app/api/extract/route.ts
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import "server-only";
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service";

const handleExtract = async (req: Request) => {
  const { documentId } = await req.json(); // no Zod
  const sb = createSupabaseServiceRoleClient();
  const { data: doc } = await sb.from("documents").select("*").eq("id", documentId).single();
  // ... storage download, gemini call, rpc write inline
  return Response.json({ ok: true });
};

export const POST = verifySignatureAppRouter(handleExtract);
```

Tests require mocking `server-only`, `createSupabaseServiceRoleClient`, and `extractFromPdfBytes`. The `vi.mock` return types won't satisfy strict TS without `as`, which ESLint rejects. Net result: no tests, or tests that mock so heavily they prove nothing.

### After — three-layer split

```text
src/lib/extract/pipeline.ts          # no server-only, pure DI
src/lib/extract/pipeline.test.ts     # 15 tests, fake port, plain vitest
src/lib/extract/supabase-port.ts     # server-only lives here only
src/app/api/extract/route.ts         # thin wrapper, dual export
src/lib/qstash.ts                    # publisher + USE_QSTASH=false bypass
scripts/extract-one.ts               # dev CLI, calls handleExtract directly
```

The pipeline test file imports only from `@/lib/extract/pipeline` and `@/lib/extraction/types` — neither transitively touches `server-only`. `npm test` runs it with no config changes.

## Related

- [server-only bypass from plain Node and vitest](./server-only-bypass-from-node-and-vitest-2026-04-22.md) — the earlier learning this extends. That doc covers the CLI-harness case (`--conditions=react-server` + helper extraction). This doc is the Route-Handler counterpart; the structural insight (isolate the `server-only` import chain from the testable core) is the same, applied at a different call site. Candidate for consolidation — see note below.
- [Supabase clients and Next 16 proxy](./supabase-clients-and-proxy-next16-2026-04-22.md) — defines the three-client partition (`server`, `browser`, `service`); the adapter in Layer 2 wraps the `service` client. Explains the `server-only` + `typeof window` double-guard on that client.
- [Zod null-vs-empty-object for Gemini nullable OBJECT](./zod-null-vs-empty-object-gemini-nullable-schema-2026-04-22.md) — the `z.preprocess` normalization that produces the `ExtractionResult` the pipeline consumes. Relevant because downstream `toJsonValue` must tolerate `fields: null` on the `unknown` branch.
- [RLS cross-tenant document teleport via UPDATE](../security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md) — establishes why the service-role client must live behind `SECURITY DEFINER` functions and behind column-grant fences; Layer 2's adapter respects that boundary by routing the terminal write through `update_extraction_result` rather than a direct table UPDATE.

**Consolidation note:** The Related Docs Finder flagged moderate overlap (3/5 dimensions) with the server-only-bypass doc. Both address the same root friction (`server-only` chain blocking tests), at different call sites (CLI vs. Route Handler). Consider merging into one "Testing code that imports `server-only` modules" doc in a future `/ce:compound-refresh` pass.
