---
title: Invoking a `server-only`-guarded module from plain Node or vitest
date: 2026-04-22
category: best-practices
module: extraction
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - A module imports `"server-only"` to prevent accidental inclusion in the client bundle (e.g., a Supabase service-role client or a Gemini extraction helper)
  - You need to invoke that same module from a plain Node script (e.g., a fixture harness, a seed script, a one-off CLI)
  - You need to unit-test pure helpers that live in — or share a file with — a `server-only`-guarded module via vitest / jest / tsx
  - A module resolution error like `This module cannot be imported from a Client Component module` surfaces from `node_modules/server-only/index.js` when running outside a Next.js RSC runtime
tags:
  - server-only
  - react-server
  - vitest
  - tsx
  - node-conditions
  - nextjs-16
  - extraction-harness
related_components:
  - authentication
  - tooling
---

## Context

The `server-only` npm package throws at import time unless Node resolves it via the `react-server` export condition. Inside a Next.js RSC build, the bundler sets that condition automatically and picks the package's empty-module entry. Everywhere else — plain `node`, `tsx`, `vitest`, `jest`, test runners, standalone scripts — `server-only` resolves to its default export, which throws:

```
Error: This module cannot be imported from a Client Component module.
It should only be used from a Server Component.
    at Object.<anonymous> (node_modules/server-only/index.js:1:7)
```

This matters on this project because several modules are intentionally server-only (`src/lib/extraction/gemini.ts`, `src/lib/supabase/service.ts`). U7 (the extraction-accuracy harness in `scripts/extract-report.ts`) needs to call `extractFromPdfBytes` from plain Node, and vitest needs to import pure helpers that live alongside it — both hit the guard.

## Guidance

Two complementary fixes, applied together:

### 1. Pass `--conditions=react-server` to Node when the script genuinely needs the server-only module

This is the right fix for CLI entry points (harnesses, seed scripts, one-offs) that actually execute server code:

```json
// package.json
{
  "scripts": {
    "extract:report": "node --conditions=react-server --env-file=.env.local --import tsx scripts/extract-report.ts"
  }
}
```

The flag tells Node's module resolver to prefer the `"react-server"` entry in a package's `exports` condition map. For `server-only`, that points at an empty stub instead of the throw-on-load default. The module "loads" successfully, its sentinel does nothing, and imports of the real server module succeed.

**Always pair the flag with an explanatory file-level comment at the top of the script** so a future reader doesn't read the flag as "telling Node this is a server context" — it isn't, it's telling the module resolver which export condition to pick.

```ts
// scripts/extract-report.ts
// Extraction-accuracy harness. See fixtures/README.md for fixture shape.
//
// The npm script passes `--conditions=react-server` so Node resolves the
// `server-only` module (imported by src/lib/extraction/gemini.ts) to its
// empty stub instead of its throw-on-load default. The harness runs in plain
// Node, not a Next.js RSC runtime — the condition flag is the intentional
// bypass, not a claim that this is a server context.
```

### 2. Extract pure helpers into a separate module so vitest can unit-test them without touching the guarded import

The `--conditions=react-server` flag is a runtime flag, not a vitest config knob. Tests run through vitest's own loader and will hit the guard as soon as they transitively import the server-only module. The fix is structural: move the pure, testable helpers into a file that has zero dependency on the server-only chain.

```text
scripts/
  extract-report.ts            # imports gemini.ts (server-only) — only runnable via the npm script
  extract-report-helpers.ts    # pure helpers — safe to import from vitest
  extract-report.test.ts       # imports only helpers, never gemini.ts
```

The main harness re-imports the helpers from the sibling module:

```ts
// scripts/extract-report.ts
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import { type FieldComparison, isBlankBaseline, parseGroundTruth, thresholdSweep } from "./extract-report-helpers";

// server-only, fine at CLI runtime
```

Vitest picks them up with the extended include pattern:

```ts
// vitest.config.ts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
```

## Why This Matters

