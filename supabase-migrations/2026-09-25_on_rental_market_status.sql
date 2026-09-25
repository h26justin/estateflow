-- ============================================================================
-- Property status 'on_rental_market' + non-chargeable reason 'on_market'
-- (Properly updates brief, part 2, 25 Sep 2026).
--
-- On Rental Market = ready to rent, actively marketed, no tenant paying.
-- Rent is not expected and the months must not count against collection %.
-- Ruled 25 Sep 2026: the exclusion is a DATED non_chargeable_periods row
-- (reason 'on_market') that the app opens when the status is set and closes
-- the day before the tenancy starts when it moves to Rented. Excluding by
-- current status would rewrite earlier months every time the status changed.
--
-- Additive only: both CHECK constraints are widened, nothing is backfilled,
-- no existing status or period is altered. Idempotent.
-- ============================================================================

alter table public.properties
  drop constraint if exists properties_status_check;
alter table public.properties
  add constraint properties_status_check
  check (status = any (array[
    'purchased'::text,
    'refurb'::text,
    'let_agreed'::text,
    'rented'::text,
    'short_term_let'::text,
    'notice_given'::text,
    'on_rental_market'::text,
    'vacant'::text,
    'sold'::text
  ]));

alter table public.non_chargeable_periods
  drop constraint if exists non_chargeable_periods_reason_check;
alter table public.non_chargeable_periods
  add constraint non_chargeable_periods_reason_check
  check (reason in ('not_owned', 'on_market', 'vacant', 'refurbishment', 'rent_free', 'other'));

comment on column public.non_chargeable_periods.reason is
  'not_owned (before the purchase completed) | on_market (ready to rent, being marketed) | vacant | refurbishment | rent_free | other';

notify pgrst, 'reload schema';

-- Verification:
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conname in ('properties_status_check', 'non_chargeable_periods_reason_check');
