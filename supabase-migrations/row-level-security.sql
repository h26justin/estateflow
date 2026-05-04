-- =============================================================================
-- OwnProperly: Row-Level Security (RLS) Policies
-- =============================================================================
-- This migration enforces data isolation at the DATABASE level.
-- Even if someone bypasses the UI or uses the API directly, they cannot read
-- or write data for companies they don't own or have access to.
--
-- HOW IT WORKS:
--   - Each table has policies that check auth.uid() against ownership/access
--   - Developers (is_developer = true in user_profiles) bypass all filters
--     — this is a deliberate special role for the OwnProperly operator
--   - Service role (Edge Functions) always bypasses RLS automatically
--
-- RUN ORDER: After all previous migrations
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. ADD is_developer COLUMN (replaces platform_admin naming)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_developer BOOLEAN DEFAULT false;

-- Migrate existing platform_admin values to is_developer
UPDATE user_profiles SET is_developer = true WHERE platform_admin = true AND is_developer = false;

-- We keep platform_admin column for backwards compat but is_developer is canonical

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HELPER FUNCTION: is current user a developer?
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_developer() RETURNS BOOLEAN AS $func$
DECLARE
  v_is_dev BOOLEAN;
BEGIN
  SELECT COALESCE(is_developer, false) INTO v_is_dev
  FROM user_profiles WHERE user_id = auth.uid()::text::uuid LIMIT 1;
  RETURN COALESCE(v_is_dev, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. HELPER FUNCTION: does current user have access to a company?
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION has_company_access(p_company_id UUID) RETURNS BOOLEAN AS $func$
BEGIN
  -- Developers always have access
  IF is_developer() THEN RETURN true; END IF;

  -- User owns the company
  IF EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND owner_id::text = auth.uid()::text) THEN
    RETURN true;
  END IF;

  -- User has been granted shared access
  IF EXISTS (SELECT 1 FROM user_company_access WHERE company_id = p_company_id AND user_id::text = auth.uid()::text) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COMPANIES TABLE
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select" ON companies
FOR SELECT USING (
  is_developer()
  OR owner_id::text = auth.uid()::text
  OR id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text)
);

DROP POLICY IF EXISTS "companies_insert" ON companies;
CREATE POLICY "companies_insert" ON companies
FOR INSERT WITH CHECK (
  is_developer() OR owner_id::text = auth.uid()::text
);

DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies
FOR UPDATE USING (
  is_developer() OR owner_id::text = auth.uid()::text
);

DROP POLICY IF EXISTS "companies_delete" ON companies;
CREATE POLICY "companies_delete" ON companies
FOR DELETE USING (
  is_developer() OR owner_id::text = auth.uid()::text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PROPERTIES TABLE
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_select" ON properties;
CREATE POLICY "properties_select" ON properties
FOR SELECT USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR has_company_access(company_id)
);

DROP POLICY IF EXISTS "properties_insert" ON properties;
CREATE POLICY "properties_insert" ON properties
FOR INSERT WITH CHECK (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR has_company_access(company_id)
);

DROP POLICY IF EXISTS "properties_update" ON properties;
CREATE POLICY "properties_update" ON properties
FOR UPDATE USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR has_company_access(company_id)
);

DROP POLICY IF EXISTS "properties_delete" ON properties;
CREATE POLICY "properties_delete" ON properties
FOR DELETE USING (
  is_developer() OR user_id::text = auth.uid()::text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CHILD TABLES (tenancy_details, compliance_items, maintenance_jobs, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
-- These inherit access via property_id

-- Helper: access check via property
CREATE OR REPLACE FUNCTION has_property_access(p_property_id UUID) RETURNS BOOLEAN AS $func$
DECLARE v_co_id UUID;
BEGIN
  IF is_developer() THEN RETURN true; END IF;
  SELECT company_id INTO v_co_id FROM properties WHERE id = p_property_id LIMIT 1;
  IF v_co_id IS NULL THEN RETURN false; END IF;
  RETURN has_company_access(v_co_id);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ── TENANCY_DETAILS ──
ALTER TABLE tenancy_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenancy_details_all" ON tenancy_details;
CREATE POLICY "tenancy_details_all" ON tenancy_details
FOR ALL USING (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
) WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
);

-- ── COMPLIANCE_ITEMS ──
ALTER TABLE compliance_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "compliance_items_all" ON compliance_items;
CREATE POLICY "compliance_items_all" ON compliance_items
FOR ALL USING (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
) WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
);

-- ── MAINTENANCE_JOBS ──
ALTER TABLE maintenance_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maintenance_jobs_all" ON maintenance_jobs;
CREATE POLICY "maintenance_jobs_all" ON maintenance_jobs
FOR ALL USING (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
) WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
);

