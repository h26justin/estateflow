-- Canonicalise rent_payments.status on 'overdue' (not 'missed').
--
-- WHY: half the app filtered status='overdue' (TenantPortal, _monolith
-- arrears KPI, dealCashflow time buckets) while half filtered status='missed'
-- (Dashboard charts, Day Tracker, Rent Tracker, ReportsPage). The DB itself
-- had no CHECK constraint, so both values coexisted depending on which code
-- path wrote the row. Result: health score, collection rate, arrears total
-- and tenant-portal "amount overdue" all disagreed silently.
--
-- DECISION (Justin, 2026-05-25): canonicalise on 'overdue'. Reads better in
-- the tenant UI ("£X overdue") and matches what existing tenant-facing
-- pages already expected.
--
-- Run order:
--   1. Migrate every existing 'missed' → 'overdue'.
--   2. Add a CHECK constraint pinning the vocabulary.
--   3. (Code change in commit) update every JS/JSX filter from
--      status==='missed' → status==='overdue', plus PaymentModal status
--      options and Day Tracker SETTABLE_STATUSES.
--
-- Apply via Supabase Dashboard SQL editor.

-- 1. Migrate existing rows.
UPDATE public.rent_payments
SET    status = 'overdue'
WHERE  status = 'missed';

-- 2. Lock the vocabulary. Allow the values the app actually writes today:
--    paid, overdue, late, partial, void, refurb, pending.
-- Future statuses must be added here explicitly so we can't accidentally
-- drift back into a two-vocab situation.
ALTER TABLE public.rent_payments
  DROP CONSTRAINT IF EXISTS rent_payments_status_check;

ALTER TABLE public.rent_payments
  ADD CONSTRAINT rent_payments_status_check
  CHECK (status IS NULL OR status IN (
    'paid', 'overdue', 'late', 'partial', 'void', 'refurb', 'pending'
  ));

-- 3. Quick sanity probe — should return zero rows after migration.
-- SELECT status, COUNT(*) FROM public.rent_payments
--   WHERE status NOT IN ('paid','overdue','late','partial','void','refurb','pending')
--   GROUP BY 1;
