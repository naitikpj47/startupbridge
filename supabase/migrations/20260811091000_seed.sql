-- StartupBridge Phase 1 seed data.
--
-- All organizations, people, and products below are fictional.
-- Derived fields (profile_text, embedding, base_readiness,
-- data_confidence) are intentionally NULL — Phase 2 backfills them
-- (spec patch 11). Seeds use fixed UUIDs and ON CONFLICT DO NOTHING so
-- re-running is harmless.
--
-- The roster deliberately exercises the scoring rules:
--   #7  Paddyworks      → founder-confirmed ZERO funding (0 in denominator)
--   #8  HelioGrid       → confirmed heavy infra (gate exclusion demo)
--   #9  Larkbriar Health → confirmed no PoC (gate exclusion demo)
--   #10 TidalGuard      → scraped-provenance PoC (gate passes flagged)
--   #11 Cassava Labs    → UNverified affiliation (institutional = NULL)
--   #12-14              → thin scraped profiles (mostly NULL)
--   #6, #7, #9, #15     → affiliations_confirmed_none (institutional = 0)

-- ── Team allowlist ──────────────────────────────────────────────────────

insert into public.team_members (email)
values ('naitik.pahuja@gmail.com')
on conflict (email) do nothing;

-- ── Scoring config (single row) ─────────────────────────────────────────

insert into public.scoring_config (id) values (true)
on conflict (id) do nothing;

-- ── Country → region lookup ─────────────────────────────────────────────

insert into public.country_regions (country, region) values
  ('JP', 'East Asia'), ('KR', 'East Asia'), ('CN', 'East Asia'),
  ('MN', 'East Asia'), ('TW', 'East Asia'), ('HK', 'East Asia'),
  ('PH', 'Southeast Asia'), ('ID', 'Southeast Asia'), ('VN', 'Southeast Asia'),
  ('TH', 'Southeast Asia'), ('MY', 'Southeast Asia'), ('SG', 'Southeast Asia'),
  ('KH', 'Southeast Asia'), ('LA', 'Southeast Asia'), ('MM', 'Southeast Asia'),
  ('BN', 'Southeast Asia'), ('TL', 'Southeast Asia'),
  ('BD', 'South Asia'), ('IN', 'South Asia'), ('PK', 'South Asia'),
  ('LK', 'South Asia'), ('NP', 'South Asia'), ('BT', 'South Asia'),
  ('MV', 'South Asia'), ('AF', 'South Asia'),
  ('AU', 'Oceania'), ('NZ', 'Oceania'), ('PG', 'Oceania'), ('FJ', 'Oceania'),
  ('SB', 'Oceania'), ('WS', 'Oceania'), ('TO', 'Oceania'), ('VU', 'Oceania'),
  ('KI', 'Oceania'), ('FM', 'Oceania'), ('MH', 'Oceania'), ('TV', 'Oceania'),
  ('NR', 'Oceania'), ('PW', 'Oceania'),
  ('US', 'North America'), ('CA', 'North America'), ('MX', 'North America'),
  ('GB', 'Europe'), ('DE', 'Europe'), ('FR', 'Europe'), ('NL', 'Europe'),
  ('SE', 'Europe'), ('NO', 'Europe'), ('DK', 'Europe'), ('FI', 'Europe'),
  ('ES', 'Europe'), ('IT', 'Europe'), ('CH', 'Europe'), ('IE', 'Europe'),
  ('BE', 'Europe'), ('AT', 'Europe'), ('PT', 'Europe'), ('PL', 'Europe'),
  ('AE', 'Middle East'), ('SA', 'Middle East'), ('IL', 'Middle East'),
  ('JO', 'Middle East'), ('TR', 'Middle East'), ('QA', 'Middle East'),
  ('KW', 'Middle East'), ('OM', 'Middle East'), ('BH', 'Middle East'),
  ('LB', 'Middle East'), ('IQ', 'Middle East'),
  ('KE', 'Africa'), ('NG', 'Africa'), ('ZA', 'Africa'), ('GH', 'Africa'),
  ('ET', 'Africa'), ('TZ', 'Africa'), ('UG', 'Africa'), ('RW', 'Africa'),
  ('EG', 'Africa'), ('MA', 'Africa'), ('SN', 'Africa'), ('CI', 'Africa'),
  ('ZM', 'Africa'), ('MW', 'Africa'), ('MZ', 'Africa'),
  ('BR', 'Latin America'), ('AR', 'Latin America'), ('CL', 'Latin America'),
  ('CO', 'Latin America'), ('PE', 'Latin America'), ('EC', 'Latin America'),
  ('UY', 'Latin America'), ('PY', 'Latin America'), ('BO', 'Latin America'),
  ('GT', 'Latin America'), ('CR', 'Latin America'), ('PA', 'Latin America'),
  ('DO', 'Latin America'), ('JM', 'Latin America'),
  ('KZ', 'Central Asia'), ('UZ', 'Central Asia'), ('KG', 'Central Asia'),
  ('TJ', 'Central Asia'), ('TM', 'Central Asia')