-- ── PROPERTY_EXPENSES ──
ALTER TABLE property_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_expenses_all" ON property_expenses;
CREATE POLICY "property_expenses_all" ON property_expenses
FOR ALL USING (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
) WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
);

-- ── RENT_PAYMENTS ──
ALTER TABLE rent_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rent_payments_all" ON rent_payments;
CREATE POLICY "rent_payments_all" ON rent_payments
FOR ALL USING (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
) WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)
);

-- ── DEALS ──
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deals_all" ON deals;
CREATE POLICY "deals_all" ON deals
FOR ALL USING (
  is_developer() OR user_id::text = auth.uid()::text
) WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text
);

-- ── COMPANY_SETTINGS ──
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_settings_all" ON company_settings;
CREATE POLICY "company_settings_all" ON company_settings
FOR ALL USING (
  is_developer() OR has_company_access(company_id)
) WITH CHECK (
  is_developer() OR has_company_access(company_id)
);

-- ── USER_COMPANY_ACCESS ──
ALTER TABLE user_company_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uca_select" ON user_company_access;
CREATE POLICY "uca_select" ON user_company_access
FOR SELECT USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
);

DROP POLICY IF EXISTS "uca_insert" ON user_company_access;
CREATE POLICY "uca_insert" ON user_company_access
FOR INSERT WITH CHECK (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
);

DROP POLICY IF EXISTS "uca_update" ON user_company_access;
CREATE POLICY "uca_update" ON user_company_access
FOR UPDATE USING (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
);

DROP POLICY IF EXISTS "uca_delete" ON user_company_access;
CREATE POLICY "uca_delete" ON user_company_access
FOR DELETE USING (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
);

-- ── USER_PROFILES ── (users can see their own profile; developers see all)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_profiles_select" ON user_profiles;
CREATE POLICY "user_profiles_select" ON user_profiles
FOR SELECT USING (
  is_developer() OR user_id::text = auth.uid()::text
);
DROP POLICY IF EXISTS "user_profiles_insert" ON user_profiles;
CREATE POLICY "user_profiles_insert" ON user_profiles
FOR INSERT WITH CHECK (user_id::text = auth.uid()::text OR is_developer());
DROP POLICY IF EXISTS "user_profiles_update" ON user_profiles;
CREATE POLICY "user_profiles_update" ON user_profiles
FOR UPDATE USING (
  is_developer() OR user_id::text = auth.uid()::text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ADDITIONAL TABLES (if present — wrapped in DO blocks to not fail)
-- ─────────────────────────────────────────────────────────────────────────────

DO $block$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'deposit_protection') THEN
    ALTER TABLE deposit_protection ENABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "dp_all" ON deposit_protection';
    EXECUTE 'CREATE POLICY "dp_all" ON deposit_protection FOR ALL USING (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)) WITH CHECK (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id))';
  END IF;
END $block$;

DO $block$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'legal_notices') THEN
    ALTER TABLE legal_notices ENABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "ln_all" ON legal_notices';
    EXECUTE 'CREATE POLICY "ln_all" ON legal_notices FOR ALL USING (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)) WITH CHECK (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id))';
  END IF;
END $block$;

DO $block$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'right_to_rent') THEN
    ALTER TABLE right_to_rent ENABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "rtr_all" ON right_to_rent';
    EXECUTE 'CREATE POLICY "rtr_all" ON right_to_rent FOR ALL USING (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)) WITH CHECK (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id))';
  END IF;
END $block$;

DO $block$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'property_documents') THEN
    ALTER TABLE property_documents ENABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "pd_all" ON property_documents';
    EXECUTE 'CREATE POLICY "pd_all" ON property_documents FOR ALL USING (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id)) WITH CHECK (is_developer() OR user_id::text = auth.uid()::text OR has_property_access(property_id))';
  END IF;
END $block$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RESTRICT list_auth_users RPC TO DEVELOPERS ONLY
-- ─────────────────────────────────────────────────────────────────────────────
-- This RPC was letting any user list all users on the platform. Lock it down.

CREATE OR REPLACE FUNCTION list_auth_users() RETURNS TABLE (
  id UUID, email TEXT, created_at TIMESTAMPTZ
) AS $func$
BEGIN
  IF NOT is_developer() THEN
    RAISE EXCEPTION 'Permission denied: developers only';
  END IF;
  RETURN QUERY SELECT au.id, au.email::text, au.created_at FROM auth.users au ORDER BY au.created_at DESC;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- VERIFICATION QUERIES
-- After running this migration, run these to verify:
--   SELECT is_developer();  -- should return true for you, false for others
--   SELECT * FROM companies;  -- should only show accessible companies
--   SELECT * FROM properties;  -- should only show accessible properties
-- =============================================================================
