-- Keep the receipts for how a problem statement was arrived at.
--
-- The intake now refuses to invent context: an officer confirms each fact
-- or explicitly marks it unknown. Storing both halves means a brief can
-- always be audited back to what a human actually said, and the gaps stay
-- visible instead of quietly reading as settled.

alter table public.problems
  add column if not exists intake_answers jsonb,
  add column if not exists open_questions text[];

comment on column public.problems.intake_answers is
  'Record of the structured intake: what the officer confirmed, per dimension, and what they marked unknown. Provenance for the description.';
comment on column public.problems.open_questions is
  'Dimensions the officer could not answer. Shown as open questions rather than filled in by the model.';
