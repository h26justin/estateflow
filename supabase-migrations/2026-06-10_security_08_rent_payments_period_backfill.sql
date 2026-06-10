-- ===========================================================================
-- Security hardening 08 — rent_payments period_start/period_end (contract 3)
-- ===========================================================================
-- Contract 3: every writer sets period_start = first day of (year,month) and
-- period_end = last day when not explicitly provided; readers fall back to
-- year/month when period_start IS NULL. This migration:
--   * backfills existing rows that still have NULL period_start/period_end
--     from their (year, month) columns;
--   * adds a defence-in-depth BEFORE trigger that fills period_start/period_end
--     from (year, month) when a writer leaves them NULL — so the DB stays
--     consistent regardless of which client/edge path inserts the row.
--
-- The trigger only fills NULLs; it never overrides an explicit period the
-- writer supplied (e.g. the per-payment date selection in the rent tracker).
--
-- Idempotent. ROLLBACK: DROP TRIGGER trg_rent_payments_stamp_period ON
--   public.rent_payments; DROP FUNCTION public.stamp_rent_payment_period();
--   (the backfilled column values can be left as-is or re-NULLed manually).
-- ===========================================================================

-- ── Backfill existing NULL periods from year/month ───────────────────────────
UPDATE public.rent_payments
SET period_start = make_date(year, month, 1)
WHERE period_start IS NULL
  AND year IS NOT NULL AND month BETWEEN 1 AND 12;

UPDATE public.rent_payments
SET period_end = (make_date(year, month, 1) + INTERVAL '1 month - 1 day')::date
WHERE period_end IS NULL
  AND year IS NOT NULL AND month BETWEEN 1 AND 12;

-- ── Defence-in-depth: stamp NULL periods on write ────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_rent_payment_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.period_start IS NULL
     AND NEW.year IS NOT NULL AND NEW.month BETWEEN 1 AND 12 THEN
    NEW.period_start := make_date(NEW.year, NEW.month, 1);
  END IF;

  IF NEW.period_end IS NULL
     AND NEW.year IS NOT NULL AND NEW.month BETWEEN 1 AND 12 THEN
    NEW.period_end := (make_date(NEW.year, NEW.month, 1) + INTERVAL '1 month - 1 day')::date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rent_payments_stamp_period ON public.rent_payments;
CREATE TRIGGER trg_rent_payments_stamp_period
  BEFORE INSERT OR UPDATE ON public.rent_payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_rent_payment_period();

-- ===========================================================================
-- VERIFICATION:
--   SELECT count(*) FROM rent_payments
--     WHERE period_start IS NULL AND year IS NOT NULL AND month BETWEEN 1 AND 12;
--     -> 0
-- ===========================================================================
