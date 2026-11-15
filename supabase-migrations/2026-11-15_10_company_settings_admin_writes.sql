-- ----------------------------------------------------------------------------
-- company_settings: writes limited to company owners / admins (security fix,
-- 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- WHAT: company_settings_insert / _update / _delete are recreated so that a
--   write needs is_developer() OR user_is_company_admin(company_id)
--   (platform admin, company owner, or a user_company_access row with
--   is_admin / is_owner). UPDATE additionally needs company_is_live() on the
--   new row. company_settings_select is NOT touched.
--
-- WHY (exploit): has_company_access() is true for every member, including a
--   read-only viewer, so a viewer could PATCH /rest/v1/company_settings and
--   change bank_sort_code / bank_account_no, which get_tenant_portal_context()
--   shows tenants as the account to pay rent into.
--
-- CLIENT BEHAVIOUR CHANGE: editors and viewers can no longer save company
--   settings (branding, logo, report year type, bank details, tenant portal
--   flags, compliance_tracked, tenant_notification_email). This matches the
--   client ROLE_DEFAULTS (src/lib/api/roles.js: edit_company_settings is
--   owner/admin only). An expired (not live) company can still INSERT its
--   first settings row but cannot UPDATE settings until it is live again.
--
-- Uses user_is_company_admin(uuid), which exists live but has no definition
-- in this repo; it is referenced by name only.
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS company_settings_insert ON public.company_settings;
--   CREATE POLICY company_settings_insert ON public.company_settings
--     FOR INSERT TO public
--     WITH CHECK (user_is_company_admin(company_id) OR is_developer() OR has_company_access(company_id));
--   DROP POLICY IF EXISTS company_settings_update ON public.company_settings;
--   CREATE POLICY company_settings_update ON public.company_settings
--     FOR UPDATE TO public
--     USING (user_is_company_admin(company_id) OR is_developer() OR has_company_access(company_id))
--     WITH CHECK (user_is_company_admin(company_id) OR is_developer() OR has_company_access(company_id));
--   DROP POLICY IF EXISTS company_settings_delete ON public.company_settings;
--   CREATE POLICY company_settings_delete ON public.company_settings
--     FOR DELETE TO public
--     USING (is_developer() OR has_company_access(company_id));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS company_settings_insert ON public.company_settings;
CREATE POLICY company_settings_insert ON public.company_settings
  FOR INSERT TO public
  WITH CHECK (
    public.is_developer()
    OR public.user_is_company_admin(company_id)
  );

DROP POLICY IF EXISTS company_settings_update ON public.company_settings;
CREATE POLICY company_settings_update ON public.company_settings
  FOR UPDATE TO public
  USING (
    public.is_developer()
    OR public.user_is_company_admin(company_id)
  )
  WITH CHECK (
    public.is_developer()
    OR (
      public.user_is_company_admin(company_id)
      AND public.company_is_live(company_id)
    )
  );

DROP POLICY IF EXISTS company_settings_delete ON public.company_settings;
CREATE POLICY company_settings_delete ON public.company_settings
  FOR DELETE TO public
  USING (
    public.is_developer()
    OR public.user_is_company_admin(company_id)
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only, after apply):
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'company_settings' ORDER BY policyname;
--   -- expect insert/update/delete to mention user_is_company_admin and NOT
--   -- has_company_access; company_settings_select unchanged.
-- As a viewer:  UPDATE company_settings SET bank_sort_code = '00-00-00' WHERE company_id = '<co>';  -> 0 rows
-- As an admin:  same statement                                                                    -> 1 row
