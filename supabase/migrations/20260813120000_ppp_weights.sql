-- PPP readiness weights, in the one place weights live.
--
-- Every tunable number in this system sits in the single scoring_config
-- row and is editable from the dashboard. A score that answers "could
-- this become a public-private partnership" is a policy judgement more
-- than a technical one, so it belongs there more than most.
--
-- Defaults mirror DEFAULT_PPP_WEIGHTS in src/lib/scoring/ppp.ts; the
-- code merges tolerantly over its own defaults, so a partial or absent
-- object degrades to sensible behaviour rather than breaking scoring.

alter table public.scoring_config
  add column if not exists ppp_weights jsonb not null default jsonb_build_object(
    'gov_experience', 30,
    'pilot_evidence', 25,
    'field_deployment', 15,
    'financial_depth', 12,
    'delivery_capacity', 8,
    'institutional_backing', 5,
    'jurisdictions', 5,
    'infrastructure_fit', 5,
    'ready_at', 65,
    'approaching_at', 40
  );

comment on column public.scoring_config.ppp_weights is
  'Weights for PPP readiness — a different question from base_readiness: can this company survive procurement and deliver at commercial scale with a public counterpart. ready_at and approaching_at are band thresholds, not weights.';
