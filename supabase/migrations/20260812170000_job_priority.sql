-- Job priority: someone is watching some of these.
--
-- The queue was strict FIFO, so a hunt an officer triggered and is
-- staring at would wait behind dozens of background enrichment jobs
-- queued by earlier hunts. From the officer's side the button looked
-- broken; the job was simply 25th in line.
--
-- Foreground work (a hunt, a URL pre-fill) now outranks background work
-- (enrichment, recompute, embedding). Within a priority band it stays
-- FIFO, so nothing starves.

alter table public.jobs add column priority integer not null default 0;

create index jobs_queue_priority_idx
  on public.jobs (status, priority desc, run_after, created_at);

-- Existing rows: promote the two kinds a human waits on.
update public.jobs
set priority = 10
where type in ('source_candidates', 'prefill_url');

create or replace function public.claim_next_jobs(batch_size integer default 1)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Bury orphans that already used every attempt.
  update public.jobs
  set status = 'failed',
      error = coalesce(error, 'worker lost; attempts exhausted'),
      finished_at = now()
  where status = 'running'
    and started_at < now() - interval '15 minutes'
    and attempts >= max_attempts;

  return query
  update public.jobs j
  set status = 'running', started_at = now(), attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where (status = 'queued' and run_after <= now())
       or (status = 'running'
           and started_at < now() - interval '15 minutes'
           and attempts < max_attempts)
    order by priority desc, created_at
    limit batch_size
    for update skip locked
  )
  returning j.*;
end;
$$;

revoke execute on function public.claim_next_jobs(integer)
  from public, anon, authenticated;

-- How many jobs sit ahead of a given one — so the UI can say "3 ahead"
-- instead of an indefinite spinner.
-- How much work outranks a problem's pending hunt — so the UI can say
-- "3 jobs ahead" instead of showing an indefinite spinner.
create function public.sourcing_queue_depth(p_problem_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select priority, created_at
    from public.jobs
    where type = 'source_candidates'
      and payload->>'problem_id' = p_problem_id::text
      and status in ('queued', 'running')
    order by created_at desc
    limit 1
  )
  select coalesce((
    select count(*)::integer
    from public.jobs j, target t
    where j.status in ('queued', 'running')
      and (j.priority > t.priority
           or (j.priority = t.priority and j.created_at < t.created_at))
  ), 0);
$$;

revoke execute on function public.sourcing_queue_depth(uuid)
  from public, anon, authenticated;
