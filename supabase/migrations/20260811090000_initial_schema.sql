-- StartupBridge Phase 1: extensions, enums, tables, triggers, RLS.
--
-- Security model (see SPEC.md "SECURITY"):
--   anon          → zero reads, zero writes, zero grants; public intake
--                   happens only through a validated RPC added in a later
--                   phase (granted to anon explicitly at that point).
--   authenticated → full access ONLY when their email is in team_members
--                   (the env allowlist is mirrored there). Enforced in
--                   RLS itself via is_team_member(), so direct PostgREST
--                   calls cannot bypass the allowlist.
--   service_role  → bypasses RLS, server-side only.

create extension if not exists vector with schema extensions;

-- ── Enums ───────────────────────────────────────────────────────────────

create type public.startup_source as enum
  ('self_serve', 'scraped', 'referred', 'csv_import');

create type public.startup_status as enum
  ('submitted', 'under_review', 'approved', 'rejected');

create type public.poc_status as enum
  ('none', 'pilot_completed', 'deployed_in_field');

create type public.infra_intensity as enum
  ('plug_and_play', 'moderate', 'heavy');

create type public.data_confidence as enum ('high', 'medium', 'low');

create type public.org_type as enum
  ('university', 'research_institute', 'accelerator', 'gov_lab');

create type public.affiliation_relationship as enum
  ('spinoff', 'incubated', 'cohort', 'research_partner');

create type public.problem_status as enum
  ('draft', 'open', 'matching', 'closed');

create type public.match_status as enum
  ('suggested', 'shortlisted', 'introduced', 'engaged', 'dropped');

create type public.outreach_response as enum
  ('pending', 'interested', 'declined');

create type public.sourcing_status as enum
  ('running', 'completed', 'failed');

-- ── updated_at trigger ──────────────────────────────────────────────────

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Team allowlist (DB-enforced) ────────────────────────────────────────
-- Mirror of the env email allowlist. RLS policies check membership here,
-- so a stray authenticated JWT (e.g. via an unnoticed signup path) still
-- reads nothing. The app syncs env emails into this table server-side.

