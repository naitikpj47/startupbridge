-- StartupBridge Phase 4: public intake.
--
--  1. jobs.result + 'prefill_url' job type — the URL pre-fill runs as a
--     queued background job (patch 10); the UI polls for its result.
--  2. rate_limits + check_rate_limit — 5/IP/hour shared by the public
--     intake surfaces (patch 9), fixed windows, persistent across
--     serverless instances.
--  3. claim_codes — hashed email-verification codes for the claim flow.
--  4. submit_startup — THE one validated entry point for public
--     submissions (spec SECURITY). Atomic: validates, dedupes (existing
--     scraped domain → claimable), inserts startup + profile +
--     affiliations with founder_provided provenance, enqueues scoring
--     jobs. Executed by the server with the service role; anon has no
--     path to it or any table.

alter table public.jobs add column result jsonb;
alter type public.job_type add value if not exists 'prefill_url';

-- ── Rate limiting ───────────────────────────────────────────────────────

create table public.rate_limits (
  bucket text not null,
  ip_hash text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, ip_hash, window_start)
);

alter table public.rate_limits enable row level security;

create function public.check_rate_limit(
  p_bucket text,
  p_ip_hash text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, ip_hash, window_start, count)
  values (p_bucket, p_ip_hash, v_window, 1)
  on conflict (bucket, ip_hash, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup; the table stays tiny.
  delete from public.rate_limits where window_start < now() - interval '1 day';

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;

-- ── Claim codes ─────────────────────────────────────────────────────────

create table public.claim_codes (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid not null references public.startups (id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index claim_codes_startup_idx on public.claim_codes (startup_id);
alter table public.claim_codes enable row level security;

-- ── The one validated public-submission entry point ─────────────────────

create function public.submit_startup(p jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p->>'name', ''));
  v_website text := trim(coalesce(p->>'website', ''));
  v_domain text := lower(trim(coalesce(p->>'domain', '')));
  v_email text := nullif(trim(coalesce(p->>'contact_email', '')), '');
  v_poc text := nullif(p->>'poc_status', '');
  v_infra text := nullif(p->>'infra_intensity', '');
  v_existing record;
  v_startup_id uuid;
  v_provenance jsonb := '{}'::jsonb;
  v_aff jsonb;
  k text;
begin
  -- Validation: fail closed with a machine-readable status.
  if v_name = '' or length(v_name) > 200 then
    return jsonb_build_object('status', 'invalid', 'message', 'Company name is required (max 200 chars).');
  end if;
  if v_website !~* '^https?://' or length(v_website) > 500 then
    return jsonb_build_object('status', 'invalid', 'message', 'Website must be an http(s) URL.');
  end if;
  if v_domain = '' or v_domain !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' or v_domain like 'www.%' then
    return jsonb_build_object('status', 'invalid', 'message', 'Could not derive a valid domain from the website.');
  end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('status', 'invalid', 'message', 'Contact email is not valid.');
  end if;
  if v_poc is not null and v_poc not in ('none', 'pilot_completed', 'deployed_in_field') then
    return jsonb_build_object('status', 'invalid', 'message', 'Invalid PoC status.');
  end if;
  if v_infra is not null and v_infra not in ('plug_and_play', 'moderate', 'heavy') then
    return jsonb_build_object('status', 'invalid', 'message', 'Invalid infrastructure intensity.');
  end if;
  if length(coalesce(p->>'description', '')) > 4000
     or length(coalesce(p->>'tagline', '')) > 300
     or length(coalesce(p->>'poc_evidence', '')) > 6000
     or length(coalesce(p->>'gov_experience_note', '')) > 2000 then
    return jsonb_build_object('status', 'invalid', 'message', 'One of the text fields is too long.');
  end if;

  select id, source, claimed into v_existing
  from public.startups where domain = v_domain;
  if found then
    if v_existing.source = 'scraped' and not v_existing.claimed then
      return jsonb_build_object('status', 'claimable', 'startup_id', v_existing.id);
    end if;
    return jsonb_build_object('status', 'duplicate');
  end if;

  -- founder_provided provenance for every field the founder actually set.
  foreach k in array array[
    'tagline', 'description', 'sectors', 'tech_type', 'countries_active',
    'hq_country', 'gov_experience', 'funding_raised_usd', 'team_size',
    'poc_status', 'poc_evidence', 'infra_intensity', 'sdg_tags', 'stage'
  ] loop
    if p ? k and p->k is not null and p->>k is not null and trim(p->>k) <> '' and p->>k <> '[]' then
      v_provenance := v_provenance || jsonb_build_object(k, 'founder_provided');
    end if;
  end loop;

  insert into public.startups
    (name, website, domain, tagline, description, contact_name, contact_email,
     source, status, claimed)
  values
    (v_name, v_website, v_domain,
     nullif(trim(coalesce(p->>'tagline', '')), ''),
     nullif(trim(coalesce(p->>'description', '')), ''),
     nullif(trim(coalesce(p->>'contact_name', '')), ''),
     v_email, 'self_serve', 'submitted', true)
  returning id into v_startup_id;

  insert into public.startup_profiles
    (startup_id, sdg_tags, sectors, tech_type, stage, countries_active,
     hq_country, gov_experience, gov_experience_note, funding_raised_usd,
     team_size, pitch_deck_url, poc_status, poc_evidence, infra_intensity,
     affiliations_confirmed_none, field_provenance)
  values
    (v_startup_id,
     case when p ? 'sdg_tags' and jsonb_typeof(p->'sdg_tags') = 'array'
       then (select array_agg(upper(left(t.y, 10))) from (select x as y from jsonb_array_elements_text(p->'sdg_tags') x limit 20) t) end,
     case when p ? 'sectors' and jsonb_typeof(p->'sectors') = 'array'
       then (select array_agg(lower(left(t.y, 40))) from (select x as y from jsonb_array_elements_text(p->'sectors') x limit 20) t) end,
     case when p ? 'tech_type' and jsonb_typeof(p->'tech_type') = 'array'
       then (select array_agg(lower(left(t.y, 40))) from (select x as y from jsonb_array_elements_text(p->'tech_type') x limit 20) t) end,
     nullif(trim(coalesce(p->>'stage', '')), ''),
     case when p ? 'countries_active' and jsonb_typeof(p->'countries_active') = 'array'
       then (select array_agg(upper(left(t.y, 2))) from (select x as y from jsonb_array_elements_text(p->'countries_active') x limit 30) t) end,
     upper(nullif(trim(coalesce(p->>'hq_country', '')), '')),
     (p->>'gov_experience')::boolean,
     nullif(trim(coalesce(p->>'gov_experience_note', '')), ''),
     (p->>'funding_raised_usd')::numeric,
     (p->>'team_size')::integer,
     nullif(trim(coalesce(p->>'pitch_deck_url', '')), ''),
     v_poc::public.poc_status,
     nullif(trim(coalesce(p->>'poc_evidence', '')), ''),
     v_infra::public.infra_intensity,
     coalesce((p->>'affiliations_confirmed_none')::boolean, false),
     v_provenance);

  if p ? 'affiliations' and jsonb_typeof(p->'affiliations') = 'array' then
    for v_aff in select * from jsonb_array_elements(p->'affiliations') limit 10 loop
      if coalesce(trim(v_aff->>'org_name'), '') <> ''
         and v_aff->>'org_type' in ('university', 'research_institute', 'accelerator', 'gov_lab')
         and v_aff->>'relationship' in ('spinoff', 'incubated', 'cohort', 'research_partner') then
        insert into public.affiliations (startup_id, org_name, org_type, relationship, verified)
        values (v_startup_id, left(trim(v_aff->>'org_name'), 200),
                (v_aff->>'org_type')::public.org_type,
                (v_aff->>'relationship')::public.affiliation_relationship, false);
      end if;
    end loop;
  end if;

  -- Score + embed asynchronously; the worker picks these up.
  insert into public.jobs (type, payload) values
    ('recompute_startup', jsonb_build_object('startup_id', v_startup_id)),
    ('embed_startup', jsonb_build_object('startup_id', v_startup_id));

  return jsonb_build_object('status', 'submitted', 'startup_id', v_startup_id);
exception
  when others then
    -- Fail closed for the public caller, but keep the cause in DB logs.
    raise warning 'submit_startup failed: %', sqlerrm;
    return jsonb_build_object('status', 'invalid', 'message', 'Submission could not be processed.');
end;
$$;

revoke execute on function public.submit_startup(jsonb)
  from public, anon, authenticated;
