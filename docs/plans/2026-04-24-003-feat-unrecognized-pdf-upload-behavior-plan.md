---
title: "feat: Distinct Unrecognized pill and detail-page empty state"
type: feat
status: active
date: 2026-04-24
origin: docs/brainstorms/2026-04-24-blank-pdf-upload-behavior-requirements.md
---

# feat: Distinct Unrecognized pill and detail-page empty state

## Overview

When a user uploads a blank PDF or a form Gemini can't classify (W-9, receipt, poorly-scanned page), the document currently lands in `needs_review` with `doc_type: "unknown"` and `fields: null` — rendering identically to legitimate low-confidence extractions and dead-ending at a `NeedsReviewPicker` that the user can't meaningfully action. This plan adds a UI-only derivation of the state as **Unrecognized**: a distinct dashboard pill, and an empty-state panel with a single Delete button on the detail page. No schema, RPC, or pipeline changes.

Scope is demo hardening ahead of the Loom recording — this is the smallest change that makes the blank/unsupported-upload flow look intentional rather than broken.

## Problem Frame

See origin: `docs/brainstorms/2026-04-24-blank-pdf-upload-behavior-requirements.md`.

Two UX gaps on the current flow:

1. Dashboard row for a blank/unsupported PDF looks identical to a legitimate low-confidence W-2 awaiting review. The user can't tell recoverable from unrecoverable rows without opening each one.
2. Detail page prompts "Pick W-2 / 1099-NEC / 1099-MISC / K-1 to complete manually" — wrong prompt for a blank page or unsupported form. The flow dead-ends.

Because there is no post-extraction signal to distinguish a blank page from an unsupported-but-non-blank form (both produce `doc_type: "unknown"` + `fields: null`), the plan addresses the broader "Unrecognized" class of which blank is a subset.

## Requirements Trace

Source: origin doc's Success Criteria (see origin).

- **R1.** A user who uploads a blank or unrecognized PDF sees a distinct **Unrecognized** pill on the dashboard within the usual realtime-update window — not "Needs review."
- **R2.** Opening that document shows an empty-state panel, not the form-type picker. Primary action is Delete, routed through Unrecognized-specific confirmation-dialog copy.
- **R3.** A user who uploads a supported tax form Gemini classifies correctly but with low confidence still sees the existing "Needs review" pill and manual-completion flow. Behavior unchanged for that case.
- **R4.** Confirming deletion on the detail page returns the user to the dashboard via `router.push("/dashboard")`; the row is gone.
- **R5.** A failed DELETE renders an inline error under the button (not a toast); the button re-enables so the user can retry without leaving the page.
- **R6.** Mixed-list behavior is intentional: "Needs review" filter + stats-strip count continues to include both pill variants.
- **R7.** No database migration. No change to `src/lib/extract/pipeline.ts` or the extraction schemas.

## Scope Boundaries

- No client-side pre-upload blank detection (no pdf.js in the browser).
- No server-side PDF text sniff to distinguish blank from unsupported.
- No retry / re-extract button. Delete is the only action.
- No new dashboard filter for "Unrecognized."
- No change to stats-strip counts.
- No refactor of `DeleteDocumentButton` into a shared headless hook — the detail-page Delete button duplicates the small dialog+fetch pattern intentionally (minimum blast radius for demo hardening; see Key Technical Decisions).
- No realtime subscription on the detail page — it remains static-by-design, matching today's behavior for every other status transition on that page.

### Deferred to Separate Tasks

- **Telemetry / audit trail for deleted Unrecognized documents.** Product-lens flagged this as the highest-signal demand dataset for future form-support prioritization; deferring means demo-period signal is not retained. The deferral is a deliberate demo-scope trade-off, not an indefinite drop. Concrete post-demo implementation sketch so the follow-up is unblocked: (a) extend the `DocumentDeletePort.loadDocument` select in `src/app/api/documents/[id]/route.ts` to also return `doc_type` + `extracted_data`; (b) in `handleDocumentDelete` (`src/lib/documents/delete.ts`), after the successful row-delete, if the loaded row's `doc_type === "unknown"` or `extracted_data.fields === null`, emit a structured `console.info("[documents/delete] unrecognized deleted", { documentId, workspaceId, filename, doc_type })` so it's captured in Vercel function logs for retroactive review; (c) later, promote to a proper `unrecognized_deletes` table if the signal proves valuable. ~10 lines across two files; out of demo scope only because of blast-radius discipline.
- **Secondary affordance like "request support for this form" link** (scope-expansion beyond demo hardening; reconsider post-demo based on Loom feedback). The revised body copy (see Key Technical Decisions) removes the roadmap implication that made this feel necessary; if users still ask, a `mailto:` link is the cheapest follow-up.
- **Extraction of a shared `useDocumentDelete` hook** (dialog state + fetch + error shape) to eliminate the duplication between `DeleteDocumentButton` and the detail-page Delete button. Current plan duplicates intentionally to minimize blast radius before demo; extraction is scheduled for post-demo.
- **Consistency pass on success-feedback divergence** between dashboard Delete (toast) and detail-page Delete (navigation-only). Either unify on toast-after-navigation or remove the dashboard toast — pick one post-demo based on Loom feedback.
- **Automated RTL component coverage** for `StatusCell`, `DocumentDetailHeader` (Unrecognized branch), `UnrecognizedEmptyState`, and `DocumentDetail` branch routing. Blocked today by the absence of `@testing-library/react` + `jsdom` in `devDependencies` and `.test.tsx` in the `vitest.config.ts` include glob. Post-demo, add the test-harness infrastructure as a standalone prep unit, then backfill component tests for the UI branches. Manual verification (Unit 5 acceptance) is the demo-period gate.

