-- ----------------------------------------------------------------------------
-- user_profiles privilege guard (security hotfix, 14 Oct 2026)
--
-- user_profiles_update / _insert only check user_id = auth.uid() and
-- `authenticated` holds table-level INSERT/UPDATE, so any signed-in user could
-- set is_developer or platform_admin on their own row. is_developer() reads
-- exactly those two columns and is the RLS bypass in almost every policy, so
-- that was a full cross-tenant takeover. Verified live on 14 Oct 2026; the
-- only flagged account was the platform owner's, so no sign of abuse.
--
-- Fix: a BEFORE INSERT/UPDATE trigger, same shape as
-- enforce_company_billing_guard. Only an existing platform admin (or a
-- service-role / SQL-editor session, where auth.uid() is NULL) may grant or
-- change either flag. No app code writes these columns.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_user_profile_privilege_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_platform_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_developer IS TRUE OR NEW.platform_admin IS TRUE THEN
      RAISE EXCEPTION 'developer/admin flags can only be granted by a platform administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_developer   IS DISTINCT FROM OLD.is_developer
     OR NEW.platform_admin IS DISTINCT FROM OLD.platform_admin
     OR NEW.user_id     IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'developer/admin flags can only be changed by a platform administrator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_user_profile_privilege_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_profiles_privilege_guard ON public.user_profiles;
CREATE TRIGGER user_profiles_privilege_guard
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_profile_privilege_guard();

-- Pin user_id on update too (the trigger blocks changing it; this keeps the
-- policy honest if the trigger is ever dropped).
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
CREATE POLICY user_profiles_update ON public.user_profiles
  FOR UPDATE TO public
  USING (is_developer() OR ((user_id)::text = ((SELECT auth.uid()))::text))
  WITH CHECK (is_developer() OR ((user_id)::text = ((SELECT auth.uid()))::text));
