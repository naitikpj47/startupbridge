SETUP FIRST: Create a folder called "startupbridge" in the current directory
(or work here directly if the folder is empty), save this ENTIRE message as
SPEC.md inside it, and do all work in there. I am a beginner on Windows using
the Claude desktop app Code tab. Handle everything you possibly can yourself:
folder structure, installs, config, git init. When something genuinely
requires me (creating a Supabase/Vercel account, pasting an API key, clicking
a dashboard button), STOP, give me a numbered click-by-click instruction
list, and wait. Never ask me to run terminal commands myself; you run them.

# PROJECT: StartupBridge (working name)

A two-sided matchmaking platform connecting development-focused startups with
public-sector problem statements posted by an internal team. IMPORTANT: never
name any real organization anywhere in code, UI, copy, or comments. Use
neutral terms only: "the team", "program officers", "partner institutions".

## HOW TO WORK
Build in phases. At the end of each phase: summarize what you built in plain
language, tell me exactly how to test it (what to open, what to click, what I
should see), and WAIT for my go-ahead. Never commit secrets. Use .env.local
and provide .env.example.

## STACK
Next.js (App Router, TypeScript, Tailwind). Supabase (Postgres + pgvector,
Auth, RLS, Edge Functions, pg_cron). Anthropic API (model string in env,
default claude-sonnet-4-6) for enrichment, rationales, briefing notes, and
sourcing. OpenAI text-embedding-3-small (1536 dims) for embeddings. Python
scrapers run by GitHub Actions cron. Vercel for hosting.

## PHASES
0 scaffold + env + Supabase connect
1 schema + RLS + seed data
2 enrichment + embedding pipeline
3 matching engine + gate + threshold + fallback
4 public site (landing, smart intake, claim flow)
5 internal dashboard
6 scrapers + 5AM cron + demand-driven sourcing
7 polish, animations, deploy

## DATA MODEL (proper migrations; add ids, timestamps, sensible defaults)
startups: name, website, domain (UNIQUE, nullable, normalized bare domain),
  tagline, description, logo_url, contact_name, contact_email,
  source (self_serve|scraped|referred|csv_import),
  status (submitted|under_review|approved|rejected), claimed bool default false.
startup_profiles: startup_id fk, sdg_tags text[], sectors text[],
  tech_type text[], stage (descriptive ONLY, never scored),
  countries_active text[] (ISO), hq_country text, gov_experience bool NULLABLE,
  gov_experience_note, funding_raised_usd numeric NULLABLE, team_size int
  NULLABLE, pitch_deck_url, poc_status (none|pilot_completed|deployed_in_field|
  NULL=unknown), poc_evidence text, infra_intensity (plug_and_play|moderate|
  heavy|NULL), profile_text text, embedding vector(1536), base_readiness int,
  data_confidence (high|medium|low), field_provenance jsonb.
affiliations: startup_id fk, org_name, org_type (university|research_institute|
  accelerator|gov_lab), relationship (spinoff|incubated|cohort|
  research_partner), verified bool.
problems: title, country, sector, description, enriched_brief, posted_by,
  status (draft|open|matching|closed), embedding vector(1536).
matches: problem_id fk, startup_id fk, UNIQUE(problem_id, startup_id),
  similarity float, context_fit int, strategic_fit int, final_score int,
  rationale text, briefing_note text, briefing_generated_at,
  status (suggested|shortlisted|introduced|engaged|dropped).
outreach: match_id fk (NOT startup_id), contacted_at, channel,
  response_status (pending|interested|declined), notes.
scoring_config: single row, all weights + thresholds + country_weights jsonb.
scrape_runs: started_at, finished_at, source, new_found, updated, failed, notes.
sourcing_runs: problem_id fk, run_at, candidates_found, status.
country_regions: lookup table, country ISO to region, seeded.

## SCORING (all weights in scoring_config, one source of truth, editable in
dashboard)
base_readiness 0-100 from five signals: gov_experience 25, PoC 15
(deployed_in_field 15, pilot_completed 10), infra 10 (plug_and_play 10,
moderate 5), institutional_backing 20 (from VERIFIED affiliations),
funding 15 (>5M=15, 1-5M=10, <1M=5, confirmed zero=0), team_size 10
(>20=10, 6-20=6, <=5=2). Stage is never scored.
NULL vs ZERO rule, critical, applies everywhere: NULL means unknown, remove
that signal's max from the denominator and rescale to 100. Confirmed zero or
false scores 0 INSIDE the denominator. PoC and infra normalize as two
independent signals, never as one composite.
data_confidence derives from provenance mix and verified-signal count,
displayed as "LOW (2 of 5 signals)", NEVER blended into any score.
context_fit 0-100: problem country in countries_active 40, else same region
25 (use country_regions), sector overlap 35, SDG overlap 25.
strategic_fit: country_weights {"JP":10,"KR":8,"CA":5,"AU":3,"default":0}
applied to hq_country only, normalized weight/max*100. UI label everywhere:
"Partnership priority". NO per-startup badges or flags for this anywhere.
final_score = 0.35*similarity*100 + 0.30*base_readiness + 0.20*context_fit
+ 0.15*strategic_fit.
Similarity threshold in config (start 0.55 cosine). Below it: an honest,
well-designed empty state plus up to 3 clearly-labeled "adjacent" candidates.

