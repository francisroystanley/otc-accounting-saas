---
title: "feat: U15 — Error-handling polish, deploy, README, Loom"
type: feat
status: active
date: 2026-04-24
origin: docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md
---

# U15 — Error-handling polish, deploy, README, Loom

## Overview

Final ship unit for the OTC Accounting SaaS prototype. Closes out the parent plan's U15 by completing all code-agent-executable deliverables (audit, error-polish, EXTRACTION_REPORT, README, Loom script) and preparing the handoff artifacts (deploy notes, reviewer email draft) for the user to execute. U1–U14 are complete; this unit is the last one before reviewer handoff.

## Problem Frame

Parent plan (`docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md`) defined a single U15 unit time-boxed to 2 hours on Fri 13:00–15:00 EDT. The worktree is already on `feat/u15-polish-deploy-readme-loom` at `f9d6be0`. All feature units (U1–U14) are committed. What remains:

1. **Pre-ship audit** — code smell sweep (casts, `any`, lint, build, demo banner), per R32/R35.
2. **Error-handling polish** — final toast copy and inline failed-row popover per R33.
3. **EXTRACTION_REPORT.md re-run** — current report is a blank-fixture baseline (see `docs/EXTRACTION_REPORT.md` "Baseline-only" banner); re-generate against the final schema and decide whether filled fixtures land or the baseline-only caveat stays.
4. **README final pass** — replace the 87-line provisional README with the reviewer-facing doc per R25.
5. **Deploy + GitHub invite + Loom + reviewer email** — R23/R24/R26/R27. These touch shared systems and require the user to execute; this plan captures the exact steps and a ready-to-send email template.

See parent plan lines 969–1012 for the full U15 scope and time-box.

## Requirements Trace

From the parent plan's Requirements Trace table (lines 58–72):

- **R23** Live Vercel URL — U15.5
- **R24** GitHub repo with `alex@owntheclimb.com` as collaborator — U15.6
- **R25** README covering setup + architecture + what's-not-built — U15.4
- **R26** Loom walkthrough (3–5 min) — U15.7 (recording)
- **R27** Credentials emailed — U15.8
- **R28c** Service-role usage inventory (documented in README) — U15.4
- **R32** Zero `: any` / bare casts (verified at ship-time) — U15.1
- **R33** User-facing error handling — U15.2
- **R35** Accepted risks + demo banner (documented in README) — U15.1 + U15.4

## Scope Boundaries

