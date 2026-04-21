---
title: Supabase SSR clients and Next 16 proxy.ts scaffolding
date: 2026-04-22
category: best-practices
module: auth
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - Scaffolding Supabase SSR auth in a Next 16 app using proxy.ts (middleware replacement)
  - New Supabase projects (2026+) using asymmetric JWT signing keys
  - Repo has strict ESLint (no-non-null-assertion, consistent-type-assertions, no-unsafe-*) that bans bare casts and process.env.X!
  - Splitting server / browser / service-role Supabase clients with server-only enforcement
  - Debugging "users get logged out randomly" after a Next 15 → Next 16 migration
tags:
  - supabase
  - supabase-ssr
  - nextjs-16
  - proxy-ts
  - middleware
  - get-claims
  - service-role
  - server-only
  - eslint-strict
  - cookies
related_components:
  - tooling
  - development_workflow
---

# Supabase SSR clients and Next 16 proxy.ts scaffolding

## Context

A greenfield Next.js 16.2.4 + React 19.2.4 + Supabase SSR project needed to establish the auth foundation before any feature work. Supabase SSR with Next 16 has three known trip-points that silently break sessions:

1. Next 16 renamed `middleware.ts` to `proxy.ts` and tightened the cookie-forwarding contract — partial writes compile but silently drop sessions.
2. `cookies()` from `next/headers` is now async, which changes every call site that touches it.
3. New Supabase projects (2026+) default to asymmetric JWT signing keys, so `getClaims()` can verify locally via JWKS without a DB round-trip. Using `getUser()` reflexively hits `auth.users` on every request.

On top of that, this project's ESLint config bans `!` (non-null assertions) and all `as T` casts (`consistent-type-assertions: "never"`), which invalidates most copy-paste Supabase examples from the internet. This guidance captures the patterns that survived the constraints.

## Guidance

### 1. The proxy.ts cookie dance

`proxy.ts` lives at the repo root (not under `src/`) and runs on every matched request. Its job is to refresh the Supabase session cookie and forward it to both the downstream request (for Server Components) and the outgoing response (for the browser).

The load-bearing detail: `setAll` must write to BOTH sides, and `response` must be a `let` that gets reassigned after the write, because `NextResponse.next({ request })` snapshots the request cookies at construction time.

```ts
// proxy.ts (repo root)
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: cookiesToSet => {
        // 1) mutate the request so downstream Server Components see refreshed cookies
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // 2) reassign response so the browser receives Set-Cookie headers
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Identity-only check — verifies JWT locally via JWKS, no auth.users round-trip
  await supabase.auth.getClaims();

  return response;
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

If you skip the `response` reassignment, the response object keeps a stale snapshot of request cookies taken before `setAll` mutated them. The browser never receives the refreshed `sb-*` cookies, and the next navigation logs the user out.

### 2. Three-client partitioning is a security boundary

Each client has a different trust level and must live in its own module. Never re-export one from another; never let a component import the wrong one.

```ts
// src/lib/supabase/server.ts — Server Components, Route Handlers, Server Actions
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies(); // async in Next 16

  return createServerClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: cookiesToSet => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can read but not write cookies.
          // proxy.ts will refresh the session on the next request; swallow is intentional.
        }
      },
    },
  });
};
```

```ts
// src/lib/supabase/browser.ts — Client Components only
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";

let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export const createSupabaseBrowserClient = () => {
  if (cachedClient !== null) {
    return cachedClient;
  }

  cachedClient = createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey());

  return cachedClient;
};
```

```ts
// src/lib/supabase/service.ts — admin operations, webhooks, background jobs
import { createClient } from "@supabase/supabase-js";
import "server-only";
// build-time guard: importing from a Client Component fails the build

import type { Database } from "@/lib/database.types";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/env";

// Runtime belt-and-braces: if something ever bundles this into a client chunk, fail loud.
if (typeof window !== "undefined") {
  throw new Error("@/lib/supabase/service must only be imported from server code.");
}

export const createSupabaseServiceRoleClient = () => {
  return createClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};