## THE GATE (deployability doctrine)
Excluded from ALL matching surfaces (matches, adjacent fallbacks, sourcing
suggestions, via ONE shared filter function): poc_status confirmed 'none' OR
infra_intensity confirmed 'heavy'. They stay 'approved' in the pool; founder-
facing copy says "held until PoC confirmed" with a path to submit evidence.
NULL on gate fields passes WITH a "verify before intro" flag.
Provenance strictness on gate fields only: clean pass requires
founder_provided, premium_db, or reviewer_confirmed. scraped or ai_inferred
values pass flagged. Intake form collects PoC EVIDENCE (link, partner,
location, results), not just a dropdown.

## PROVENANCE
field_provenance ranks: founder_provided > premium_db > scraped > ai_inferred.
Equal or higher rank may overwrite, lower never. If premium_db contradicts
founder_provided, do not overwrite: raise a review flag, the contradiction is
information.

## ENRICHMENT
Startup: server job fetches their website, Claude extracts structured JSON
(tagline, description, sectors, tech, countries, hq_country, affiliation
hints, PoC evidence hunt), fields tagged ai_inferred. Compose ONE canonical
profile_text template for everyone (name, tagline, description, sectors,
tech, countries) and embed that, so thin and rich profiles compete fairly.
Problem: on create, Claude expands into enriched_brief (context, affected
population, constraints, what a good solution looks like). Officer must
confirm before matching runs (draft to open).

## MATCHING MECHANICS
Re-runs UPSERT on (problem_id, startup_id): refresh scores, never duplicate,
status and outreach untouched. Profile update triggers base_readiness
recompute and final_score refresh on matches of OPEN problems only, closed
stay frozen. briefing_note stamped with generated_at; show "regenerate" when
the profile changed after that stamp. Rationale (2-3 sentences) and a one-
page briefing note generated on shortlist, stored, not regenerated per view.

## DEMAND-DRIVEN SOURCING
When a problem yields nothing above threshold: honest empty state plus a
"Source externally" button. Runs Claude with web search: problem terms plus
"pilot", "field-tested", "deployable", priority countries first, university
spinoff and TTO angles. Extract candidates, dedupe on domain (rejected
domains skipped SILENTLY, logged), insert as source scraped with
sourced_for=problem_id into the review queue, never directly into results.
Async UI ("hunting, check back"). One auto run per problem, manual re-trigger
only.

## NIGHTLY AUTOMATION (Asia/Manila 05:00, cron "0 21 * * *" UTC)
GitHub Actions runs Python scrapers: discovery pass over a sources file
(accelerator cohorts, grantee lists, university TTO pages), new domains enter
review queue; refresh pass over the 50 oldest scraped profiles, may update
scraped-rank fields only; housekeeping (dead sites flagged, stale embeddings
regenerated, recompute queue). Every run writes a scrape_runs row. pg_cron
processes the recompute queue. Dashboard widget: "Last night's harvest: X
new, Y refreshed, Z failed, N pending review." Failure spike logs a warning
(webhook URL optional in env).

## CSV IMPORT
Dashboard page: upload CSV, map columns to schema, dedupe on domain, source
csv_import, provenance premium_db, enrichment runs after import, bulk review
view sortable by relevance to any open problem.

## PUBLIC SITE
Landing: one screen, crisp value prop, single CTA "Submit your startup".
Smart intake: URL first, server enriches and pre-fills, founder confirms and
edits, PoC evidence fields, submit lands as status submitted. If the domain
already exists as scraped: claim flow instead (email verification code to an
address on the company domain, then claimed=true, founder can edit).
Rate limit public submissions (5 per IP per hour) plus a honeypot field.

## INTERNAL DASHBOARD (Supabase Auth, email allowlist from env)
Review queue (approve, reject; rejected never resurrect; provenance conflict
flags surfaced). Problems (create, confirm enrichment, open, view matches).
Matches: ranked list, score breakdown on hover, confidence chip, verify
flags, rationale, briefing note with generate and regenerate, status
pipeline, outreach log per match. Config editor for all weights, threshold,
and "Partnership priority" countries. Harvest widget and scrape_runs
history. CSV import.

