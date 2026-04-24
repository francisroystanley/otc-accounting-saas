---
title: Google + Microsoft OAuth setup for Supabase (local + Vercel production)
date: 2026-04-24
category: best-practices
module: auth
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - Adding one-click sign-in via Google or Microsoft to a Supabase-backed Next.js app
  - Configuring OAuth providers in both supabase/config.toml (local dev) and the Supabase Dashboard (remote)
  - Deciding between Azure "common" tenant (personal + work/school) vs single-tenant
  - Wiring redirect-URL allowlists across localhost, Vercel previews, and production
tags:
  - supabase
  - oauth
  - google
  - microsoft
  - azure
  - pkce
  - nextjs-16
---

# Google + Microsoft OAuth setup for Supabase

The app code (callback route, sign-in buttons, env plumbing) is already wired. This doc is the **runbook** for the one-time provider-side configuration needed to turn the buttons from "redirect to an error page" into "sign a user in." Do it once per environment.

## Prerequisites

- Supabase project exists (remote) and is linked locally (`supabase link`).
- `NEXT_PUBLIC_SUPABASE_URL` is known. This is the base for the Supabase-hosted OAuth callback: `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`. **This is the URL you give Google and Microsoft — NOT your app's `/auth/callback`.** Supabase receives the provider callback, then redirects to your app's `/auth/callback?code=...`.
- Production site URL is known (e.g. `https://otc-accounting.example.com`).

## Google

### 1. Create the OAuth 2.0 client

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Select (or create) the project that will own this OAuth client.
3. If prompted, configure the **OAuth consent screen** first: User type "External" for public SaaS, add the app name, support email, developer contact email.
4. Click **Create Credentials → OAuth client ID**.
5. Application type: **Web application**.
6. Name: e.g. `OTC Accounting SaaS — production` (create a separate client for dev if you want isolated logs).
7. **Authorized redirect URIs**: add `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback` (one entry per Supabase project you link to).
8. Save. Copy the **Client ID** and **Client secret**.

### 2. Plug the credentials in

**Local dev** — paste into `.env.local`:

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client-id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client-secret>
```

Then restart `supabase start`. The `[auth.external.google]` block in `supabase/config.toml` reads these via `env(...)` substitution.

**Production** — open the Supabase Dashboard for the remote project → **Authentication → Providers → Google** → enable, paste Client ID + Client secret, save.

### 3. Gotchas

- `skip_nonce_check = true` is set for local dev in `supabase/config.toml` — this is required by Supabase's CLI for local Google sign-in. Remote Supabase handles the nonce differently; no equivalent toggle is needed in the Dashboard.
- If Google OAuth returns `redirect_uri_mismatch`, the URI in step 7 does not exactly match what Supabase is sending. Copy it verbatim from the Supabase Dashboard → Authentication → Providers → Google → "Callback URL (for OAuth)" field.

## Microsoft (Azure)

### 1. Register the application

1. Open [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (Entra ID / Azure AD).
2. Click **New registration**.
3. Name: e.g. `OTC Accounting SaaS`.
4. **Supported account types**:
   - `Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)` → keeps `common` tenant (recommended for this app).
   - `Accounts in this organizational directory only` → single-tenant; use only if the app is restricted to one customer org.
5. **Redirect URI**: platform = `Web`, value = `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`.
6. Register.
7. From the **Overview** tab, copy the **Application (client) ID**. This is `SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID`.
8. Go to **Certificates & secrets → Client secrets → New client secret**. Copy the secret **Value** (NOT the Secret ID). This is `SUPABASE_AUTH_EXTERNAL_AZURE_SECRET`. The value is shown once — if you lose it, create a new secret.
9. (Single-tenant only) From the Overview tab, copy the **Directory (tenant) ID** and use `https://login.microsoftonline.com/<tenant-id>/v2.0` as `SUPABASE_AUTH_EXTERNAL_AZURE_URL`. Multi-tenant keeps the default `https://login.microsoftonline.com/common/v2.0`.

### 2. Plug the credentials in

**Local dev** — paste into `.env.local`:

```
SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID=<client-id>
SUPABASE_AUTH_EXTERNAL_AZURE_SECRET=<client-secret-value>
SUPABASE_AUTH_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/common/v2.0
```

**Production** — Supabase Dashboard → **Authentication → Providers → Azure (Microsoft)** → enable, paste Application (client) ID + Secret Value, set Azure Tenant URL, save.

### 3. Gotchas

- Microsoft's "Secret ID" and "Secret Value" are different fields. You want the **Value**.
- `common` tenant accepts personal Microsoft accounts (@outlook.com, @hotmail.com, Xbox accounts) _and_ work/school accounts. If you ever need to lock it down to a single enterprise, switch the URL to that tenant ID — it's a one-line change, no code.
- First sign-in from a new enterprise tenant may require admin consent; the first user to sign in from that tenant sees a consent screen — have an admin account ready if testing against a locked-down tenant.

## Redirect URL allowlists in Supabase

Supabase enforces an allowlist on the URLs it's willing to redirect back to **after** the Supabase-side OAuth callback exchanges the code. This is the second hop, not the Google/Microsoft-side redirect URI.

**Local dev** — `supabase/config.toml` already lists:

```
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = [
  "https://127.0.0.1:3000",
  "http://127.0.0.1:3000/auth/callback",
  "https://127.0.0.1:3000/auth/callback",
]
```

**Production / Vercel previews** — in the Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: production apex, e.g. `https://otc-accounting.example.com`.
- **Additional Redirect URLs**: add each of:
  - `https://otc-accounting.example.com/auth/callback`
  - `https://otc-accounting-*.vercel.app/auth/callback` (if wildcards are supported on your plan — otherwise add a handful of recent preview URLs manually).
  - Any custom domain you route traffic through.

If Supabase rejects a redirect with `requested path is invalid`, the URL isn't in this allowlist.

## Verifying end-to-end

1. `supabase start` with populated `.env.local`. Confirm `supabase status` shows auth running.
2. `npm run dev`. Navigate to `http://127.0.0.1:3000/login`.
3. Click **Continue with Google**. Complete the consent screen. You should land on `/dashboard`.
4. Check the workspace trigger fired — the `handle_new_user` migration already auto-creates one workspace + `workspace_members` row per new `auth.users` INSERT. SQL check via the local Supabase Studio or `supabase db query`:
   ```sql
   select w.name, m.role
   from public.workspace_members m
   join public.workspaces w on w.id = m.workspace_id
   join auth.users u on u.id = m.user_id
   where u.email = '<your-google-email>';
   ```
   Expect one row, role `owner`.
5. Sign out via the top nav. Click **Continue with Google** again. Confirm you re-enter the dashboard with the same user id (no duplicate workspace).
6. Repeat steps 2-5 for **Continue with Microsoft**.

## Known limitations

- **Same-email across providers is a duplicate account.** If a user previously signed up with email/password under `alice@example.com` and then signs in with Google using the same email, Supabase creates a separate `auth.users` row. This is Supabase's default behavior. If support cases appear, a follow-up task can enable identity linking via Supabase's "Manual linking" or "Automatic linking" settings.
- **Azure `email_verified` is not always set.** If Microsoft sign-ins fail at the `handle_new_user` trigger, inspect `select raw_user_meta_data from auth.users where email = '<user>';` after a failed attempt and widen the trigger in a follow-up migration if needed. No known breakage at the time of writing.
