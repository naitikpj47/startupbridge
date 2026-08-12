# StartupBridge (working name)

A two-sided matchmaking platform connecting development-focused startups
with public-sector problem statements posted by an internal team.

Full product specification: [SPEC.md](./SPEC.md).

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + pgvector, Auth, RLS, Edge Functions, pg_cron)
- Anthropic API for enrichment, rationales, briefing notes, and sourcing
- OpenAI `text-embedding-3-small` for embeddings
- Python scrapers on GitHub Actions cron; Vercel for hosting

## Local development

1. Copy `.env.example` to `.env.local` and fill in the values.
2. `npm install`
3. `npm run dev`, then open http://localhost:3000

Secrets live only in `.env.local`, which is gitignored. Never commit keys.

## Surfaces

| Route | Who | What |
|---|---|---|
| `/` | public | Landing page, one CTA |
| `/submit` | public | Smart intake (URL pre-fill) and claim flow |
| `/signin` | team | Password sign-in |
| `/dashboard` | team | **Ask** — describe a need, get matched startups |
| `/dashboard/queue` | team | Review queue |
| `/dashboard/startups` | team | Directory and profiles |
| `/dashboard/problems` | team | Problem statements, matches, briefings, outreach |
| `/dashboard/config` | team | Scoring weights and threshold |
| `/dashboard/import` | team | CSV import |
| `/status` | team-ish | Build/pipeline status |

## Operations

```bash
npx tsx scripts/worker.ts            # drain the job queue once
npx tsx scripts/worker.ts --watch    # keep draining
npx tsx scripts/create-officer.ts    # create/reset officer accounts
npx tsx scripts/test-scoring.ts      # readiness scoring vs hand-computed
npx tsx scripts/test-matching.ts     # gate + match math
npx tsx scripts/calibrate-matching.ts # similarity matrix vs threshold
python scrapers/nightly.py           # the nightly harvest (needs env vars)
```

Long AI work (enrichment, embeddings, briefings, sourcing) runs as queued
jobs, never inside a web request. `POST /api/worker/tick` drains a few
jobs and is what the UI calls after enqueueing.

## Conventions

- No real organization is ever named in code, UI, copy, or comments —
  neutral terms only: "the team", "program officers", "partner
  institutions".
- The service-role Supabase client (`src/lib/supabase/admin.ts`) is
  server-only; the anon role can submit through one validated RPC and
  read nothing.