```

The two guards — `import "server-only"` and `typeof window` — are not redundant. The first fails the build if a Client Component imports this module. The second catches the edge case where a shared utility pulls it into a chunk that ends up on the wire anyway.

### 3. `getClaims()` vs `getUser()`

New Supabase projects (post-2026) default to asymmetric JWT signing keys. `getClaims()` fetches the JWKS once, caches it, and verifies the access token locally. No DB round-trip.

```ts
// Identity-only path (proxy.ts, route guards, "is there a session" checks)
const { data } = await supabase.auth.getClaims();

if (data === null || typeof data.claims.sub !== "string") {
  return null;
}

const userId = data.claims.sub;

// Full user path — use only when you need a live auth.users read
// (e.g., checking is_anonymous, email_confirmed_at, app_metadata that might have changed)
const { data: live } = await supabase.auth.getUser();
```

Rule of thumb: if you only need `sub` or a role claim, use `getClaims()`. If you reflexively call `getUser()` in proxy.ts, you add a DB round-trip to every authenticated request.

```ts
// src/lib/auth/require-auth.ts
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthenticatedContext = {
  userId: string;
  workspaceId: string;
};

export const getAuthenticatedContext = async (): Promise<AuthenticatedContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError !== null || claimsData === null) {
    return null;
  }

  const userId = claimsData.claims.sub;

  if (typeof userId !== "string" || userId === "") {
    return null;
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membership === null) {
    return null;
  }

  return { userId, workspaceId: membership.workspace_id };
};
```

Helper returns `null` instead of redirecting or throwing, so Server Components can call `redirect('/login')` and Route Handlers can return `Response.json(..., { status: 401 })` — each context decides its own failure mode.

### 4. The env.ts escape hatch for strict ESLint

With `no-non-null-assertion` and `consistent-type-assertions: "never"` enabled, this breaks lint:

```ts
// Rejected: non-null assertion
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

// Rejected: type assertion
const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
```

Solution: a tiny helper that narrows via `if`-throw and returns typed strings. Every call site gets a real string and lint stays green.

```ts
// src/lib/env.ts
const readEnv = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];

  return value === undefined || value === "" ? undefined : value;
};

export const getSupabaseUrl = (): string => readEnv("NEXT_PUBLIC_SUPABASE_URL");

export const getSupabasePublishableKey = (): string =>
  readOptionalEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export const getSupabaseServiceRoleKey = (): string => readEnv("SUPABASE_SERVICE_ROLE_KEY");
```

The optional-fallback pattern on the publishable key reflects Supabase's 2026 rename: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the forward-looking name but `NEXT_PUBLIC_SUPABASE_ANON_KEY` still works. Reading both keeps the helper portable across older `.env.local` files that predate the rename.

### 5. Same-origin check for mutating routes

```ts
// src/lib/auth/origin-check.ts
import "server-only";

const buildAllowedOrigins = (): string[] => {
  const origins = new Set<string>();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelUrl = process.env.VERCEL_URL;
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (siteUrl !== undefined && siteUrl !== "") origins.add(siteUrl.replace(/\/$/, ""));
  if (vercelUrl !== undefined && vercelUrl !== "") origins.add(`https://${vercelUrl}`);
  if (prodUrl !== undefined && prodUrl !== "") origins.add(`https://${prodUrl}`);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return Array.from(origins);
};

