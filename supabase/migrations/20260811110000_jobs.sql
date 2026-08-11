-- StartupBridge Phase 2: background job queue.
--
-- All long-running AI work (enrichment, embedding, briefing generation)
-- runs through this queue via workers holding the service role — never
-- inside web request handlers (spec patch 10). UIs poll job status.

create type public.job_type as enum
  ('enrich_startup', 'recompute_startup', 'embed_startup',
   'enrich_problem', 'embed_problem');

create type public.job_status as enum
  ('queued', 'running', 'succeeded', 'failed');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type public.job_type not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_queue_idx on public.jobs (status, run_after);

create trigger set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

-- Team can watch job progress from the dashboard; only the service role
-- claims and mutates jobs (RLS insert/update paths stay closed to it via
-- the worker using service role which bypasses RLS).
create policy team_read_jobs on public.jobs
  for select to authenticated using (public.is_team_member());

-- Atomically claim the next queued jobs. SKIP LOCKED means parallel
-- workers never grab the same job. Service-role only.
create function public.claim_next_jobs(batch_size integer default 1)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
  set status = 'running', started_at = now(), attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where status = 'queued' and run_after <= now()
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning j.*;
$$;

revoke execute on function public.claim_next_jobs(integer)
  from public, anon, authenticated;
