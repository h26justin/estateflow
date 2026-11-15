-- ----------------------------------------------------------------------------
-- tenant_messages: a tenant sees and updates only their own thread (security
-- fix, 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- WHAT: tenant_messages_select and tenant_messages_update are recreated with
--   the tenant branch narrowed from
--     is_tenant_of_property(property_id)
--   to
--     (tenant_user_id = (select auth.uid()) AND is_tenant_of_property(property_id))
--   The landlord-side branches (platform admin, developer, has_property_access,
--   property creator) are unchanged. tenant_messages_insert / _delete and the
--   tenant_messages_readonly_guard trigger are not touched.
--
-- WHY (exploit): is_tenant_of_property() is per PROPERTY, so in an HMO every
--   tenant linked to the property could read (and mark read) every other
--   tenant's private messages with the landlord, and a former tenant whose
--   tenant_profiles row was never removed could keep reading new ones.
--
-- CLIENT BEHAVIOUR CHANGE:
--   * Tenant portal (fetchTenantMessages / markMessagesRead in
--     src/lib/api/tenant_portal.js) now only returns / updates rows whose
--     tenant_user_id is the signed-in tenant. Landlord replies are inserted
--     with tenant_user_id set (replyToTenantMessage), so normal threads are
--     unaffected.
--   * Any historical row with tenant_user_id IS NULL becomes invisible to
--     tenants (landlords still see it). Run the count in VERIFY first.
--   * Landlord side unchanged.
--
-- NOT IN THIS PASS (tenancy-scoped follow-up needed):
--   The tenant SELECT policies on rent_payments and tenancy_details (and
--   other tenant-facing per-property policies built on is_tenant_of_property)
--   remain PER-PROPERTY: every tenant linked to an HMO property, or a former
--   tenant still linked in tenant_profiles, can read the whole property's rent
--   ledger / tenancy record. Fixing that needs tenant_profiles tied to a
--   specific tenancy (and an end date), which is a larger redesign.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS tenant_messages_select ON public.tenant_messages;
--   CREATE POLICY tenant_messages_select ON public.tenant_messages
--     FOR SELECT USING (
--       is_platform_admin() OR is_developer()
--       OR is_tenant_of_property(property_id)
--       OR has_property_access(property_id)
--       OR EXISTS (SELECT 1 FROM properties p
--                  WHERE p.id = tenant_messages.property_id AND p.user_id = (SELECT auth.uid())));
--   DROP POLICY IF EXISTS tenant_messages_update ON public.tenant_messages;
--   CREATE POLICY tenant_messages_update ON public.tenant_messages
--     FOR UPDATE
--     USING (
--       is_platform_admin() OR is_developer()
--       OR is_tenant_of_property(property_id)
--       OR has_property_access(property_id)
--       OR EXISTS (SELECT 1 FROM properties p
--                  WHERE p.id = tenant_messages.property_id AND p.user_id = (SELECT auth.uid())))
--     WITH CHECK (
--       is_platform_admin() OR is_developer()
--       OR is_tenant_of_property(property_id)
--       OR has_property_access(property_id)
--       OR EXISTS (SELECT 1 FROM properties p
--                  WHERE p.id = tenant_messages.property_id AND p.user_id = (SELECT auth.uid())));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_messages_select ON public.tenant_messages;
CREATE POLICY tenant_messages_select ON public.tenant_messages
  FOR SELECT USING (
    is_platform_admin()
    OR is_developer()
    OR (
      tenant_user_id = (SELECT auth.uid())
      AND public.is_tenant_of_property(property_id)
    )
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS tenant_messages_update ON public.tenant_messages;
CREATE POLICY tenant_messages_update ON public.tenant_messages
  FOR UPDATE
  USING (
    is_platform_admin()
    OR is_developer()
    OR (
      tenant_user_id = (SELECT auth.uid())
      AND public.is_tenant_of_property(property_id)
    )
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR is_developer()
    OR (
      tenant_user_id = (SELECT auth.uid())
      AND public.is_tenant_of_property(property_id)
    )
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   -- BEFORE applying: rows that tenants will stop seeing (expect 0 or a
--   -- known, acceptable number):
--   SELECT count(*) FROM public.tenant_messages WHERE tenant_user_id IS NULL;
--   -- After applying:
--   SELECT policyname, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'tenant_messages' ORDER BY policyname;
--   -- As tenant A in an HMO: SELECT count(*) FROM tenant_messages WHERE tenant_user_id <> auth.uid(); -> 0