on conflict (country) do nothing;

-- ── Problems (draft; enrichment + embedding come later) ─────────────────

insert into public.problems (id, title, country, sector, description, status) values
(
  'd0000000-0000-4000-a000-000000000001',
  'Dengue hotspot detection and outbreak early warning',
  'PH', 'health',
  'Provincial health offices need earlier, more localized warning of dengue outbreaks. Case reporting arrives late and aggregated, so response teams fumigate after the peak instead of before it. Officers want ward-level hotspot prediction that combines weather, historical case data, and larval survey results — and that works with intermittent connectivity and limited local analytical capacity.',
  'draft'
),
(
  'd0000000-0000-4000-a000-000000000002',
  'Vaccine cold-chain integrity across island provinces',
  'ID', 'health',
  'Routine immunization campaigns in island provinces lose doses to cold-chain breaks during inter-island transport and last-mile delivery. The program needs affordable monitoring that flags temperature excursions in transit, works offline for days at a time, and produces evidence that program officers can use for corrective action with logistics providers.',
  'draft'
),
(
  'd0000000-0000-4000-a000-000000000003',
  'Community-level flood early warning for river basins',
  'BD', 'climate',
  'Riverine communities receive flood warnings too late to act on them. Program officers want basin-level early warning that translates upstream gauge and rainfall data into actionable lead time for evacuation and asset protection, delivered through low-cost channels such as SMS and community sirens, and maintainable by district disaster committees.',
  'draft'
)
on conflict (id) do nothing;

-- ── Startups ────────────────────────────────────────────────────────────

insert into public.startups
  (id, name, website, domain, tagline, description, contact_name, contact_email, source, status, claimed)
