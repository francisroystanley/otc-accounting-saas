---
date: 2026-04-24
topic: blank-pdf-upload-behavior
status: ready-for-planning
---

# Blank / Unrecognized PDF Upload Behavior

## Problem Frame

Today, if a user uploads a **valid-but-blank PDF** (or any PDF whose content Gemini can't classify as a supported tax form — e.g. a W-9, a receipt, a poorly scanned page), the document lands in `needs_review` with `doc_type: "unknown"` and `fields: null`.

Two UX issues follow:

1. **Dashboard row looks identical** to a legitimately low-confidence extraction (e.g. a W-2 Gemini wasn't sure about). Both render the same "Needs review" pill. The user can't tell which rows are recoverable and which aren't without opening each one.
2. **Detail page prompts `NeedsReviewPicker`** ("Pick W-2 / 1099-NEC / 1099-MISC / K-1 to complete manually"). That's the wrong prompt — the user can't manually classify a blank page or an unsupported form. The flow dead-ends with no clear next action.

This is **demo hardening**, not an incident response. The goal is that if someone uploads a blank or unsupported PDF during the Loom / live demo, the product reacts in a way that looks intentional and guides the user to a clear next action (delete + re-upload).

## Current Flow (verified)

1. Upload gates catch 0-byte files and non-PDF magic bytes — `src/lib/upload/validate.ts:38-54` and `src/lib/upload/client-batch.ts:74-98`. Those paths are already user-friendly and **out of scope here**.
2. Valid PDFs reach the extract pipeline. For content Gemini can't classify, `extractFromPdfBytes` returns `{ doc_type: "unknown", doc_type_confidence: X, fields: null }` — see `src/lib/extraction/schemas.ts:102-118`.
3. `runExtractPipeline` at `src/lib/extract/pipeline.ts:116-120` sets `finalStatus: "needs_review"` whenever `doc_type === "unknown"` or confidence is below threshold. The result is written to `documents.extracted_data` via the `update_extraction_result` RPC.
4. Dashboard pill rendering at `src/app/(app)/dashboard/StatusCell.tsx:16-30` maps status 1:1 to label/variant. No UI distinction exists today between "low-confidence W-2" and "unknown-type blank page."
5. Detail page at `src/app/(app)/documents/[id]/DocumentDetail.tsx:187-204` renders `NeedsReviewPicker` for every `needs_review` row, regardless of `doc_type`.

## Framing Decision: "Unrecognized" Covers Blank + Unsupported

The request started as "blank PDF behavior," but **we have no post-extraction signal to distinguish a blank page from an unsupported-but-non-blank form.** Both produce `doc_type: "unknown"` + `fields: null`.

The requirements below therefore address the broader "Gemini couldn't recognize this" class — of which blank is a subset. The pill label and detail-page copy reflect both causes.

Distinguishing blank from unsupported would require either a pre-extraction PDF text sniff or an enriched Gemini prompt — both are **out of scope** for demo hardening (see Non-Goals).

## Scope

**In scope:**

- Add a derived UI state **"Unrecognized"** that renders as a distinct pill in the dashboard, using existing `extracted_data` fields. No schema change.
- Replace `NeedsReviewPicker` on the detail page with an empty-state panel for Unrecognized documents. Panel contains a short explanation and a single **Delete** button.
- Detection rule applies only to the `needs_review` code path — which is where Gemini's `doc_type: "unknown"` result lands. A blank PDF that instead triggers a Gemini `empty_response` ExtractionError (rare) lands in `failed`, not `needs_review`, and its user-facing copy is owned by the parallel `gemini-error-messages` brainstorm, not re-scoped here.

**Out of scope / non-goals:**

This is a UI-only derivation — no schema, RPC, or pipeline changes are needed (they're structurally excluded, not separately declined). The genuine product decisions deliberately excluded here are:

- No client-side pre-upload blank detection (would require pdf.js in the browser — over-scoped for demo hardening).
- No server-side PDF text sniff to distinguish blank from unsupported. Both roll up under "Unrecognized."
- No retry / re-extract button on the detail page. Delete is the only action.
- No new dashboard filter for "Unrecognized." The existing "Needs review" filter continues to include these rows.
- No change to stats-strip counts. Unrecognized documents still contribute to the `needs_review` count.

## Detection Rule

A `DocumentRow` renders as **Unrecognized** when **all** of the following are true:

1. `row.status === "needs_review"`
2. `row.doc_type === "unknown"` (or `row.doc_type` is null / not one of the supported types — `w2`, `1099_nec`, `1099_misc`, `k1`)
3. `row.extracted_data` is a record whose `fields` key is `null`. Because `documents.extracted_data` is typed `Json | null`, the predicate must first narrow the value to a record before accessing `.fields` — reuse the `isRecord` pattern at `src/lib/dashboard/live-feed.ts:102-104`. If `extracted_data` is null, not a record, or its `fields` key is missing, the predicate returns `false`. The extract pipeline writes `{ doc_type, doc_type_confidence, fields: null }` for unknown results (normalized by the Zod preprocess at `src/lib/extraction/schemas.ts:107-117`), so this narrow-and-check matches the stored shape exactly. The status check in (1) MUST remain the first clause — user-edited complete rows store a flat `Record<string, {value, confidence}>` in `extracted_data` with no `fields` wrapper, so the wrapped shape is only reliable for `needs_review` rows.

The predicate's boolean output maps directly to whether the UI renders the **Unrecognized** state — there is no intermediate layer. If any of (2) or (3) are false — i.e. the row is `needs_review` because of **low confidence** on an identified doc type — the row renders as the existing "Needs review" pill and the existing `NeedsReviewPicker` flow. That case is unchanged.

The detection predicate lives in a small pure helper (e.g. `src/lib/dashboard/is-unrecognized.ts`) so it is reused between `StatusCell` and `DocumentDetail` and is unit-testable.

## UX Changes

### Dashboard

- **Pill presentation.** All four shadcn Badge variants (`default`, `secondary`, `destructive`, `outline`) are already consumed by the five existing status pills (see `src/app/(app)/dashboard/StatusCell.tsx:24-30`), so the Unrecognized pill cannot pick a fully unused variant. Instead it reuses the `outline` base and differentiates by **two visual properties** (not color alone — required for color-vision-deficiency accessibility):
  1. An inline icon prefix — `FileQuestionIcon` from `lucide-react`, sized to match the Badge's text height.
  2. `text-muted-foreground` applied to the badge label, distinguishing it from the full-contrast text on the `Pending` and `Needs review` pills that share the `outline` base.
- The pill replaces "Needs review" for rows matching the detection rule. No low-confidence chip is shown (there are no fields to be low-confidence about).
- **Aria labeling.** Follow the existing `StatusCell` pattern — the column header provides the `Status` context, so no explicit `aria-label` is added to the pill itself.
- No new tooltip or popover. The pill itself is enough context; the detail page carries the explanation.

### Document Detail Page

When an Unrecognized document is opened, the right-hand column (where `NeedsReviewPicker` currently renders) shows an empty-state panel with:

- **Heading:** "No data extracted." Neutral and factual — avoids the AI-apology pattern ("We couldn't recognize...") and leaves the action to the Delete button and body copy.
- **Body copy (roadmap-first framing):** "We couldn't extract this as a W-2, 1099-NEC, 1099-MISC, or K-1. If it's a different tax form, we don't yet support it — otherwise the PDF may be blank or too poorly scanned to read." The supported-types list in this copy must derive from the shared `DocType` constant rather than being hardcoded, so it stays in sync when new types are added. Leading with the "we don't yet support" framing positions the supported-forms list as a roadmap rather than a wall — addresses the product-lens concern that Delete-only + laundry-list copy teaches product rigidity.
- **A single primary `Delete` button** that uses the existing confirmation-dialog pattern from `src/app/(app)/dashboard/DeleteDocumentButton.tsx`, but with Unrecognized-specific copy (the generic "Delete? Cannot be undone." reads as alarming when the data was never useful):
  - Dialog heading: **"Remove unrecognized document?"**
  - Dialog body: **"This PDF couldn't be read. Removing it won't affect your tax documents."**
  - Confirm label: **"Remove"**; cancel label: **"Keep"**
- **Delete button states** (all required — do not leave to implementer guess):
  1. Idle — enabled, default Button styling.
  2. After the user clicks Confirm in the dialog — button disabled + inline spinner until the DELETE `/api/documents/[id]` call resolves. Prevents double-submission.
  3. On failure — button re-enables and an inline error message renders directly below the button: _"Couldn't remove — try again."_ Not a toast: the user is mid-action on this page and a toast can be missed.
  4. On success — `router.push("/dashboard")` returns the user to the dashboard, consistent with the existing delete-from-detail flow.

**Detail-page realtime behavior.** The detail page reads `row` from an initial server-rendered fetch in `src/app/(app)/documents/[id]/page.tsx` and does not subscribe to realtime status changes — this matches the detail page's behavior for every existing status transition today. If a user has a `processing` row open and it transitions to Unrecognized server-side, the page will not auto-update; the user's natural flow is upload → land on the dashboard (which _does_ subscribe via `live-feed.ts`) → click the document once it resolves. No new subscription work is in scope; the `row.status` routing already correctly renders the empty-state panel the next time the user lands on the page.

The left-hand PDF preview continues to render as it does for every other status — so the user can visually verify the PDF before removing it.

`NeedsReviewPicker` and `ExtractedFieldsForm` are **not** shown for Unrecognized rows.

## Success Criteria

- A user who uploads a blank or unrecognized PDF sees a distinct **"Unrecognized"** pill on the dashboard within the usual realtime-update window — not "Needs review."
- Opening that document shows the empty-state panel, not the form-type picker. The primary action is Delete, which goes through the Unrecognized-specific confirmation dialog copy.
- A user who uploads a supported tax form (W-2 etc.) that Gemini classifies correctly but with low confidence still sees the existing "Needs review" pill and the existing manual-completion flow — behavior for that case is unchanged.
- Confirming deletion from the detail page returns the user to the dashboard via `router.push("/dashboard")` and the row is gone.
- A failed DELETE renders an inline error under the button (not a toast); the button re-enables so the user can retry without leaving the page.
- **Mixed-list behavior is intentional (not a QA bug):** when the "Needs review" filter is active on the dashboard, both "Needs review" and "Unrecognized" pills render in the same list, and the stats-strip "Needs review" count continues to include both. This matches the out-of-scope decision to not add a separate filter or separate count for Unrecognized.
- No database migration is applied. No change lands in `src/lib/extract/pipeline.ts` or the extraction schemas.

_Implementation note (not a milestone gate):_ the `isUnrecognized` predicate has test coverage for the four documented cases — `needs_review` + `unknown` + null fields (true); `needs_review` + `w2` + non-null fields (false); `complete` + anything (false); `failed` + anything (false). "Non-null fields" asserts that `extracted_data.fields` is a non-null record, regardless of per-field confidence values. Coverage lives in the caller's existing test suite; no standalone test file is required.

## Open Questions for Planning

1. **Pill label wording.** `Unrecognized` is the starting draft. Alternatives: `Can't extract`, `Unsupported`, `Review (no data)`. Pick one in planning based on how it reads next to the other pills in the dashboard.
2. **Predicate location.** Three options, in order of increasing ceremony: (a) inline `isUnrecognized` as a named export from `StatusCell.tsx`, reused by `DocumentDetail` via a direct import; (b) co-locate in `src/lib/dashboard/live-feed.ts` next to the `DocumentRow` type and `isRecord` helper it depends on; (c) a standalone `src/lib/dashboard/is-unrecognized.ts` module. For a 3-clause predicate, (a) or (b) are justified — (c) is likely over-ceremonied. Planning picks one.
3. **Does the empty-state panel need the filename?** Small detail — probably yes so the user can confirm which file they're about to delete, matching `DocumentDetailHeader` which already shows it.
4. **Priority vs other pre-demo work.** Sequence this alongside the parallel `gemini-error-messages` brainstorm and any remaining U14 follow-ups. If the Loom script deliberately includes an unsupported-form upload as a feature moment, this is high priority; otherwise, it's defensive polish that can sit behind other items.
