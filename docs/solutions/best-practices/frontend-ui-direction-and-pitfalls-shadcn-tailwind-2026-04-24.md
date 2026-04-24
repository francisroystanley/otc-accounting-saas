---
title: Frontend UI direction and component pitfalls in shadcn + Tailwind v4 + Next 16
date: 2026-04-24
category: best-practices
module: ui-components
problem_type: best_practice
component: ui
severity: medium
applies_when:
  - Diagnosing a Tailwind v4 + next/font UI that renders as Times New Roman / browser default serif
  - Receiving "the design is bare" or "this doesn't feel right" feedback before investing in another redesign pass
  - Choosing a visual direction for a B2B finance / fintech product
  - Writing or refactoring shadcn/ui-based components in this Next 16 App Router project
  - Adding ARIA roles or aria-label to non-semantic wrappers
  - Building active-route indicators or tab-style nav under a header border
  - Designing component prop APIs where one prop turns a structural behavior on/off
  - Writing nav helpers that decide whether the current pathname matches a link
tags:
  - shadcn
  - tailwind-v4
  - next-app-router
  - next-font
  - geist
  - css-variables
  - design-direction
  - b2b-fintech
  - accessibility
  - aria
  - component-api
  - nav
related_components:
  - top-nav
  - brand
  - demo-banner
  - dashboard
  - globals-css
  - root-layout
---

## Context

A frontend-polish pass on the OTC Accounting prototype (commit `001ab72`, branch `feat/frontend-polish`) added a Brand wordmark, active-route TopNav, dashboard stats strip, empty state, slim footer, and refined demo banner. Two layers of feedback during the same task surfaced lessons that are easy to repeat:

- A first round of feedback ("everything is bare") looked like a design problem. It turned out to be a font-loading bug masquerading as a design problem.
- A second round of feedback ("this design isn't appropriate for a finance tech webapp") was a calibration problem — the wrong reference set was assumed for "more presence."

The downstream UI patterns from the same task's ce-review pass are also worth keeping. They are stack-specific and inexpensive to reapply once written down.

## Guidance

### 0. Diagnostic-first: when a Tailwind v4 + next/font UI looks like Times New Roman, suspect the `@theme` font variable wiring before suspecting the design

The trap. In `globals.css`:

```css
/* Wrong — --font-sans references itself, fallback is whatever the browser ships */
@theme inline {
  --font-sans: var(--font-sans);
  --font-mono: var(--font-geist-mono);
}
```

The `--font-sans` CSS variable is never set anywhere in the file. `next/font/google`'s `Geist({ variable: "--font-geist-sans" })` sets `--font-geist-sans`, not `--font-sans`. So Tailwind's generated `font-sans` utility resolves to a non-existent variable and the browser falls back to its default serif — Times New Roman on Windows, Cambria/Times on macOS in some configs.

The fix:

```css
@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-geist-sans);
}
```

How to spot it. Symptom is "the UI looks unintentionally bare / unstyled / homemade" even when shadcn primitives, spacing, and color tokens are all correct. Open DevTools → inspect any text node → look at the computed `font-family`. If it shows `Times New Roman` or no Geist family at all, the CSS variable is the culprit. The screenshot looks "fine but ugly," which is why it's invisible until you check.

When to suspect it. Any time you inherit or scaffold a Next 16 + Tailwind v4 + shadcn project. The `shadcn init` template ships with the variable name aligned, but a few common edits introduce the self-reference (renaming `--font-geist-sans` → `--font-sans` in `layout.tsx` without updating `globals.css`, or vice versa).

### 1. "Make the design less bare" is not actionable without naming the audience aesthetic

The trap. When a user says "this is bare" or "this needs more design," the temptation is to ADD: a display serif, italic accents, stylized punctuation (e.g., `OTC<i>&</i>Accounting`), gradient backgrounds, decorative eyebrows. For a personal-finance / consumer / editorial product this is correct. For a **B2B finance tech** product (which OTC Accounting is) it reads as wrong-genre and has to be undone.

The reference set for B2B fintech, in this domain: Stripe, Mercury, Brex, Modern Treasury, Plaid, Carta, Wise, Pilot. Shared traits across all of them:

- **Sans-serif throughout.** No display serifs. Geist Sans (or Inter, or Söhne) is the look.
- **Monochromatic + one functional accent.** Deep blue is the de facto accent (Stripe `#635bff`, Mercury `#0066ff`, Modern Treasury blue). Emerald reads as consumer-banking / "money positive" — appropriate for Robinhood / Wealthsimple, less so for an enterprise tool.
- **No decorative italics.** No stylized ampersands. No "OTC<i>&</i>Accounting" wordmark moves.
- **Strong info hierarchy via weight and size**, not via decoration.
- **Eyebrow-style uppercase brand-color labels** above sober sans headlines (Stripe Docs, Linear, Modern Treasury).
- **Generous whitespace**, sober palette, near-pure-white or barely-cool-tinted backgrounds.

The lesson. Before adding visual presence to an existing system, name two or three concrete product references that match the audience. If you can't name them, ask. Ambiguous direction guarantees wrong-genre work and a rebuild.

A short checklist that would have caught the first attempt:

- Who is the user? (CFOs, controllers, ops teams — not consumers)
- What products are they used to looking at all day? (Stripe Dashboard, NetSuite, Carta, Brex)
- Are those products serif-decorative or sans-sober? (Sans-sober, every one)
- Then I should be sans-sober too.

### 2. `role="status"` is a polite live region — wrong for static content

A `<div role="status">` carries `aria-live="polite"` semantics. JAWS + Chrome announces the contents on hard page load. For a banner whose text never updates after mount (e.g., `DemoBanner`), use no role at all, or `role="note"` for an informational callout. Reserve `role="status"` for elements whose textContent changes after mount.