values
(
  '5b000000-0000-4000-a000-000000000001',
  'Sentira Health', 'https://sentirahealth.com', 'sentirahealth.com',
  'Ward-level disease surveillance from data health offices already have',
  'Sentira Health builds machine-learning surveillance models that predict vector-borne disease hotspots at ward level, combining weather, case history, and larval survey data. Designed for provincial health offices with limited analytical staff; runs on intermittent connectivity.',
  'Aiko Tanabe', 'aiko@sentirahealth.com', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000002',
  'Mulgil Dynamics', 'https://mulgil.io', 'mulgil.io',
  'River-basin flood forecasting that buys communities hours, not minutes',
  'Mulgil Dynamics operationalizes hydrological simulation for flood early warning. Its basin models fuse upstream gauge networks, rainfall radar, and satellite data into district-level lead-time forecasts, delivered to disaster committees via SMS and siren integrations.',
  'Jisoo Baek', 'jisoo@mulgil.io', 'referred', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000003',
  'Frostvane Systems', 'https://frostvane.io', 'frostvane.io',
  'Cold-chain monitoring built for the last mile, not the warehouse',
  'Frostvane makes rugged, low-cost temperature loggers and an offline-first mobile app for vaccine cold chains. Excursion evidence is packaged for program officers to drive corrective action with transport providers.',
  'Ruth Calloway', 'ruth@frostvane.io', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000004',
  'Veridian Crop', 'https://veridiancrop.com', 'veridiancrop.com',
  'Satellite yield estimation for smallholder programs',
  'Veridian Crop turns satellite imagery into field-level yield and stress estimates for smallholder agriculture programs and insurers, with no on-farm hardware required.',
  'Marcus Ellery', 'hello@veridiancrop.com', 'referred', 'approved', false
),
(
  '5b000000-0000-4000-a000-000000000005',
  'Gridmere Analytics', 'https://gridmere.sg', 'gridmere.sg',
  'Transit planning decisions from anonymized movement data',
  'Gridmere Analytics helps city agencies redesign bus networks and pedestrian infrastructure using anonymized mobility analytics, with privacy review built into every engagement.',
  'Priya Nathan', 'priya@gridmere.sg', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000006',
  'AquaSentry', 'https://aquasentry.nz', 'aquasentry.nz',
  'Continuous water-quality monitoring for small utilities',
  'AquaSentry builds solar-powered sensor pods that give small water utilities continuous contamination monitoring and simple SMS alerting, sized for municipal reservoirs and rural schemes.',
  'Tom Whetu', 'tom@aquasentry.nz', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000007',
  'Paddyworks', 'https://paddyworks.vn', 'paddyworks.vn',
  'Agronomy advice for rice farmers over plain SMS',
  'Paddyworks delivers localized planting, irrigation, and pest advisories to smallholder rice farmers over SMS in local languages. Bootstrapped and revenue-funded through farmer cooperatives.',
  'Linh Truong', 'linh@paddyworks.vn', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000008',
  'HelioGrid Energy', 'https://heliogrid.com', 'heliogrid.com',
  'Solar microgrids that keep rural clinics powered',
  'HelioGrid Energy designs, installs, and remotely operates solar microgrids for off-grid health facilities, including refrigeration loads for immunization programs.',
  'Dan Okafor', 'dan@heliogrid.com', 'referred', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000009',
  'Larkbriar Health', 'https://larkbriar.health', 'larkbriar.health',
  'AI triage support for overloaded primary care',
  'Larkbriar Health is building a clinical triage assistant for primary-care settings. The product is in development; the team is preparing its first supervised pilots.',
  'Sarah Kimathi', 'sarah@larkbriar.health', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000010',
  'TidalGuard', 'https://tidalguard.jp', 'tidalguard.jp',
  'Storm-surge monitoring buoys for exposed coastlines',
  'TidalGuard deploys low-cost coastal buoys that stream surge and wave data to harbor authorities and disaster agencies ahead of typhoon landfall.',
  null, null, 'referred', 'approved', false
),
(
  '5b000000-0000-4000-a000-000000000011',
  'Cassava Labs', 'https://cassavalabs.com', 'cassavalabs.com',
  'Clean planting material for disease-hit cassava regions',
  'Cassava Labs multiplies disease-resistant cassava planting material and distributes certified kits through farmer cooperatives, with tissue-culture QA at the core.',
  'Elena Marsh', 'elena@cassavalabs.com', 'self_serve', 'approved', true
),
(
  '5b000000-0000-4000-a000-000000000012',
  'BreezeAI', 'https://breezeai.io', 'breezeai.io',
  null,
  'Air quality forecasting for cities.',
  null, null, 'scraped', 'under_review', false
),
(
  '5b000000-0000-4000-a000-000000000013',
  'Kilat Systems', 'https://kilatsystems.com', 'kilatsystems.com',
  null,
  'Severe-weather SMS alerting startup based in Indonesia.',
  null, null, 'scraped', 'under_review', false
),
(
  '5b000000-0000-4000-a000-000000000014',
  'Farmlink Bay', 'https://farmlinkbay.ph', 'farmlinkbay.ph',
  null,
  'Logistics marketplace connecting farm cooperatives with buyers.',
  null, null, 'scraped', 'approved', false
),
(
  '5b000000-0000-4000-a000-000000000015',
  'Onsae Health', 'https://onsae.health', 'onsae.health',
  'Teleconsultation infrastructure for rural clinic networks',
  'Onsae Health provides teleconsultation software and referral workflows for rural clinic networks, built for low-bandwidth environments and community health workers.',
  'Minjun Seo', 'minjun@onsae.health', 'self_serve', 'approved', true
)
on conflict (id) do nothing;