## Context & Research

### Relevant Code and Patterns

- **`src/lib/dashboard/live-feed.ts`** — `DocumentRow = Tables<"documents">`; module-private `isRecord` helper at lines 102-104; `countLowConfidence(row, threshold)` at lines 120-154 establishes the "status-gated predicate on `DocumentRow` + `extracted_data` record-narrowing" pattern that this plan mirrors.
- **`src/app/(app)/dashboard/StatusCell.tsx`** — current pill rendering; `statusLabel` + `statusVariant` maps at lines 16-30. All four shadcn Badge variants (`default`, `secondary`, `destructive`, `outline`) are already consumed by the five existing status pills — the Unrecognized pill must differentiate without a new Badge token.
- **`src/app/(app)/dashboard/DeleteDocumentButton.tsx`** — the confirmation-dialog + DELETE-fetch pattern to mirror. Note its contract is list-oriented (`onOptimisticRemove` / `onRestore` / `onDeleteConfirmed`), which is why the detail-page button duplicates the dialog+fetch shape rather than reusing the component.
- **`src/app/(app)/documents/[id]/DocumentDetail.tsx`** — right-column branching currently routes `needs_review` rows into `NeedsReviewPicker` (lines 187-204). Add a prior branch for Unrecognized.
- **`src/app/(app)/documents/[id]/DocumentDetailHeader.tsx`** — page header with two badges: a doc-type badge (line 38) rendering `DOC_TYPE_SPECS[row.doc_type].label` or `"Unknown type"`, and a status badge (line 39) rendering `STATUS_LABEL[row.status]`. The status badge is what Unit 3 swaps to an Unrecognized pill; the doc-type badge is unchanged.
- **`src/app/api/documents/[id]/route.ts`** — existing `DELETE` endpoint with origin check, workspace membership verification, storage cleanup, and row delete. No changes needed.
- **`src/lib/documents/doc-types.ts`** (re-exported from `src/app/(app)/documents/[id]/form-schemas.ts`) — `SUPPORTED_DOC_TYPES` array and `DocType` union. Body copy derives its "W-2, 1099-NEC, 1099-MISC, or K-1" list from this constant + `DOC_TYPE_SPECS[t].label`.
- **`src/app/(app)/dashboard/page.tsx:14-27`** — dashboard server-side query uses `.select("*")`, so `DocumentRow.extracted_data` and `DocumentRow.doc_type` are already in the initial payload. The predicate has the data it needs; no query changes required.

### Institutional Learnings

- `docs/solutions/best-practices/zod-null-vs-empty-object-gemini-nullable-schema-2026-04-22.md` — relevant background on how the pipeline normalizes Gemini's `unknown`-branch `fields` to `null` even when the model returns `{}`.
- `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md` — the port/adapter pattern used by existing document routes; not directly changed here but informs the test-mock approach for any server-side code.
- `docs/solutions/best-practices/user-session-patch-with-status-scoped-toctou-guard-2026-04-23.md` — informs why the existing PATCH uses status-scoped updates; not changed here, but relevant if the predicate ever moves server-side.

### External References

Not used — this is a well-patterned UI derivation in an existing Next.js App Router + shadcn + Supabase stack. No external research added value.

## Key Technical Decisions

