-- ===========================================================================
-- Security hardening 05 — role-aware + billing-liveness write policies
-- ===========================================================================
-- Addresses two findings on the tenant-facing tables:
--
--   * Role gating is client-side only (HIGH): the live child-table policies are
--     role-blind (has_property_access / user_has_company_access), so a 'viewer'
--     collaborator can INSERT/UPDATE/DELETE rent, expenses, tenancy PII,
--     compliance and maintenance via direct PostgREST calls.
--
--   * Trial/suspension enforced only in React (HIGH): RLS checks membership only
--     (never subscription status / trial_ends_at / is_free_tier), so an expired
--     owner or suspended collaborator keeps full read/write via REST.
--
-- FIX: for properties + the five named child tables, split the role-blind
-- FOR ALL policies into SELECT vs write. READS stay open to any member (the
-- React layer still gates which columns/financials are shown). WRITES require
-- BOTH has_property_permission(...) (blocks viewers) AND company_is_live(...)
-- (blocks expired/suspended accounts). Owners keep SELECT so they can export /
-- resubscribe even when not live.
--
-- Depends on 2026-06-10_security_01_helpers.sql — run that first.
-- Scope is deliberately limited to the five child tables in the finding plus
-- properties; property_notes / deposit_protection / legal_notices /
-- right_to_rent / property_documents keep their existing policies (see notes).
--
-- Idempotent. ROLLBACK: restore the *_all / per-command policies from
-- row-level-security.sql and the 2026-05-* per-command migrations.
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PROPERTIES — split read vs write, gate writes on liveness
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Drop the older catch-all policy and the public per-command set so the new
-- write rules are authoritative (no role-blind permissive policy left to OR in).
DROP POLICY IF EXISTS "properties_rls"    ON public.properties;
DROP POLICY IF EXISTS "properties_select" ON public.properties;
DROP POLICY IF EXISTS "properties_insert" ON public.properties;
DROP POLICY IF EXISTS "properties_update" ON public.properties;
DROP POLICY IF EXISTS "properties_delete" ON public.properties;

-- Read: any member (owner keeps read even when not live, so they can resubscribe).
CREATE POLICY "properties_select" ON public.properties
FOR SELECT USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR has_company_access(company_id)
);

CREATE POLICY "properties_insert" ON public.properties
FOR INSERT WITH CHECK (
  is_developer()
  OR (
    (user_id::text = auth.uid()::text OR has_company_access(company_id))
    AND company_is_live(company_id)
  )
);

CREATE POLICY "properties_update" ON public.properties
FOR UPDATE
USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR has_company_access(company_id)
)
WITH CHECK (
  is_developer()
  OR (
    (user_id::text = auth.uid()::text OR has_company_access(company_id))
    AND company_is_live(company_id)
  )
);

-- Delete stays owner/developer (unchanged behaviour; allowed even if not live
-- so users can clean up).
CREATE POLICY "properties_delete" ON public.properties
FOR DELETE USING (
  is_developer() OR user_id::text = auth.uid()::text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- CHILD TABLES — role-aware writes + liveness, open reads
-- ─────────────────────────────────────────────────────────────────────────────
-- Each table: drop the role-blind FOR ALL policy and the per-command policies,
-- then recreate SELECT (member read) + INSERT/UPDATE/DELETE gated by
-- has_property_permission + company_is_live. company_is_live is evaluated
-- against the row's property->company.
DO $build$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tenancy_details', 'rent_payments', 'property_expenses',
    'compliance_items', 'maintenance_jobs'
  ];
  -- legacy policy names to clear (FOR ALL + per-command variants)
  old_policies text[] := ARRAY[
    'tenancy_details_all','tenancy_select','tenancy_insert','tenancy_update','tenancy_delete',
    'rent_payments_all','rent_payments_select','rent_payments_insert','rent_payments_update','rent_payments_delete',
    'property_expenses_all','expenses_select','expenses_insert','expenses_update','expenses_delete',
    'compliance_items_all','compliance_select','compliance_insert','compliance_update','compliance_delete',
    'maintenance_jobs_all','maintenance_select','maintenance_insert','maintenance_update','maintenance_delete'
  ];
  p text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Drop any of the known legacy policy names if present on this table.
    FOREACH p IN ARRAY old_policies LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;
    -- And the new ones, so this migration is re-runnable.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rls_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rls_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rls_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rls_delete', t);

    -- Read: any member (legacy personal-owner OR property access).
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR SELECT USING (
        is_developer()
        OR user_id::text = auth.uid()::text
        OR has_property_access(property_id)
      )$f$, t||'_rls_select', t);

    -- Insert: editor+ and company live.
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR INSERT WITH CHECK (
        has_property_permission(property_id, 'write')
        AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
      )$f$, t||'_rls_insert', t);

    -- Update: editor+ and company live.
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR UPDATE
      USING (has_property_permission(property_id, 'write'))
      WITH CHECK (
        has_property_permission(property_id, 'write')
        AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
      )$f$, t||'_rls_update', t);

    -- Delete: editor+ (viewer blocked); liveness not required for cleanup.
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR DELETE USING (has_property_permission(property_id, 'delete'))$f$,
      t||'_rls_delete', t);
  END LOOP;
END $build$;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION
--   As a VIEWER collaborator (company live):
--     SELECT * FROM rent_payments WHERE property_id='<p>';          -> rows (read OK)
--     INSERT INTO rent_payments (...) VALUES (...);                 -> blocked
--     DELETE FROM rent_payments WHERE id='<x>';                     -> blocked
--   As an EDITOR collaborator (company live): insert/update/delete  -> OK
--   As the OWNER of an EXPIRED company (no live sub, trial passed):
--     SELECT works; INSERT/UPDATE on properties/children            -> blocked
--   Confirm no role-blind FOR ALL policy remains:
--     SELECT tablename, policyname FROM pg_policies
--       WHERE tablename IN ('rent_payments','tenancy_details','property_expenses',
--                           'compliance_items','maintenance_jobs')
--       AND cmd='ALL';                                              -> 0 rows
-- ===========================================================================