-- ── Startup profiles ────────────────────────────────────────────────────
-- NULL vs ZERO is deliberate throughout: NULL = unknown (drops out of the
-- readiness denominator), false/0 = founder-confirmed (scores 0 inside it).

insert into public.startup_profiles
  (id, startup_id, sdg_tags, sectors, tech_type, stage, countries_active,
   hq_country, gov_experience, gov_experience_note, funding_raised_usd,
   team_size, poc_status, poc_evidence, infra_intensity,
   affiliations_confirmed_none, field_provenance)
values
(
  '9f000000-0000-4000-a000-000000000001',
  '5b000000-0000-4000-a000-000000000001',
  array['SDG3'], array['health'], array['machine_learning','geospatial'],
  'series_a', array['JP','PH','VN'], 'JP',
  true, 'Two municipal health department surveillance pilots completed.',
  2400000, 14,
  'pilot_completed',
  'Six-month dengue surveillance pilot across three provincial health offices in the Philippines; sensitivity/specificity report available on request.',
  'moderate', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000002',
  '5b000000-0000-4000-a000-000000000002',
  array['SDG13','SDG11'], array['climate','water'],
  array['simulation','remote_sensing','iot'],
  'growth', array['KR','BD','KH'], 'KR',
  true, 'Three-year river-basin modeling engagement with a national water agency.',
  5800000, 23,
  'deployed_in_field',
  'Operational flood early-warning deployment covering two river basins in Cambodia since 2024; published uptime and lead-time metrics.',
  'moderate', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000003',
  '5b000000-0000-4000-a000-000000000003',
  array['SDG3'], array['health','logistics'], array['iot','mobile'],
  'seed', array['AU','ID','PG'], 'AU',
  true, 'Subcontractor on a national immunization program in two provinces.',
  1200000, 9,
  'deployed_in_field',
  'Temperature loggers live in 450 rural clinics across Indonesia and Papua New Guinea; monthly excursion reports delivered to program staff.',
  'plug_and_play', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000004',
  '5b000000-0000-4000-a000-000000000004',
  array['SDG2'], array['agriculture'], array['remote_sensing','machine_learning'],
  'series_a', array['CA','IN','VN'], 'CA',
  false, 'No public-sector deployments to date; commercial insurers only.',
  7500000, 31,
  'pilot_completed',
  'Yield-estimation pilot with a smallholder insurance program in Vietnam, 2025 growing season; accuracy summary shareable.',
  'plug_and_play', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"premium_db","team_size":"premium_db","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000005',
  '5b000000-0000-4000-a000-000000000005',
  array['SDG11'], array['urban'], array['data_analytics','machine_learning'],
  'series_a', array['SG','ID','TH'], 'SG',
  true, 'Bus-network optimization pilot with a metropolitan transit authority.',
  3100000, 18,
  'pilot_completed',
  'Twelve-week transit optimization pilot with a metropolitan authority; before/after ridership analysis available.',
  'moderate', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000006',
  '5b000000-0000-4000-a000-000000000006',
  array['SDG6'], array['water','health'], array['iot','sensors'],
  'seed', array['NZ','FJ','WS'], 'NZ',
  null, null,
  800000, 6,
  'pilot_completed',
  'Continuous monitoring pilot on two municipal reservoirs in Fiji; six months of validated sensor data.',
  'plug_and_play', true,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000007',
  '5b000000-0000-4000-a000-000000000007',
  array['SDG2'], array['agriculture'], array['mobile','sms'],
  'bootstrapped', array['VN','KH','LA'], 'VN',
  false, 'Works through farmer cooperatives rather than government programs.',
  0, 4,
  'deployed_in_field',
  'Advisory service in daily use by roughly 12,000 smallholder rice farmers across three provinces; cooperative retention data available.',
  'plug_and_play', true,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000008',
  '5b000000-0000-4000-a000-000000000008',
  array['SDG7','SDG3'], array['energy','health'], array['hardware','iot'],
  'growth', array['AU','PG','SB'], 'AU',
  true, 'Contractor on a rural electrification program.',
  12000000, 45,
  'deployed_in_field',
  'Nine clinic microgrids commissioned across Papua New Guinea and Solomon Islands; remote operations dashboard in production.',
  'heavy', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000009',
  '5b000000-0000-4000-a000-000000000009',
  array['SDG3'], array['health'], array['machine_learning','llm'],
  'seed', array['CA'], 'CA',
  false, 'No government engagements yet.',
  4000000, 12,
  'none',
  'Product in development; no field pilots completed yet.',
  'plug_and_play', true,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000010',
  '5b000000-0000-4000-a000-000000000010',
  array['SDG13','SDG11'], array['climate','water'], array['iot','sensors'],
  null, array['JP','PH','ID'], 'JP',
  null, null,
  null, 11,
  'pilot_completed',
  'Storm-surge monitoring pilot with a harbor authority through one typhoon season, per industry press coverage.',
  'moderate', false,
  '{"tagline":"scraped","description":"scraped","sectors":"scraped","countries_active":"scraped","hq_country":"scraped","team_size":"scraped","poc_status":"scraped","poc_evidence":"scraped","infra_intensity":"scraped"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000011',
  '5b000000-0000-4000-a000-000000000011',
  array['SDG2'], array['agriculture'], array['biotech'],
  'seed', array['AU','PG','TL'], 'AU',
  null, null,
  1900000, 8,
  'pilot_completed',
  'Field trials with two farmer cooperatives in Timor-Leste across a full planting cycle.',
  'moderate', false,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000012',
  '5b000000-0000-4000-a000-000000000012',
  null, array['climate'], null,
  null, null, null,
  null, null,
  null, null,
  null, null,
  null, false,
  '{"description":"scraped","sectors":"scraped"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000013',
  '5b000000-0000-4000-a000-000000000013',
  null, array['climate'], array['mobile','sms'],
  null, array['ID'], 'ID',
  null, null,
  null, null,
  null, null,
  null, false,
  '{"description":"scraped","sectors":"scraped","tech_type":"scraped","countries_active":"scraped","hq_country":"scraped"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000014',
  '5b000000-0000-4000-a000-000000000014',
  null, array['agriculture','logistics'], null,
  null, array['PH'], 'PH',
  null, null,
  null, null,
  null, null,
  null, false,
  '{"description":"scraped","sectors":"scraped","countries_active":"scraped","hq_country":"scraped"}'::jsonb
),
(
  '9f000000-0000-4000-a000-000000000015',
  '5b000000-0000-4000-a000-000000000015',
  array['SDG3'], array['health'], array['telehealth','mobile'],
  'seed', array['KR','MN'], 'KR',
  false, 'Private clinic networks only so far.',
  900000, 7,
  'pilot_completed',
  'Teleconsultation pilot with a rural clinic network in Mongolia; 400 patients over four months, referral completion tracked.',
  'plug_and_play', true,
  '{"tagline":"founder_provided","description":"founder_provided","sectors":"founder_provided","countries_active":"founder_provided","hq_country":"founder_provided","gov_experience":"founder_provided","funding_raised_usd":"founder_provided","team_size":"founder_provided","poc_status":"founder_provided","poc_evidence":"founder_provided","infra_intensity":"founder_provided"}'::jsonb
)
on conflict (id) do nothing;

-- ── Affiliations ────────────────────────────────────────────────────────
-- Two verified university spinoffs (JP, KR) and one deliberately
-- UNverified accelerator record (institutional signal stays NULL).

insert into public.affiliations
  (id, startup_id, org_name, org_type, relationship, verified)
values
(
  'af000000-0000-4000-a000-000000000001',
  '5b000000-0000-4000-a000-000000000001',
  'Seihoku University', 'university', 'spinoff', true
),
(
  'af000000-0000-4000-a000-000000000002',
  '5b000000-0000-4000-a000-000000000002',
  'Saebom National University', 'university', 'spinoff', true
),
(
  'af000000-0000-4000-a000-000000000003',
  '5b000000-0000-4000-a000-000000000011',
  'Southern Cross AgTech Accelerator', 'accelerator', 'cohort', false
)
on conflict (id) do nothing;