- **Predicate co-locates in `live-feed.ts`, not a standalone file.** Matches the existing `countLowConfidence` pattern — predicate-on-`DocumentRow` helpers live in `live-feed.ts` next to the row type and the module-private `isRecord` helper it depends on. `isRecord` stays private (no cross-module consumer today; avoid widening the public API for a one-off use). Resolves origin-doc Open Question 2 and addresses scope-guardian's "separate file unjustified for 3-clause predicate" concern from document-review.
- **`UnrecognizedEmptyState` is a separate file, not inline JSX in `DocumentDetail`.** Despite `DocumentDetail` being `"use client"` (so inline `useState` is technically possible), the panel carries its own local state machine (`isSubmitting`, `errorMessage`), an `AlertDialog` subtree, and an async submit handler — extracting it keeps `DocumentDetail`'s routing readable and concentrates the state concern in one reviewable file. Sibling `NeedsReviewPicker` follows the same pattern. The existing inline `failed` branch is ~14 lines of static JSX with no state, which is why it stays inline. Scope-guardian raised this as a review point; keeping as a file is the right call for readability.
- **Detail-page Delete button mirrors `DeleteDocumentButton`'s AlertDialog+fetch pattern** (dialog structure, `isSubmitting` flag, `finally` cleanup), but intentionally diverges on three axes: (a) trigger is a primary `<Button variant="destructive" size="default">`, not a `variant="ghost" size="icon"` row-action button; (b) success path is `router.push("/dashboard")` instead of a list-mutation callback; (c) failure surfaces as an inline `role="alert"` message, not a toast. The divergence is deliberate — the dashboard is a list context with restoration semantics, the detail page is a single-record context. Rationale for duplicating the dialog+fetch pattern rather than extracting a shared hook: refactoring the dashboard button would change three caller sites (list-oriented callbacks) and expand blast radius. For demo hardening, duplication is cheaper than the refactor. The duplication is an accepted cost, tracked in Deferred to Separate Tasks for post-demo extraction.
- **Success-feedback divergence is acknowledged.** Dashboard Delete uses a toast on success; detail-page Delete uses navigation-as-success (no toast). Users interacting with both surfaces will see different feedback for the same verb. Accepted for demo scope because the navigation itself is unmistakable; a consistency pass (either toast-on-return or remove-the-dashboard-toast) is a post-demo follow-up if Loom feedback flags it.
- **`FileQuestionIcon` + `text-muted-foreground` on the `outline` Badge base** — two-property differentiation (icon + muted label) satisfies color-vision-deficiency accessibility without introducing a new Badge token. All four shadcn variants are already consumed by the five existing status pills. Applied consistently in BOTH `StatusCell` (dashboard) and `DocumentDetailHeader` (detail page) so the pill is the same shape everywhere — resolves the "header contradicts panel" issue surfaced by design-lens.
- **Detail page stays static; no realtime subscription added.** Matches today's behavior for every other status transition on that page; the user's natural flow is dashboard-subscribed → click resolved row. No new subscription work in demo scope.
- **Inline error (not toast) on DELETE failure** on the detail page. Toast can be missed when the user is mid-action on this single-page flow. Differs from `DeleteDocumentButton`'s toast pattern because the dashboard has list-context feedback (row restoration) that the detail page lacks.
- **Plain disabled (no spinner) during submit, matching `DeleteDocumentButton` exactly.** Both dialog buttons (Keep + Remove) go `disabled` while `isSubmitting`; no `Loader2Icon`, no text change to "Removing…". Consistency with the existing pattern outranks the marginal UX benefit of richer loading affordance.
- **Body copy does not imply a roadmap promise.** The empty-state panel reads "This file couldn't be read as a supported tax form. It may be blank, a form we don't currently handle, or too poorly scanned to parse." We avoided the earlier "we don't yet support it" phrasing — that wording implicitly committed to a forward roadmap for which the Delete-only action has no follow-through. The revised copy describes the failure factually without making promises the UI can't keep. Product-lens raised the contradiction; this is the resolution.

## Open Questions

### Resolved During Planning

- **Pill label wording** → keep `Unrecognized` (origin-doc starting draft). Less ambiguous than `Can't extract` (sounds like a retryable error) and less permanent-sounding than `Unsupported` (which would over-commit the roadmap framing). Alternatives remain open for a copy pass during QA.
- **Predicate location** → `src/lib/dashboard/live-feed.ts` (see Key Technical Decisions).
- **Empty-state panel filename** → yes, include it. Matches `DocumentDetailHeader` + the existing `DeleteDocumentButton` dialog which surfaces filename. The dialog body will render the filename in bold, matching the existing pattern.

### Deferred to Implementation

- **Priority vs other pre-demo work** (origin Open Question 4) — user-owned sequencing; not a planning decision.

## Implementation Units

- [ ] **Unit 1: `isUnrecognized` predicate in `live-feed.ts`**

**Goal:** Add a pure predicate `isUnrecognized(row: DocumentRow): boolean` that returns `true` when a row is `needs_review` + `doc_type` unknown/unsupported + wrapped `extracted_data.fields === null`.

**Requirements:** R1, R2, R3, R6, R7

**Dependencies:** None

**Files:**

- Modify: `src/lib/dashboard/live-feed.ts` (add `isUnrecognized`; `isRecord` stays module-private — no export)
- Test: `src/lib/dashboard/live-feed.test.ts` (add `isUnrecognized` test block)

**Approach:**

- Predicate body:
  1. **Status gate:** `row.status === "needs_review"` — MUST stay first, since user-edited complete rows store a flat `Record<string, StoredField>` with no `fields` wrapper.
  2. **`doc_type` gate:** matches when `row.doc_type` is `null` OR `"unknown"` OR any string not in the `SUPPORTED_DOC_TYPES` array. Written out explicitly: `row.doc_type === null || row.doc_type === "unknown" || !SUPPORTED_DOC_TYPES.includes(row.doc_type as DocType)`. Note that `DocumentRow.doc_type` is typed `string | null` in `src/lib/database.types.ts` (NOT the narrower `DocType` union), so arbitrary strings are possible and must fall into the "not one of the supported types" branch. **Do NOT use `isDocType(row.doc_type)` as a guard here** — `isDocType` returns `false` for exactly the cases this gate wants to match (null, "unknown", unknown strings), so using it would invert the logic. The sibling `buildInitialsForEdit` in `DocumentDetail.tsx` uses `isDocType` deliberately for the opposite purpose (narrowing to known types); this predicate has the mirror requirement.
  3. **Record gate:** `isRecord(row.extracted_data) && row.extracted_data.fields === null`. Reuses the existing module-private `isRecord` helper at `src/lib/dashboard/live-feed.ts:102-104` without exporting it (both the predicate and its tests live in the same module pair, so no public API widening is needed).
     If any gate fails, return `false`.
