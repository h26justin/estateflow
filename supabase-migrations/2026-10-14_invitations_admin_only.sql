-- ----------------------------------------------------------------------------
-- invitations: only company admins create or manage invites (security
-- hotfix, 14 Oct 2026)
--
-- HOLE (live pg_policies, 14 Oct 2026):
--   invitations_insert  WITH CHECK (invited_by = auth.uid())
--   invitations_update  USING (email = auth.email() OR invited_by = auth.uid())
--                       no WITH CHECK
-- Any signed-in user could create an invitation for ANY company_id, including
-- one with is_admin = true addressed to themselves, then use it to pass the
-- uca_insert "self-service join" branch and become an admin of a company they
-- had nothing to do with. Separately, the invitee could UPDATE their invite
-- row freely (flip is_admin, move company_id, rewrite invited_by), because
-- the update policy had no WITH CHECK.
--
-- FIX:
--   * INSERT: caller must be a company admin/owner (user_is_company_admin) and
--     must stamp invited_by = auth.uid(). Developer bypass kept.
--   * UPDATE: company admins (and developers) may manage their company's
--     invites. The invitee (email matches the caller, case-insensitive) may
--     still see the row through USING, but the BEFORE UPDATE trigger below
--     lets a non-admin change ONLY accepted (to true) and accepted_at, so
--     company_id, email, is_admin, invited_by, token and expires_at are
--     pinned. WITH CHECK cannot see OLD, hence the trigger.
--   * invited_by is immutable for everyone except developers / service role.
--   Acceptance itself now goes through accept_company_invitation()
--   (2026-10-14_accept_company_invitation_rpc.sql), a SECURITY DEFINER
--   function that bypasses RLS, so the client no longer needs this path.
--
-- SELECT and DELETE policies are not touched.
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS invitations_insert ON public.invitations;
CREATE POLICY invitations_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = (SELECT auth.uid())
    AND (public.is_developer() OR public.user_is_company_admin(company_id))
  );

DROP POLICY IF EXISTS invitations_update ON public.invitations;
CREATE POLICY invitations_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    public.is_developer()
    OR public.user_is_company_admin(company_id)
    OR lower(email) = lower((SELECT auth.email()))
  )
  WITH CHECK (
    public.is_developer()
    OR public.user_is_company_admin(company_id)
    OR lower(email) = lower((SELECT auth.email()))
  );

-- ── Non-admin updates may only mark the invite accepted ────────────────────
CREATE OR REPLACE FUNCTION public.enforce_invitation_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  -- Service role / SQL editor / SECURITY DEFINER RPCs running without a JWT.
  IF auth.uid() IS NULL OR public.is_developer() THEN
    RETURN NEW;
  END IF;

  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'invited_by cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A company admin of BOTH the old and the new company may manage the invite.
  IF public.user_is_company_admin(OLD.company_id)
     AND public.user_is_company_admin(NEW.company_id) THEN
    RETURN NEW;
  END IF;

  -- Everyone else (the invitee): only accepted -> true and accepted_at.
  v_old := to_jsonb(OLD) - 'accepted' - 'accepted_at' - 'updated_at';
  v_new := to_jsonb(NEW) - 'accepted' - 'accepted_at' - 'updated_at';
  IF v_new IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'only a company admin can change an invitation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.accepted IS TRUE AND NEW.accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'an accepted invitation cannot be un-accepted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_invitation_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS invitations_update_guard ON public.invitations;
CREATE TRIGGER invitations_update_guard
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invitation_update_guard();

NOTIFY pgrst, 'reload schema';