export const isSameOriginRequest = (request: Request): boolean => {
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin === null) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  return buildAllowedOrigins().includes(origin);
};
```

Call this in Route Handlers that mutate state, before you trust a cookie-based session. CSRF defence in depth on top of SameSite cookies.

## Why This Matters

**Session drops are silent.** If `setAll` writes to only the request or only the response, the user stays logged in for the current request and then gets logged out on the next navigation. There is no error, no console warning, no failing test — just users reporting "it logged me out randomly." The `let response` + reassignment pattern is the difference between a working auth system and a flaky one.

**Service-role leaks end careers.** The service-role key bypasses RLS. If it ends up in a client bundle — via an accidental import, a misconfigured `"use client"` boundary, or a shared utility — anyone viewing your site can read and write every row in the database. The two-layer guard (`import "server-only"` + runtime `typeof window` throw) exists because one layer is not enough; build-time checks miss dynamic imports and runtime checks miss tree-shaken dead code. See the companion learning on RLS column grants (`docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md`) for the downstream blast radius.

**`getUser()` in a hot path is a stealth performance regression.** Each call is a round-trip to `auth.users`. In proxy.ts, which runs on every matched request, that's one extra DB query per page load per user. On a busy page it's the difference between p95 of 40ms and p95 of 200ms. `getClaims()` verifies locally and the JWKS is cached across requests.

**Strict ESLint catches real bugs.** `no-non-null-assertion` and `consistent-type-assertions` look pedantic until you realize they force you to write code that actually validates its inputs. The `env.ts` helper throws at startup with a named variable — not at 3am with a cryptic `TypeError: Cannot read properties of undefined`.

**The `try/catch` in server.ts `setAll` is not defensive coding, it is the contract.** Server Components are explicitly not allowed to write cookies. If you don't swallow that throw, every Server Component that touches Supabase crashes. The refresh happens in proxy.ts on the next request; that's by design.

## When to Apply

- **Starting a new Next 16 + Supabase project.** This is the baseline; copy the structure before writing any route or component.
- **Migrating a Next 15 app to Next 16.** The `middleware.ts` → `proxy.ts` rename is mechanical but the async `cookies()` change is invasive — every server client creation site needs `await`.
- **Debugging "users get logged out randomly" reports.** First suspect is an incomplete `setAll` in proxy.ts. Second suspect is a Server Component creating a server client without the `try/catch` in `setAll`.
- **Reviewing a PR that imports from `@/lib/supabase/service`.** The importing file must be a Route Handler, Server Action, or server-only utility — never a Client Component, never a file without a clear server boundary.
- **Auditing auth latency.** Grep for `getUser()` in proxy.ts and middleware-equivalent paths. Replace with `getClaims()` unless the code genuinely needs a live `auth.users` read.
- **Onboarding a new engineer to the codebase.** Point them at `env.ts` first so they understand why there are no `process.env.X!` calls.

## Examples

### Before: Next 15 middleware.ts

```ts
// middleware.ts (Next 15, synchronous cookies, getUser in hot path)
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // BUG: only writes to response, not to request — Server Components see stale cookies
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // DB round-trip on every request
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Problems with the above, from top to bottom:

- Filename `middleware.ts` is deprecated in Next 16.
- `function middleware` — project style in this repo is arrow functions.
- `process.env.X!` — fails `no-non-null-assertion`.
- `setAll` writes only to `response`, not to `request`. Downstream Server Components see stale cookies.
- `response` is `const`, so even if you fixed the above, you can't reassign it after the write.
- `getUser()` hits `auth.users` on every request when `getClaims()` would do.

### After: Next 16 proxy.ts

The final `proxy.ts` shown in section 1 fixes every line-item above: renamed file, arrow function, `env.ts` helper, both sides of cookie dance, `let` + reassignment, `getClaims()` in place of `getUser()`. The migration is a one-line function rename plus a one-call API swap — both mechanical, both silent failure modes if you get them wrong.

### Before: Server Component creating a client inline (don't do this)

```tsx
// app/dashboard/page.tsx
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export default async function Dashboard() {
  const cookieStore = cookies(); // Next 15 — sync
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: cookiesToSet => {
          // Crashes in a Server Component — cookies can't be written here
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );
  const { data } = await supabase.auth.getUser();

  return <div>Hello {data.user?.email}</div>;
}
```

### After: use the shared helper

```tsx
// app/dashboard/page.tsx
import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Dashboard = async () => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("workspaces").select("name").eq("id", auth.workspaceId).single();

  return <div>Hello {data?.name ?? "workspace"}</div>;
};

export default Dashboard;
```

One import for the auth check, redirect-on-unauth handled, client creation centralized, `setAll` throws are swallowed correctly in `server.ts`, and the identity check uses `getClaims()` under the hood.

## Related

- `docs/solutions/best-practices/nextjs-supabase-shadcn-scaffolding-defaults-2026-04-21.md` — U1/U2 scaffolding gotchas (ESLint `consistent-type-assertions`, tsconfig target, devDependencies). Adjacent stack, no overlap on auth.
- `docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md` — U3 RLS column-grant fix. Explains the blast radius that makes service-role partitioning in this doc load-bearing.
- Next 16 docs in-repo: `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
- Supabase prompt for Next.js auth (Next-16-ready): `https://github.com/supabase/supabase/blob/master/examples/prompts/nextjs-supabase-auth.md`.
