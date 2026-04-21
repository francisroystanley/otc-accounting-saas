---
title: Open redirect via unvalidated `next` query param on Supabase email-confirm callback
date: 2026-04-22
category: security-issues
module: auth-confirm
problem_type: security_issue
component: authentication
severity: high
symptoms:
  - GET /auth/confirm?token_hash=<valid>&type=signup&next=https://evil.example returns 307 Location https://evil.example after verifyOtp succeeds
  - Phishing-via-real-confirmation-link: attacker gets the victim past OTP gate onto an attacker-controlled page
  - Internal Supabase error strings leak into browser history/logs via /login?error=<urlencoded message>
  - Confirm-route redirect to /login?error=... lands on login page that never reads the query param (dead-letter error channel)
root_cause: missing_validation
resolution_type: code_fix
tags:
  - open-redirect
  - supabase
  - verifyotp
  - nextjs-16
  - auth-callback
  - csrf-adjacent
  - csrf
  - phishing
related_components:
  - authentication
  - email_processing
---

# Open redirect via unvalidated `next` query param on Supabase email-confirm callback

## Problem

The `/auth/confirm` Route Handler read `next` directly from the query string and passed it to `redirect(next)` after a successful `supabase.auth.verifyOtp` call. Next.js's `redirect()` accepts absolute URLs, so `?next=https://evil.example` sent the user off-origin the instant the OTP exchange succeeded — turning a real confirmation email into a phishing vector.

Two secondary issues shipped alongside it:

1. Raw `error.message` from Supabase was URL-encoded into `/login?error=<msg>` — internal error strings in browser history and referrer headers, for zero user-visible benefit.
2. The login page never read the `?error` param, so every confirm-route failure silently dropped the user on a blank sign-in screen.

## Symptoms

- `curl -i 'https://app.example/auth/confirm?token_hash=<valid>&type=signup&next=https://evil.example'` returned `HTTP/1.1 307 Temporary Redirect` with `Location: https://evil.example`.
- The attack required no code on the victim's side — any link that looked like a real confirmation email (Supabase confirmation emails are indistinguishable from phishing at a glance) was sufficient.
- A user whose token was expired or malformed landed on a plain login form with no explanation. Three reviewers independently flagged the dead-letter `?error` param, confirming the silent-failure was real.
- Four independent reviewer personas (correctness, security, kieran-typescript, maintainability) converged on the same line — high-confidence finding.

## What Didn't Work

- **Leaning on Supabase's session middleware.** `proxy.ts` refreshes the session but does not validate post-OTP redirects; the open redirect is a Route Handler concern, not a middleware concern.
- **Assuming Next.js's built-in Server Action Origin check covers it.** That check runs on Server Actions, not on GET Route Handlers. `/auth/confirm` is a GET handler and is outside that protection.
- **Escape the error message into the URL.** `encodeURIComponent(error.message)` is a string-safety fix, not a security fix; the attack surface is the redirect target, not the error payload.

## Solution

Two guards in `src/app/auth/confirm/route.ts` — one for the redirect target, one for the error channel — plus a small backend change to render a stable slug instead of the raw error.

```ts
// Only accept relative, non-protocol-relative redirects.
// Blocks open-redirect via ?next=https://evil.example.
const sanitizeNextPath = (raw: string | null): string => {
  if (raw === null || raw === "" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/dashboard";
  }

  return raw;
};

export const GET = async (request: NextRequest): Promise<Response> => {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type");
  const next = sanitizeNextPath(url.searchParams.get("next"));

  if (tokenHash === null || typeParam === null || !isAllowedEmailOtpType(typeParam)) {
    redirect("/login?error=invalid_confirm_link");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: typeParam });

  if (error !== null) {
    redirect("/login?error=confirm_failed");
  }

  redirect(next);
};
```

Key properties of the sanitizer:

- `!raw.startsWith("/")` — rejects `https://evil`, `javascript:`, `data:`, and anything without a leading slash.
- `raw.startsWith("//")` — rejects protocol-relative URLs like `//evil.example/path` which browsers interpret as `https://evil.example/path`.
- Empty string and `null` short-circuit to the default.

On the login side, replace the raw error render with a small server-side allowlist that translates stable slugs into user-facing copy:

