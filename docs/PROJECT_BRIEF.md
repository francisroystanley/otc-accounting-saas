====================
THE CHALLENGE
====================

Build a multi-tenant SaaS prototype for accountants. An accountant logs in, uploads tax documents (K-1s, 1099s, W-2s, and ideally any common tax PDF), and the system uses Gemini to extract structured data into a clean dashboard they can review, edit, and export.

Think: "accountants drag in a stack of PDFs, the system does the tedious data entry for them."

====================
WHY WE ARE BUILDING THIS
====================

OTC(OwnTheClimb) is building relationships with accounting firms. A working demo of this tool accelerates sales conversations dramatically. We want to see how you think, scope, and ship real product work.

====================
WHAT TO BUILD: MUST-HAVES (REQUIRED FOR PASS)
====================

1. Auth + multi-tenant. Supabase Auth + RLS policies. Each user sees only their own data. We test this explicitly with two accounts.

2. Bulk PDF upload. User can drag and drop multiple PDFs at once.

3. Async processing pipeline. Uploads do not block. User sees status per document (pending, processing, complete, failed).

4. Gemini extraction for three document types at minimum: K-1, 1099 (NEC or MISC), W-2. Extract the standard fields from each.

5. Dashboard. Searchable/filterable table of uploaded documents. Click a doc to see extracted fields side by side with the PDF preview.

6. Review and edit. User can correct any extracted field before exporting.

7. Export to CSV at minimum.

8. Strict TypeScript throughout. No `any`, no bare casts.

9. Deployed to Vercel with a working URL we can log into.

10. README covering setup, architecture, what you built, what you did not build and why, any known issues.

11. 3 to 5 minute Loom walkthrough showing the product end to end.

====================
STRETCH GOALS: SHOW OFF WHERE IT MAKES SENSE
====================

With Claude Code or Cursor plus your own judgment, you can ship substantially more than the must-haves in this timeline. We want to see what you do with room to breathe. Examples, pick what you think makes this feel like a real product:

- Microsoft/Google OAuth (one-click sign in)
- QuickBooks Online OAuth (fetch chart of accounts, push journal entries)
- Additional document types (1098, 5498, additional 1099 variants)
- Confidence scoring per extracted field
- PDF annotation showing exactly where each field came from
- Excel and CSV ingestion alongside PDF
- Team or firm structure (multiple users per tenant, roles)
- Audit log on edits
- Retry logic and resilient queue
- Deep UI polish (loading states, empty states, keyboard shortcuts, animations)
- Test coverage
- Sentry or observability wiring
- or anything else you feel would be worth adding or improving.

There is no pressure to do anything extra. We are evaluating your general skills and creativity, and we are happy if you use Claude Code or Cursor to move faster and impress us.

====================
TECHNICAL STACK
====================

Required:

- Next.js 16.2 (App Router)
- Strict TypeScript
- Supabase (Postgres + Auth + Storage + RLS)
- Vercel deployment
- Gemini for extraction (via Google AI Studio or Google Cloud Vertex AI)

Recommended optional (our default pairing):

- Tailwind CSS
- shadcn/ui
- lucide-react icons
- Drizzle ORM for type-safe queries

Also welcome if useful:

- Upstash Redis (queue or rate limiting)
- Resend (transactional email)
- React Email (templates)
- Sentry (error tracking)
- PostHog (analytics)
- Arcjet (rate limit, shield)
- Sonner (toasts)
- nuqs (URL state)
- Anthropic Claude or OpenAI as backup LLM if Gemini fails

You know your craft. Choose what fits.

====================
COST: EVERYTHING IS FREE
====================

Do NOT spend your own money on this except for optional Claude Code/Cursor usage. Every service above has a free tier that covers this project:

- Supabase free tier: 500MB database, 1GB storage, 50,000 monthly auth users
- Vercel Hobby plan: free, covers this easily
- Google AI Studio: free Gemini API access (15 req/min on Flash, 1M context)
- Google Cloud: $300 in free credits for new accounts (if you use Vertex AI)
- GitHub: free repo
- Domain: not needed, Vercel subdomain is fine

====================
LLM CODING TOOLS: EXPECTED
====================

We use LLM tools such as Claude Code daily. We expect you to use Claude Code, Cursor, or similar AI coding tools aggressively throughout this build. This is how we work at OTC.

Hand-coding every line is slow, and although you might be comfortable with it, LLM coding is part of the job.

What we want to see:
What can a strong engineer ship in 3 to 4 days when paired with LLM tools and good judgment?

====================
SAMPLE DOCUMENTS FOR TESTING
====================

The IRS publishes blank versions of Schedule K-1 (Form 1065), 1099-NEC, 1099-MISC, and W-2 on IRS.gov. Use those as templates, or find realistic anonymized samples online. Testing against 3 to 5 filled samples per doc type is sufficient.

====================
DELIVERABLES (BY FRIDAY APRIL 24, 3:00 PM EDT)
====================

1. Working deployed Vercel URL.

2. Two test accounts with login credentials. One with sample data loaded, one empty. So we can verify multi-tenant isolation ourselves.

3. GitHub repo with alex@owntheclimb.com invited as collaborator. Code should be clean and reviewable.

4. ALL credentials and access tokens for the app, emailed separately:
   - Supabase project URL, anon key, service role key
   - Gemini API key
   - Any other API keys used
   - Admin login for the app if different from the test accounts
     We will rotate all of these after evaluation. Do not worry about long-term exposure.

5. README in the repo covering setup, architecture, features built, features intentionally not built, known issues.

6. 3 to 5 minute Loom walkthrough. Paste the link in your final delivery email.

====================
TIMELINE
====================

- Start: Now, as soon as you would like
- Hard deadline: Friday April 24, 2026 by 3:00 PM EDT
- Questions during build: email me. Quick replies.
- Evaluation: weekend of April 25-26

====================
EVALUATION CRITERIA
====================

We grade on:

1. Does it work end to end? (Must-haves as pass/fail.)
2. Multi-tenant RLS correctness. We test explicitly with two accounts.
3. Code quality. Strict TS, clean architecture, sensible organization.
4. Error handling. Bad PDFs, Gemini timeouts, upload failures, empty files, oversized files.
5. UI craft. Does it feel like a product or a prototype?
6. Scoping judgment. What you built vs. what you intentionally left out. Good tradeoffs matter.
7. Initiative. Did you go above the minimum where it added real value?
8. Communication. Async updates, clear questions, README quality, Loom clarity.
