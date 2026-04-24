---
title: Supabase SDK methods can throw — port adapters must catch, not just unwrap { error }
date: 2026-04-24
category: best-practices
module: auth
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - Wrapping a Supabase SDK call behind a port/adapter interface for testability
  - Any `supabase.auth.*` method that makes a network hop (exchangeCodeForSession, signInWithPassword, verifyOtp, refreshSession)
  - Route handlers that map port results to a `redirect()` and rely on friendly error-slug routing
related_components:
  - auth-callback
tags:
  - supabase
  - port-adapter
  - error-handling
  - oauth
  - exchangecodeforsession
  - testability
  - nextjs-16
---

# Supabase SDK methods can throw — port adapters must catch, not just unwrap `{ error }`

## Context

The repo uses a port/adapter pattern to keep route handlers testable without mocking the Supabase SDK (see `src/lib/upload/sign.ts` as the canonical example). The pattern looks like this:

```ts
// Pure handler — takes a port, returns a string decision.
export const resolveOAuthCallback = async (request: Request, port: OAuthCallbackPort): Promise<string> => {
  const result = await port.exchangeCodeForSession(code);
  if (!result.ok) return "/login?error=oauth_exchange_failed";
  return sanitizeNextPath(...);
};

// Route handler — constructs the real port inline and maps the decision to redirect().
export const GET = async (request: NextRequest): Promise<Response> => {
  const supabase = await createSupabaseServerClient();
  const port: OAuthCallbackPort = {
    exchangeCodeForSession: async code => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return error === null ? { ok: true } : { ok: false };
    },
  };
  const target = await resolveOAuthCallback(request, port);
  redirect(target);
};
```

This looks airtight. Tests inject fake ports returning `{ ok: true }` or `{ ok: false }`, the pure handler's every branch passes, and the route handler is a trivial wrapper. But there's a third outcome the tests can't observe: **the SDK can throw.**

## Guidance

**Wrap every Supabase SDK call inside a port adapter in try/catch, and collapse thrown errors into the same `{ ok: false }` return shape you use for the documented error path.**

```ts
// ✅ Correct — catches throws as well as documented errors.
const port: OAuthCallbackPort = {
  exchangeCodeForSession: async code => {
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return error === null ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  },
};
```

Without the catch:

```ts
// ❌ Wrong — passes every unit test, fails silently in production.
const port: OAuthCallbackPort = {
  exchangeCodeForSession: async code => {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error === null ? { ok: true } : { ok: false };
  },
};
```

If `exchangeCodeForSession` throws (network partition, Supabase project paused on free tier, unexpected SDK panic, `_acquireLock` timeout), the exception propagates through the pure handler's uncaught `await`, through the route handler's `redirect()` call that was never reached, and out to Next.js. Next.js renders its generic 500 page. The user never sees your friendly `/login?error=oauth_exchange_failed`.

## Why this matters

**The port/adapter pattern creates a false sense of safety.** Your tests mock the port, so they exercise the `{ ok: true }` and `{ ok: false }` branches exhaustively. The test suite is green. But the real port — the one that actually talks to Supabase — has a third runtime behavior the mocks can't surface: **throwing**.

The Supabase JS SDK's contract on most `auth.*` methods is "return `{ data, error }`, where `error` is an `AuthError` or `null`." This is documented and reliable for the common failure cases (invalid credentials, expired tokens, revoked codes). But the SDK also:

- Wraps network calls in `fetch`, which can throw on DNS resolution, connection refused, or timeout.
- Uses internal `_acquireLock` timeouts that raise non-`AuthError` exceptions.
- Has occasionally panicked on malformed responses from the auth server.

None of these produce an `{ error }` return shape. They throw. The adapter either catches or leaks.

**This session caught it during multi-persona code review** — three independent reviewers (correctness, reliability, adversarial) converged on the same finding from different angles. Cross-reviewer agreement is the signal that made it a P1 autofix. A single reviewer flagging it would have been a P2 "consider wrapping in try/catch." Three reviewers independently reaching the same conclusion means the issue is real and non-obvious enough that people reading the code miss it.

## When to apply

Every port adapter that wraps a Supabase SDK method that makes a network call. Conservatively: **every `supabase.auth.*` method**, since the SDK's internal transport is opaque.

Specifically in this codebase:

- `src/app/auth/callback/route.ts` — `exchangeCodeForSession` (done, this doc's example)
- `src/app/auth/confirm/route.ts` — `verifyOtp` (TODO — same pattern, same throw risk)
- `src/app/actions/auth.ts` — `signInWithPassword`, `signUp`, `signOut` (server actions, not port-adapted yet; if they ever are, same rule)

Don't apply the rule to pure computation inside the port (e.g. a port method that only reads a cookie jar or formats a URL). The rule is specifically for I/O-bound SDK calls.

## Examples

### Test the throw path, not just the return-value paths

A regression test should fail if the try/catch is ever removed. The test injects a port whose `exchangeCodeForSession` rejects (throws asynchronously), and asserts the handler still returns the friendly slug rather than propagating the throw:

```ts
// src/lib/auth/oauth-callback.test.ts
it("routes to oauth_exchange_failed when exchange throws (not just returns { error })", async () => {
  const port: OAuthCallbackPort = {
    exchangeCodeForSession: vi.fn().mockRejectedValue(new Error("network")),
  };

  // Note: the THROW happens in the real route adapter's try/catch, not in the pure handler.
  // To regression-test the route adapter, spin up the Next request and assert on the 307 → /login
  // via a browser-test probe (curl -o /dev/null -w %{redirect_url} ...).
});
```

In practice, a live-server curl probe catches this cheaply:

```bash
# Bogus code should produce a friendly redirect, not a 500.
$ curl -s -o /dev/null -w "HTTP %{http_code} -> %{redirect_url}" "http://127.0.0.1:3000/auth/callback?code=abc"
HTTP 307 -> http://127.0.0.1:3000/login?error=oauth_exchange_failed
```

This probe is the canonical smoke test for the full pipeline (route handler → real Supabase SDK → port adapter → pure handler → redirect) and exercises the catch-path on every run because `exchangeCodeForSession("abc")` against a real Supabase project will reject the code — sometimes with `{ error }`, sometimes with a throw depending on the SDK version. Either way, the user gets the right slug.

### Don't widen the error type to preserve the cause — unless you need to

It's tempting to change `OAuthExchangeResult = { ok: true } | { ok: false; cause: unknown }` so the catch path can forward the `cause` to a logger. Resist this unless you actually have a logger to forward to. In this codebase today, the server-side logging stack isn't wired up and the closed-vocabulary slug pattern is the user-facing contract — adding `cause` creates a type obligation that no caller consumes. If/when a server logger is added, widen the type at that point in a single commit that also adds the logger call.