## SECURITY
anon role: submit via one validated RPC or Edge Function only, zero reads.
authenticated allowlist: full app access. Service role server-side only.
No keys in client code, ever.

## SEED DATA
15 realistic fake startups across health, agri, climate, urban in Asia-
Pacific, including: 2 university spinoffs (one JP, one KR), 3 thin scraped
profiles (mostly NULLs), 1 confirmed heavy-infra and 1 confirmed no-PoC (to
demo the gate), hq countries mixing JP, KR, CA, AU, and others. 3 problems:
dengue hotspot detection Philippines, vaccine cold-chain Indonesia, flood
early warning Bangladesh. Seed country_regions and scoring_config fully.

## DESIGN DIRECTIVE (as important as the code)
Do NOT produce the generic AI-app look. Banned: purple or indigo gradients,
emoji in UI, glassmorphism, default shadcn gray cards, rounded-3xl
everywhere, drop shadows on everything.
Aesthetic: quiet, editorial, institutional-grade. Linear crossed with Stripe
docs crossed with a serious annual report.
Color: warm off-white paper (around #FAFAF7), near-black ink, ONE accent
only, a deep forest green. Muted semantic colors.
Type: Inter or Geist for UI. A serif display (Fraunces or Newsreader) for
page titles only. Tabular numerals for every score and table.
Layout: generous whitespace, max-w-6xl, 8pt spacing grid, hairline 1px low-
contrast borders instead of shadows.
Tables: dense and precise, monospace numerals, hover is a background shift
only.
Motion: 150-250ms ease-out micro-interactions, fade plus 4px translate on
mount, animated count-up on scores, skeleton loaders, a subtle shimmer
during enrichment and sourcing. Nothing bouncy, nothing spinning.
Empty states are designed features, especially "no strong matches yet":
make honesty look intentional and beautiful.
Score pattern: the number large, "Confidence: LOW (2 of 5)" as a quiet chip
beside it. Focus states and AA contrast throughout.

Start with Phase 0 now. Remember: you run everything, I only click what you
tell me to click.

## SPEC PATCHES v1.1 (override anything above where in conflict)

1. SCORING FORMULA, EXPLICIT: base_readiness = round(100 * earned_points /
   sum_of_max_points_of_KNOWN_signals) across the SIX signals (gov, PoC,
   infra, institutional, funding, team). If zero signals are known,
   base_readiness = NULL, never 0. Confidence chip reads "X of 6 signals".

2. FINAL SCORE NULL RULE: similarity, base_readiness, and context_fit are
   evidence components; if any is NULL, renormalize across the known
   evidence weights. strategic_fit is a POLICY component, never
   renormalized: unknown hq_country = default weight 0, and its 0.15
   weight ALWAYS stays in the denominator. Never zero-fill a NULL
   evidence component.

3. context_fit applies the same NULL rule to its own sub-signals
   (geography 40/25, sector 35, SDG 25): unknown sub-signals drop from
   its denominator; if all unknown, context_fit = NULL.

4. Add startups.sourced_for uuid NULL references problems, set by
   demand-driven sourcing, shown in the review queue.

5. Add startup_profiles.affiliations_confirmed_none bool default false
   (set by founder form / reviewer). Institutional signal is NULL unless
   verified affiliations exist OR this flag is true. Founder intake asks
   "any university, accelerator, or institutional affiliations?" with a
   confirmable none option; same pattern for gov_experience and funding
   (confirmed zero vs unknown).

6. Add startups.review_flags jsonb default '[]' for provenance conflicts
   and verify-before-intro flags; surfaced in review queue and match view.

7. Similarity threshold: default 0.50, calibrate in Phase 3 by printing
   the seed matrix (3 problems x 15 startups similarity scores) and
   adjusting config so intended seed matches clear it.

8. pgvector <=> returns cosine DISTANCE; similarity = 1 - distance.
   Assert in code, do not mix them.

9. The URL enrichment/pre-fill endpoint shares the public rate limit
   (5/IP/hour), validates http(s) URLs, and rejects private/internal
   hosts.

10. All long-running AI jobs (enrichment, sourcing, briefing generation)
    run as Supabase Edge Functions or queued background tasks, never
    inside web request handlers, to avoid platform timeouts. UI polls
    for completion.

11. Phase 1 seeds leave embedding NULL; Phase 2 backfills all embeddings
    and base_readiness as its first task. Seed data must include founder-
    confirmed zeros AND true NULLs so patch 1 and 2 are visibly exercised.

12. Claim flow fallback: if no email on the company domain is possible,
    a reviewer can manually mark claimed from the dashboard.
