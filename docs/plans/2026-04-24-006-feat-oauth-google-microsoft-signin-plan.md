---
title: "feat: Add Google + Microsoft OAuth one-click sign-in"
type: feat
status: active
date: 2026-04-24
---

# feat: Add Google + Microsoft OAuth one-click sign-in

## Overview

Add "Continue with Google" and "Continue with Microsoft" buttons to the existing login and signup cards so first-time and returning users can authenticate without typing an email/password. Wiring lives on top of the Supabase SSR stack already in the repo: the browser client initiates the PKCE flow via `signInWithOAuth`, a new `/auth/callback` route handler exchanges the code for a session, and the existing `handle_new_user` trigger auto-creates a workspace + `workspace_members` row for first-time OAuth users — no schema migration required.

**Short answer to the framing question** ("is it easy?"): yes, for this codebase specifically. Supabase does the provider plumbing, the three-client partitioning and cookie dance (`proxy.ts`) already exist, the onboarding trigger already fires on OAuth signups, and the `sanitizeNextPath` open-redirect sanitizer is already written. The non-trivial work is (1) the two provider configurations (Supabase Dashboard + `supabase/config.toml`), (2) Azure tenant choice (single vs common), and (3) redirect-URL allowlists across localhost / Vercel previews / production.

## Problem Frame

Email + password is the only current auth path (`src/app/(auth)/login/LoginForm.tsx:15`, `src/app/actions/auth.ts`). Typing credentials is friction for a demo-grade prototype aimed at accounting professionals; "Continue with Google / Microsoft" is the expected affordance for a SaaS and removes the password-management burden for users trying the product for the first time. Both providers are high-value for the target audience (Google Workspace and Microsoft 365 are ubiquitous among bookkeepers / accountants).

## Requirements Trace

- R1. A user can click "Continue with Google" from `/login` or `/signup` and land on `/dashboard` with an authenticated session.
- R2. A user can click "Continue with Microsoft" from `/login` or `/signup` and land on `/dashboard` with an authenticated session.
- R3. First-time OAuth users are auto-onboarded: `handle_new_user` creates a workspace named `"<email>'s Workspace"` and inserts the `workspace_members` row; the user lands on `/dashboard` with a working `workspaceId` (R1, R2 imply this).
- R4. OAuth failures (user cancels, provider error, state/code exchange fails) redirect to `/login?error=<slug>` with a human-readable message rendered from a closed-vocabulary allowlist — never raw provider error text.
- R5. The OAuth callback refuses open-redirects via `?next=` (reuse `sanitizeNextPath`).
- R6. The existing email/password flow continues to work unchanged.
- R7. Provider credentials are managed via env vars (not checked in); `.env.example` documents them.
- R8. Both providers work in local dev (`http://127.0.0.1:3000`) and production (Vercel URL).

## Scope Boundaries