create table public.team_members (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create function public.is_team_member() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke execute on function public.is_team_member() from public, anon;
grant execute on function public.is_team_member() to authenticated;

-- ── Lookup: country → region ────────────────────────────────────────────

create table public.country_regions (
  country text primary key check (country = upper(country) and length(country) = 2),
  region text not null
);

-- ── Problems ────────────────────────────────────────────────────────────
-- Created before startups: startups.sourced_for references it (patch 4).

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  country text check (country is null or (country = upper(country) and length(country) = 2)),
  sector text,
  description text,
  enriched_brief text,
  posted_by uuid,
  status public.problem_status not null default 'draft',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Startups ────────────────────────────────────────────────────────────

create table public.startups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  -- normalized bare domain: lowercase, no scheme, no www.
  domain text unique check (
    domain is null
    or (domain = lower(domain) and domain not like '%/%' and domain not like 'www.%')
  ),
  tagline text,
  description text,
  logo_url text,
  contact_name text,
  contact_email text,
  source public.startup_source not null default 'self_serve',
  status public.startup_status not null default 'submitted',
  claimed boolean not null default false,
  -- set by demand-driven sourcing (patch 4)
  sourced_for uuid references public.problems (id) on delete set null,
  -- provenance conflicts + verify-before-intro flags (patch 6)
  review_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index startups_status_idx on public.startups (status);
create index startups_sourced_for_idx on public.startups (sourced_for);

-- ── Startup profiles (1:1) ──────────────────────────────────────────────

create table public.startup_profiles (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid not null unique references public.startups (id) on delete cascade,
  sdg_tags text[],
  sectors text[],
  tech_type text[],
  stage text, -- descriptive only, never scored
  countries_active text[], -- ISO-3166 alpha-2
  hq_country text,
  -- NULL = unknown; false = confirmed no (the NULL vs ZERO rule)
  gov_experience boolean,
  gov_experience_note text,
  funding_raised_usd numeric,
  team_size integer,
  pitch_deck_url text,
  poc_status public.poc_status, -- NULL = unknown
  poc_evidence text,
  infra_intensity public.infra_intensity, -- NULL = unknown
  -- patch 5: institutional signal is NULL unless verified affiliations
  -- exist OR the founder/reviewer confirmed there are none
  affiliations_confirmed_none boolean not null default false,
  profile_text text,
  embedding vector(1536),
  base_readiness integer check (base_readiness between 0 and 100),
  data_confidence public.data_confidence,
  field_provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Affiliations ────────────────────────────────────────────────────────

create table public.affiliations (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid not null references public.startups (id) on delete cascade,
  org_name text not null,
  org_type public.org_type not null,
  relationship public.affiliation_relationship not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index affiliations_startup_idx on public.affiliations (startup_id);

-- ── Matches ─────────────────────────────────────────────────────────────

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  startup_id uuid not null references public.startups (id) on delete cascade,
  similarity double precision check (similarity between 0 and 1),
  context_fit integer check (context_fit between 0 and 100),
  strategic_fit integer check (strategic_fit between 0 and 100),
  final_score integer check (final_score between 0 and 100),
  rationale text,
  briefing_note text,
  briefing_generated_at timestamptz,
  status public.match_status not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (problem_id, startup_id)
);

create index matches_problem_idx on public.matches (problem_id);
create index matches_startup_idx on public.matches (startup_id);

-- ── Outreach (per match, never per startup) ─────────────────────────────

create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  contacted_at timestamptz not null default now(),
  channel text,
  response_status public.outreach_response not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outreach_match_idx on public.outreach (match_id);

-- ── Scoring config (single row, one source of truth) ────────────────────

create table public.scoring_config (
  id boolean primary key default true check (id), -- forces a single row
  similarity_threshold numeric not null default 0.50,
  weight_similarity numeric not null default 0.35,
  weight_readiness numeric not null default 0.30,
  weight_context numeric not null default 0.20,
  weight_strategic numeric not null default 0.15,
  readiness_weights jsonb not null default '{
    "gov_experience": 25,
    "poc": {"deployed_in_field": 15, "pilot_completed": 10, "max": 15},
    "infra": {"plug_and_play": 10, "moderate": 5, "max": 10},
    "institutional_backing": 20,
    "funding": {"tiers": [
      {"gt": 5000000, "points": 15},
      {"gte": 1000000, "points": 10},
      {"gt": 0, "points": 5},
      {"eq": 0, "points": 0}
    ], "max": 15},
    "team_size": {"tiers": [
      {"gt": 20, "points": 10},
      {"gte": 6, "points": 6},
      {"gte": 0, "points": 2}
    ], "max": 10}
  }'::jsonb,
  context_weights jsonb not null default '{
    "geo_country_active": 40,
    "geo_same_region": 25,
    "sector_overlap": 35,
    "sdg_overlap": 25
  }'::jsonb,
  country_weights jsonb not null default
    '{"JP": 10, "KR": 8, "CA": 5, "AU": 3, "default": 0}'::jsonb,
  adjacent_candidate_limit integer not null default 3,
  updated_at timestamptz not null default now()
);

-- ── Run logs ────────────────────────────────────────────────────────────

create table public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source text not null,
  new_found integer not null default 0,
  updated integer not null default 0,
  failed integer not null default 0,
  notes text
);

create table public.sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  run_at timestamptz not null default now(),
  candidates_found integer,
  status public.sourcing_status not null default 'running'
);

create index sourcing_runs_problem_idx on public.sourcing_runs (problem_id);

-- ── updated_at triggers ─────────────────────────────────────────────────

create trigger set_updated_at before update on public.startups
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.startup_profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.affiliations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.problems
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.outreach
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.scoring_config
  for each row execute function public.set_updated_at();

-- ── Row-level security ──────────────────────────────────────────────────
-- RLS on everywhere. No anon policies exist. Authenticated users get
-- access only if is_team_member() passes — the allowlist is enforced by
-- the database, not just the app.

alter table public.team_members enable row level security;
alter table public.country_regions enable row level security;
alter table public.problems enable row level security;
alter table public.startups enable row level security;
alter table public.startup_profiles enable row level security;
alter table public.affiliations enable row level security;
alter table public.matches enable row level security;
alter table public.outreach enable row level security;
alter table public.scoring_config enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.sourcing_runs enable row level security;

-- Members may see the roster; only the service role edits it.
create policy team_read_roster on public.team_members
  for select to authenticated using (public.is_team_member());

create policy team_full_access on public.country_regions
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.problems
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.startups
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.startup_profiles
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.affiliations
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.matches
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.outreach
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.scoring_config
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.scrape_runs
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_full_access on public.sourcing_runs
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

-- ── Anon privilege hardening ────────────────────────────────────────────
-- The spec's model is opt-in per object: anon gets nothing by default,
-- and the future intake RPC will be granted to anon explicitly. Strip
-- Supabase's default table grants and stop future objects (including
-- functions, which PostgREST exposes as RPC) from picking them up.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke execute on function public.set_updated_at() from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;
