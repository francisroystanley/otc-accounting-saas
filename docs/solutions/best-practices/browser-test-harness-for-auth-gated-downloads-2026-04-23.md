---
title: Browser-test harness for auth-gated download endpoints (IDM-safe)
date: 2026-04-23
category: best-practices
module: testing-harness
problem_type: workflow_pattern
component: e2e-testing
applies_when:
  - Verifying a route that returns Content-Disposition = attachment (CSV/ZIP/PDF/etc.) with a real authenticated session
  - Using agent-browser or similar Playwright-style automation on a machine where users may have IDM (Internet Download Manager) or similar download managers installed
  - Needing to inspect the *actual bytes* of a download response, not just that a click fired
  - Writing end-to-end coverage for auth-gated endpoints without waiting on a seed script (U14) to land
tags:
  - browser-testing
  - agent-browser
  - idm
  - download-interception
  - supabase
  - auth-fixtures
  - test-harness
  - e2e
---

# Browser-test harness for auth-gated download endpoints (IDM-safe)

## Context

U13 added a `GET /api/export` endpoint that returns `application/zip` with `Content-Disposition: attachment`. The plan deferred end-to-end verification to "manual before submission" because the happy path needs three things simultaneously — a logged-in user, at least one `status='complete'` document in their workspace, and a browser capable of capturing the downloaded zip bytes for inspection.

When we tried to run this as an automated browser pass we hit two non-obvious failures:

1. **`agent-browser download @button` returned `✗ Download was canceled`** even though the server log showed `GET /api/export 200 in 1631ms`. The click fired, the server responded, but Playwright never saw the download event.
2. **`fetch('/api/export')` from `agent-browser eval` returned `204 null null`** — zero bytes, no `Content-Type`, no `Content-Disposition`, `Cache-Control: no-cache`. The server-side log for the same request showed `GET /api/export 200`.

Both failures share one cause: **IDM (Internet Download Manager)**, a Chrome extension, intercepts any response with `Content-Disposition: attachment` at the network layer, consumes the body itself (opens its own download prompt), and returns a synthetic `204 No Content` to the page. From Chrome's perspective the request "completed" but the response is empty. From Playwright's perspective no download was ever delivered to the browser's download handler — IDM took it before Chrome saw it.

The IDM prompt the user sees is actually confirmation that the button worked. But the test harness needs to inspect the real zip, not trust a user-visible dialog.

## Guidance

Use a two-channel harness: **agent-browser for UX behavior, server-side curl with extracted session cookies for response-body inspection.**

### 1. Provision auth fixtures via Supabase MCP direct SQL

When the seed script (U14) isn't available yet, create a pre-verified user + seeded documents in one transaction rather than hand-clicking through signup + verification + upload + waiting-for-extraction. Follow the pattern from the U11 isolation proof, adapted for a workspace that needs `complete` documents rather than just any documents.

```sql
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_email text := 'u13export-test@example.com';
  v_password text := 'TestU13Export!2026';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user
  ) VALUES (
    v_user_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '', '', '', '',  -- MUST be empty strings, not NULL
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email,
                       'email_verified', true, 'phone_verified', false),
    false, false
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_user_id::text, 'email',
    jsonb_build_object('sub', v_user_id::text, 'email', v_email,
                       'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );
  -- handle_new_user trigger on auth.users auto-creates the workspace + membership row.
END $$;
```

Then seed `public.documents` with explicit casts on the `document_status` enum:

```sql
INSERT INTO public.documents (
  id, workspace_id, uploaded_by, filename, storage_path,
  doc_type, doc_type_confidence, status, extracted_data, edited_fields
)
SELECT gen_random_uuid(), wm.workspace_id, wm.user_id,
  'u13-test-w2-acme.pdf', wm.workspace_id || '/u13-test-w2-acme.pdf',
  'w2', 0.98, 'complete'::document_status,  -- MUST cast text to the enum
  jsonb_build_object(
    'employer_name', jsonb_build_object('value', 'Acme Corp', 'confidence', 0.99),
    -- ...
  ),
  '{}'::jsonb
FROM public.workspace_members wm
JOIN auth.users u ON u.id = wm.user_id
WHERE u.email = 'u13export-test@example.com';
```

### 2. Log in via the real `/login` UI in agent-browser

Use the real Server Action path — cookie-injection hacks accumulate drift with the SSR client:

```bash
agent-browser --session u13-test open http://localhost:3000/login
agent-browser --session u13-test snapshot -i
agent-browser --session u13-test fill @e2 "u13export-test@example.com"
agent-browser --session u13-test fill @e3 "TestU13Export!2026"
agent-browser --session u13-test click @e4
```

Use `--session <name>` to get an isolated cookie jar per test run. The `e2/e3/e4` refs are Playwright element handles from the prior `snapshot -i`.

### 3. Inspect the response bytes via server-side curl with extracted cookies

