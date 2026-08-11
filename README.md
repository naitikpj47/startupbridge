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

## Conventions

- No real organization is ever named in code, UI, copy, or comments —
  neutral terms only: "the team", "program officers", "partner
  institutions".
- The service-role Supabase client (`src/lib/supabase/admin.ts`) is
  server-only; the anon role can submit through one validated RPC and
  read nothing.
