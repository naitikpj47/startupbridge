-- Traction metrics: a real home for commercial signals (revenue over a
-- stated period, customers, deployments, headcount, last raise).
--
-- Deliberately jsonb rather than columns: what is findable varies wildly
-- between a seed-stage spinout and a growth-stage company, and an
-- officer would rather see "three named deployments, revenue unknown"
-- than a wall of NULL columns.
--
-- Every entry carries its own provenance and as_of date, because a
-- revenue figure without a date is not evidence. NOT scored — this is
-- context for a human, never an input to base_readiness.
alter table public.startup_profiles
  add column metrics jsonb not null default '{}'::jsonb;

comment on column public.startup_profiles.metrics is
  'Traction signals for display only, never scored. Shape: '
  '{"revenue_usd": {"value": 1200000, "period_months": 12, "as_of": "2026-01", "source": "premium_db"}, '
  '"customers": {...}, "deployments": {...}, "employees": {...}, "last_raise": {...}}';