- Keep the predicate pure (no side effects, no async) to match `countLowConfidence`'s shape.

**Patterns to follow:**

- `countLowConfidence` in the same file (`src/lib/dashboard/live-feed.ts:120-154`) — status-gated → narrow `extracted_data` → iterate/check.

**Test scenarios:**

- Happy path: `needs_review` + `doc_type: "unknown"` + `extracted_data: { doc_type: "unknown", doc_type_confidence: 0.4, fields: null }` → returns `true`.
- Happy path: `needs_review` + `doc_type: null` + same `extracted_data` shape → returns `true` (null `doc_type` routes to Unrecognized).
- Edge case: `needs_review` + `doc_type: "1099_k"` (arbitrary unsupported string) + same `extracted_data` shape → returns `true` (any string not in `SUPPORTED_DOC_TYPES` routes to Unrecognized).
- Edge case: `needs_review` + `doc_type: "w2"` + `extracted_data: { doc_type: "w2", doc_type_confidence: 0.6, fields: { wages: {value: 50000, confidence: 0.5}, ... } }` → returns `false` (low-confidence W-2 is the "Needs review" path, not Unrecognized).
- Edge case: `needs_review` + `doc_type: "unknown"` + `extracted_data: null` → returns `false` (predicate must not match when the record is missing entirely; guards against schema drift).
- Edge case: `needs_review` + `doc_type: "unknown"` + `extracted_data: { doc_type: "unknown", fields: {} }` (empty object, not null) → returns `false` (only strictly-null `fields` matches; empty object is an unexpected shape we don't claim for Unrecognized).
- Status gating: `complete` + unknown + null fields → returns `false`; `failed` + unknown + null fields → returns `false`; `pending` / `processing` + anything → returns `false`.

**Verification:**

- All test scenarios above pass.
- `countLowConfidence` continues to work unchanged (no changes to `isRecord`'s scope).
- No other file has to change to keep the existing `live-feed` callers working.

---

- [ ] **Unit 2: Render "Unrecognized" pill in `StatusCell`**

**Goal:** When `isUnrecognized(row)` is `true`, `StatusCell` renders a distinct `Unrecognized` pill (icon prefix + muted text on the `outline` Badge base) instead of the `needs_review` label. Behavior is unchanged for all other rows.

**Requirements:** R1, R3, R6

**Dependencies:** Unit 1

**Files:**

- Modify: `src/app/(app)/dashboard/StatusCell.tsx` — add `FileQuestionIcon` to the existing `lucide-react` import alongside `AlertCircleIcon`; import `isUnrecognized` from `@/lib/dashboard/live-feed`; add the new branch described below.
- Test: none direct — StatusCell has no existing unit test file (the visible behavior is covered by the predicate unit tests in Unit 1 plus manual/Loom verification in Unit 5's acceptance checklist). If QA wants regression coverage later, add an RTL test then.

**Approach:**

- Branch on `isUnrecognized(row)` at the top of the component. Return a dedicated `<Badge variant="outline" className="text-muted-foreground gap-1"><FileQuestionIcon className="size-3.5" aria-hidden />Unrecognized</Badge>` before the existing `statusLabel[row.status]` / `statusVariant[row.status]` lookup runs.
- Do not add `Unrecognized` to the `statusLabel` / `statusVariant` maps — those are keyed by DB status, and Unrecognized is a UI-derived state over `needs_review`. Keeping it as a separate branch preserves the 1:1 status→label mapping for every other case.
- No low-confidence chip for Unrecognized rows (there are no fields to be low-confidence about). The existing `ConfidenceCountChip` gate already excludes non-`complete` rows, so no additional change is needed.
- Do not add `aria-label` on the pill — follow the existing pattern where the column header provides `Status` context.

**Patterns to follow:**

- Existing `StatusCell` branching at lines 41-57 (the `failed` case adds a popover before the common pill renders; Unrecognized follows the same "early return for special-cased state" shape, just before the default switch).
- Icon import style: `FileQuestionIcon` from `lucide-react`, matching `UploadCloudIcon` / `Trash2Icon` / `AlertCircleIcon` usage elsewhere in the project.

**Test scenarios:**

- Test expectation: none direct for this unit — covered transitively by Unit 1 predicate tests and Unit 5's integration routing plus manual acceptance checklist. If a regression later justifies it, add an RTL snapshot covering: (a) Unrecognized row renders `Unrecognized` label + `FileQuestionIcon`, (b) a low-confidence `needs_review` W-2 still renders `Needs review`, (c) `complete` / `failed` / `pending` / `processing` render unchanged.

**Verification:**

- Dashboard renders `Unrecognized` pill for a seeded `needs_review` + `doc_type: "unknown"` row (verified manually in Unit 5's acceptance step).
- A low-confidence `needs_review` W-2 still renders `Needs review` — regression check against R3.
- No visual regression on other pills.

---

- [ ] **Unit 3: Render "Unrecognized" pill in `DocumentDetailHeader`**

**Goal:** When `isUnrecognized(row)` is `true`, `DocumentDetailHeader` renders the same "Unrecognized" pill shape used in `StatusCell` (icon prefix + muted text on `outline` Badge) instead of the default `STATUS_LABEL.needs_review` badge. This closes the header-vs-panel contradiction — without this unit, an Unrecognized document shows "Needs review" in the page header while the right column says "No data extracted."

**Requirements:** R1, R3

**Dependencies:** Unit 1

**Files:**

- Modify: `src/app/(app)/documents/[id]/DocumentDetailHeader.tsx` — add `FileQuestionIcon` to the existing `lucide-react` import alongside `ChevronLeftIcon`; import `isUnrecognized` from `@/lib/dashboard/live-feed`; swap the status-badge line for a conditional expression.
- Test: none direct — same treatment as Unit 2 (no existing test file; coverage via predicate unit tests in Unit 1 + manual verification in Unit 5's acceptance checklist).

**Approach:**

- Compute `const isUnrecognizedRow = isUnrecognized(row);` once near the top of the component, adjacent to the existing `docTypeLabel` computation.
- Replace the line `<Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{STATUS_LABEL[row.status]}</Badge>` (currently at `src/app/(app)/documents/[id]/DocumentDetailHeader.tsx:39`) with:
  - If `isUnrecognizedRow` is true: `<Badge variant="outline" className="text-muted-foreground gap-1"><FileQuestionIcon className="size-3.5" aria-hidden />Unrecognized</Badge>` — same shape as Unit 2's `StatusCell` pill.
  - Else: the existing ternary badge (destructive/secondary based on status).
- Do NOT hide the sibling doc-type badge (`{docTypeLabel}` at line 38). For Unrecognized rows it renders `"Unknown type"` via the existing `isDocType` guard at line 23 — this is compatible with the Unrecognized story, not contradictory. Hiding it is a one-line follow-up if design feedback flags it as redundant.

**Patterns to follow:**

- Unit 2's `StatusCell` branch — the same two-property differentiation (icon + muted text on outline base) must be applied here verbatim so the pill is visually identical across the two surfaces.
- Existing `DocumentDetailHeader` JSX layout — keep the badge row order unchanged.

**Test scenarios:**

- Test expectation: none direct. Visible behavior is covered by manual verification in Unit 5 (which now explicitly checks the header pill for Unrecognized rows).

**Verification:**

- Header pill for an Unrecognized document reads **"Unrecognized"** (not "Needs review"), with the same icon + muted-text treatment used on the dashboard.
- Header pill for a low-confidence `needs_review` W-2 still reads **"Needs review"** (regression check against R3).
- `failed` / `complete` / `pending` / `processing` rows continue to render unchanged.

---

- [ ] **Unit 4: `UnrecognizedEmptyState` component + copy helper**

**Goal:** A client component that renders the empty-state panel on the document detail page for Unrecognized rows: heading, factual body copy with derived supported-types list, Delete button with Unrecognized-specific confirmation dialog, local idle/submitting/error state, `router.push("/dashboard")` on success. Plus a small pure helper for the supported-types list formatting so it can be unit-tested without requiring component-test infrastructure.

**Requirements:** R2, R4, R5

**Dependencies:** None (can be built in parallel with Units 1-3; wired up in Unit 5)

**Files:**

- Create: `src/app/(app)/documents/[id]/UnrecognizedEmptyState.tsx`
- Create: `src/app/(app)/documents/[id]/unrecognized-copy.ts` — exports `formatSupportedTypesList(): string` (see below).
- Test: `src/app/(app)/documents/[id]/unrecognized-copy.test.ts` — the only automated test for this unit. The component itself is deferred to manual verification (see Unit 5 acceptance), matching Units 2 and 3. The project's `vitest.config.ts` include glob is `.test.ts` only and `devDependencies` does not include `@testing-library/react` or `jsdom`, so `.test.tsx` files would be silently skipped — the right move for demo scope is to extract the testable pure logic and let the component itself rely on manual QA. Full RTL component coverage is captured under "Deferred to Separate Tasks."

**Approach:**

_`unrecognized-copy.ts` (pure helper):_

- Exports `formatSupportedTypesList(): string` which reads `SUPPORTED_DOC_TYPES` and `DOC_TYPE_SPECS` at call time and returns a comma-separated list with "or" before the final entry — e.g. `"W-2, 1099-NEC, 1099-MISC, or K-1"` for the current four-type roster.
- Implementation decision (this was previously a deferred question — resolving now): use an inline `join`-based formatter, not `Intl.ListFormat`. Four fixed English labels, no i18n story today; inline keeps the helper dependency-free and fully deterministic in tests. Implementer: collect labels via `SUPPORTED_DOC_TYPES.map(t => DOC_TYPE_SPECS[t].label)`, then if the array has ≥ 2 entries, render as `[...allButLast].join(", ") + ", or " + last`. Single-entry and empty-array cases are defensive-only (not reachable today) — return the single label or `""` respectively.

_`UnrecognizedEmptyState.tsx` (component):_

- File starts with `"use client";` pragma (matches sibling `DocumentDetail.tsx` and `NeedsReviewPicker.tsx`). Imports: `useRouter` from `next/navigation`, `useState` from `react`, Button and AlertDialog primitives from `@/components/ui/*`, `formatSupportedTypesList` from the sibling helper.
- Props: `{ documentId: string; filename: string }` — the detail page already has both on `row`.
- Local state: `isSubmitting: boolean`, `errorMessage: string | null`, `open: boolean` (dialog open state, mirroring `DeleteDocumentButton`).
- Markup shape:
  - Container div with rounded border + padding using `bg-muted/30` + `border` styling (mirror the existing `pending`/`processing` panel at `DocumentDetail.tsx:221` — NOT the amber `NeedsReviewPicker` theme; the neutral muted treatment is the right visual register for "no data extracted" state).
  - `<h2 className="text-sm font-medium">No data extracted</h2>` — no trailing period, matching `NeedsReviewPicker`'s h2 style at `NeedsReviewPicker.tsx:18`.
  - `<p>` body: `"This file couldn't be read as a supported tax form (${formatSupportedTypesList()}). It may be blank, a form we don't currently handle, or too poorly scanned to parse."` — factual and roadmap-neutral, resolves the product-lens contradiction where the earlier "we don't yet support it" copy implied a forward commitment the Delete-only UX couldn't deliver on.
  - `<AlertDialog>` block mirroring `DeleteDocumentButton` structure:
    - Trigger: a primary `<Button variant="destructive" size="default">Delete</Button>` (not a ghost/icon button — the detail page is single-record context; the destructive primary is the correct weight).
    - `AlertDialogTitle`: **"Remove unrecognized document?"**
    - `AlertDialogDescription`: `"This PDF (<span className='font-medium'>{filename}</span>) couldn't be read. Removing it won't affect your tax documents."` — filename bold, matching the `font-medium` span pattern in `DeleteDocumentButton.tsx:78`.
    - Cancel label: **"Keep"**
    - Confirm label: **"Remove"** (destructive styling). The dialog uses "Remove" deliberately — softer than "Delete document" in `DeleteDocumentButton` because the user is discarding unusable data, not a completed record. This divergence from the dashboard dialog's wording is intentional; do not "harmonize" during QA.
  - Below the Delete button, a conditional `<p role="alert" className="text-destructive text-sm mt-2">` that renders `errorMessage` when non-null. `role="alert"` ensures assistive tech announces the error; no toast for the reasons noted in Key Technical Decisions.
- Submit handler:
  1. Set `isSubmitting = true`, `errorMessage = null`.
  2. `fetch("/api/documents/${documentId}", { method: "DELETE" })`.
  3. If `response.ok`: first call `setOpen(false)` (unmounts the dialog cleanly while the component is still mounted), THEN `router.push("/dashboard")`. Ordering matters — closing the dialog after `router.push` can race with the unmount and warn about state updates on an unmounted component.
  4. If `!response.ok` or throw: set `errorMessage = "Couldn't remove — try again."`; set `isSubmitting = false`; `console.error` the underlying cause so it reaches Vercel function logs. Do NOT close the dialog on error — keep it open so the user can retry without re-clicking Delete, matching `DeleteDocumentButton`'s current behavior on failure (its `setOpen(false)` runs in `finally` and closes on success; on error, the toast signals failure and the row optimistic-remove is reverted — the detail-page flow has no list to revert, so keeping the dialog open preserves the retry affordance).
- During `isSubmitting`: both `Keep` and `Remove` dialog buttons go `disabled`. No spinner, no text change to "Removing…" — matches `DeleteDocumentButton.tsx:83-88` exactly. The plain-disabled treatment is the consistent pattern; divergent loading affordance is not worth the inconsistency for this flow.
- **Focus management on mount:** no autofocus. The Delete button sits below the heading + body copy in normal document flow, which is the right reading order for keyboard and screen-reader users. Explicit autofocus to the Delete button would skip the explanation and point a screen reader directly at a destructive action. Declining autofocus here is the deliberate choice.

**Patterns to follow:**

- `src/app/(app)/dashboard/DeleteDocumentButton.tsx` — dialog structure, `isSubmitting` flag, button disable pattern. Copy the shape; diverge only where Key Technical Decisions documents the divergence.
- `src/app/(app)/documents/[id]/NeedsReviewPicker.tsx:18` — h2 heading style (`text-sm font-medium`, no trailing period).
- `src/app/(app)/documents/[id]/DocumentDetail.tsx:221` — the `pending`/`processing` panel's `bg-muted/30` + `border` styling. Match that, NOT `NeedsReviewPicker`'s amber theme (which signals "action needed," wrong register for Unrecognized).

**Test scenarios:**

_For `unrecognized-copy.test.ts` (the only automated coverage in this unit):_

- `formatSupportedTypesList()` with the current four-type roster returns `"W-2, 1099-NEC, 1099-MISC, or K-1"` exactly.
- Property-style: the returned string contains each of the four current `DOC_TYPE_SPECS[t].label` values (so the test does not drift if a label is renamed without updating the assertion).

_For `UnrecognizedEmptyState.tsx` itself: test expectation — none direct._ Component behavior (dialog open/close, fetch + error + navigation) is verified manually in Unit 5's acceptance checklist. Full RTL coverage requires the test-harness work captured in "Deferred to Separate Tasks." For demo scope, the risk is acceptable because (a) the submit-handler logic is a straight mirror of `DeleteDocumentButton` with well-delineated divergences, and (b) Unit 5's checklist includes both happy-path and failure-path manual simulations.

**Verification:**

- `unrecognized-copy.test.ts` passes.
- Manual (covered in Unit 5 acceptance): opening an Unrecognized document shows the panel; clicking Delete → Remove closes the dialog and redirects to `/dashboard`; simulating a 500 (DevTools offline throttle, click Remove) surfaces the inline error, re-enables the Remove button, and keeps the dialog open for retry.

---

- [ ] **Unit 5: Wire `UnrecognizedEmptyState` into `DocumentDetail`**

**Goal:** `DocumentDetail` routes Unrecognized rows to the new empty-state panel instead of `NeedsReviewPicker`. All other status routing is unchanged.

**Requirements:** R1, R2, R3, R4, R5, R6, R7 (this unit is where end-to-end requirements land — it's the final wire-up and the manual-acceptance gate)

**Dependencies:** Units 1 and 4

**Files:**

- Modify: `src/app/(app)/documents/[id]/DocumentDetail.tsx`

**Approach:**

- Import `isUnrecognized` from `@/lib/dashboard/live-feed` and `UnrecognizedEmptyState` from the sibling file.
- In the existing right-column branch structure (currently `DocumentDetail.tsx:188-240`), add a top-priority branch **before** the `needs_review && pickedType === null` check that renders `NeedsReviewPicker`. Branch condition is just `isUnrecognized(row)` — no redundant outer `row.status === "needs_review"` check, since the predicate's first gate already requires it. When the branch matches, render `<UnrecognizedEmptyState documentId={row.id} filename={row.filename} />`.
- No other changes to `DocumentDetail`. The `inputs` computation (lines 162-172) already excludes Unrecognized because it checks `isDocType(row.doc_type)` — `"unknown"` fails that guard, so `inputs` is `null` and no form renders. The new branch makes that implicit exclusion explicit.
- Left-column PDF preview continues to render unchanged, per origin doc.

**Patterns to follow:**

- Existing conditional JSX at lines 187-240 — add the new branch as a peer of the other conditional blocks.

**Test scenarios:**

- Test expectation: none direct. `DocumentDetail` has no existing unit test, and its branching logic is covered by Unit 1 predicate tests + Unit 4's pure-logic helper tests + this unit's manual acceptance checklist. Full RTL coverage for `DocumentDetail` branch routing is deferred alongside the other component tests pending test-harness work.

**Verification — manual acceptance checklist (this is the demo gate):**

_Dashboard surface:_

- Seed (or wait for) a `needs_review` + `doc_type: "unknown"` + `fields: null` row (e.g., upload a blank PDF or W-9 fixture) → dashboard pill reads **"Unrecognized"** with the `FileQuestionIcon` prefix and muted-foreground text. Not "Needs review." (R1 — `StatusCell` branch, Unit 2)
- A low-confidence `needs_review` W-2 (seeded fixture or real upload) still shows the **"Needs review"** pill unchanged. (R3 regression)
- With the dashboard's **"Needs review"** status filter active, both pill variants appear in the same list; the stats-strip "Needs review" count includes Unrecognized rows. (R6)

_Detail-page surface:_

- Clicking through to an Unrecognized document opens the detail page. Page-header status badge reads **"Unrecognized"** (same pill shape as the dashboard, not "Needs review"). (R1 — `DocumentDetailHeader` branch, Unit 3)
- Right column renders the empty-state panel: heading **"No data extracted"** (no trailing period), factual body copy referencing the four supported types, and a primary **Delete** button. The `NeedsReviewPicker` is not shown. (R2)
- Clicking Delete opens the confirmation dialog with title "Remove unrecognized document?", filename bold in the body, cancel label "Keep", confirm label "Remove". (R2)
- Clicking Remove on a healthy network: dialog closes cleanly, URL navigates to `/dashboard`, and the deleted row is gone from the list (via realtime subscription on the dashboard). (R4)
- Failure simulation: set DevTools to "Offline" (or otherwise force a non-2xx from `/api/documents/[id]`), click Delete → Remove → the inline error "Couldn't remove — try again." appears under the button with `role="alert"`, the Remove button re-enables, and the dialog stays open so the user can retry without re-clicking Delete. (R5)

_Unchanged-behavior regression checks:_

- `complete` / `failed` / `pending` / `processing` documents render unchanged on the dashboard and on the detail page.
- Deleting from the dashboard's row action (existing `DeleteDocumentButton`) still works as before (toast, optimistic remove, restore on failure).

_Invariants:_

- No database migration was run. No changes to `src/lib/extract/pipeline.ts`, `src/lib/extraction/*`, the `update_extraction_result` RPC, or `src/app/api/documents/[id]/route.ts`. (R7)

## System-Wide Impact

- **Interaction graph:** `DocumentDetail` gains one new branch; `StatusCell` and `DocumentDetailHeader` each gain one early-return branch; `live-feed` gains one new exported predicate (`isUnrecognized`). The module-private `isRecord` helper stays private. No new middleware, callbacks, or observers. The predicate's pure-function nature means callers can't depend on it for anything outside rendering.
- **Error propagation:** DELETE failure surfaces as a local `errorMessage` state in `UnrecognizedEmptyState` and a `console.error` log — does not leak to toast or global handlers. Matches the detail-page "user is mid-action on one row" context.
- **State lifecycle risks:** None. Component is self-contained; no cache invalidation, no optimistic mutation of parent state (the dashboard's realtime subscription handles the delete propagation after navigation). The submit handler explicitly closes the dialog before calling `router.push` to avoid unmount-during-state-update races. If the user navigates back before the realtime event arrives, the row may briefly still render — identical to today's behavior after `DeleteDocumentButton` clicks on the dashboard, acceptable.
- **API surface parity:** No API changes. The existing `DELETE /api/documents/[id]` is re-used; its auth + workspace + storage cleanup contract is unchanged.
- **Integration coverage:** The full "Supabase write → realtime → Unrecognized pill renders → Remove navigates → row gone" path is covered only by manual verification in Unit 5 — no automated end-to-end test. Acceptable for demo hardening; the predicate is pure and the render branches are narrow. Automated RTL component coverage is captured in "Deferred to Separate Tasks" pending test-harness work.
- **Unchanged invariants:**
  - `documents.status` enum: unchanged. Unrecognized is a UI derivation; the DB value stays `needs_review`.
  - `update_extraction_result` RPC: unchanged.
  - `src/lib/extract/pipeline.ts` and `src/lib/extraction/*`: unchanged.
  - `src/app/api/documents/[id]/route.ts`: unchanged. The detail-page Delete button uses the same endpoint as the dashboard.
  - `DeleteDocumentButton` (dashboard-row context): unchanged — the detail-page button is a separate component.
  - `NeedsReviewPicker` and `ExtractedFieldsForm`: unchanged; they continue to serve the low-confidence-with-supported-doc-type path.
  - The `"Needs review"` filter and stats-strip count continue to include Unrecognized rows (the DB status is `needs_review`).
  - `DocumentDetailHeader`'s doc-type badge (e.g., "Unknown type" label for non-`DocType` rows) is NOT modified in this plan — only the status badge changes. The two badges coexist compatibly for Unrecognized rows.

## Risks & Dependencies

| Risk                                                                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pill variant visually blends with `Needs review` (both are `outline`-based) during a demo glance                                                  | Two-property differentiation (icon prefix + `text-muted-foreground`); verify in actual browser before Loom with a side-by-side row. If still too subtle, fallback is to swap the `outline` base for a new local Badge variant in `src/components/ui/badge.tsx` — small, contained change                                                   |
| `fetch` in `UnrecognizedEmptyState` fails silently if `console.error` is the only failure surface and the inline error is missed                  | Inline error uses `role="alert"` so assistive tech announces it; manual QA step explicitly simulates DELETE failure                                                                                                                                                                                                                        |
| Detail page is static and won't auto-refresh if a `processing` row transitions to Unrecognized while the page is open                             | Acceptable by design (origin doc §Document Detail Page). Dashboard is realtime-subscribed; the natural flow exits and re-enters the detail page                                                                                                                                                                                            |
| Predicate misclassifies a row whose `extracted_data` has an unexpected shape (e.g. Gemini prompt evolution writes `fields: {}` instead of `null`) | Predicate's third gate is strict `=== null`. An unexpected shape returns `false` → row falls through to the existing `Needs review` pill + picker. This is the safer failure mode — user still sees the document and can make a decision                                                                                                   |
| `DocType` enum gains a new type post-plan (e.g. 1099-K support) and the body copy needs updating                                                  | Body copy derives from `SUPPORTED_DOC_TYPES` + `DOC_TYPE_SPECS` at render time via Unit 4's `formatSupportedTypesList` helper — adding a type to those constants flows through automatically. The helper's test (`unrecognized-copy.test.ts`) asserts the property-style "contains each label" check so it won't drift when labels change. |

## Documentation / Operational Notes

- No runbook or operational doc changes. This is UI-only.
- Once merged, consider a one-line note in `README.md` or the demo script clarifying that "Unrecognized" rows are the expected state for unsupported forms — not a system error. Not required for this PR.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-24-blank-pdf-upload-behavior-requirements.md`
- **Parallel brainstorm** (related, not a dependency): `docs/brainstorms/2026-04-24-gemini-error-messages-requirements.md` — owns the `failed + empty_response` copy path; not re-scoped here.
- **Parallel plan** (related, not a dependency): `docs/plans/2026-04-24-002-feat-gemini-error-messages-plan.md` — Gemini error message user-facing copy.
- Related code (read during planning): `src/lib/dashboard/live-feed.ts`, `src/app/(app)/dashboard/StatusCell.tsx`, `src/app/(app)/dashboard/DeleteDocumentButton.tsx`, `src/app/(app)/documents/[id]/DocumentDetail.tsx`, `src/app/(app)/documents/[id]/DocumentDetailHeader.tsx`, `src/app/(app)/documents/[id]/NeedsReviewPicker.tsx`, `src/app/(app)/documents/[id]/form-schemas.ts`, `src/lib/documents/doc-types.ts` (re-exported via form-schemas), `src/app/api/documents/[id]/route.ts`, `src/app/(app)/dashboard/page.tsx`, `vitest.config.ts`, `package.json` (devDependencies check for test-harness readiness).
