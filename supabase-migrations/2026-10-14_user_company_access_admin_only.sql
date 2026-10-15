-- ----------------------------------------------------------------------------
-- user_company_access: only company admins (or developers) write membership
-- rows (security hotfix, 14 Oct 2026)
--
-- APPLY ORDER: after 2026-10-14_accept_company_invitation_rpc.sql AND after
-- the client that calls accept_company_invitation() is deployed. The old
-- client's acceptInvitation() self-upserts and will fail once this lands.
--
-- HOLE (live pg_policies, 14 Oct 2026):
--   uca_insert had a "self-service join" branch:
--     user_id = auth.uid()::text AND is_owner IS NOT TRUE AND
--     ((is_admin IS NOT TRUE AND role IN (null,'viewer','editor'))
--      OR EXISTS an is_admin invitation for (company_id, auth.email()))
--   => any signed-in user could add themselves to ANY company as an
--      editor (full read/write of its properties, tenants and finances)
--      without an invitation; with a self-made invitation, as an admin.
--   uca_update let a member UPDATE their OWN row (USING user_id = auth.uid())
--   and WITH CHECK only looked at the new row, so a member could re-point
--   their row's company_id to any other company (the self branch passes
--   for viewer/editor), joining it. Admins could likewise move rows between
--   companies they do not administer.
--
-- FIX:
--   * uca_insert: developer, or company admin/owner (user_is_company_admin);
--     only the real company owner may create an is_owner row. The self
--     branch is gone: invitations are accepted by the SECURITY DEFINER RPC
--     accept_company_invitation(), and code invites by
--     redeem_company_invite(), both of which bypass RLS after validating.
--   * uca_update: developer or company admin only. Members can no longer
--     edit their own row (role/permissions/is_admin are admin decisions).
--   * BEFORE UPDATE trigger: company_id is immutable and user_id may only
--     change for the legacy "claim" case — a row created before sign-up
--     with user_id = the invitee's email, being claimed by the signed-in
--     user whose email matches (App.jsx -> updateUserIdByEmail). Developers
--     and service role (auth.uid() IS NULL) are exempt.
--   Legacy rows whose user_id is an email string are not modified.
--
-- uca_select and uca_delete are unchanged.
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS uca_insert ON public.user_company_access;
CREATE POLICY uca_insert ON public.user_company_access
  FOR INSERT
  WITH CHECK (
    public.is_developer()
    OR (
      public.user_is_company_admin(company_id)
      AND (
        is_owner IS NOT TRUE
        OR EXISTS (SELECT 1 FROM public.companies c
                    WHERE c.id = user_company_access.company_id
                      AND c.owner_id = (SELECT auth.uid()))
      )
    )
  );

DROP POLICY IF EXISTS uca_update ON public.user_company_access;
CREATE POLICY uca_update ON public.user_company_access
  FOR UPDATE
  USING (
    public.is_developer()
    OR public.user_is_company_admin(company_id)
  )
  WITH CHECK (
    public.is_developer()
    OR (
      public.user_is_company_admin(company_id)
      AND (
        is_owner IS NOT TRUE
        OR EXISTS (SELECT 1 FROM public.companies c
                    WHERE c.id = user_company_access.company_id
                      AND c.owner_id = (SELECT auth.uid()))
      )
    )
  );

-- ── Pin company_id / user_id on update ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_uca_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_developer() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company access cannot be moved to another company; remove it and grant a new one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    -- Legacy claim: the row was keyed by email before the person signed up
    -- (user_id is not a uuid), its email is the caller's, and it is being
    -- re-keyed to the caller's own id. Nothing else may change user_id.
    IF OLD.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND NEW.user_id = auth.uid()::text
       AND lower(btrim(COALESCE(OLD.email, OLD.user_id))) = lower(btrim(auth.email()))
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'the member on a company access row cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_uca_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS uca_identity_guard ON public.user_company_access;
CREATE TRIGGER uca_identity_guard
  BEFORE UPDATE ON public.user_company_access
  FOR EACH ROW EXECUTE FUNCTION public.enforce_uca_identity_guard();

NOTIFY pgrst, 'reload schema';
