-- Phase 6: demand-driven sourcing runs through the job queue.
alter type public.job_type add value if not exists 'source_candidates';
