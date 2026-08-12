# Deploying StartupBridge

The app is one Next.js deployment plus the hosted Supabase project it
already talks to. Nothing else needs hosting: background work runs
through the job queue, driven by `POST /api/worker/tick`.

## 1. Environment variables

Set these in the hosting provider's project settings. They are the same
names as `.env.local` — copy the values from there.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Safe to expose (publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Secret.** Bypasses RLS — server only |
| `ANTHROPIC_API_KEY` | yes | **Secret** |
| `ANTHROPIC_MODEL` | yes | `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | yes | **Secret.** Embeddings only |
| `DASHBOARD_ALLOWLIST_EMAILS` | yes | Comma-separated officer emails |
| `RESEND_API_KEY` | no | Claim-code email; logs to console without it |
| `EMAIL_FROM` | no | Sender address for claim codes |
| `SCRAPE_ALERT_WEBHOOK_URL` | no | Nightly failure-spike alerts |
| `SUPABASE_DB_PASSWORD` | no | Only needed locally, for migrations |

`SUPABASE_DB_PASSWORD` never needs to reach the host — migrations are
pushed from a developer machine.

## 2. Build settings

Defaults work. Framework preset: Next.js. Build command `npm run build`,
install `npm install`, output handled by the adapter.

Node 20+ is required (the SSRF-guarded fetch uses undici APIs).

## 3. After the first deploy

1. **Confirm sign-in works** at `/signin` with an allowlisted email. If
   the account doesn't exist yet, run `npx tsx scripts/create-officer.ts`
   locally — it talks to the same hosted database.
2. **Check `/status`** (team-only) — every row should read Ready.
3. **Smoke-test the public form** at `/submit` with any URL.

## 4. Keeping the queue moving

Enrichment, embeddings, briefings, and sourcing are queued jobs. The UI
kicks `POST /api/worker/tick` after enqueueing, which drains up to three
jobs per call. For unattended processing, add a scheduled request:

- **Vercel Cron** — add to `vercel.json`:
  ```json
  { "crons": [{ "path": "/api/worker/tick", "schedule": "*/10 * * * *" }] }
  ```
- **Or GitHub Actions** — the nightly workflow already curls the tick
  endpoint when the `APP_URL` secret is set.

Long sourcing runs (5+ minutes of web search) exceed a serverless
function's budget. Run those from a machine with no time limit:

```bash
npx tsx scripts/worker.ts
```

## 5. Nightly harvest (GitHub Actions)

`.github/workflows/nightly-harvest.yml` runs at 21:00 UTC (05:00
Asia/Manila). It needs repository secrets:

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Same value as `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role |
| `APP_URL` | Deployed base URL, so the workflow can drain the queue |
| `SCRAPE_ALERT_WEBHOOK_URL` | Optional |

Before it does anything useful, add real listing pages to
`scrapers/sources.yaml` and set `enabled: true` on them. Shipped entries
are placeholders with `enabled: false`, so the first runs will report
"no enabled sources" rather than scraping nonsense.

## 6. Security posture in production

- The `anon` role has **zero** table grants; public submission goes
  through one validated RPC.
- Dashboard access is enforced in the database (`team_members` +
  `is_team_member()` in every RLS policy), not just in the app.
- `/dashboard`, `/status`, `/api`, and `/signin` are disallowed in
  `robots.txt`; security headers are set in `next.config.ts`.
- Public endpoints share a 5-request-per-IP-per-hour limit and a
  honeypot field.

## 7. Rolling out schema changes

Migrations live in `supabase/migrations/` and are pushed from a
developer machine (the project is in the Tokyo region; the direct
database host is IPv6-only, so use the session pooler):

```bash
npx supabase db push --db-url 'postgresql://postgres.<project-ref>:<url-encoded-password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'
```
