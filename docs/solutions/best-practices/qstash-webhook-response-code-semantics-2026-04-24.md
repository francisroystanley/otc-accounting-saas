---
title: QStash webhook response-code semantics — 2xx = delivery done, 5xx = retry
date: 2026-04-24
module: extraction
tags: [qstash, webhook, retry, idempotency, cost-bound]
problem_type: best_practice
component: api-route
category: best-practices
---

# QStash webhook response-code semantics — 2xx = delivery done, 5xx = retry

## Context

Upstash QStash uses at-least-once delivery. It retries any non-2xx response up to the `retries` value configured at publish time (`retries: 3` in `src/lib/qstash.ts`). A webhook handler that wraps an expensive downstream call (Gemini, a third-party API, a costly job) must pick its response code with queue semantics in mind, not HTTP semantics in isolation.

The trap: if the handler has already **durably recorded** the outcome of a failed operation (e.g., written `status = 'failed'` to the DB), returning HTTP 500 for the logical failure asks QStash to redeliver — which reruns the same expensive call and produces the same failure. On a deterministically broken input (torn PDF, malformed payload, permanent 4xx from the upstream), `retries: 3` multiplies the cost by 4 for zero recovery value.

## Guidance

Match the response code to the question QStash is asking: **"Was this delivery successfully processed?"** — not to the question "Did the underlying operation succeed?"

- **Return 2xx** when the handler ran to completion, even if the operation logically failed, _and_ the failure is durably recorded so nothing is lost. Include a structured body (`{ status: "failed", reason: "<code>", ... }`) so log-based tooling can still distinguish success from failure.
- **Return 5xx** only for genuinely transient failures where a fresh delivery attempt could succeed — DB momentarily unreachable, network hiccup, uncaught panic. Let these flow through via the default Next.js 500 path so QStash's retry budget is preserved for failures that benefit from retry.
- **Be disciplined about which exceptions become 2xx.** If upstream errors (e.g., Gemini 503) are wrapped into the same exception type as deterministic failures, all of them collapse into the 2xx branch and lose queue-level retry. Either distinguish at the wrap site (separate typed exceptions for transient vs. deterministic) or accept the cost and provide a user-initiated retry path as the recovery mechanism.

## Why This Matters

QStash's `retries: N` is a budget allocated _per message_. Every deterministic failure that goes to 500 burns the entire budget re-running the same expensive call. On a pathological input, the cost multiplier is `N + 1` (initial delivery + N retries).

Cost impact on this project: `/api/extract` failing on a broken PDF previously burned 4 Gemini calls per user upload. After the fix, 1 call. Per-document ceiling with `retry_count` cap of 10: was 40 calls (10 × 4), now 10.

Observability cost: flipping 500 → 200 means HTTP-status-based alerting stops firing on extraction failures. Compensate by logging a structured marker (`outcome=extraction_failed`) so log-based tooling can still query failure rate without relying on the response code.

## When to Apply

- Webhook handler receives messages from QStash (or any at-least-once queue with similar retry semantics — AWS SQS, Cloudflare Queues, etc.).
- The handler invokes a costly downstream operation (AI inference, paid third-party API, long-running job).
- Failure outcomes are (or can be) durably recorded before the response is returned.
- The failure mode is deterministic or at-least-once retry wouldn't help — the same input will produce the same failure.

Do NOT apply when:

- The failure is clearly transient and a retry has meaningful chance of success.
- The operation is idempotent and cheap, so retries are free.
- You haven't durably recorded the failure — in that case 5xx is correct because 2xx would silently drop the outcome.

## Examples

**Before (QStash retries burn the budget):**

```ts
// src/app/api/extract/route.ts
} catch (error) {
  if (error instanceof PipelineFailedError) {
    console.error(`[extract] extraction failed for document ${documentId}:`, error);
    return json({ error: "extraction_failed", documentId }, 500);
    // QStash sees 500 → redelivers up to 3 more times
    // Each redelivery runs Gemini again → 4× cost on a broken PDF
  }
  throw error;
}
```

**After (handler owns the outcome; QStash moves on):**

```ts
// src/app/api/extract/route.ts
} catch (error) {
  if (error instanceof PipelineFailedError) {
    console.error(
      `[extract] outcome=extraction_failed documentId=${documentId}`,
      error
    );
    // The pipeline already wrote status='failed' via writeResult before throwing.
    // Return 200 so QStash treats the delivery as done and does not burn the
    // retries:3 budget on a deterministic failure.
    return json({ status: "failed", reason: "extraction_failed", documentId }, 200);
  }
  throw error;   // Non-PipelineFailedError (transient infra) still hits 500 → QStash retries
}
```

**Structural log marker (so 200-failed is still queryable):**

The `outcome=extraction_failed` in the log line lets Vercel/Datadog/Cloudwatch queries filter extraction failures without relying on HTTP status. Use a stable string prefix so the query pattern is durable.

**Related pattern — distinguishing transient from deterministic at the wrap site:**

```ts
// Idea: instead of collapsing all Gemini errors into ExtractionError,
// classify at the SDK boundary so the handler can decide:
try {
  result = await client.models.generateContent(...);
} catch (err) {
  if (isTransient(err)) {          // e.g., HTTP 503, 429, timeout
    throw new TransientGeminiError(err);   // escapes as 500 → QStash retries
  }
  throw new ExtractionError("sdk_error", err);  // → 200, user-initiated retry
}
```

This refinement is a follow-up — the default 2xx-for-all-PipelineFailedError path costs one user click on a genuine transient failure, which is an acceptable tradeoff for most demo/early-stage products.

## Origin

- Plan: `docs/plans/2026-04-24-005-feat-retry-p1-hardening-plan.md` Unit 1
- Commit: `feat/retry-p1-hardening@1219f44`
- Parent plan: `docs/plans/2026-04-24-004-feat-pdf-retry-mechanism-plan.md`
