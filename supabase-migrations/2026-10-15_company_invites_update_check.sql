-- ----------------------------------------------------------------------------
-- company_invites: pin the company on update + two advisor follow-ups
-- (15 Oct 2026, found by the post-rollout security advisor pass).
--
-- 1. "Company admins update own invites" had a USING clause but no WITH
--    CHECK, so the new row was never checked. Anyone can become an admin by
--    creating their own company (create_company_for_owner), create a join
--    code for it, then UPDATE that code's company_id to someone else's
--    company and redeem it via redeem_company_invite() to join that company
--    as admin. Fix: the same admin/owner test must hold for the new row, and
--    a trigger stops company_id or created_by changing at all.
-- 2. has_rent_permission() is SECURITY DEFINER and still callable by anon.
-- 3. Three trigger/helper functions had a role-mutable search_path.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Company admins update own invites" ON public.company_invites;
CREATE POLICY "Company admins update own invites" ON public.company_invites
  FOR UPDATE
  USING (
    (EXISTS (SELECT 1 FROM public.user_company_access
              WHERE user_company_access.user_id = ((SELECT auth.uid()))::text
                AND user_company_access.company_id = company_invites.company_id
                AND (user_company_access.is_admin = true OR user_company_access.is_owner = true)))
    OR (EXISTS (SELECT 1 FROM public.companies
                 WHERE companies.id = company_invites.company_id
                   AND companies.owner_id = (SELECT auth.uid())))
  )
  WITH CHECK (
    (EXISTS (SELECT 1 FROM public.user_company_access
              WHERE user_company_access.user_id = ((SELECT auth.uid()))::text
                AND user_company_access.company_id = company_invites.company_id
                AND (user_company_access.is_admin = true OR user_company_access.is_owner = true)))
    OR (EXISTS (SELECT 1 FROM public.companies
                 WHERE companies.id = company_invites.company_id
                   AND companies.owner_id = (SELECT auth.uid())))
  );

CREATE OR REPLACE FUNCTION public.enforce_company_invite_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_developer() THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a join code cannot be moved to another company; create a new one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_company_invite_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS company_invites_identity_guard ON public.company_invites;
CREATE TRIGGER company_invites_identity_guard
  BEFORE UPDATE ON public.company_invites
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_invite_identity_guard();

REVOKE EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) TO authenticated;

ALTER FUNCTION public.stl_segment_status_guard() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.notification_dedupe_key(text, jsonb) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.notifications_dedupe_guard() SET search_path TO 'public', 'pg_temp';

NOTIFY pgrst, 'reload schema';
