-- StartupBridge Phase 3: matching support.
--
--  1. problems.sdg_tags — the context_fit SDG sub-signal needs SDGs on
--     both sides; officers set/confirm these (backfilled for seeds).
--  2. problem_similarities RPC — cosine similarity in SQL. pgvector's
--     <=> returns cosine DISTANCE; similarity = 1 - distance (patch 8).
--  3. append_review_flags now dedupes on (type, field, detail) so gate
--     verify-flags and enrichment hints never accumulate duplicates.
--  4. New job type for shortlist-time rationale + briefing generation.

alter table public.problems add column sdg_tags text[];

update public.problems set sdg_tags = array['SDG3']
  where id = 'd0000000-0000-4000-a000-000000000001';
update public.problems set sdg_tags = array['SDG3']
  where id = 'd0000000-0000-4000-a000-000000000002';
update public.problems set sdg_tags = array['SDG13', 'SDG11']
  where id = 'd0000000-0000-4000-a000-000000000003';

-- Similarity of every embedded startup to one problem, best first.
-- Status is returned, not filtered: the engine matches approved startups
-- only, while threshold calibration prints the full seed matrix.
create function public.problem_similarities(p_problem_id uuid)
returns table (startup_id uuid, name text, status public.startup_status, similarity double precision)
language sql
security definer
set search_path = ''
as $$
  select
    sp.startup_id,
    s.name,
    s.status,
    1 - (sp.embedding operator(extensions.<=>) p.embedding) as similarity
  from public.startup_profiles sp
  join public.startups s on s.id = sp.startup_id
  cross join (
    select embedding from public.problems where id = p_problem_id
  ) p
  where sp.embedding is not null
    and p.embedding is not null
  order by similarity desc;
$$;

revoke execute on function public.problem_similarities(uuid)
  from public, anon, authenticated;

-- Dedupe on (type, field, detail): a flag that says the same thing about
-- the same field is the same flag, whenever it was raised.
create or replace function public.append_review_flags(p_startup_id uuid, p_flags jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.startups s
  set review_flags = s.review_flags || (
    select coalesce(jsonb_agg(nf), '[]'::jsonb)
    from jsonb_array_elements(p_flags) nf
    where not exists (
      select 1 from jsonb_array_elements(s.review_flags) ef
      where ef->>'type' = nf->>'type'
        and coalesce(ef->>'field', '') = coalesce(nf->>'field', '')
        and ef->>'detail' = nf->>'detail'
    )
  )
  where s.id = p_startup_id;
$$;

alter type public.job_type add value if not exists 'generate_briefing';