```ts
// src/app/(auth)/login/page.tsx
const CONFIRM_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_confirm_link: "That confirmation link isn't valid. Sign in or request a new one.",
  confirm_failed: "We couldn't finish verifying your email. Sign in and we'll ask you to resend the link.",
};

const readErrorMessage = (value: string | string[] | undefined): string | undefined => {
  if (value === undefined) return undefined;

  const key = Array.isArray(value) ? value[0] : value;

  if (key === undefined) return undefined;

  return CONFIRM_ERROR_MESSAGES[key];
};
```

This closes the dead-letter channel, pins the error vocabulary, and removes the leak of Supabase internals into the URL.

Also derive the allowed OTP types from Supabase's own `EmailOtpType` export instead of hand-maintaining the union:

```ts
import type { EmailOtpType } from "@supabase/supabase-js";

const ALLOWED_EMAIL_OTP_TYPES: ReadonlyArray<EmailOtpType> = [
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email",
  "email_change",
];

const isAllowedEmailOtpType = (value: string): value is EmailOtpType => {
  return ALLOWED_EMAIL_OTP_TYPES.some(allowed => {
    return allowed === value;
  });
};
```

If Supabase ever adds a new type, `ReadonlyArray<EmailOtpType>` gives the compiler a chance to catch it (though it'll still accept omissions — this is best-effort drift detection).

## Why This Works

`redirect()` in Next.js takes whatever URL-shaped string you give it and sets `Location: <value>` on the response. It does not validate the target; that's the caller's job. The privilege layer is "whatever string passes through `redirect()`," and the sanitizer narrows that layer to "relative paths only." Everything else — external URLs, protocol-relative URLs, JavaScript URIs — is rejected before `redirect()` ever sees the string.

The `?error=<slug>` change converts a free-form string channel (where internal Supabase messages could leak) into a closed-vocabulary channel (where only known slugs round-trip). This is the same pattern as CSRF tokens: you control the vocabulary, you validate on receive.

The `EmailOtpType` import is belt-and-braces. The hand-rolled union was the same list literally, but if Supabase renames `"magiclink"` to `"otp"` in a minor release, the hand-rolled guard silently breaks without a TypeScript error. Importing the union and constraining the array to `ReadonlyArray<EmailOtpType>` at least catches _rename_ drift at compile time.

## Prevention

- **Every `redirect(foo)` where `foo` comes from user input needs a sanitizer.** Query params, form inputs, referrer headers — any untrusted source. Write the guard as a pure function near the top of the file so it's hard to miss on review.
- **Audit every `?error=<msg>` pattern for URL leakage.** If the string is a human-readable error, convert to a closed-vocabulary slug. If the param is never read by the target page, delete the param entirely rather than leaving a dead-letter channel open.
- **Prefer library type exports over hand-rolled unions for security allowlists.** `EmailOtpType`, `ContentType`, etc. — whatever the library ships is more likely to stay in sync than a hand-maintained copy.
- **Multi-reviewer convergence is a high-confidence signal.** Four reviewers flagging the same line (correctness, security, kieran-typescript, maintainability) independently is stronger evidence than any single reviewer's confidence score. Treat converged findings as P0 even when individual severities vary.
- **Don't assume middleware/proxy protects Route Handlers.** The Supabase session refresh in `proxy.ts` does not validate redirects. CSRF-adjacent attacks (like open redirects) are per-handler concerns unless explicitly covered at the platform layer.

**Harness assertion to pin the fix:**

```ts
// Reject absolute URLs
expect(sanitizeNextPath("https://evil.example/foo")).toBe("/dashboard");
expect(sanitizeNextPath("//evil.example/foo")).toBe("/dashboard");
expect(sanitizeNextPath("javascript:alert(1)")).toBe("/dashboard");

// Accept legitimate relative paths
expect(sanitizeNextPath("/dashboard/overview")).toBe("/dashboard/overview");
expect(sanitizeNextPath("/workspaces/abc/documents")).toBe("/workspaces/abc/documents");

// Empty/missing → default
expect(sanitizeNextPath(null)).toBe("/dashboard");
expect(sanitizeNextPath("")).toBe("/dashboard");
```

## Related

- `docs/solutions/best-practices/supabase-clients-and-proxy-next16-2026-04-22.md` — U4 context; documents the session-refresh layer that does NOT cover this attack surface.
- `docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md` — adjacent: column-level grants as a privilege-layer defence. Same repo pattern: enumerate what's allowed, reject the rest.
- Supabase auth verifyOtp docs: https://supabase.com/docs/reference/javascript/auth-verifyotp
- Next.js redirect() docs: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`
