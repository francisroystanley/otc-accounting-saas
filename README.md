# OTC Accounting SaaS

A prototype SaaS that ingests US tax documents (W-2, 1099-NEC, 1099-MISC, K-1), extracts structured fields via Gemini, lets reviewers verify low-confidence items, and exports per-doc-type CSVs.

Built on Next.js 16 (App Router), Supabase (Auth + Postgres + Storage + Realtime), Upstash QStash, and Google Gemini 2.5 Flash. Deployed on Vercel.

> This README is provisional — a final setup + reviewer walkthrough lands in U15.

## Prerequisites

- Node.js 24 LTS
- npm
- Vercel CLI (`npm i -g vercel`)
- Supabase CLI (`npm i -g supabase`)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd otc-accounting-saas
npm install
```

### 2. Provision external services

You will need accounts / projects on:

| Service                                                | What to create                                           | Where to find keys                            |
| ------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------- |
| [Supabase](https://supabase.com/dashboard)             | A new project (keep asymmetric JWT signing keys enabled) | Project Settings → Data API                   |
| [Google AI Studio](https://aistudio.google.com/apikey) | An API key                                               | API keys page                                 |
| [Upstash QStash](https://console.upstash.com/qstash)   | A QStash instance                                        | Dashboard (token + current/next signing keys) |
| [Vercel](https://vercel.com/new)                       | A project linked to the GitHub repo                      | CLI (`vercel link`)                           |

### 3. Configure local environment

Copy the template and fill in values:

```bash
cp .env.example .env.local
```

Each variable is documented inline in `.env.example`.

### 4. Configure Vercel environment

Once keys are in `.env.local`, push them to Vercel Production and Preview:

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GOOGLE_GENAI_API_KEY
vercel env add QSTASH_TOKEN
vercel env add QSTASH_CURRENT_SIGNING_KEY
vercel env add QSTASH_NEXT_SIGNING_KEY
vercel env add USE_QSTASH
```

Verify with `vercel env ls`.

## Develop

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project layout

- `src/app/` — Next.js App Router routes (auth, dashboard, upload, documents, API)
- `src/lib/` — Supabase clients, extraction pipeline, auth helpers
- `supabase/migrations/` — SQL migrations (schema, RLS, Storage, Realtime, SECURITY DEFINER function)
- `docs/plans/` — Implementation plan and phase breakdown
- `docs/brainstorms/` — Requirements source of truth
