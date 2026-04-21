---
title: Scaffolding gotchas for a Next 16 + Supabase + shadcn + strict-TypeScript project
date: 2026-04-21
category: best-practices
module: project-scaffold
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Starting a new Next 16 + Supabase + shadcn project with strict TypeScript / strict ESLint
  - Running `shadcn init` or `shadcn add <component>` against a repo with non-default ESLint rules
  - Setting up CI/CD targeting Vercel with mixed-shell dev environments
  - Auditing an existing create-next-app scaffold before landing the first feature branch
tags:
  - scaffolding
  - next-16
  - supabase
  - shadcn
  - typescript
  - eslint
  - prettier
  - tsconfig
related_components:
  - development_workflow
  - tooling
---

# Scaffolding gotchas for a Next 16 + Supabase + shadcn + strict-TypeScript project

## Context

`create-next-app`, `shadcn init`, and `supabase init` each optimize for a different axis (broad browser compat, pragmatic codegen, POSIX shells). Layered under strict TS/ESLint on a Vercel deploy, the defaults don't compose cleanly — small frictions compound into silent misconfig, bloated production installs, and Windows-shell traps. These seven were surfaced during a U1/U2 review of a multi-tenant accounting SaaS prototype. Fix them at scaffold time; they are retrofits later.

## Guidance

### 1. One config file per tool

Cosmiconfig picks one; the rest load silently as no-ops. `.prettierrc` + `.prettierrc.json` both present means one is ignored, and plugins listed only in the ignored file never run. In this project, `prettier-plugin-tailwindcss` was in the ignored file — class sorting never ran despite the dep being installed.

```bash
npx prettier --find-config-path src/app/page.tsx
```

Pick one, delete the rest. `prettier-plugin-tailwindcss` must be listed last per its own docs. `trailingComma` is a real choice: Prettier 3's default is `"all"` (better diffs, works with any ES2017+ target); this project adopted `"es5"` from the previously-ignored config — either is defensible, pick deliberately.

```json
{
  "plugins": ["@trivago/prettier-plugin-sort-imports", "prettier-plugin-tailwindcss"]
}
```

### 2. Prefer per-line ESLint disables over per-file

`@typescript-eslint/consistent-type-assertions: ['error', { assertionStyle: 'never' }]` bans `x as T` repo-wide. shadcn's generated UI primitives use `as` pragmatically:

```tsx
theme={theme as ToasterProps["theme"]}
style={{ "--normal-bg": "var(--popover)" } as React.CSSProperties}
```

Three options, narrowest first:

1. `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions` at each `as` site — strictest; new casts added later still get flagged.
2. `/* eslint-disable @typescript-eslint/consistent-type-assertions */` at file top — easier but silently permits any future `as` added to that file.
3. ESLint `overrides` block scoping the rule off `src/components/ui/**` — zero friction on `shadcn add` but makes strictness silently path-dependent.

Option 1 most closely matches "explicit at the point of violation." This project ended up on option 2 as a demo-time compromise; the per-line pattern is the better default for new projects.

### 3. Scaffolding CLIs in `devDependencies`

`shadcn`, `supabase`, `tsx` — any CLI invoked via `npx` or in scripts, never imported at runtime — belongs in `devDependencies`. Vercel's production install skips devDependencies; keeping them in `dependencies` inflates deploy time and `node_modules` size.

`shadcn` in particular can end up in `dependencies` after `npx shadcn@latest init` depending on the CLI version. Audit placement after init:

```bash
npm pkg delete dependencies.shadcn
npm pkg set devDependencies.shadcn='4.3.1'   # prefer exact pin over caret for codegen CLIs
npm install
```

Supabase CLI has a forcing function: it blocks global `npm i -g` on Windows, nudging toward project-local `devDependencies` install anyway.

### 4. Bump `tsconfig.json` `target` to match the actual runtime

`create-next-app` defaults to `"target": "ES2017"`. If your runtime is Node 20.9+ and modern browsers, bump to `ES2022`. Unlocks `structuredClone`, `Array#at`, `Object.hasOwn`, Error `cause`, top-level await in editor type-checking and direct `tsc` output. Next's SWC/Turbopack compiles separately — this mostly affects editor integration and non-Next tooling.

```json
{ "compilerOptions": { "target": "ES2022" } }
```

### 5. Declare `engines.node`

Next 16.2.4 requires Node 20.9+; `--env-file` in dev scripts requires Node 20.6+. Default scaffolding encodes neither. Declare it once so Vercel and `npm install` both respect the floor:

```json
{ "engines": { "node": ">=20.9" } }
```

Add `engine-strict=true` in `.npmrc` to promote the warning to an install error locally. Pin more tightly (e.g. `">=20.9.0 <21 \|\| >=22.11.0"`) if you want to exclude odd-numbered Node majors.

### 6. `.env.example`, not `.env.local.example`

`.env.example` is the convention. The developer's local copy is `.env.local` (Next's gitignored pattern). `.env.local.example` conflates template and copy. Canonical flow:

```bash
cp .env.example .env.local
```

Update any plan or README text that prescribes otherwise.

### 7. Keep CLI scripts shell-portable — or hard-code

`supabase gen types typescript --project-id $VAR > file.ts` assumes POSIX variable expansion and UTF-8 stdout redirection. cmd.exe doesn't expand `$VAR`; PowerShell 5.1 redirects as UTF-16LE with BOM. Git Bash works, which is why this hasn't surfaced on this project yet — forward-looking defense, not a retrospective fix.

Simplest fix: hard-code the project ref in the npm script.

```json
"db:types": "supabase gen types typescript --project-id <ref> > src/lib/database.types.ts"
```

A small Node wrapper that spawns the CLI and writes UTF-8 directly is more portable, but it must also resolve Windows' `.cmd` shim for the Supabase binary (otherwise it ENOENTs). For a single project-ref script, hard-coding is simpler.

## Why This Matters

Each gotcha is small in isolation; their cost compounds. Silent misconfig (Prettier plugin not loading, ESLint rule path-dependent) surfaces as drift between intent and behavior, not as errors. Production installs bloat, new contributors hit "doesn't work on my machine," and every `shadcn add` re-opens the same lint friction. Scaffolding is when these are cheap to fix.

## When to Apply

- Starting a new Next 16 + Supabase + shadcn project with strict TypeScript / ESLint.
- Every `shadcn init` / `shadcn add` — audit the generated files against your lint config and the CLI's placement in `dependencies`.
- Setting up Vercel CI/CD on a team with mixed Windows/macOS/Linux dev environments.
- Auditing an existing U1/U2-equivalent provisioning story during code review.
- Any time a config file type has multiple valid filenames (Prettier, ESLint, PostCSS) — verify only one is present.

## Related

- `docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md` — adjacent learning from the same review cycle (U3 schema phase).
