---
title: "feat: U10 — upload dropzone UI"
type: feat
status: active
date: 2026-04-22
origin: docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md
---

# feat: U10 — upload dropzone UI

## Overview

Build the authed drag-and-drop upload surface at `/upload` that wires the browser client into the shipped `POST /api/upload/sign` + Supabase Storage `uploadToSignedUrl` + `POST /api/upload/finalize` flow (U9). Deliver the demo banner (R35) and the `(app)` authed layout chrome (top nav + sign-out) so every authed page is framed consistently. Keep all planning-time work focused on Client-Component glue, not reinventing the server contract.

## Problem Frame

U9 shipped and tested the server-side upload API. U10 is the first user-facing surface that exercises it end-to-end. The reviewer drops a stack of tax PDFs into the page, expects every file to either reach `pending` or fail with a per-file message that names the file — never a silent failure, never a whole-batch abort because one file is bad. The upload flow is also the only surface in the entire demo where a browser holds bytes of a user document, so error-code surfacing (from U9's enumerated codes) has to feel polished rather than leaking raw server responses.

Beyond the dropzone itself, U10 stands up the `(app)` route group layout shared by `/upload`, `/dashboard` (U11), and `/documents/[id]` (U12). The persistent demo banner (R35) lives in that layout so all three surfaces display it without per-page boilerplate.

See origin plan for full master framing: `docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md`.

## Requirements Trace

- **R5** Drag-and-drop multiple PDFs
- **R6** Per-file cap 10 MB, per-batch cap 10 files + client-side guards that mirror the server magic-bytes check
- **R7** Direct-to-Storage signed upload URLs (wire the browser to `uploadToSignedUrl`)
- **R33** User-facing error handling (per-file toasts, never a whole-batch failure mode)
- **R35** Accepted risks + demo banner (persistent, yellow, on every authed page)

## Scope Boundaries

This plan explicitly **does not** include:

- Polling fallback for Realtime (the dashboard surface, U11, handles live status; the upload page does not subscribe)
- Per-field progress over the Storage PUT (Supabase's `uploadToSignedUrl` does not expose XHR-level progress; the plan uses stepwise progress — sign / upload / finalize — rather than byte-level)
- Chunked or resumable uploads (demo PDFs are ≤ 10 MB; single PUT is sufficient)
- Replacing the dashboard page shell — U10 only adds the surrounding `(app)` layout so that chrome is consistent
- Any re-extraction, retry, or cancel affordances on already-queued files (a failed file is deleted by `/finalize`; the user re-drops)
- Client-side duplicate-filename detection across batches (the server's insert-unique `storage_path` is authoritative; duplicate drops of the same bytes are prevented by the per-call `documentId` UUID)

### Deferred to Separate Tasks

- None in this unit — the upload surface is a full vertical slice.

## Context & Research

### Relevant Code and Patterns

U9 already landed the full server contract and validation primitives:

- `src/app/api/upload/sign/route.ts` — POST handler; returns `{ ok: true, signedUrl, token, documentId, storagePath }` or `{ ok: false, code }`.
- `src/app/api/upload/finalize/route.ts` — POST handler; returns `{ ok: true, documentId }` or `{ ok: false, code }`.
- `src/lib/upload/sign.ts` — DI port + pure handler (`handleUploadSign`, `UploadSignPort`).
- `src/lib/upload/finalize.ts` — DI port + pure handler (`handleUploadFinalize`, `UploadFinalizePort`).
- `src/lib/upload/validate.ts` — shared constants (`MAX_UPLOAD_BYTES = 10 * 1024 * 1024`, `PDF_MAGIC_BYTES`, `storagePathForDocument`) and `validateFilename`. The client will import the constants and the filename validator directly — keep one source of truth.
- `src/lib/supabase/browser.ts` — `createSupabaseBrowserClient()` (singleton, asymmetric-keys safe) is the only Supabase surface legal in Client Components.
- `src/components/ui/sonner.tsx` — shadcn Sonner wrapper, already installed but **not yet mounted** in the root layout (verified via grep: only the definition exists). U10 mounts it.
- `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/LoginForm.tsx` — Client Component + shadcn composition pattern to mirror.
- `src/app/dashboard/page.tsx` — currently lives at `src/app/dashboard/`, outside any route group. U10 moves it into `src/app/(app)/dashboard/` so the shared authed layout applies. Path stays `/dashboard`.
- `src/app/actions/auth.ts` — `signOutAction` is already implemented and used from the current dashboard page; the new `(app)/layout.tsx` top nav takes over that wiring.

### Institutional Learnings

- `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md` — the server-side pattern U9 uses. U10 mirrors it on the client: the pure batch-orchestration logic (`uploadOne`, sequencing, error mapping) lives in a Node-testable module with an `UploadBatchPort` interface; the Client Component is the thin adapter that wires DOM + fetch + Supabase browser upload into the port. This is load-bearing because vitest is Node-only (per `vitest.config.ts`) — React component tests are out of scope for the demo, but the orchestration logic (which owns all the error-path branching R33 depends on) must still be unit-tested.
- `docs/solutions/best-practices/multi-write-route-idempotency-and-rollback-2026-04-22.md` — confirms that when `/finalize` fails after a successful Storage PUT, the server deletes the orphan object; the client does **not** need to attempt cleanup. This shapes the `uploadOne` error-recovery logic: on a non-200 from `/finalize`, just surface the error code — do not double-delete.
- `docs/solutions/best-practices/nextjs-supabase-shadcn-scaffolding-defaults-2026-04-21.md` — confirms the shadcn + route-group layout conventions used elsewhere in this repo.

### External References

- Supabase Storage `uploadToSignedUrl` — browser-side PUT to a pre-signed URL; returns `{ data: { path } | null, error }`. Does not expose progress events. Reference: `@supabase/storage-js` types bundled with `@supabase/supabase-js@^2.104`.
- Next 16 App Router route groups (`(app)`) — parentheses-named folders do not affect URL paths; files inside inherit the group's `layout.tsx`. Reference: `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`.
- Sonner Toaster — mount once in `src/app/layout.tsx` so toasts triggered from any Client Component surface in the tree.

## Key Technical Decisions

- **Native HTML5 drag-and-drop, no `react-dropzone`.** Master plan already rules this out. A controlled `<input type="file" multiple accept="application/pdf">` inside a `<div>` with `onDragOver`/`onDragLeave`/`onDrop` handlers is sufficient. Keyboard activation via click-through on the label — the hidden input owns tab focus.
- **Pure orchestration layer in `src/lib/upload/client-batch.ts`.** Exports a `UploadBatchPort` interface (the four effectful operations: `signUpload`, `putToStorage`, `finalizeUpload`, `onProgress`) and a pure `uploadOne(file, port) → Promise<UploadOneResult>` function. The Client Component constructs the real port (`fetch` + `supabase.storage.from('documents').uploadToSignedUrl` + `fetch`) and hands it to `uploadOne`. Unit tests in `client-batch.test.ts` use fake ports to exercise every error branch in Node vitest.
- **Stepwise progress, not byte-level.** Four states per file: `queued` (0%), `signing` (10%), `uploading` (40%), `finalizing` (75%), `done` (100%) | `failed`. Rendered as a determinate progress bar per row. Supabase's `uploadToSignedUrl` does not expose XHR progress, and switching to raw `fetch` + `ReadableStream` would buy a nicer bar at the cost of redundant auth + bucket policy handling. The demo evaluator cares about "did it work?" not "did each byte animate?"
- **`Promise.allSettled` for batch orchestration.** Enforces R33's "per-file failure, not batch failure" semantics. Ten files all race through `uploadOne`; each returns either `{ok: true, documentId}` or `{ok: false, code}`. The top-level code emits one Sonner toast per result.
- **Server error codes → user messages are centralized.** `client-batch.ts` exports a `userMessageForCode(code: string): string` mapping (e.g. `magic_bytes_mismatch` → "That file doesn't look like a PDF. Try again with a real PDF."). The map covers every enumerated code from `sign.ts`/`finalize.ts` (`forbidden_origin`, `unauthorized`, `invalid_json_body`, `invalid_payload`, `filename_*`, `forbidden_path`, `storage_object_missing`, `empty_upload`, `oversize`, `magic_bytes_mismatch`, `insert_failed`, `publish_failed`, `signed_url_failed`) plus client-synthesized codes (`network_error`, `storage_put_failed`, `too_many_in_batch`, `non_pdf_extension`, `non_pdf_mime`, `client_oversize`, `empty_file`).
- **Client-side validation mirrors the server, does not replace it.** Extension, MIME, size, and batch-cap checks run before any network call — failures surface as immediate toasts with no network cost. The server's magic-bytes check remains the security boundary; a renamed `.txt → .pdf` passes client validation but fails `/finalize`, which is the correct blast radius.
- **Dashboard moves into `(app)` route group.** Path stays `/dashboard`. The existing `src/app/dashboard/page.tsx` is moved to `src/app/(app)/dashboard/page.tsx` so the shared layout (top nav + demo banner) applies without duplicating chrome. The inline sign-out `<form>` inside the page is removed — the layout nav takes over.
- **Demo banner is an inert `<Alert variant="warning">`**, rendered once in `src/app/(app)/layout.tsx`. No dismiss. Copy per R35: "Demo only: synthetic PDFs — do not upload real tax documents."
- **Auth gate is layout-level.** `src/app/(app)/layout.tsx` calls `getAuthenticatedContext()`; if null, `redirect('/login')`. The per-page gates inside U10 and U11 become redundant but are kept as belt-and-suspenders defense (shallow, idempotent calls).
- **Sonner `Toaster` mounted once in the root layout** (`src/app/layout.tsx`), not in `(app)/layout.tsx`. Toasts can be triggered from the (auth) tree too (e.g., "Link expired" on `/login`); centralizing the mount avoids a future bug.
- **No `<progress>` element — render a Tailwind div.** shadcn hasn't installed a `progress` primitive in this repo (verified: no `src/components/ui/progress.tsx`). A two-div progress bar (`bg-muted` track + `bg-primary` fill, width = percent) is enough for the demo and avoids pulling in another Radix primitive.
- **`uploadOne` accepts an injected `AbortSignal`** even though the demo never cancels. The signal is threaded into both `fetch` calls and is a zero-cost affordance for U11's "leave the page" cleanup and future retry UX. Default: never-aborting.

## Open Questions

### Resolved During Planning

- **Move dashboard into `(app)` group, or keep it at `src/app/dashboard` and duplicate chrome?** Resolved: move. Keeping duplicated chrome would guarantee drift; U11 will touch `/dashboard` heavily and the layout needs to be in place before U11 starts.
- **Auto-navigate to `/dashboard` after a successful batch, or require a click?** Resolved: require a click. The master plan mentions both; the click form is more respectful of the user's attention during a batch and avoids a race if a late toast fires mid-navigation. The success state renders a `<Button asChild><Link href="/dashboard">View dashboard</Link></Button>`.
- **Single mixed list of `successful | failed | queued` rows, or split?** Resolved: single list, per-row state chip. A unified list keeps the rendered DOM predictable, matches Sonner's per-file-toast grain, and avoids a flash of re-ordering when a file transitions from `uploading` to `done`.
- **Where does the Sonner `Toaster` mount?** Resolved: root layout, not `(app)` — toasts can fire from `(auth)` surfaces too.
- **Native DnD vs react-dropzone.** Resolved via master plan: native.
- **Client MIME vs extension check?** Resolved: both. Extension == `.pdf` and `File.type === 'application/pdf'`. A PDF with a non-pdf MIME (rare, non-Chromium) is a corner case the server-side magic-bytes check still covers.

### Deferred to Implementation

- **Exact per-step progress percentages.** Placeholder values (10/40/75/100) may be nudged once the progress bar is rendered against real timing on a demo PDF. Pure visual polish; no behavior impact.
- **Whether to render a per-file cancel affordance.** U10 plumbs `AbortSignal` but does not render a cancel button. If time permits during implementation polish, a `<Button variant="ghost" size="icon">` with an X icon can be added; it is not required for demo.
- **Whether the drop target visual state should animate.** Defer to implementation — Tailwind class swap based on `isDragActive` state is sufficient; any transition polish is a nice-to-have.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

### Per-file upload lifecycle

```
 selected ──► pre-check ──► signing ──► uploading ──► finalizing ──► done
                 │              │            │              │
                 │              │            │              └─► failed (magic_bytes_mismatch, oversize, insert_failed, publish_failed, ...)
                 │              │            └─► failed (storage_put_failed)
                 │              └─► failed (signed_url_failed, unauthorized, forbidden_origin, invalid_payload, filename_*)
                 └─► failed (non_pdf_extension | non_pdf_mime | client_oversize | empty_file | too_many_in_batch)
```

### Component tree

```
src/app/layout.tsx (root)
  └── Toaster (sonner, mounted once)
      └── src/app/(app)/layout.tsx
              ├── <TopNav />  (workspace email + sign-out form)
              ├── <DemoBanner />  (persistent yellow alert)
              └── src/app/(app)/upload/page.tsx    (Server Component)
                      └── <UploadDropzone />       (Client Component — thin adapter)
                              └── uploadOne(file, port)   ← src/lib/upload/client-batch.ts (pure, testable)
                                      ├── port.signUpload(filename)
                                      ├── port.putToStorage(signed, token, file)
                                      ├── port.finalizeUpload({documentId, filename, storagePath})
                                      └── port.onProgress(fileId, stage, percent)
```

### Batch orchestration

```
user drops N files
  ├── per-file pre-check (extension + MIME + size) → immediate toast on failure
  ├── if batch length > 10, reject files 11+ with toast, let 1..10 proceed
  └── Promise.allSettled(files.map(f => uploadOne(f, realPort)))
        ├── each uploadOne emits onProgress("signing"|"uploading"|"finalizing"|"done"|"failed")
        ├── settle → per-file toast (success: "Queued: x.pdf"; failure: userMessageForCode(code))
        └── final state: list of row-status chips, "View dashboard" button enabled
```

## Output Structure

```
src/
├── app/
│   ├── layout.tsx                        (modify: mount <Toaster />)
│   ├── (app)/
│   │   ├── layout.tsx                    (new: auth gate + TopNav + DemoBanner)
│   │   ├── dashboard/
│   │   │   └── page.tsx                  (move from src/app/dashboard/page.tsx; strip inline sign-out)
│   │   └── upload/
│   │       └── page.tsx                  (new: Server Component shell; renders <UploadDropzone />)
│   └── dashboard/                        (delete after move)
├── components/
│   ├── DemoBanner.tsx                    (new: persistent yellow Alert)
│   ├── TopNav.tsx                        (new: workspace label + sign-out form)
│   └── upload/
│       └── UploadDropzone.tsx            (new: Client Component; thin adapter over uploadOne)
└── lib/
    └── upload/
        ├── client-batch.ts               (new: pure orchestration; UploadBatchPort + uploadOne + userMessageForCode)
        └── client-batch.test.ts          (new: Node vitest against fake ports)
```

## Implementation Units

Three small, dependency-ordered sub-units. All three should land as one commit; the split is for implementation focus and test locality, not for separate PRs.

- [ ] **Sub-unit 10.1: `(app)` layout, DemoBanner, TopNav, dashboard move**

**Goal:** Stand up the shared authed layout chrome. Move the existing dashboard page into the `(app)` route group without changing its URL. Deliver the R35 demo banner and a top-nav sign-out that replaces the inline form.

**Requirements:** R35 (demo banner).

**Dependencies:** U5 (auth surfaces), U9 (already shipped).

**Files:**

- Create: `src/app/(app)/layout.tsx`
- Create: `src/components/DemoBanner.tsx`
- Create: `src/components/TopNav.tsx`
- Move: `src/app/dashboard/page.tsx` → `src/app/(app)/dashboard/page.tsx`
  - Strip the inline `<form action={signOutAction}>` from the moved page (TopNav owns this now).
  - Keep the `getAuthenticatedContext()` call + redirect inside the page as defense-in-depth (redundant with layout, cheap, idempotent).
- Delete: `src/app/dashboard/` (after move).

**Approach:**

- `(app)/layout.tsx` is a Server Component: `await getAuthenticatedContext()`, redirect to `/login` if null, then render `<DemoBanner />` above `<TopNav email={auth.email} />` above `{children}`. Use a container with `max-w-6xl mx-auto p-6` so all `(app)` pages inherit consistent horizontal rhythm.
- `DemoBanner`: `<Alert>` with `variant="warning"` (shadcn's `alert` already supports variants; if not, compose with `border-yellow-500 bg-yellow-50 text-yellow-900` Tailwind classes). Copy: **"Demo only: synthetic PDFs — do not upload real tax documents."** No close button.
- `TopNav`: renders the signed-in email on the left (from `auth` — `getAuthenticatedContext()` already returns `{ userId, workspaceId }`; if email is not part of that shape, extend the helper with one additional claim pull, scope: add `email` to the returned type and to the one other caller). On the right: `<form action={signOutAction}><Button type="submit" variant="outline" size="sm">Sign out</Button></form>`. Include a `<Link href="/dashboard">` for the app logo/name and `<Link href="/upload">` for "Upload".

**Patterns to follow:**

- `src/app/(auth)/layout.tsx` for route-group layout shape.
- `src/app/dashboard/page.tsx` (current) for the existing auth + sign-out wiring — lift the sign-out into `TopNav`, preserve the redirect.

**Test scenarios:**

- **Happy path:** Navigate to `/dashboard` while signed in → layout renders the banner above the top nav above the page content; sign-out button is visible.
- **Happy path:** Navigate to `/upload` while signed in → same layout chrome renders (banner present).
- **Error path:** Navigate to `/dashboard` or `/upload` while signed out → redirect to `/login`.
- **Integration:** Clicking the sign-out button in TopNav clears the session and redirects to `/login` (same contract as the existing inline form).

**Verification:**

- `npm run lint` passes (strict TS + no bare `as` casts).
- `npm run build` passes with the moved file tree.
- Manual: log in, confirm banner is present on `/dashboard` and persists across a navigation to `/upload`.

---

- [ ] **Sub-unit 10.2: pure `client-batch.ts` + Node vitest coverage**

**Goal:** Extract the per-file upload orchestration into a pure, Node-testable module with a typed port. Cover every error branch in `client-batch.test.ts` using fake ports. This is the load-bearing R33 test surface — the Client Component in 10.3 is a thin adapter that is not reasonably testable in this repo's Node-only vitest setup.

**Requirements:** R5 (orchestration core), R6 (client-side size + batch cap), R7 (signed-URL flow), R33 (error-code → message mapping).

**Dependencies:** U9 (imports `MAX_UPLOAD_BYTES` + `validateFilename` from `src/lib/upload/validate.ts`).

**Files:**

- Create: `src/lib/upload/client-batch.ts`
- Create: `src/lib/upload/client-batch.test.ts`

**Execution note:** Test-first. Write `client-batch.test.ts` with the full error-branch matrix before the implementation; the fake ports are the specification.

**Approach:**

- Export `type UploadBatchPort = { signUpload: (filename: string) => Promise<SignResult>; putToStorage: (signedUrl: string, token: string, file: File) => Promise<PutResult>; finalizeUpload: (args: {documentId: string; filename: string; storagePath: string}) => Promise<FinalizeResult>; onProgress: (stage: UploadStage, percent: number) => void; signal?: AbortSignal }`.
- `SignResult`, `PutResult`, `FinalizeResult` are discriminated unions: `{ ok: true, ... } | { ok: false, code: string }`. Use Zod-at-boundary validation on any `unknown`-shaped port responses to keep strict TS honest without `as` casts.
- Export `preCheckFile(file: File): null | { code: ClientOnlyCode }` running: extension (`.pdf`), MIME (`application/pdf`), size (`isWithinSizeLimit`). Return the first failure.
- Export `preCheckBatch(files: File[]): { accepted: File[]; rejected: Array<{ file: File; code: 'too_many_in_batch' | ClientOnlyCode }> }`. Enforce the R6 batch cap (10) and run `preCheckFile` over the accepted slice.
- Export `uploadOne(file: File, port: UploadBatchPort): Promise<UploadOneResult>` where `UploadOneResult = { ok: true, documentId: string, filename: string } | { ok: false, filename: string, code: string }`. Sequence:
  1. `port.onProgress('signing', 10)` → `port.signUpload(file.name)` → on `ok: false` return with code; on ok, extract `{signedUrl, token, documentId, storagePath}`.
  2. `port.onProgress('uploading', 40)` → `port.putToStorage(signedUrl, token, file)` → on failure return `storage_put_failed`.
  3. `port.onProgress('finalizing', 75)` → `port.finalizeUpload({documentId, filename: file.name, storagePath})` → on `ok: false` return with code; on ok, `port.onProgress('done', 100)` and return `{ok: true, documentId, filename: file.name}`.
- Export `userMessageForCode(code: string): string`. Map every enumerated server code (`forbidden_origin`, `unauthorized`, `invalid_json_body`, `invalid_payload`, `signed_url_failed`, `filename_empty`, `filename_too_long`, `filename_has_path_separator`, `filename_has_null_byte`, `filename_not_pdf`, `forbidden_path`, `storage_object_missing`, `empty_upload`, `oversize`, `magic_bytes_mismatch`, `insert_failed`, `publish_failed`) + the client-synthesized codes (`network_error`, `storage_put_failed`, `too_many_in_batch`, `non_pdf_extension`, `non_pdf_mime`, `client_oversize`, `empty_file`) to a reviewer-legible sentence. Unknown codes fall through to a generic "Upload failed. Try again."

**Patterns to follow:**

- `src/lib/upload/sign.ts` + `src/lib/upload/finalize.ts` — same DI-port shape, same discriminated-union `{ok, code}` return style.
- `src/lib/upload/sign.test.ts` + `src/lib/upload/finalize.test.ts` — fake-port test style; covers every branch.
- `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md` — the institutional learning this unit embodies on the client side.

**Test scenarios:**

- **Happy path:** `preCheckFile` on a 2 MB `.pdf` with MIME `application/pdf` returns `null`.
- **Happy path:** `preCheckBatch` on 10 valid files returns all 10 accepted, zero rejected.
- **Happy path:** `uploadOne` with all three port steps returning `ok: true` resolves to `{ok: true, documentId, filename}` and calls `onProgress` in order: `signing` → `uploading` → `finalizing` → `done`.
- **Edge case:** `preCheckBatch` on 11 files returns 10 accepted and the 11th rejected with `too_many_in_batch`.
- **Edge case:** `preCheckFile` on a `.txt` file returns `{code: 'non_pdf_extension'}`.
- **Edge case:** `preCheckFile` on a 12 MB `.pdf` returns `{code: 'client_oversize'}`.
- **Edge case:** `preCheckFile` on a 0-byte file returns `{code: 'empty_file'}`.
- **Edge case:** `preCheckFile` on `.pdf` with MIME `text/plain` returns `{code: 'non_pdf_mime'}`.
- **Error path:** `uploadOne` where `signUpload` returns `{ok: false, code: 'unauthorized'}` resolves to `{ok: false, filename, code: 'unauthorized'}` and does **not** call `putToStorage` or `finalizeUpload`.
- **Error path:** `uploadOne` where `putToStorage` returns `{ok: false}` resolves to `{ok: false, code: 'storage_put_failed'}` and does **not** call `finalizeUpload`.
- **Error path:** `uploadOne` where `finalizeUpload` returns `{ok: false, code: 'magic_bytes_mismatch'}` resolves to `{ok: false, code: 'magic_bytes_mismatch'}`.
- **Error path:** `uploadOne` where `signUpload` throws (e.g., network error surfaced by `fetch` rejection) resolves to `{ok: false, code: 'network_error'}` — the orchestration catches and normalizes.
- **Error path:** `userMessageForCode('magic_bytes_mismatch')` returns a user-legible sentence naming "PDF" (filename lives in the toast, not the template).
- **Error path:** `userMessageForCode('some_unknown_code')` returns the generic fallback sentence.
- **Integration:** A full `uploadOne` run with fake ports that succeed emits `onProgress` exactly four times in order.

**Verification:**

- `npm test -- src/lib/upload/client-batch.test.ts` passes with every listed scenario exercised.
- `npm run lint` passes — zero `any`, zero bare casts.
- Coverage of `client-batch.ts` via targeted tests is visually complete (every branch touched).

---

- [ ] **Sub-unit 10.3: `UploadDropzone` Client Component + `/upload` page + root `Toaster` mount**

**Goal:** Wire the pure orchestration into the DOM. Render the drop target, per-file progress rows, post-batch summary, and toasts. Mount Sonner's `<Toaster />` once in the root layout so this and future surfaces can emit toasts.

**Requirements:** R5, R6, R7, R33.

**Dependencies:** Sub-unit 10.1 (layout), Sub-unit 10.2 (orchestration core), U9 (API already shipped).

**Files:**

- Modify: `src/app/layout.tsx` (mount `<Toaster />` from `@/components/ui/sonner`).
- Create: `src/app/(app)/upload/page.tsx` (Server Component shell).
- Create: `src/components/upload/UploadDropzone.tsx` (Client Component).

**Approach:**

- `src/app/layout.tsx`: import `Toaster`, render `<Toaster richColors closeButton position="top-right" />` as a sibling of `{children}`. Leave the existing `<Analytics />` and `<SpeedInsights />` mounts untouched. This is a two-line edit.
- `src/app/(app)/upload/page.tsx` is a Server Component. It calls `getAuthenticatedContext()` (defense-in-depth), then renders a page heading and `<UploadDropzone />`. No props pass through — the client component owns all state.
- `src/components/upload/UploadDropzone.tsx`:
  - `"use client";`
  - State shape: `type Row = { id: string; file: File; stage: UploadStage; percent: number; resultCode?: string }`. Managed with `useReducer` for predictable stage transitions. Keys are `crypto.randomUUID()` per drop (not per file — DnD can drop duplicates of the same File reference across separate drops).
  - Drop handler: `onDrop(e)` → `e.preventDefault()` → `Array.from(e.dataTransfer.files)` → pass through `preCheckBatch`. For each rejected file in pre-check, emit an immediate Sonner error toast with `userMessageForCode(code)` prefixed by the filename. For each accepted file, seed a `Row` with `stage: 'queued'` and fire `uploadOne(file, port)` as part of `Promise.allSettled(accepted.map(f => uploadOne(f, realPort(fileId))))`.
  - The click-through `<label htmlFor="upload-input">` + hidden `<input type="file" multiple accept="application/pdf">` gives keyboard users the same affordance. `onChange` of the input routes into the same batch entrypoint as drop.
  - `realPort(fileId)` closure:
    - `signUpload(filename)`: `await fetch('/api/upload/sign', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({filename}) })` → Zod-parse the response shape.
    - `putToStorage(signedUrl, token, file)`: `const supabase = createSupabaseBrowserClient(); const { data, error } = await supabase.storage.from('documents').uploadToSignedUrl(storagePath, token, file, { contentType: 'application/pdf', upsert: false });` → map to `{ok: true}` or `{ok: false}`. (The browser client derives `storagePath` from the `signedUrl`; pass it through the port as a closure variable rather than re-parsing.)
    - `finalizeUpload({documentId, filename, storagePath})`: `await fetch('/api/upload/finalize', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({documentId, filename, storagePath}) })` → Zod-parse.
    - `onProgress(stage, percent)`: dispatches `{type: 'progress', fileId, stage, percent}`.
  - After `Promise.allSettled` resolves, loop over results, dispatch final row states, emit one Sonner toast per result (`toast.success("Queued: " + filename)` or `toast.error(filename + " — " + userMessageForCode(code))`).
  - Render:
    - Drop target: large `<label>`-wrapped `<div>` with `aria-label="Drop PDFs or click to choose"`, hover + drag-active styling via Tailwind class swaps.
    - Rows list: `<ul>` of per-file rows with filename, two-div progress bar (width = percent), stage chip, result state (check icon / x icon / spinner).
    - Post-batch: when all rows are `done | failed`, show `<Button asChild><Link href="/dashboard">View dashboard</Link></Button>`.
  - Zod schemas for `/sign` and `/finalize` response bodies live alongside the component (small, local — not worth exporting). Runtime parse at the boundary (R32).

**Execution note:** Implement after 10.2 is green. Lean on manual browser verification for UI polish — vitest in this repo is Node-only and React-Testing-Library is not installed.

**Patterns to follow:**

- `src/app/(auth)/login/LoginForm.tsx` — Client Component structure, shadcn composition, error rendering idiom.
- `src/components/ui/sonner.tsx` — already exists; just mount `<Toaster />` in root layout.
- `src/lib/upload/validate.ts` — reuse `MAX_UPLOAD_BYTES` (client oversize toast copy can reference "10 MB").

**Test scenarios:**

Test expectation: **no new automated tests in this sub-unit** — the orchestration logic is covered by 10.2's unit tests, and the DOM layer is not reasonably testable in this repo's Node-only vitest setup. Manual verification below is the acceptance surface.

**Verification (manual, on `npm run dev`):**

- **Happy path:** Drop 3 valid PDFs (< 10 MB each). All three rows progress through `signing → uploading → finalizing → done`. Three success toasts appear. Visit `/dashboard` — three rows in `pending` or `processing` status.
- **Edge case:** Drop 11 valid PDFs. 10 succeed (each emits a toast); the 11th shows a "Max 10 files per batch" toast and is not uploaded.
- **Edge case:** Drop a `.txt` file. Immediate toast "That file isn't a PDF (extension)" (or equivalent). No network traffic in DevTools.
- **Edge case:** Drop a 12 MB PDF. Immediate toast "That file is over 10 MB." No network traffic.
- **Error path:** Drop a `.txt` renamed to `.pdf`. Client validation passes. Network shows `sign` → Storage PUT → `finalize`; `finalize` returns `magic_bytes_mismatch`. A failure toast with that code's message appears. No row is left in an indeterminate state. No row in the `documents` table.
- **Error path:** Simulate a network drop between `sign` and PUT (DevTools → offline). Toast shows `storage_put_failed` message; sibling files in the batch continue.
- **Integration:** Open `/upload` on an existing signed-in session in one tab, a different workspace's session in another. Drop the same bytes in both; each ends up in a different Storage prefix; neither sees the other's row on their dashboard.
- **Integration:** Demo banner is visible on `/upload` and `/dashboard`.
- **Integration:** Sign out from the `/upload` page's top nav → land on `/login`.

---

## System-Wide Impact

- **Interaction graph:** U10 produces `pending` rows that U8 (already shipped) will drive through `processing → complete | needs_review | failed`. The dashboard (U11, not yet shipped) subscribes via Realtime to observe this. U10 does **not** open a Realtime subscription of its own.
- **Error propagation:** Every server-recognized failure (enumerated codes in `sign.ts`/`finalize.ts`) surfaces as a per-file toast without interrupting the batch. Unrecognized codes fall through to a generic sentence — the missing entry becomes a lint-like signal when reviewing `userMessageForCode`.
- **State lifecycle risks:** A failed `/finalize` triggers server-side Storage cleanup (U9 verified). The client does **not** attempt to re-delete. A client-crashed upload mid-PUT leaves an orphan Storage object; U9 deletes it on the next `/finalize` attempt or when the workspace is deleted. This is documented in U15's "accepted risks" (R35).
- **API surface parity:** No new server routes. U10 is a consumer of the U9 contract. The error-code list in `userMessageForCode` is the **client-side mirror** of the server's enumerated codes; if U9 ever adds a new code, `userMessageForCode` needs the matching entry (lint-caught: falls through to generic sentence, tests would catch if scenarios added).
- **Integration coverage:** The `client-batch.test.ts` Node-level tests do not cover the real network. Manual cross-workspace drop-in-two-tabs (above) is the only E2E proof; no automated browser test in the demo window.
- **Unchanged invariants:** `/api/upload/sign` and `/api/upload/finalize` are untouched. `src/lib/upload/sign.ts`, `src/lib/upload/finalize.ts`, `src/lib/upload/validate.ts` are untouched. `src/lib/supabase/browser.ts` is untouched. The dashboard page's auth behavior (redirect if unauthenticated) is preserved by the `(app)` layout redirect.

## Risks & Dependencies

| Risk                                                                                                                            | Mitigation                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonner `<Toaster />` was never mounted in the root layout — toasts triggered from U10 would silently no-op                      | Explicit sub-unit 10.3 task: mount `<Toaster />` in `src/app/layout.tsx` and verify one test toast fires before wiring into the dropzone.                       |
| `uploadToSignedUrl` does not return `storagePath` — the client must thread it through the port closure                          | `realPort` is constructed per-row with `storagePath` captured from the `/sign` response; `putToStorage` receives it via closure, not as a port arg.             |
| Layout migration (moving `/dashboard` into `(app)`) breaks routing silently if a `(app)` and `dashboard` group collision exists | Delete the old `src/app/dashboard/` directory in the same commit as the move; `next build` will fail loudly if both exist.                                      |
| Client-side MIME checks are skippable (rename `.txt → .pdf` with MIME `application/pdf` injected by curl)                       | Acceptable; server's magic-bytes check in U9 is the security boundary. Client checks are UX.                                                                    |
| R33 partially demands "user-facing error handling" — a generic fallback sentence for unknown codes is thin                      | `userMessageForCode` has an entry for every code enumerated in `sign.ts` and `finalize.ts` at plan-write time; the fallback exists only as a defensive default. |
| DnD `dataTransfer.files` behavior varies subtly across browsers (Safari 15-, Firefox <90)                                       | Demo is evaluated on a current Chromium; accepted risk. README notes the supported browser list.                                                                |

## Documentation / Operational Notes

- No README change needed for U10 on its own — U15 writes the consolidated README with accepted-risks section that references the client-MIME caveat and orphan-object behavior.
- No new env vars. No new Vercel configuration.
- No new migrations.

## Sources & References

- **Origin plan:** `docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md` — U10 section, lines 703–746.
- **Already-shipped server contract (U9):** `src/app/api/upload/sign/route.ts`, `src/app/api/upload/finalize/route.ts`, `src/lib/upload/sign.ts`, `src/lib/upload/finalize.ts`, `src/lib/upload/validate.ts`.
- **Client Supabase singleton:** `src/lib/supabase/browser.ts`.
- **Institutional learning — DI port + thin adapter:** `docs/solutions/best-practices/testable-next-route-via-di-port-and-thin-adapter-2026-04-22.md`.
- **Institutional learning — multi-write idempotency + rollback (drives "don't double-delete" decision):** `docs/solutions/best-practices/multi-write-route-idempotency-and-rollback-2026-04-22.md`.
- **Layout + shadcn conventions:** `docs/solutions/best-practices/nextjs-supabase-shadcn-scaffolding-defaults-2026-04-21.md`.
- **Next 16 layouts and route groups:** `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`.
- **Sonner API (mounted `<Toaster />` + `toast.success`/`toast.error`):** `sonner` package in `package.json` (`^2.0.7`).
- **Supabase Storage `uploadToSignedUrl`:** `@supabase/supabase-js` (`^2.104.0`) / `@supabase/storage-js` types.