- **Not in scope:** adding new features, refactoring components, altering schema, changing auth flow. This unit is pure finishing work.
- **Not in scope:** filled-fixture curation (the parent plan's `fixtures/README.md` "Day-1 curation backlog" is explicitly deferred; baseline-only accuracy is accepted per R13).
- **Not in scope:** CI pipeline, monitoring, alerting (parent plan Operational Notes: "Not applicable for a prototype demo").

### Deferred to Separate Tasks

- **Filled-fixture accuracy calibration** — backlog lives at `fixtures/README.md`; re-run of `npm run extract:report` after filled fixtures land is a post-submission activity. EXTRACTION_REPORT.md carries the "baseline-only" banner so reviewer sees the honest caveat.
- **K-1 drop decision** — per `docs/EXTRACTION_REPORT.md` "K-1 inclusion decision" the call is deferred until filled K-1 fixtures land. The current build keeps K-1 in the discriminated union; if the reviewer asks, the drop path is documented in parent plan's Risks table.

## Context & Research

### Relevant Code and Patterns

- `src/app/(app)/layout.tsx:13` — `DemoBanner` already wired into every authed page (satisfies R35 banner requirement).
- `src/app/(app)/dashboard/DashboardTable.tsx` — failed-row click → popover with `error_message` already lands in U11; U15.2 only confirms copy.
- `src/app/api/documents/[id]/preview-url/route.ts` — preview-URL signing; expiry prompt in UI lives in U12.
- `src/lib/supabase/service.ts:8` — `server-only` guard: throws at import if `typeof window !== 'undefined'`. Five server-side call sites (all route handlers, catalog in U15.4).
- `docs/EXTRACTION_REPORT.md` — committed 2026-04-22; regenerate before ship and keep the baseline-only disclosure.
- `README.md` — 87 lines, currently marked provisional.

### Institutional Learnings

Relevant solutions in `docs/solutions/`:

- `best-practices/` patterns documented during U8/U9/U10/U11/U13/U14 — referenced by README's architecture section only if they change how a reviewer reads the code.
- `security-issues/` — enumerate in README "Known issues" and "Accepted risks" only if they remain unmitigated.

### External References

No new external references needed; README links out to parent plan's Sources & References section where appropriate.

## Key Technical Decisions

- **Ship README before EXTRACTION_REPORT re-run.** Content of README does not depend on the regenerated report — the only cross-reference is "see EXTRACTION_REPORT.md for details". Re-running extract costs Gemini quota (~48 calls, well under the 250 RPD assumption per parent plan's Risks table); if it fails at ship-time the committed 2026-04-22 baseline is acceptable.
- **Baseline-only accuracy banner stays.** Parent plan's R13a requires committing a rationale record. Filled fixtures are out of scope; the reviewer sees the honest "schema conformance, not real extraction" caveat. This is captured as a Known Issue in README, not hidden.
- **Deploy + email are user-executed.** Vercel `--prod` deploy, GitHub collaborator invite, Loom recording, and credential email are shared-system writes. The plan produces deploy instructions, an invite command, the Loom script, and an email template — the user runs them.
- **Do not amend EXTRACTION_REPORT.md if regeneration fails.** Preserve the last successful commit. README Known Issues section documents that the report is a point-in-time snapshot.
- **No new dependencies; no new source files in `src/`.** U15 is polish + docs + deploy only. Any source change would indicate scope creep back into U1–U14.

## Open Questions

### Resolved During Planning

- **Q: Do we re-run `npm run extract:report` at ship-time?**
  Resolution: Yes, opportunistically. If it fails, keep the 2026-04-22 commit and move on (parent plan fallback in U15 Approach time-box 13:40–14:00).
- **Q: Who invites `alex@owntheclimb.com` — agent or user?**
  Resolution: User. GitHub collaborator invite is a shared-system write (see parent plan's "Executing actions with care"). Plan provides the exact `gh` command.
- **Q: Does README duplicate the HLD diagram from the parent plan?**
  Resolution: Yes — reviewer should not need to open the plan file to understand the architecture. Copy the mermaid diagram (or a simplified version) into README and link to the plan for deeper context.

### Deferred to Implementation

- **Exact README section ordering** — follow parent plan's time-bucket 14:15–14:25 outline (Setup, Architecture, What was built, What was intentionally not built, Known issues, Extraction quality). Minor reorderings OK if they improve flow.
- **Whether to inline or link the HLD diagram** — decide at write-time based on README length; if > 300 lines, link; otherwise inline.

## Implementation Units

- [x] **U15.1: Pre-ship audit**

**Goal:** Verify R32 (zero `: any` / bare casts), build is clean, lint is clean, demo banner renders on all authed pages.

**Requirements:** R32, R35

**Dependencies:** None.

**Files:**

- No code changes expected. This unit is a read-only verification pass; any failures feed into U15.2.

**Approach:**

- Run the audit commands (grep for `' as '`, `': any'`, `npm run lint`, `npm run build`).
- Verify `src/app/(app)/layout.tsx` still mounts `<DemoBanner />` for every authed page. Confirm unauthed routes (`/login`, `/signup`) are not expected to show the banner.
- Enumerate the five service-role import sites (from the earlier grep): `src/app/api/documents/[id]/preview-url/route.ts`, `src/app/api/documents/[id]/route.ts`, `src/app/api/extract/route.ts`, `src/app/api/upload/finalize/route.ts`, `src/app/api/upload/sign/route.ts`. This list feeds the README service-role inventory (U15.4).
- Record findings in a scratch note (not committed) or inline in the commit message for whichever unit fixes any issues found.

**Patterns to follow:** N/A (read-only).

**Test scenarios:**

- _Test expectation: none — pure audit pass. Verification checklist substitutes._

**Verification:**

- `grep -rn ' as ' src/` shows only safe usages (radix import aliases, shadcn defaults, comment text). No bare `as` casts on unknown types.
- `grep -rn ': any' src/` returns zero non-comment hits.
- `npm run lint` exits 0.
- `npm run build` exits 0.
- Manual check: dashboard, upload, detail pages all show the banner in dev.
- Service-role import list is exactly the five files above; no new callers introduced since U14.

---

- [x] **U15.2: Error-handling polish**

**Goal:** Final pass on user-facing error copy per R33. Verify the three end-user error paths from parent plan's System-Wide Impact "Error propagation" bullet all produce sensible UI.

**Requirements:** R33

**Dependencies:** U15.1 (audit must surface any issues first).

**Files:**

- Modify (only if U15.1 or manual smoke-test finds a regression): `src/app/(app)/dashboard/DashboardTable.tsx`, `src/app/(app)/upload/**`, `src/app/(app)/documents/[id]/**`.
- No files expected to change if U11/U10/U12 copy is already correct.

**Approach:**

- Manually exercise each error path listed in parent plan's "Error propagation":
  1. **Gemini extraction failure:** trigger a failed row (e.g., upload a non-tax PDF) → Realtime update → Sonner toast + inline error icon + popover with `error_message`.
  2. **Upload magic-bytes mismatch:** rename a `.jpg` to `.pdf`, drop into the dropzone → expect 400 → toast; confirm no Storage orphan, no DB row.
  3. **Login form server-action error:** submit wrong password → inline form error, no redirect.
- Confirm preview-URL expiry prompt (parent plan U15 13:20–13:40 line) still works: open a detail page, leave idle past expiry, refresh preview → re-sign succeeds.
- If copy reads like a stack trace or exposes internal identifiers (workspace IDs, row IDs in error messages), tighten it.

**Patterns to follow:**

- `docs/solutions/best-practices/` — U8/U10 error-handling patterns (toast + inline marker).
- Existing `<DashboardTable>` failed-row popover structure.

**Test scenarios:**

- _Happy path:_ manually verified above.
- _Regression:_ existing Vitest suites for U10/U11/U12 must still pass (`npm run test`).

**Verification:**

- All three error paths produce user-legible text (no stack traces, no raw error codes like `PGRST0-xxx`).
- `npm run test` exits 0.
- Preview-URL re-sign round-trip works on a document detail page.

---

- [x] **U15.3: EXTRACTION_REPORT.md regeneration**

**Goal:** Re-run `npm run extract:report` against the current schema and fixture set, commit the output. Fallback: keep the 2026-04-22 commit.

**Requirements:** R13 (K-1 decision gate), R13a (rationale record committed)

**Dependencies:** U15.1 (build must be green).

**Files:**

- Modify (or replace): `docs/EXTRACTION_REPORT.md`

**Approach:**

- Run `npm run extract:report`. Expected duration: ~60s for 4 fixtures + a few seconds of Gemini latency each.
- Gemini quota check: per parent plan Risks, Day-1 assumed budget is ~128 RPD steady-state under a 250 RPD cap. A single report run consumes 8–16 calls (≤ 4 fixtures × up to 2 passes). Safe.
- Verify the regenerated file still carries the "Baseline-only" disclosure at the top (the harness writes it unconditionally; confirm).
- If the run fails (network, quota exhausted, schema-mismatch crash), abort this unit and preserve the existing file; document the failure reason in the ship commit message.

**Patterns to follow:**

- Harness code at `scripts/extract-report.ts`. Do not modify the harness in this unit.

**Test scenarios:**

- _Happy path:_ regeneration succeeds; committed file differs only in timestamp / per-fixture confidence values (structurally identical).
- _Failure path:_ harness exits non-zero → preserve old file, document reason, proceed to next unit.

**Verification:**

- `docs/EXTRACTION_REPORT.md` timestamp is today (2026-04-24) OR commit message explicitly notes the regeneration was skipped with reason.
- File still shows the "Baseline-only" banner.
- K-1 inclusion decision section present and deferred (consistent with parent plan's R13 fallback).

---

- [x] **U15.4: README final pass**

**Goal:** Replace the provisional 87-line README with the reviewer-facing document per R25 and R28c.

**Requirements:** R25, R28c, R33 (linked docs), R35 (accepted risks)

**Dependencies:** U15.1 (service-role inventory), U15.3 (extraction quality stats if regenerated).

**Files:**

- Modify: `README.md`

**Approach:**
Target sections, in order:

1. **Hero** — one-paragraph product summary, stack (Next.js 16 App Router, Supabase, Upstash QStash, Gemini 3 Flash Preview → 2.5 fallback, Vercel), live demo URL placeholder (filled in at U15.5), and a visible R35 banner line ("⚠ Prototype — accepted risks documented below").

2. **Quickstart (reviewer path)** — the single-block path for someone just cloning the repo to verify it builds: `npm install`, `cp .env.example .env.local`, fill keys, `supabase db push`, `npm run seed`, `npx @upstash/qstash-cli@latest dev` (Terminal 1), `npm run dev` (Terminal 2), open `localhost:3000`. Link to demo credentials in the reviewer email (R27).

3. **Setup (from scratch)** — keep the existing 4-step provision/env/vercel flow but tighten. Reference `.env.example` for per-key documentation.

4. **Architecture** — copy the HLD diagram from the parent plan (mermaid). Describe the three Supabase clients:
   - `src/lib/supabase/browser.ts` — browser session, used in Client Components only.
   - `src/lib/supabase/server.ts` — server session via cookies, used in Server Components + Server Actions.
   - `src/lib/supabase/service.ts` — service-role, **server-only** guard at line 8; five import sites (list them).
     Describe the write boundary: all `documents` extraction writes go through `update_extraction_result` (SECURITY DEFINER); user edits use PATCH + RLS.

5. **What was built** — bulleted list of R1–R27 with sub-bullets for multi-part requirements (R3, R10, R11, R17, R28).

6. **What was intentionally not built** — copy parent plan's Scope Boundaries (including the R1–R27 non-goals and the "Deferred to Separate Tasks" items).

7. **Known issues & accepted risks** (R35):
   - EXTRACTION_REPORT.md is blank-fixture baseline; filled-fixture calibration deferred.
   - K-1 inclusion decision deferred (currently included; drop path documented in parent plan).
   - 4.5 MB Vercel response ceiling on the CSV zip export (documented in U13 solutions).
   - iOS Safari blocks `application/pdf` in iframes (reviewer uses desktop).
   - QStash Flow Control `key: 'extract'` is a per-account global ceiling, not per-workspace.
   - No migration rollback (fix-forward).
   - Fixture PDFs are IRS public samples only — no real PII.
   - Service-role key inventory (the five files) — documents the write boundary.

8. **Extraction quality** — summary table pulled from `docs/EXTRACTION_REPORT.md` (schema conformance per doc type). Link to the full report. Flag the baseline-only caveat prominently.

9. **Project layout** — trim the existing list to match the final tree.

10. **Further reading** — links to parent plan, requirements brainstorm, `docs/solutions/`, `fixtures/README.md`.

**Patterns to follow:**

- Current README's tone and table style.
- Parent plan's Sources & References section for link formatting.

**Test scenarios:**

- _Test expectation: none — documentation. Verification checklist substitutes._

**Verification:**

- Reviewer can clone the repo, follow Quickstart, and reach `localhost:3000` in under 10 minutes without asking questions.
- Every R (R1–R35) is either described under "What was built" or explicitly called out under "What was intentionally not built" / "Known issues". Scan both sections back-to-back and confirm no R is silently missing.
- Service-role inventory in README lists exactly the five files found in U15.1.
- No absolute paths in the README.
- `README.md` is < 500 lines (single-page-scannable).

---

- [x] **U15.5: Deploy to Vercel production (user-executed)**

**Goal:** Produce a live production URL per R23.

**Requirements:** R23

**Dependencies:** U15.1–U15.4 all committed.

**Files:**

- No file changes. Plan produces the command sequence.

**Approach:**
User-executed. Plan documents exactly what to run:

```
vercel link             # one-time, if not already linked in this worktree
vercel env pull .env.vercel.production --environment=production  # sanity check keys
vercel --prod
```

Smoke test from an incognito window using a demo credential: log in, see seeded dashboard, log out, switch account, verify empty state.

**Patterns to follow:** Vercel CLI standard deploy flow.

**Test scenarios:**

- _Manual smoke:_ login round-trip on both demo accounts; one upload → `complete` streaming on prod URL.

**Verification:**

- Production URL is reachable from incognito.
- Both demo accounts log in and see the expected state.
- The production URL is captured for README hero (U15.4) and reviewer email (U15.8).

---

- [ ] **U15.6: GitHub collaborator invite (user-executed)**

**Goal:** `alex@owntheclimb.com` has read access to the repo per R24.

**Requirements:** R24

**Dependencies:** None.

**Files:**

- No file changes.

**Approach:**
User-executed. Plan provides the `gh` command:

```
gh api --method PUT repos/<owner>/<repo>/collaborators/<alex-github-username> --field permission=pull
```

If Alex's GitHub username is unknown at ship-time, fallback: invite by email via the GitHub web UI Settings → Collaborators. Document this fallback in the reviewer email (U15.8) so Alex knows to accept the invite.

**Verification:**

- `gh api repos/<owner>/<repo>/collaborators` includes alex's handle OR the pending-invite screenshot confirms the invite sent.

---

- [ ] **U15.7: Loom recording (user-executed)**

**Goal:** 3–5 minute Loom walkthrough recorded against the production URL per R26.

**Requirements:** R26

**Dependencies:** U15.5 (live URL).

**Files:**

- No file changes.

**Approach:**
User records against the prod URL, captures both browser profiles for the isolation beat. One take; re-record only for catastrophic fumbles. Upload to Loom, capture shareable link for the reviewer email.

**Verification:**

- Loom link plays end-to-end without auth redirect (public-link mode).
- Duration ≤ 5:00.

---

- [ ] **U15.8: Reviewer email (user-executed)**

**Goal:** Send credentials + links to `alex@owntheclimb.com` per R27.

**Requirements:** R27

**Dependencies:** U15.6, U15.7.

**Files:**

- No file changes.

**Approach:**

Email to be sent by user; contains secrets and shared-system destination

**Verification:**

- Email sent with all six artifacts (prod URL, repo URL, Loom URL, both credentials, required API keys).
- Secrets in email correspond to the Vercel production project (not stale dev keys).

---

## System-Wide Impact

- **Interaction graph:** U15 does not add new write paths. Audit in U15.1 confirms service-role inventory unchanged.
- **Error propagation:** U15.2 verifies the three error paths from parent plan's Error propagation section. No new paths introduced.
- **State lifecycle risks:** None — no code changes to state machines.
- **API surface parity:** None — no new endpoints.
- **Integration coverage:** U15.5 smoke test on prod URL exercises auth → dashboard → upload → extract → edit → export, which is the whole parent plan's integration test bed.
- **Unchanged invariants:**
  - Service-role client remains server-only (guard at `src/lib/supabase/service.ts:8`).
  - Demo banner remains on every authed page (`src/app/(app)/layout.tsx:13`).
  - All `documents` extraction writes still go through `update_extraction_result`.

## Risks & Dependencies

| Risk                                                                                      | Mitigation                                                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| EXTRACTION_REPORT regeneration hits a Gemini quota wall                                   | U15.3 has an explicit fallback: preserve the 2026-04-22 commit and document in the ship commit.     |
| README drifts beyond one-page-scannable length                                            | Hard cap at ~500 lines. Link out to parent plan for deep architecture; inline only the HLD diagram. |
| Vercel deploy fails due to missing env var                                                | `vercel env pull` in U15.5 surfaces gaps before `--prod`.                                           |
| GitHub collaborator invite bounces because Alex's email is not linked to a GitHub account | U15.6 fallback: invite via the web UI, document in reviewer email.                                  |
| Credentials in reviewer email leak via accidental CC / screenshot                         | Email is sent by the user manually, to one recipient. No auto-send.                                 |
| Loom exceeds 5:00                                                                         | Script is timed at 4:00 with 1:00 buffer; trim the "Export & wrap" beat if needed.                  |

## Documentation Plan

- `README.md` — rewritten in U15.4.
- `docs/EXTRACTION_REPORT.md` — regenerated in U15.3 (or preserved as-is).
- `.env.example` — no changes expected; audit in U15.1 confirms every key documented in README is present.
- No changes to `AGENTS.md` or `CLAUDE.md`.

## Operational / Rollout Notes

- **Rollout:** single `vercel --prod` push. No staging, no canary, no feature flag. If a critical bug ships, revert the latest commit and re-deploy — see parent plan Operational Notes.
- **Monitoring:** none. Reviewer surfaces issues via email.
- **Post-ship cleanup:** after the reviewer confirms receipt, the worktree can be archived. No scheduled follow-up.

## Sources & References

- **Origin document (parent plan):** [docs/plans/2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md](./2026-04-21-001-feat-otc-accounting-saas-prototype-plan.md) — see lines 969–1012 for U15's original scope and time-box.
- **Requirements brainstorm:** [docs/brainstorms/otc-accounting-saas-requirements.md](../brainstorms/otc-accounting-saas-requirements.md)
- **Current extraction report (baseline):** [docs/EXTRACTION_REPORT.md](../EXTRACTION_REPORT.md)
- **Fixture curation backlog:** `fixtures/README.md`
- **Service-role client:** `src/lib/supabase/service.ts`
- **Demo banner mount:** `src/app/(app)/layout.tsx:13`
- **SECURITY DEFINER function:** `supabase/migrations/20260421000006_update_extraction_result.sql` (plus hardening migration `…000009`)
