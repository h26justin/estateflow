-- ===========================================================================
-- Feature-flag columns that were never created on company_settings
-- ===========================================================================
-- The Features settings panel (src/components/FeatureComponents.jsx) toggles a
-- set of feature_* flags by upserting the whole settings object into
-- company_settings. But five of those flags have no backing column, so any
-- attempt to toggle them errors ("column ... does not exist") and the flag
-- never persists. The UI masks this for the opt-out flags (it reads them as
-- `!== false`, so absence looks like "on"), but turning them OFF is impossible,
-- and the opt-in Statement Importer can never be turned ON at all.
--
-- Missing columns (the existing feature_* columns are all boolean DEFAULT true):
--   * feature_statements        - opt-IN: read as truthy in DashboardComponents
--                                 (no `!== false`), so it must default FALSE to
--                                 preserve today's behaviour (importer hidden
--                                 until explicitly enabled).
--   * feature_tenant_portal     - opt-out (read `!== false`), default TRUE.
--   * feature_tenant_messaging  - opt-out, read `!== false` in TenantPortal.
--   * feature_tenant_repairs    - opt-out.
--   * feature_tenant_documents  - opt-out.
--
-- Adding these columns also fixes get_tenant_portal_context(), which already
-- reads feature_tenant_messaging/repairs/documents from the company_settings
-- row (they were always null because the columns did not exist), and lets the
-- branded-login RPC honour a disabled tenant portal (updated below).
-- ===========================================================================

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS feature_statements       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_tenant_portal     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_tenant_messaging  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_tenant_repairs    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_tenant_documents  boolean NOT NULL DEFAULT true;

-- Now that feature_tenant_portal is a real column, the subdomain branding RPC
-- can report the true portal state instead of a hardcoded `true`. A company
-- that turns its tenant portal off no longer gets a branded login (the app
-- falls back to the marketing site). Null/missing still reads as enabled.
CREATE OR REPLACE FUNCTION public.get_company_branding_by_subdomain(p_subdomain text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c     record;
  v_logo  text;
  v_portal boolean;
BEGIN
  IF p_subdomain IS NULL OR length(trim(p_subdomain)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT id, name, abbr, color
    INTO v_c
  FROM public.companies
  WHERE lower(subdomain) = lower(trim(p_subdomain))
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_c IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT logo_url, feature_tenant_portal
    INTO v_logo, v_portal
  FROM public.company_settings
  WHERE company_id = v_c.id;

  RETURN jsonb_build_object(
    'id',                    v_c.id,
    'name',                  v_c.name,
    'abbr',                  v_c.abbr,
    'color',                 v_c.color,
    'logo_url',              v_logo,
    'tenant_portal_enabled', COALESCE(v_portal, true)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_branding_by_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_branding_by_subdomain(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_branding_by_subdomain(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION
-- -- All five columns present with the right defaults:
-- --   SELECT column_name, column_default FROM information_schema.columns
-- --   WHERE table_name='company_settings' AND column_name LIKE 'feature_%';
-- -- A toggle now persists (was: ERROR column does not exist):
-- --   UPDATE company_settings SET feature_tenant_messaging=false WHERE company_id='<x>';
-- -- Branded login honours a disabled portal:
-- --   get_company_branding_by_subdomain('<sub of company with portal off>')
-- --     -> tenant_portal_enabled = false
-- ===========================================================================