- **The flag alone is not enough** — it only works at the entry-point invocation (the npm script). It does not propagate to vitest, to `next build`, or to an IDE that runs a test file directly. Any testable code that lives inside the server-only import graph is untestable by default.
- **The extraction alone is not enough** — the harness entry point still needs to call the real server code. Without the flag, the CLI script fails the moment `extractFromPdfBytes` is imported.
- **Mislabeling leads to worse bugs than no protection** — removing `import "server-only"` from a module "to make it work with the harness" defeats the purpose of the guard, and the next person who accidentally imports it from a client component won't find out until runtime. Keep the guard; bypass the resolver.

## When to Apply

- Adding a new CLI script that needs to call any module in `src/lib/extraction/`, `src/lib/supabase/service.ts`, or any other file with `import "server-only"` at the top.
- Writing unit tests for a helper that currently sits next to a server-only import — extract the helper first.
- Debugging a `This module cannot be imported from a Client Component module` error from a Node script, vitest run, or standalone tsx invocation.
- Onboarding: a reviewer asking "why does this npm script have `--conditions=react-server`?" is expected — the comment at the top of the script should already answer it.

## Examples

Before (fails at import time under vitest):

```ts
// scripts/extract-report.ts
import { extractFromPdfBytes } from "@/lib/extraction/gemini";

export const parseGroundTruth = (raw: unknown): GroundTruth => {
  /* pure */
};
export const thresholdSweep = (comparisons: FieldComparison[]): SweepRow[] => {
  /* pure */
};
```

```ts
// scripts/extract-report.test.ts
import { parseGroundTruth } from "./extract-report";

// ❌ vitest run → Error: This module cannot be imported from a Client Component module.
```

After (vitest passes; CLI still works via the npm script):

```ts
// scripts/extract-report-helpers.ts  — no server-only import in the chain
export const parseGroundTruth = (raw: unknown): GroundTruth => {
  /* pure */
};
export const thresholdSweep = (comparisons: FieldComparison[]): SweepRow[] => {
  /* pure */
};
```

```ts
// scripts/extract-report.ts
import { extractFromPdfBytes } from "@/lib/extraction/gemini";
import { parseGroundTruth, thresholdSweep } from "./extract-report-helpers";

// OK: flag handles this at CLI time
```

```ts
// scripts/extract-report.test.ts
import { parseGroundTruth, thresholdSweep } from "./extract-report-helpers";

// ✓ vitest run — helpers load without touching gemini.ts
```

```json
// package.json — flag is on the CLI entry point
"extract:report": "node --conditions=react-server --env-file=.env.local --import tsx scripts/extract-report.ts"
```

## Related U7 Learnings (smaller but worth remembering)

Two additional gotchas surfaced during U7 that are small enough to fold in here:

**Gemini 3 Flash Preview reports `confidence: 1.00` on blank form boxes.** When a field is unfilled on the source PDF, Gemini returns the correct value (empty string / zero) _and_ reports full confidence. This means a threshold sweep over a blank-fixture baseline shows zero flagged fields and no useful precision/recall signal. The accuracy number looks great (100%) and tells you nothing about extraction quality. When building an LLM-vision accuracy harness, annotate the report banner with a `Baseline-only` warning whenever every ground-truth value is empty/zero, and defer threshold recommendations until filled fixtures are curated. Field-level mean confidence is a useful sanity check at the top of the report.

**Inclusive ±$0.01 tolerance needs FP slop.** `Math.abs(12345 - 12345.01)` in JavaScript is not exactly `0.01` — it's `0.010000000000218279` on typical hardware. A `<= 0.01` check fails the boundary value users expect to pass ("within one cent"). Add a small epsilon to the tolerance: `Math.abs(a - b) <= TOLERANCE + 1e-10`. Don't loosen the tolerance itself (a reader who sees `0.0101` will wonder what the extra 0.0001 is for) — keep the human-meaningful constant and add a named `FP_EPSILON` next to it with a one-line comment explaining the boundary case.
