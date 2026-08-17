-- Pilots: the step after a match, and the pathway after a pilot.
--
-- An officer who has chosen a startup for a challenge sets the terms a
-- funded pilot would run under — budget, implementation window, and the
-- objectives it exists to hit. Objectives are the officer's words
-- (seeded from what they confirmed at intake, never invented), because
-- a pilot agreement is exactly the kind of document that gets forwarded.
--
-- A completed pilot records an outcome, and a successful one can be
-- put on a pathway toward commercial scale as a public-private
-- partnership: a five-stage tracker, officer-annotated, stored as jsonb
-- so the stages can evolve without migrations.

create type public.pilot_status as enum
  ('drafted', 'agreed', 'underway', 'completed', 'cancelled');

create type public.pilot_outcome as enum
  ('met_objectives', 'partial', 'not_met');

create type public.scale_decision as enum
  ('recommend_ppp', 'extend_pilot', 'close_out');

create table public.pilots (
  id uuid primary key default gen_random_uuid(),
  -- One pilot per match: the pilot IS that pairing's next step. A
  -- re-run pilot is an edit, not a second row.
  match_id uuid not null unique references public.matches(id) on delete cascade,
  budget_usd numeric not null default 500000 check (budget_usd > 0),
  duration_months integer not null default 12
    check (duration_months between 1 and 60),
  started_on date,
  -- [{ "text": "...", "measure": "..." }] — officer-authored.
  objectives jsonb not null default '[]'::jsonb,
  -- [{ "month": 3, "deliverable": "..." }] — officer-authored.
  milestones jsonb not null default '[]'::jsonb,
  status public.pilot_status not null default 'drafted',
  outcome public.pilot_outcome,
  outcome_notes text,
  scale_decision public.scale_decision,
  -- { "stages": [{ "key": "...", "done": bool, "note": "..." }] }
  scale_pathway jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An outcome only exists once the pilot has actually finished.
  check (outcome is null or status = 'completed'),
  -- A scale decision only exists once there is an outcome to decide on.
  check (scale_decision is null or outcome is not null)
);

create trigger set_updated_at before update on public.pilots
  for each row execute function public.set_updated_at();

alter table public.pilots enable row level security;

create policy team_full_access on public.pilots
  for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

comment on table public.pilots is
  'Terms an officer sets for a funded pilot on one match: budget, window, objectives — then outcome, and the PPP scale-up pathway for successful ones.';
