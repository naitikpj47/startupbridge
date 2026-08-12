-- The request an officer is watching right now wins.
--
-- Priority alone was not enough: every hunt shares one priority band and
-- FIFO within it, so a hunt triggered ten minutes ago and abandoned
-- would still be claimed before the one someone is sitting in front of.
--
-- Foreground work is therefore NEWEST-first: the most recent explicit
-- request is the one a human is waiting on. Background work stays
-- oldest-first, so nothing back there starves.

create or replace function public.claim_next_jobs(batch_size integer default 1)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
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
    order by
      priority desc,
      -- foreground: newest request first
      (case when priority > 0 then created_at end) desc nulls last,
      -- background: oldest first, so it drains fairly
      created_at asc
    limit batch_size
    for update skip locked
  )
  returning j.*;
end;
$$;

revoke execute on function public.claim_next_jobs(integer)
  from public, anon, authenticated;

/**
 * Request a hunt for one problem, collapsing duplicates.
 *
 * Clicking twice used to create two jobs, so the second click queued
 * itself behind the first. Now an existing pending hunt is refreshed to
 * the front instead — one problem never occupies more than one slot.
 */
create function public.request_sourcing(p_problem_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.jobs
  where type = 'source_candidates'
    and payload->>'problem_id' = p_problem_id::text
    and status = 'queued'
  order by created_at desc
  limit 1;

  if found then
    -- Move the existing request to the front of the foreground band.
    update public.jobs
    set created_at = now(), run_after = now(), priority = 10
    where id = v_id;
    return v_id;
  end if;

  insert into public.jobs (type, payload, priority)
  values ('source_candidates',
          jsonb_build_object('problem_id', p_problem_id),
          10)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.request_sourcing(uuid)
  from public, anon, authenticated;