```tsx
// Wrong — promotes static text to a live region
<div role="status">Synthetic IRS sample PDFs only — do not upload real tax documents.</div>

// Right — static informational banner, no live-region semantics
<div>Synthetic IRS sample PDFs only — do not upload real tax documents.</div>
```

### 3. `aria-label` on a `role=generic` span is ARIA 1.2 prohibited

ARIA 1.2 §6.3 lists `aria-label` as prohibited on elements whose computed role is `generic` (a plain `<span>` or `<div>` with no role). Browsers tolerate it; axe-core flags `aria-prohibited-attr`. When wrapping mixed brand content (mark + wordmark) and you want a single screen-reader announcement, give the wrapper an explicit role and mark the children `aria-hidden`.

```tsx
// Wrong — aria-label on generic span (axe-core fails)
<span aria-label="OTC Accounting">
  <span aria-hidden="true">{mark}</span>
  <span>OTC Accounting</span>
</span>

// Right — role="img" makes the label legal; children become decorative
<span role="img" aria-label="OTC Accounting">
  <span aria-hidden="true">{mark}</span>
  <span aria-hidden="true">OTC Accounting</span>
</span>
```

### 4. Active-route indicators: prefer `border-b-2` on the link itself over an absolute underline against a parent border

A common pattern is an absolute underline calibrated against the parent header border:

```tsx
<Link className="relative …">
  Dashboard
  <span className="bg-foreground absolute right-2 -bottom-[14px] left-2 h-px" />
</Link>
```

`-bottom-[14px]` is calibrated for default zoom. At browser text zoom 150%+ the link grows taller (line-height scales) but the offset does not — the indicator drifts off the header border. At 200% it overlaps the link text. If any ancestor ever gets `overflow-hidden`, the indicator is silently clipped.

The robust alternative is a transparent `border-b-2` on the link itself, swapped to the brand color when active. It scales with the link and never depends on positioning that lives outside the link's box:

```tsx
<Link
  className={cn(
    "rounded-md border-b-2 px-2 py-1 transition-colors",
    active ? "border-brand text-foreground" : "text-muted-foreground hover:text-foreground border-transparent"
  )}
>
  Dashboard
</Link>
```

### 5. For "render this as a link or not" components, prefer `asLink?: boolean` over a string sentinel

It is tempting to overload an `href` prop so that an empty string (`href=""`) means "no link wrapper, render a static element." Two problems: empty string is a valid (if unusual) URL, and the convention is undiscoverable from the type signature.

```tsx
// Opaque — what does href="" mean?
<Brand href="" size="lg" />

// Self-documenting — and immediately readable in the call site
<Brand asLink={false} size="lg" />
```

The boolean is also impossible to set accidentally (no string variable can collapse to an unintended sentinel). When the component is _always_ a link or _always_ not a link in different call sites, a boolean prop with a sensible default is the idiomatic shape.

### 6. `isActive(pathname, href)` needs an explicit slash boundary

A naive `pathname.startsWith(href)` activates `/dashboard` when the route is `/dashboard-archive`. The fix is to either match exactly or require a trailing slash before declaring a subroute match:

```ts
const isActive = (pathname: string, href: string): boolean => {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
};
```

Export the helper and unit-test the four cases: exact match, subroute match, sibling-prefix non-match (`/dashboard-archive` vs `/dashboard`), unrelated route. The four-case template lives in `src/components/TopNavLinks.test.ts`.

## Why This Matters

- The font-wiring bug is not a one-off — it survives `tsc`, ESLint, and visual screenshots, and produces the worst possible user-facing symptom (the entire product looks unstyled). It compounds with design feedback into a wild-goose chase if you treat it as a design problem.
- Wrong-genre design wastes a full pass. The first round of editorial flourishes had to be entirely removed and rewritten in B2B-sober before the user accepted the result. Naming the reference set up front is cheap; rewriting is not.
- Wrong ARIA semantics either break automated audits (axe-core in CI) or send the wrong signal to assistive tech in production.
- Pixel-positioned UI indicators tied to ancestor structure are zoom-fragile. WCAG 1.4.4 (Resize Text 200%) is a real conformance criterion.
- Component-API conventions either communicate intent through the type signature or they don't.
- Nav-active helpers are easy to write and easy to break silently.

## When to Apply

- **Section 0** — every time you scaffold or touch font config in this stack, and any time UI looks unstyled despite shadcn primitives being present.
- **Section 1** — every time you receive vague design feedback ("bare", "more presence", "make it pop"). Name the reference set before opening files.
- **Sections 2–6** — any new shadcn/Tailwind component in this repo that needs ARIA, active-route logic, or a structural-mode prop.

## Examples

These patterns are now in the worktree under `feat/frontend-polish` (commit `001ab72`):

- `src/app/globals.css` — corrected `--font-sans` wiring, deep-blue `--brand` token, sober palette
- `src/app/layout.tsx` — `Geist` + `Geist_Mono` via `next/font/google` with matching CSS variable names
- `src/components/Brand.tsx` — wordmark with a small brand-color square mark, `asLink` boolean, `role="img"` for the no-link branch
- `src/components/PageHeader.tsx` — eyebrow-style brand-color uppercase label above a sober sans H1
- `src/components/DemoBanner.tsx` — no `role="status"` on static content
- `src/components/TopNavLinks.tsx` — `border-b-2` active indicator + exported `isActive` helper
- `src/components/TopNavLinks.test.ts` — four-case unit test for `isActive`
- `src/app/(app)/dashboard/DashboardStats.tsx` — uppercase tracked labels, semibold tabular-num counts, brand-color status dot for "Complete"
- `src/app/(app)/dashboard/EmptyState.tsx` — brand-tinted icon panel, sober copy, brand-color CTA button
