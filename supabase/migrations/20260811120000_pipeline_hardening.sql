-- Phase 2 hardening (from pipeline review):
--  1. DB-level append/merge helpers so concurrent writers can't clobber
--     review_flags or field_provenance with stale read-modify-writes.
--  2. claim_next_jobs reclaims stale 'running' jobs (crashed workers) and
--     permanently fails ones that exhausted their attempts.

create function public.append_review_flags(p_startup_id uuid, p_flags jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.startups
  set review_flags = review_flags || p_flags
  where id = p_startup_id;
$$;

create function public.merge_field_provenance(p_startup_id uuid, p_changes jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.startup_profiles
  set field_provenance = field_provenance || p_changes
  where startup_id = p_startup_id;
$$;

revoke execute on function public.append_review_flags(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.merge_field_provenance(uuid, jsonb)
  from public, anon, authenticated;

-- Replace the claimer: a worker that dies between claim and terminal
-- status write leaves a 'running' row nothing would ever pick up again.
-- Jobs running > 15 minutes are presumed orphaned: re-claimable while
-- attempts remain, failed permanently once exhausted.
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
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning j.*;
end;
$$;

revoke execute on function public.claim_next_jobs(integer)
  from public, anon, authenticated;
