-- =============================================================================
-- OwnProperly: Historic data import — batches, dedupe keys, reversibility
-- =============================================================================
-- RUN THIS in Supabase > SQL Editor.
--
-- Backfilling years of rent and expenses is the one operation where a silent
-- duplicate costs real money: rent_payments has never carried a uniqueness
-- guarantee (the old (property,year,month) unique was dropped so a month could
-- hold several dated segments), so a re-run of the same import doubles income
-- with nothing to flag it. Three ExH flats are already over-stated by ~£4,000
-- from repeat Day Tracker clicks.
--
-- This migration adds:
--   1. import_batches      — one row per import, so any load can be reversed
--   2. import_batch_id     — the link from each created row back to its batch
--   3. source_ref          — a caller-supplied natural key for exact dedupe
--   4. unique indexes      — the database-level guard (STEP 4 IS GATED, read it)
--
-- STEPS 1-3 are safe to run on live data at any time. STEP 4 creates the
-- unique indexes and WILL FAIL while duplicates remain — that is deliberate.
-- Run the pre-flight in STEP 4 first and resolve what it reports.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1. import_batches
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per import run. Keeping the batch (rather than only stamping the
-- created rows) means we can show "what did this file actually do" after the
-- fact, and reverse it, even if every row it created has since been edited.
CREATE TABLE IF NOT EXISTS import_batches (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,

  -- What kind of data this batch carried.
  kind         TEXT NOT NULL CHECK (kind IN ('rent','expenses','mixed')),
  -- Where it came from, for provenance in the audit trail.
  source       TEXT NOT NULL DEFAULT 'csv'
               CHECK (source IN ('csv','xero','statement','manual')),

  filename     TEXT,
  -- Counts as committed, so the UI can report without re-reading every row.
  rows_created INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,

  -- Free-form record of the mapping/assumptions used, so a future reader can
  -- reconstruct why a figure landed where it did.
  notes        TEXT,
  meta         JSONB NOT NULL DEFAULT '{}',

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when the batch is rolled back. We keep the row: "this was imported
  -- then reversed" is more useful than the row vanishing.
  reverted_at  TIMESTAMPTZ,
  reverted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_import_batches_user
  ON import_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_company
  ON import_batches(company_id, created_at DESC);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- Own rows only. An import is a personal action even on a shared company —
-- the rows it creates are governed by the existing per-table policies.
DROP POLICY IF EXISTS import_batches_own ON import_batches;
CREATE POLICY import_batches_own ON import_batches
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2. Link created rows back to their batch
-- ─────────────────────────────────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: deleting a batch record must never delete
-- financial rows as a side effect. Reversal is an explicit, separate action.
ALTER TABLE rent_payments
  ADD COLUMN IF NOT EXISTS import_batch_id UUID
  REFERENCES import_batches(id) ON DELETE SET NULL;

ALTER TABLE property_expenses
  ADD COLUMN IF NOT EXISTS import_batch_id UUID
  REFERENCES import_batches(id) ON DELETE SET NULL;

-- Partial indexes — the vast majority of rows are hand-entered and NULL here.
CREATE INDEX IF NOT EXISTS idx_rent_payments_import_batch
  ON rent_payments(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_property_expenses_import_batch
  ON property_expenses(import_batch_id) WHERE import_batch_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3. source_ref — the dedupe key for expenses
-- ─────────────────────────────────────────────────────────────────────────────
-- Expenses have no natural uniqueness: the same landlord can genuinely pay
-- £120 for "Gas safety certificate" on the same property on the same day
-- twice. So we do NOT invent a unique constraint over (property, date, amount,
-- description) — that would reject legitimate data.
--
-- Instead the importer supplies source_ref: a stable identifier from the
-- source system (a Xero line item id, or a hash of the source file's row).
-- Re-importing the same file presents the same source_ref, which is rejected;
-- a genuine second identical expense keyed by hand has source_ref NULL and is
-- always allowed.
ALTER TABLE property_expenses
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

ALTER TABLE rent_payments
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

COMMENT ON COLUMN property_expenses.source_ref IS
  'Stable id from the source system (Xero line id, or hash of the imported file row). Unique per user where set; NULL for hand-entered rows, which are never deduped.';
COMMENT ON COLUMN rent_payments.source_ref IS
  'Stable id from the source system. See property_expenses.source_ref.';


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4. The unique guards — GATED, READ BEFORE RUNNING
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ Run the pre-flight below FIRST. If it returns any rows, STOP and resolve
-- them; the CREATE UNIQUE INDEX statements that follow will fail otherwise.
-- Failing loudly is the point: silently skipping the guard would leave the
-- database exactly as unprotected as it is today.
--
-- PRE-FLIGHT (expect zero rows):
--
--   SELECT rp.property_id, p.name, rp.period_start, rp.period_end, COUNT(*) n
--   FROM rent_payments rp JOIN properties p ON p.id = rp.property_id
--   WHERE rp.period_start IS NOT NULL
--   GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
--   ORDER BY n DESC;
--
--   SELECT user_id, source_ref, COUNT(*) n FROM property_expenses
--   WHERE source_ref IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1;
--
-- As at 2026-08-18 the first query returns 3 groups / 11 excess rows, all
-- Watts Moses House (ExH), all repeat Day Tracker clicks on 2026-06-02.
-- Those must be resolved by explicit review, not by an automated DELETE in a
-- migration — this file deliberately contains no such statement.

-- 4a. One rent segment per property per exact period.
--     Multiple segments per MONTH stay legal (changeover, part payment); what
--     becomes illegal is two rows claiming the identical date range, which is
--     always a duplicate and never a real second tenancy.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rent_payments_property_period
  ON rent_payments(property_id, period_start, period_end)
  WHERE period_start IS NOT NULL;

-- 4b. A source row may only land once per user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rent_payments_source_ref
  ON rent_payments(user_id, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_property_expenses_source_ref
  ON property_expenses(user_id, source_ref)
  WHERE source_ref IS NOT NULL;


-- =============================================================================
-- DONE.
-- Verify:
--   SELECT COUNT(*) FROM import_batches;
--   SELECT indexname FROM pg_indexes
--     WHERE indexname LIKE 'uq_rent_payments%' OR indexname LIKE 'uq_property_exp%';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='rent_payments' AND column_name IN ('import_batch_id','source_ref');
-- =============================================================================
