-- ===========================================================================
-- Tenant-portal subdomain branding: public branding lookup by subdomain
-- ===========================================================================
-- Context: Settings → Tenant Portal lets a company claim a subdomain
-- (`<sub>.ownproperly.com`) and the marketing copy promises a "branded
-- subdomain portal". But:
--   1. No migration ever added companies.subdomain, even though the app's
--      saveCompanySubdomain() writes to it, so the save path was relying on
--      an ad-hoc/undocumented column (or failing silently where it was never
--      added).
--   2. A logged-out visitor at <sub>.ownproperly.com has NO way to read the
--      branding: RLS on `companies` only grants rows to members, and the anon
--      role gets nothing. So the branded login could never load.
--
-- FIX:
--   * companies.subdomain, formalised as a column with a unique, case-folded
--     index so two companies can't claim the same subdomain.
--   * get_company_branding_by_subdomain(text): a SECURITY DEFINER RPC that
--     returns ONLY public-safe branding (company name, abbr, brand colour,
--     logo URL, and a tenant_portal_enabled flag). This is the single
--     anon-callable surface; it deliberately exposes nothing financial and no
--     row-level SELECT on `companies` is granted to anon. Subdomain + brand
--     identity are already public (they're in the URL and on tenant-facing
--     pages), so this leaks nothing a tenant couldn't already see.
--
-- NOTE: feature_tenant_portal is NOT a column on company_settings (the tenant
-- feature flags currently have no backing columns; the app treats their
-- absence as enabled via `!== false`). So tenant_portal_enabled is reported as
-- a constant true here, matching the app's default-on behaviour. If those
-- flags later get real storage, read it here.
-- ===========================================================================

-- 1. Formalise the subdomain column (idempotent, safe if added ad-hoc before).
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subdomain text;

-- One company per subdomain, case-insensitive. Partial index skips NULLs so
-- companies that haven't claimed a subdomain don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS companies_subdomain_unique_idx
  ON public.companies (lower(subdomain))
  WHERE subdomain IS NOT NULL;

-- 2. Public branding lookup. Anon-callable by design (logged-out tenants).
CREATE OR REPLACE FUNCTION public.get_company_branding_by_subdomain(p_subdomain text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c    record;
  v_logo text;
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

  -- logo_url lives in company_settings; a missing row is fine (no logo).
  SELECT logo_url INTO v_logo
  FROM public.company_settings
  WHERE company_id = v_c.id;

  RETURN jsonb_build_object(
    'id',                    v_c.id,
    'name',                  v_c.name,
    'abbr',                  v_c.abbr,
    'color',                 v_c.color,
    'logo_url',              v_logo,
    'tenant_portal_enabled', true
  );
END;
$$;

-- Public surface: logged-out tenants must be able to call this. It returns
-- only already-public branding, never financial or PII fields.
REVOKE ALL ON FUNCTION public.get_company_branding_by_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_branding_by_subdomain(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_branding_by_subdomain(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION
-- -- As anon (logged out):
-- --   SELECT get_company_branding_by_subdomain('vale');
-- --     -> { id, name, abbr, color, logo_url, tenant_portal_enabled }
-- --   SELECT get_company_branding_by_subdomain('does-not-exist');  -> NULL
-- --   SELECT get_company_branding_by_subdomain('');                -> NULL
-- --   SELECT * FROM companies WHERE subdomain = 'vale';            -> 0 rows
-- --     (anon still has NO row-level SELECT on companies, only the RPC)
-- -- Uniqueness:
-- --   UPDATE companies SET subdomain='vale' WHERE id='<other>';
-- --     -> ERROR duplicate key (companies_subdomain_unique_idx)
-- ===========================================================================
