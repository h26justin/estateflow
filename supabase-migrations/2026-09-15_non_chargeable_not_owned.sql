-- ============================================================================
-- Non-chargeable periods: add the 'not_owned' reason.
--
-- 10 Elms West (Vale) completed on 27 April 2026 but its 11 units were set up
-- as Rented from 1 January, so the Rent Tracker read every month before
-- completion as missed rent. Months before the purchase are not vacancy and
-- not refurbishment: they were never ours to collect. This reason lets them
-- be excluded from rent due, missed payments and the collection rate under
-- their own label ("Not owned / before ownership").
--
-- Additive only. Idempotent.
-- ============================================================================

alter table public.non_chargeable_periods
  drop constraint if exists non_chargeable_periods_reason_check;
alter table public.non_chargeable_periods
  add constraint non_chargeable_periods_reason_check
  check (reason in ('not_owned', 'vacant', 'refurbishment', 'rent_free', 'other'));

comment on column public.non_chargeable_periods.reason is
  'not_owned (before the purchase completed) | vacant | refurbishment | rent_free | other';

notify pgrst, 'reload schema';

-- Verification:
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'non_chargeable_periods_reason_check';
