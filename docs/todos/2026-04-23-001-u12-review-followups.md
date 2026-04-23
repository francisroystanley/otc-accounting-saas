---
title: U12 ce:review follow-ups
created: 2026-04-23
status: ready
priority: p2
owner: downstream-resolver
source: .context/compound-engineering/ce-review/20260423-144346-87e80bc1/summary.md
---

# U12 ce:review follow-ups

These are the unresolved actionable findings from the ce:review of U12 (branch `feat/u12-detail-view`). Safe auto-fixes landed in-place; these items were deferred because they require product decisions, larger refactors, or scope the autofix mode declined to widen.

## P1

### [ ] 1. In-app `<Link>` and browser back bypass the dirty-form AlertDialog

- **Origin:** correctness C3, reliability rel-4, adversarial adv-u12-07.
- **Symptom:** The `AlertDialog` opens only when the user clicks the "Back to dashboard" header button. Clicking any sidebar `<Link>` or using the browser back button silently discards edits. `beforeunload` catches hard reload / tab close but not SPA navigation.
- **Why it matters:** Plan test scenario (line 853) explicitly calls for AlertDialog on navigation-away-from-dirty. Silent data loss on a common path.
- **Fix sketch:**
  - Option A: Wrap every in-app `<Link>` with a guard component that checks `isDirty` and opens the AlertDialog.
  - Option B: Intercept `popstate` + `history.pushState` to catch all SPA navigations while dirty.
  - Pick A for simplicity and the small set of links in the detail view (failed-state panel link, sidebar nav once it exists).

## P2

### [ ] 2. No timeouts / AbortController on fetch calls

- **Origin:** reliability rel-1, rel-2, rel-8.
- **Symptom:** `ExtractedFieldsForm.onSubmit`'s fetch and `PdfPreview`'s fetch have no `AbortSignal`, so a hanging request leaves the form disabled indefinitely with no recovery except hard reload. Server-side Supabase calls also have no explicit timeout.
- **Fix sketch:**
  - Client fetches: `AbortSignal.timeout(30_000)` + cleanup on unmount.
  - Server: wrap Supabase calls in a timeout wrapper or configure the global fetch adapter.

### [ ] 3. PdfPreview expiry timer skews on backgrounded-tab / system sleep

- **Origin:** reliability rel-3.
- **Symptom:** `setTimeout` is throttled in backgrounded tabs and paused during OS sleep. On resume, a dead-URL iframe can persist until the late timer fires.
- **Fix sketch:** Add `visibilitychange` + `focus` listeners that compare `Date.now()` to `expiresAt` and transition to `{ kind: "expired" }` if overdue.

### [ ] 4. Concurrent edit collisions — no optimistic concurrency control

- **Origin:** adversarial adv-u12-02.
- **Symptom:** Two tabs / two users open the same `complete` row, both save. Last write silently wins. No `updated_at` compare-and-swap.
- **Fix sketch:**
  - Add `.eq("updated_at", loadedUpdatedAt)` to the `saveEdit` UPDATE.
  - Surface a new `409 stale_updated_at` with the server's current `updated_at` so the client can prompt to reload and merge.

### [ ] 5. doc_type_confidence stale after needs_review → complete

- **Origin:** correctness C4, adversarial adv-u12-10.
- **Symptom:** A row that Gemini classified as `unknown@0.3` keeps `doc_type_confidence = 0.3` after the user picks w2 via the type-picker, even though the new `doc_type` is user-verified.
- **Product decision needed:** Is the column semantically "model confidence" (leave stale) or "effective confidence" (set to 1.0 for user-picked)? If the latter, `doc_type_confidence` must be added to the `authenticated` UPDATE column grant in a new migration, OR the picker path must route through the service-role-only `update_extraction_result` RPC.

### [ ] 6. Testing harness lacks jsdom for UI components

- **Origin:** testing testing-01 through -04.
- **Symptom:** `vitest.config.ts` is `environment: node` with no jsdom, so `AlertDialog` flow, `PdfPreview` expiry/refresh, and keyboard-shortcut wiring have no direct UI tests. Pure-logic tests are in place.
- **Fix sketch:** Add a second vitest project (`environment: jsdom`, `include: src/**/*.ui.test.tsx`) + React Testing Library, or switch to a single jsdom config. Low-priority for demo scope.

## P3

### [ ] 7. No `GET /api/documents/[id]` read endpoint

- **Origin:** agent-native W1.
- **Symptom:** PATCH and DELETE exist, but there is no read endpoint — an agent has to scrape HTML or hit Supabase directly to see what it is editing.
- **Fix sketch:** Add a `GET` export on `src/app/api/documents/[id]/route.ts` that mirrors `DELETE`'s auth pattern and returns the row. Closes the read→decide→write loop for future MCP integration.

## Pre-existing (not introduced by U12; flag for U11 follow-up)

### [ ] 8. Dashboard `countLowConfidence` shape mismatch

- **Origin:** correctness C8.
- **Symptom:** `src/lib/dashboard/live-feed.ts` iterates `extracted_data` as a flat field bag, but the extraction pipeline stores the wrapped `ExtractionResult` shape. Pre-edit rows under-report low-confidence count.
- **Fix sketch:** Unwrap `.fields` if the shape is wrapped, mirroring `extractFormValuesFrom` in `form-schemas.ts`.

## Advisory (not fixable; flagged for awareness)

- **Signed preview URLs outlive membership revocation.** Supabase-managed signed URLs cannot be revoked server-side. 15-min TTL is the only cap. Acceptable for demo.
- **Confidence forgery is threat-model-accepted.** Users can supply arbitrary confidence numbers for their own rows. Export/dashboard consumers should not treat user-saved confidence as model-attested.
- **`getAuthenticatedContext` picks arbitrary workspace on dual-membership** (pre-existing, not introduced by U12).
