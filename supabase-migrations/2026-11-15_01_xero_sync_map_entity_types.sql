-- 2026-11-15_01 — xero_sync_map: entity types the push already writes + origin
--
-- WHAT
--   1. Widen the CHECK on xero_sync_map.entity_type to also allow
--      'mortgage_interest', 'deposit' and 'refurb'.
--   2. Add xero_sync_map.origin text ('pushed' | 'pulled'), NULL for
--      existing rows.
--
-- WHY
--   1. xero-sync posts mortgage-interest accruals, tenancy deposits and
--      refurb costs to Xero and then records them in xero_sync_map with those
--      entity types. The original CHECK (2026-05-24_xero_integration.sql)
--      only allowed property / rent_payment / expense / contact, so every
--      one of those map writes failed AFTER the Xero POST had succeeded and
--      the next sync posted the same transaction again. The function now
--      refuses to post those blocks until this constraint accepts them, and
--      stops a run on any failed map write.
--   2. "Undo last push" must only delete transactions Properly pushed. The
--      map also holds SPEND transactions pulled FROM Xero (entity_type
--      'expense'), which are the customer's own records. xero-sync writes
--      origin on every new map row once this column exists; for NULL
--      (older) rows it only treats a row as pushed when that can be proven.
--
-- Idempotent: the entity_type CHECK is found by definition and dropped
-- whatever its name, then re-added under a fixed name; the column and the
-- origin CHECK use IF NOT EXISTS / IF EXISTS.
-- The edge function works whether or not this has been applied.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.xero_sync_map'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%entity_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.xero_sync_map DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.xero_sync_map
  ADD CONSTRAINT xero_sync_map_entity_type_check
  CHECK (entity_type IN ('property','rent_payment','expense','contact','mortgage_interest','deposit','refurb'));

ALTER TABLE public.xero_sync_map
  ADD COLUMN IF NOT EXISTS origin text;

ALTER TABLE public.xero_sync_map DROP CONSTRAINT IF EXISTS xero_sync_map_origin_check;
ALTER TABLE public.xero_sync_map
  ADD CONSTRAINT xero_sync_map_origin_check
  CHECK (origin IS NULL OR origin IN ('pushed','pulled'));

COMMENT ON COLUMN public.xero_sync_map.origin IS
  'pushed = Properly posted this to Xero; pulled = read from Xero into Properly. NULL = written before 2026-11-15 (undo treats as pushed only when provable).';