Extract the Supabase auth cookie from the live browser session, then hit the endpoint directly — bypassing IDM entirely because IDM is a Chrome-only extension:

```bash
# Capture the session cookie from the authenticated browser.
agent-browser --session u13-test eval "document.cookie" > /tmp/cookie.txt

# curl the download with the captured cookie, saving the real bytes.
COOKIE=$(cat /tmp/cookie.txt | sed 's/^"//;s/"$//')
curl -s -D /tmp/headers.txt -o /tmp/export.zip \
  "http://localhost:3000/api/export" \
  -H "Cookie: $COOKIE" \
  -H "Origin: http://localhost:3000" \
  -H "Sec-Fetch-Site: same-origin"

# Inspect the zip for correctness.
unzip -l /tmp/export.zip
unzip -p /tmp/export.zip w2.csv | head -5
```

The `Origin` + `Sec-Fetch-Site` headers are required to pass the app's `isSameOriginRequest` check — curl doesn't set them by default.

### 4. Use the browser layer for what curl can't test

Curl proves the endpoint returns correct bytes. The browser proves UX behavior that lives only in the DOM:

- Button enabled/disabled state under various filter combinations
- Tooltip copy
- Toast messages on error
- That the client's `handleExport` actually wires the fetch → blob → anchor.click chain

```bash
# Verify R14a-aware disable: filter to status=needs_review and check DOM state.
agent-browser --session u13-test open "http://localhost:3000/dashboard?status=needs_review"
agent-browser --session u13-test eval \
  "JSON.stringify({ disabled: document.querySelector('[aria-label=\"Export matching documents as a zip of CSVs\"]').disabled })"
```

## Why this matters

Spreadsheets and download-manager extensions break the naive "click the button and read the download" model. Two separate failures during a U13 browser pass cost roughly 15 minutes of debugging before the IDM pattern became clear:

- Server logs said `200 OK`. Browser eval said `204`. The mismatch read like a middleware bug or a Next.js proxy quirk.
- The `download` verb in agent-browser is a Playwright wrapper around the browser's download event. If IDM (or any other extension) takes over the response before Chrome raises that event, Playwright sees "canceled" with no body.

This split — **browser for UX, curl for bytes** — composes well and removes the need to disable Chrome extensions in test environments. It also decouples correctness verification (the zip's contents, header values, status codes) from environment-dependent UI behavior.

## When to apply

- Any route that returns `Content-Disposition: attachment` and needs byte-level verification, on any machine where the developer runs a download manager.
- Any auth-gated endpoint that would otherwise require a Unit-14-style seed script before it can be exercised end-to-end.
- Verifying per-filter behavior of an export or download endpoint without rebuilding all the UI state each iteration — curl lets you script a dozen filter combinations in seconds.
- Before submitting a demo: use this harness to prove the zip opens cleanly in Excel / Google Sheets by actually opening the bytes it produces, not the bytes IDM shows you.

## Examples

### End-to-end verification matrix used for U13

| #   | Scenario                                        | Channel                                 | Result                                   |
| --- | ----------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| 1   | Login + dashboard renders                       | agent-browser                           | ✅ 2 docs visible, Export button enabled |
| 2   | Click Export triggers download                  | agent-browser + user-visible IDM prompt | ✅ confirmed                             |
| 3   | Zip happy path — 2 CSVs, real bytes             | curl                                    | ✅ 200, 1325 B, well-formed RFC 4180     |
| 4   | `?type=w2` → single-CSV zip                     | curl                                    | ✅ 200, 674 B                            |
| 5   | `?status=needs_review` → 400                    | curl                                    | ✅ `{"error":"no_documents_match"}`      |
| 6   | Cross-origin → 403                              | curl                                    | ✅ `{"error":"forbidden_origin"}`        |
| 7   | No auth → 401                                   | curl                                    | ✅ `{"error":"unauthorized"}`            |
| 8   | Button disabled when no `complete` rows visible | agent-browser eval                      | ✅ `disabled: true`                      |

### When you don't need this harness

- Pure handler logic — unit-test the pure function with a mocked `ExportPort`. That's 44 tests in `src/lib/export/` and requires no browser, no DB, no auth fixture.
- API-contract tests — can often be covered with a supertest-style setup against the route handler without going through Chrome at all.

The harness above is the layer between those two: it proves the _integration_ (auth + RLS + handler + browser + extensions) end-to-end, with a clean escape hatch when a browser-level interception breaks the naive click-to-download flow.

## Related

- `docs/solutions/best-practices/u11-two-workspace-rls-isolation-proof-2026-04-23.md` — the SQL auth-fixture pattern this doc adapts, originally used for workspace isolation testing.
- `docs/solutions/security-issues/csv-formula-injection-export-sanitization-2026-04-23.md` — the CSV formula-injection fix verified by the same harness.
- U13 plan test scenarios in `docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md` lines 898–911.
