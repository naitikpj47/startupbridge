-- Phase 6: pg_cron processes the recompute queue.
--
-- Division of labour: pg_cron does pure-SQL upkeep inside the database
-- (finding work, un-sticking the queue); the Node worker does anything
-- that calls an external API. The cron job therefore ENQUEUES jobs and
-- never executes them.
--
-- Guarded: if pg_cron is unavailable the function is still created and
-- the migration succeeds — only the schedule is skipped.

create extension if not exists pg_cron;

create or replace function public.process_recompute_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recompute integer := 0;
  v_embed integer := 0;
  v_reclaimed integer := 0;
begin
  -- 1. Derived fields missing → queue a recompute (skip anything that
  --    already has a pending job, so the queue can't snowball).
  with candidates as (
    select sp.startup_id
    from public.startup_profiles sp
    join public.startups s on s.id = sp.startup_id
    where sp.profile_text is null
      and s.status <> 'rejected'
      and not exists (
        select 1 from public.jobs j
        where j.status in ('queued', 'running')
          and j.type = 'recompute_startup'
          and j.payload->>'startup_id' = sp.startup_id::text
      )
    limit 50
  )
  insert into public.jobs (type, payload)
  select 'recompute_startup', jsonb_build_object('startup_id', startup_id)
  from candidates;
  get diagnostics v_recompute = row_count;

  -- 2. Text present but no vector → queue an embedding.
  with candidates as (
    select sp.startup_id
    from public.startup_profiles sp
    join public.startups s on s.id = sp.startup_id
    where sp.embedding is null
      and sp.profile_text is not null
      and s.status <> 'rejected'
      and not exists (
        select 1 from public.jobs j
        where j.status in ('queued', 'running')
          and j.type = 'embed_startup'
          and j.payload->>'startup_id' = sp.startup_id::text
      )
    limit 50
  )
  insert into public.jobs (type, payload)
  select 'embed_startup', jsonb_build_object('startup_id', startup_id)
  from candidates;
  get diagnostics v_embed = row_count;

  -- 3. Un-stick jobs whose worker died: past the lease and still with
  --    attempts left. (claim_next_jobs also reclaims these lazily; doing
  --    it here means the UI stops showing them as "running" sooner.)
  update public.jobs
  set status = 'queued', run_after = now()
  where status = 'running'
    and started_at < now() - interval '15 minutes'
    and attempts < max_attempts;
  get diagnostics v_reclaimed = row_count;

  return jsonb_build_object(
    'recompute_queued', v_recompute,
    'embed_queued', v_embed,
    'reclaimed', v_reclaimed
  );
end;
$$;

revoke execute on function public.process_recompute_queue()
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('startupbridge-recompute-queue')
    where exists (
      select 1 from cron.job where jobname = 'startupbridge-recompute-queue'
    );
    perform cron.schedule(
      'startupbridge-recompute-queue',
      '*/15 * * * *',
      $cron$ select public.process_recompute_queue(); $cron$
    );
  else
    raise notice 'pg_cron unavailable — process_recompute_queue() created but not scheduled';
  end if;
end;
$$;
