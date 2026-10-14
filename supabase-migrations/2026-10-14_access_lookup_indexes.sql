-- ----------------------------------------------------------------------------
-- Indexes behind the access-check functions (14 Oct 2026)
--
-- WHY: has_company_access / has_company_write / has_property_permission /
-- user_is_company_admin run on nearly every RLS check and look up
-- user_company_access by (user_id) and by (email), properties by
-- (company_id), and tenant checks look up tenant_profiles by (user_id).
-- 2026-06-10_perf_indexes.sql covered tenant_profiles(property_id /
-- invited_by) and properties(deleted_by) but none of these. Without them
-- every policy evaluation is a sequential scan, which also makes the new
-- 14 Oct guards slower than they need to be.
--
-- Each index is created only when the column exists and no existing index
-- already LEADS with that column (e.g. the (user_id, company_id) unique
-- constraint on user_company_access already serves user_id lookups), so
-- nothing redundant is added. email is indexed as-is, because the helper
-- functions compare email = auth.email() without lower().
--
-- Not CONCURRENTLY: these tables are small and the statements must run in
-- the migration transaction. Idempotent.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('properties',          'company_id', 'idx_properties_company_id'),
      ('user_company_access', 'user_id',    'idx_user_company_access_user_id'),
      ('user_company_access', 'email',      'idx_user_company_access_email'),
      ('tenant_profiles',     'user_id',    'idx_tenant_profiles_user_id')
    ) AS t(tbl, col, idx)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = spec.col) THEN
      RAISE NOTICE 'skipping %.%: column does not exist', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
       WHERE n.nspname = 'public' AND t.relname = spec.tbl AND a.attname = spec.col
         AND i.indpred IS NULL
    ) THEN
      RAISE NOTICE 'skipping %.%: an index already leads with it', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', spec.idx, spec.tbl, spec.col);
  END LOOP;
END $$;