- No new `profiles` table. OAuth metadata (avatar, display name) stays in `auth.users.raw_user_meta_data` and is not surfaced in the UI yet.
- No account-linking (users with both an email/password account and a Google account under the same email will end up with two separate `auth.users` rows — this is Supabase's default behavior; fixing it is out of scope).
- No additional providers (Apple, GitHub) — only Google and Microsoft.
- No sign-in button on `TopNav` or any app-shell page. OAuth entry points are the login and signup pages only.
- No changes to the email-confirm route (`src/app/auth/confirm/route.ts`).
- No E2E browser test for the OAuth round-trip (the providers' real flows are brittle to automate and out of scope for this slice). Unit tests for the callback handler and the sanitizer suffice.

### Deferred to Separate Tasks

- **Account linking / merging for same-email multiple providers**: future task if duplicate-account confusion becomes a support issue.
- **OAuth in E2E browser tests**: deferred until there is a documented fixture pattern (the `browser-test-harness-for-auth-gated-downloads` solution doc notes password-fallback users are the current recommendation).
- **Profiles table with avatar/full_name**: deferred until UI needs to display user identity beyond email.

## Context & Research

### Relevant Code and Patterns

- `src/app/auth/confirm/route.ts` — exact template for the new OAuth callback route. Contains `sanitizeNextPath` (lines 22-28) to be extracted into a shared helper and closed-vocabulary error slug handling.
- `src/lib/supabase/browser.ts` — `createSupabaseBrowserClient()`; OAuth initiates from the browser so the PKCE `code_verifier` cookie is written by the SDK.
- `src/lib/supabase/server.ts` — `createSupabaseServerClient()`; used in the callback route for `exchangeCodeForSession`.
- `proxy.ts` (repo root, not `src/`) — the Next 16 middleware replacement. Already refreshes session cookies on every matched request; no change needed, but OAuth's cookie persistence depends on this working correctly.
- `src/app/(auth)/login/page.tsx:5-8` — `LOGIN_ERROR_MESSAGES` map; extend with OAuth error slugs.
- `src/app/(auth)/login/LoginForm.tsx` and `src/app/(auth)/signup/SignupForm.tsx` — shadcn `Card`/`CardContent` shells; OAuth buttons go inside the existing card, above the email/password form, separated by a `<Separator />` with "or continue with email" label.
- `src/components/ui/separator.tsx` — reuse for the divider.
- `src/lib/env.ts` — `getPublicBaseUrl()` already computes the right base for `redirectTo`. No new env helper needed on the app side; provider secrets live in `supabase/config.toml` env substitution and are not read by Next.
- `src/lib/auth/require-auth.ts` — `getAuthenticatedContext()` uses `getClaims()`; post-OAuth-sign-in navigation goes through this path unchanged.
- `supabase/migrations/20260421000003_workspace_autocreate_trigger.sql` and `...14_handle_new_user_trigger_guard.sql` — the `handle_new_user` trigger already provisions workspace + member on any `auth.users` INSERT; OAuth signups trigger it automatically.
- `supabase/config.toml` — `[auth]` section + provider blocks live here. Google and Azure blocks will be added; `additional_redirect_urls` needs the `/auth/callback` variants.

### Institutional Learnings

- `docs/solutions/security-issues/open-redirect-via-next-query-param-supabase-verify-otp-2026-04-22.md` — directly transferable: `redirect(nextParam)` without sanitization is an open-redirect. Reuse `sanitizeNextPath` verbatim in the callback. Use closed-vocabulary error slugs; never forward provider `error_description`.
- `docs/solutions/best-practices/supabase-clients-and-proxy-next16-2026-04-22.md` — load-bearing doc for any auth work. OAuth PKCE depends on the `setAll` cookie dance in `proxy.ts` (the `let response = NextResponse.next({ request })` reassignment after cookie write). `cookies()` is async in Next 16.
- `docs/solutions/best-practices/u11-two-workspace-rls-isolation-proof-2026-04-23.md` — confirms `handle_new_user` fires on `auth.users` INSERT; verifies `raw_user_meta_data` shape. For OAuth, `provider` will be `'google'` or `'azure'` and `provider_id` is the provider's subject claim.
- `docs/solutions/best-practices/idempotent-supabase-seed-via-production-write-boundary-2026-04-23.md` — `auth.admin.createUser` fires the trigger; useful if we add OAuth seed fixtures later.

### External References

External research skipped — the codebase already encodes the relevant patterns (see `docs/solutions/best-practices/supabase-clients-and-proxy-next16-2026-04-22.md`), and Supabase `signInWithOAuth` / `exchangeCodeForSession` are standard. Provider setup references ([Supabase Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Azure provider](https://supabase.com/docs/guides/auth/social-login/auth-azure)) will be linked from the solution doc written post-implementation.

## Key Technical Decisions

- **Initiate OAuth from the browser client, not a server action.** Rationale: `@supabase/ssr`'s PKCE flow writes the `code_verifier` cookie during `signInWithOAuth`. The browser client is the well-trodden Supabase SSR path; a server action that returns `{ url }` is possible but puts the cookie-write on the action response, which is fiddlier. We keep the cookie handling in Supabase's hands.
- **Callback route lives at `src/app/auth/callback/route.ts`** (route handler, no route group). Mirrors the existing `src/app/auth/confirm/route.ts`. Inheriting neither the `(auth)` nor `(app)` layout is correct — this is a pure redirect endpoint.
- **Extract `sanitizeNextPath` to `src/lib/auth/redirects.ts`** and import it from both `confirm/route.ts` and `callback/route.ts`. This is the first time the helper has a second caller; the `maintainability-reviewer` "rule of three" can wait, but two callers + a learnings doc flagging the risk is enough to promote it.
- **Use Azure `common` tenant** so both personal Microsoft accounts and Microsoft 365 work accounts can sign in. Rationale: accountants span both. The tenant is configurable via `SUPABASE_AUTH_EXTERNAL_AZURE_URL` (e.g., `https://login.microsoftonline.com/common/v2.0`); we document this but default to `common`.
- **Provider config lives in `supabase/config.toml` with env substitution** for local dev, and in the Supabase Dashboard for the remote project. No app-code env vars are needed for the providers themselves — Supabase handles provider secrets.
- **Error UX uses a closed-vocabulary slug map.** Extend `LOGIN_ERROR_MESSAGES` in `src/app/(auth)/login/page.tsx` (or rename to `LOGIN_ERROR_MESSAGES` if keys grow past email-confirm + OAuth) with `oauth_failed`, `oauth_cancelled`, `oauth_exchange_failed`. Callback redirects to `/login?error=<slug>`; the page reads the slug and renders the corresponding message.
- **No `isSameOriginRequest` check on the callback route.** OAuth redirects are cross-origin by design (`accounts.google.com`, `login.microsoftonline.com`). The PKCE state param + code is the defense; calling `isSameOriginRequest` here would reject every real OAuth response.
- **Buttons render above the email/password form, inside the same card.** One `<OAuthButtons />` component shared by `LoginForm` and `SignupForm`. Separator labelled "or continue with email" divides the two. Copy is "Continue with Google" / "Continue with Microsoft" (not "Sign in with …") so the same buttons work verbatim on both pages.

## Open Questions

### Resolved During Planning

- _Do we need a new DB migration?_ No. The `handle_new_user` trigger on `auth.users` INSERT already provisions workspace + member for OAuth signups.
- _Browser-initiated vs server-action-initiated OAuth?_ Browser-initiated (see decisions).
- _Where does the callback route live?_ `src/app/auth/callback/route.ts` (no route group) — mirrors `src/app/auth/confirm/route.ts`.
- _Azure tenant scope?_ `common` (personal + work/school accounts).
- _Do we add a `profiles` table?_ No — out of scope (see Scope Boundaries).

### Deferred to Implementation

- _Exact set of error slugs._ The happy path covers `oauth_failed` (generic) and `oauth_exchange_failed` (code-exchange error). Whether to distinguish user-cancel (`error=access_denied`) with its own slug can be decided when wiring the callback — Supabase surfaces the raw provider error in `?error_description=` which must be discarded regardless.
- _Which lucide/inline SVG assets for the Google and Microsoft marks._ `lucide-react` ships no brand marks. We'll use inline SVGs (brand colors) matching the respective brand guidelines; exact viewBox/paths decided at implementation.
- _Whether to promote `LOGIN_ERROR_MESSAGES` to `LOGIN_ERROR_MESSAGES`._ Depends on how many OAuth slugs land. If it stays at 2-3, keep the existing name and add keys. If it grows larger, rename for clarity.

## Implementation Units

- [ ] **Unit 1: Extract `sanitizeNextPath` into a shared helper**

**Goal:** Move the open-redirect sanitizer out of the email-confirm route so both confirm and the new OAuth callback can import it, preventing the sanitizer from drifting between two copies.

**Requirements:** R5, R6

**Dependencies:** None

**Files:**

- Create: `src/lib/auth/redirects.ts`
- Modify: `src/app/auth/confirm/route.ts` (replace local `sanitizeNextPath` with import)
- Create: `src/lib/auth/redirects.test.ts`

**Approach:**

- Move the existing function body verbatim to the new file; export as a named arrow function (`export const sanitizeNextPath = ...`) consistent with the repo's `prefer-arrow-functions` ESLint rule.
- Import from `@/lib/auth/redirects` in both route handlers.
- Preserve the existing comment explaining the open-redirect threat model.

**Patterns to follow:**

- `src/lib/auth/require-auth.ts` — export style, file layout.
- Existing `sanitizeNextPath` at `src/app/auth/confirm/route.ts:22-28`.

**Test scenarios:**

- Happy path: `/dashboard` → `/dashboard` (already a valid relative path).
- Happy path: `null` → `/dashboard` (fallback default).
- Edge case: `""` → `/dashboard` (empty string treated as missing).
- Edge case: `/documents/123` → `/documents/123` (nested path preserved).
- Error path: `//evil.example` → `/dashboard` (protocol-relative URL rejected).
- Error path: `https://evil.example` → `/dashboard` (absolute URL rejected).
- Error path: `javascript:alert(1)` → `/dashboard` (non-slash-prefixed rejected).
- Error path: `documents/123` (missing leading slash) → `/dashboard`.

**Verification:**

- `npm test` includes the new `redirects.test.ts` and all scenarios pass.
- `/auth/confirm` behaves identically before and after (manual spot-check of the existing confirmation flow).
- `npm run lint` passes (no new `as`/`!` violations).

---

- [ ] **Unit 2: Add OAuth callback route handler**

**Goal:** Accept the `?code=` redirect from Google / Microsoft, exchange it for a Supabase session, and redirect to the sanitized `next` destination (default `/dashboard`). Map all failure paths to `/login?error=<slug>`.

**Requirements:** R1, R2, R4, R5

**Dependencies:** Unit 1 (for `sanitizeNextPath` import)

**Files:**

- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/auth/callback/route.test.ts`

**Approach:**

- `export const GET = async (request: NextRequest): Promise<Response>` — mirror `src/app/auth/confirm/route.ts`.
- Read `code`, `next`, `error` (from provider) from `request.nextUrl.searchParams`.
- If provider returned an `error` param (user cancelled, provider denial), redirect to `/login?error=oauth_failed` — do not forward `error_description` (closed-vocabulary only; see learnings doc on open-redirect / XSS via raw provider text).
- If `code === null`, redirect to `/login?error=oauth_failed`.
- `await createSupabaseServerClient()` → `supabase.auth.exchangeCodeForSession(code)`. On error, redirect to `/login?error=oauth_exchange_failed`.
- On success, `redirect(sanitizeNextPath(nextParam))`.
- Do NOT call `isSameOriginRequest` here — OAuth redirects are cross-origin by design.

**Technical design:** _(directional — illustrates control flow, not implementation)_

```
GET /auth/callback?code=...&next=/dashboard
  │
  ├── provider error param present? → /login?error=oauth_failed
  ├── code missing? → /login?error=oauth_failed
  ├── exchangeCodeForSession(code) errors? → /login?error=oauth_exchange_failed
  └── success → redirect(sanitizeNextPath(next))  // cookies written by supabase/ssr via server client
```

**Patterns to follow:**

- `src/app/auth/confirm/route.ts` — exact file shape (arrow-function GET, structured redirects, reuse of `sanitizeNextPath`).
- Closed-vocabulary error slug pattern from `src/app/(auth)/login/page.tsx:5-8`.

**Test scenarios:**

- Happy path: `?code=abc&next=/dashboard` with successful `exchangeCodeForSession` → redirects to `/dashboard`.
- Happy path: `?code=abc` (no `next`) → redirects to `/dashboard` (sanitizer default).
- Edge case: `?code=abc&next=/documents/xyz` → redirects to `/documents/xyz`.
- Error path: `?error=access_denied` (provider error present) → redirects to `/login?error=oauth_failed`; no Supabase call made.
- Error path: no `code` param → redirects to `/login?error=oauth_failed`.
- Error path: `exchangeCodeForSession` throws / returns error → redirects to `/login?error=oauth_exchange_failed`.
- Security path: `?code=abc&next=//evil.example` → session exchanged successfully, redirect target is `/dashboard` (sanitizer stripped malicious next).
- Security path: `?code=abc&next=https://evil.example` → same as above.

**Verification:**

- `npm test` covers all scenarios (via a port/adapter pattern injecting a fake `exchangeCodeForSession` — see `src/lib/upload/sign.ts` as the reference for this pattern in-repo).
- Manual smoke: hit `/auth/callback?error=access_denied` in a dev browser; land on `/login?error=oauth_failed` with the mapped copy rendered.

---

- [ ] **Unit 3: Extend login error-message map with OAuth slugs**

**Goal:** Surface human-readable copy for OAuth failure slugs emitted by Unit 2.

**Requirements:** R4

**Dependencies:** None (can land before Unit 2; Unit 2 emits the slugs Unit 3 renders).

**Files:**

- Modify: `src/app/(auth)/login/page.tsx`

**Approach:**

- Add `oauth_failed` → "We couldn't sign you in with that provider. Try again or use email." to `LOGIN_ERROR_MESSAGES`.
- Add `oauth_exchange_failed` → "Something went wrong completing sign-in. Please try again." to the same map.
- If the map grows to 4+ keys, rename to `LOGIN_ERROR_MESSAGES` in the same commit (a single rename is cheap; splitting later would be noise).

**Patterns to follow:**

- Existing `LOGIN_ERROR_MESSAGES` at `src/app/(auth)/login/page.tsx:5-8` — sentence case, no provider names in copy, no raw error text.

**Test scenarios:**

- Test expectation: none — this is a copy change in a closed-vocabulary map and is exercised transitively by Unit 2's tests (the callback emits slugs; the page reads them). Adding a dedicated test for string-literal lookups would be tautological.

**Verification:**

- Manual: navigate to `/login?error=oauth_failed` and `/login?error=oauth_exchange_failed` in dev; the mapped copy renders in the existing error slot.
- `npm run lint` and `npm run build` pass.

---

- [ ] **Unit 4: Shared `<OAuthButtons />` component with Google + Microsoft buttons**

**Goal:** A reusable client component that renders the two OAuth buttons with brand marks, kicks off `signInWithOAuth` via the browser Supabase client with the correct `redirectTo`, and handles the narrow client-side error cases (network failure before redirect).

**Requirements:** R1, R2, R7

**Dependencies:** Units 1 and 2 don't gate this, but the component should assume `/auth/callback` exists.

**Files:**

- Create: `src/components/auth/OAuthButtons.tsx`
- Create: `src/components/auth/OAuthButtons.test.tsx`

**Approach:**

- `"use client"` component with two buttons. Each button's onClick calls `createSupabaseBrowserClient().auth.signInWithOAuth({ provider: 'google' | 'azure', options: { redirectTo: ... } })`.
- Compute `redirectTo`: start with `${getPublicBaseUrl()}/auth/callback` if non-null, else fall back to `${window.location.origin}/auth/callback`. This handles both production (env var) and local dev (no env var, use current origin).
- Accept an optional `next` prop so callers can override the post-login destination; forward as `redirectTo: .../auth/callback?next=<path>`.
- Show a per-button pending state during the redirect-in-flight window (the user clicks, Supabase makes the network call, then we `window.location.assign` — this is typically <500ms but should feel responsive).
- On error before redirect (Supabase client returns `{ error }`), surface via a Sonner toast with a generic message; don't expose provider errors.
- Brand marks: inline SVGs at `src/components/auth/icons/GoogleMark.tsx` and `MicrosoftMark.tsx` (or inline in `OAuthButtons.tsx` if trivially short). Follow shadcn `<Button variant="outline">` look.

**Patterns to follow:**

- `src/components/TopNav.tsx` — arrow-function component export pattern, use of Sonner.
- shadcn `<Button>` composition in `src/components/ui/button.tsx`.
- Supabase Browser client usage is not yet present in the repo; `src/lib/supabase/browser.ts` is the singleton source.

**Test scenarios:**

- Happy path (Google): clicking the Google button calls `signInWithOAuth({ provider: 'google', options: { redirectTo: <callback-url> } })` exactly once.
- Happy path (Microsoft): clicking the Microsoft button calls `signInWithOAuth({ provider: 'azure', options: { redirectTo: <callback-url> } })`.
- Edge case: when a `next` prop is provided, `redirectTo` includes `?next=<path>` URL-encoded.
- Edge case: when `getPublicBaseUrl()` returns `null` (local dev without env var), `redirectTo` uses `window.location.origin`.
- Error path: when `signInWithOAuth` returns an `error`, a Sonner toast fires and the button returns to its non-pending state.
- Integration: the component renders inside both `LoginForm` and `SignupForm` without layout regression (visual check, not an assertion).

**Verification:**

- `npm test` includes `OAuthButtons.test.tsx`; the Supabase browser client is injected via a port (or the test swaps the module import) rather than `vi.mock('@supabase/...')`, matching `src/lib/upload/sign.ts` testability style.
- Manual: clicking each button in `npm run dev` initiates a real OAuth redirect (tested after Unit 5 lands the Supabase config).

---

- [ ] **Unit 5: Configure Google and Microsoft providers in Supabase + env**

**Goal:** Make the two providers actually work in local dev (`supabase start`) and document the remote (Vercel / production) setup. Wire env vars so secrets are not committed.

**Requirements:** R7, R8

**Dependencies:** None (but Unit 4 needs this to actually sign anyone in)

**Files:**

- Modify: `supabase/config.toml`
- Modify: `.env.example`
- Create: `docs/solutions/best-practices/oauth-google-microsoft-supabase-setup-2026-04-24.md` — human runbook for provider app creation (Google Cloud Console, Azure App Registration), secret population, and Supabase Dashboard configuration for the remote project.

**Approach:**

- In `supabase/config.toml`:
  - Add `[auth.external.google]` block: `enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`, `redirect_uri = ""` (Supabase fills default), `skip_nonce_check = true` (required for local Google sign-in per Supabase docs comment in the scaffolded `[auth.external.apple]` block).
  - Add `[auth.external.azure]` block: `enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_AZURE_SECRET)"`, `url = "env(SUPABASE_AUTH_EXTERNAL_AZURE_URL)"` (defaults to `https://login.microsoftonline.com/common/v2.0` in `.env.example`).
  - Extend `[auth] additional_redirect_urls` to include `http://127.0.0.1:3000/auth/callback` and `https://127.0.0.1:3000/auth/callback`. Production URLs are configured in the Supabase Dashboard.
- In `.env.example`: add the four OAuth env var names with `# set in Supabase dashboard for production; local dev only` comments. Also add `NEXT_PUBLIC_SITE_URL` if still absent (see research: currently missing and referenced by `getPublicBaseUrl()`).
- In `.env.local` (user responsibility): populate the four secrets from Google Cloud Console + Azure App Registration.
- Write the solution doc with: (a) Google Cloud Console steps — create OAuth 2.0 client ID, set authorized redirect URIs to `${SUPABASE_URL}/auth/v1/callback` (Supabase's callback, not ours); (b) Azure portal steps — App Registration, `common` tenant, redirect URI same as above; (c) Supabase Dashboard remote config — Auth → Providers → Google/Azure; (d) site URL + additional redirect URLs config in Dashboard for production.

**Patterns to follow:**

- Existing `[auth.external.apple]` stub in `supabase/config.toml` (scaffolded by `supabase init`) — shape of the provider block.
- `docs/solutions/best-practices/supabase-clients-and-proxy-next16-2026-04-22.md` — style for the new solution doc (YAML frontmatter, hands-on "here's exactly what to configure" tone).

**Test scenarios:**

- Test expectation: none — this unit is configuration and documentation, not behavioral code. The behavior is covered by Unit 4 (browser) and Unit 2 (server) tests plus manual end-to-end verification below.

**Verification:**

- `supabase start` with populated `.env.local` boots without config.toml parse errors (`supabase status` reports auth running).
- Manual end-to-end in local dev: click "Continue with Google" in `/login`, complete Google consent, land on `/dashboard` as a new authenticated user. Repeat for Microsoft.
- SQL check after first OAuth signup: `select * from public.workspaces w join public.workspace_members m on m.workspace_id = w.id where m.user_id = (select id from auth.users where email = '<test-email>');` returns exactly one row (proves `handle_new_user` fired on OAuth insert — R3).
- Manual second sign-in: click "Continue with Google" again; same session is re-established, no new workspace row created.

---

- [ ] **Unit 6: Wire `<OAuthButtons />` into LoginForm and SignupForm**

**Goal:** Render the OAuth buttons above the existing email/password form on both `/login` and `/signup`, separated by a labelled divider.

**Requirements:** R1, R2, R6

**Dependencies:** Unit 4

**Files:**

- Modify: `src/app/(auth)/login/LoginForm.tsx`
- Modify: `src/app/(auth)/signup/SignupForm.tsx`

**Approach:**

- Above the existing `<form>`, render `<OAuthButtons />` followed by a `<Separator />` with the text "or continue with email" (use the existing separator component; center the text with a tailwind flex + `before:`/`after:` pattern or a small wrapper — match shadcn's typical separator-with-label recipe).
- No prop changes to the forms; the OAuthButtons component owns its own state.
- `SignupForm` has the same treatment because OAuth is the same action regardless of "login" vs "signup" intent (Supabase auto-creates the user on first OAuth).

**Patterns to follow:**

- `src/app/(auth)/login/LoginForm.tsx` — `Card` / `CardContent` composition.
- shadcn "separator with label" idiom (no in-repo example yet; use a simple flex wrapper with horizontal rule siblings if a shadcn variant isn't obvious).

**Test scenarios:**

- Happy path: `LoginForm` renders with OAuth buttons above the email input (snapshot or `getByRole('button', { name: /continue with google/i })` presence check).
- Happy path: `SignupForm` renders with the same OAuth buttons.
- Integration: existing email/password tests (if any — currently none) still pass; the action and input elements are unchanged.

**Verification:**

- `npm test` passes.
- Manual: `/login` and `/signup` render the OAuth buttons, divider, then the existing form. No layout regression on mobile (test at 375px width).
- Visual: `Brand` wordmark and synthetic-samples disclaimer from `(auth)/layout.tsx` still wrap the card correctly.

---

- [ ] **Unit 7: Update README onboarding + solution doc cross-links**

**Goal:** The README's "Getting started" section should mention OAuth as an option and point at the new solution doc for provider setup.

**Requirements:** R7 (developer-facing)

**Dependencies:** Unit 5 (the solution doc must exist before README links to it).

**Files:**

- Modify: `README.md`

**Approach:**

- Add a short "Auth providers" subsection under setup that names Google + Microsoft as supported, links to `docs/solutions/best-practices/oauth-google-microsoft-supabase-setup-2026-04-24.md`, and lists the four new env vars as optional-for-local-dev.
- Keep it terse — the runbook lives in the solution doc.

**Patterns to follow:**

- Existing README style (`docs/loom-script.md` cadence of concise section headers).

**Test scenarios:**

- Test expectation: none — documentation change.

**Verification:**

- `README.md` renders correctly in GitHub preview (markdown lint clean).

## System-Wide Impact

- **Interaction graph:** `handle_new_user` trigger on `auth.users` already fires on OAuth signups — no new callbacks or observers. `proxy.ts` session refresh is unchanged.
- **Error propagation:** Provider errors (client-side before redirect) surface via Sonner toast; callback-route errors (server-side post-redirect) surface as `/login?error=<slug>` with a closed-vocabulary map. Raw provider `error_description` is never forwarded to the user or logs.
- **State lifecycle risks:** PKCE `code_verifier` cookie is written by `@supabase/ssr` during `signInWithOAuth` and read by the server client during `exchangeCodeForSession`. `proxy.ts` cookie dance must stay intact (the `let response` reassignment). A user who cancels mid-flow (closes tab during Google consent) has a stale verifier cookie — Supabase handles this by issuing a new one on next attempt; no app-side cleanup needed.
- **API surface parity:** None — no API routes touched.
- **Integration coverage:** Unit 2 and Unit 4 tests exercise the route handler and the browser component in isolation. The cross-layer scenario (browser click → provider → callback → session cookie → dashboard access) is verified manually (Unit 5 verification steps). Unit-only tests cannot prove the full round-trip.
- **Unchanged invariants:** Email/password sign-in and sign-up, email-confirm route, sign-out action, `require-auth` / `getClaims` identity check, RLS on `workspaces` / `workspace_members` / `documents`, and the existing `handle_new_user` trigger body all remain exactly as they are. OAuth is additive.

## Risks & Dependencies

| Risk                                                                                                        | Mitigation                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Azure `common` tenant lets personal accounts in; enterprise admins may want to restrict to a single tenant. | Document that switching to a specific tenant ID is a one-line config change (`SUPABASE_AUTH_EXTERNAL_AZURE_URL`) — easy to dial back if a customer requests it.                            |
| Same-email duplicate-account confusion (user has email/password AND Google account with same email).        | Out of scope. Documented as known limitation in the solution doc. If it causes support load, a future task enables Supabase's account-linking.                                             |
| Google's localhost sign-in quirks (`skip_nonce_check` requirement).                                         | Set `skip_nonce_check = true` in `[auth.external.google]` for local dev; remote Supabase dashboard handles this differently. Document in the runbook.                                      |
| Redirect URL allowlist drift — Vercel preview URLs change per PR.                                           | Document the allowlist setup in the solution doc. Long-term: consider wildcard entries in Supabase Dashboard (`https://*.vercel.app`) if Supabase supports them for this project's plan.   |
| `handle_new_user` assumes certain `raw_user_meta_data` shape; Microsoft may not set `email_verified`.       | Verify in Unit 5 manual testing (SQL check after first Microsoft signup). If the trigger silently skips or errors, widen it (separate migration) — but learnings doc suggests it's robust. |
| `LOGIN_ERROR_MESSAGES` is now misnamed once OAuth slugs land.                                               | Rename to `LOGIN_ERROR_MESSAGES` in Unit 3 if the map grows past ~3 keys; otherwise keep the existing name (the `maintainability-reviewer` line against premature renames applies).        |

## Documentation / Operational Notes

- New solution doc `docs/solutions/best-practices/oauth-google-microsoft-supabase-setup-2026-04-24.md` is the canonical runbook for provider setup (Unit 5).
- README update (Unit 7) gives developers a one-liner pointing at the runbook.
- Production rollout requires: (a) Google Cloud Console OAuth app, (b) Azure App Registration, (c) secrets populated in Supabase Dashboard for the remote project, (d) `NEXT_PUBLIC_SITE_URL` set in Vercel, (e) site URL + redirect URLs configured in Supabase Dashboard. None of this is gated by code — the code-side change ships first, providers can be flipped on/off without code changes.
- Monitoring: no new log lines or metrics. Failed OAuth attempts surface in Supabase's auth logs (Dashboard → Logs → Auth). If a support case lands, that's the first place to look.

## Sources & References

- Related code (auth core): `src/app/actions/auth.ts`, `src/app/auth/confirm/route.ts`, `src/app/(auth)/login/LoginForm.tsx`, `src/app/(auth)/signup/SignupForm.tsx`, `src/app/(auth)/login/page.tsx`, `src/lib/supabase/browser.ts`, `src/lib/supabase/server.ts`, `src/lib/auth/require-auth.ts`, `src/lib/env.ts`, `proxy.ts`.
- Related migrations: `supabase/migrations/20260421000003_workspace_autocreate_trigger.sql`, `supabase/migrations/20260421000014_handle_new_user_trigger_guard.sql`.
- Related learnings: `docs/solutions/security-issues/open-redirect-via-next-query-param-supabase-verify-otp-2026-04-22.md`, `docs/solutions/best-practices/supabase-clients-and-proxy-next16-2026-04-22.md`, `docs/solutions/best-practices/u11-two-workspace-rls-isolation-proof-2026-04-23.md`.
- External docs (for the solution doc written in Unit 5): [Supabase Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Azure provider](https://supabase.com/docs/guides/auth/social-login/auth-azure), [Next.js App Router Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers).
