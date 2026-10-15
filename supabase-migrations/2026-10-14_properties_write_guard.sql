-- ----------------------------------------------------------------------------
-- properties: role-aware writes + pinned ownership (security hotfix,
-- 14 Oct 2026)
--
-- HOLE (live pg_policies, 14 Oct 2026):
--   properties_update  USING (is_developer() OR user_id = auth.uid()
--                             OR has_company_access(company_id))
--                      WITH CHECK (is_developer() OR ((user_id = auth.uid()
--                             OR has_company_access(company_id))
--                             AND company_is_live(company_id)))
--   properties_insert  similar.
--   has_company_access() is true for ANY member, including read-only
--   viewers, so a viewer could edit every property in the company. Worse,
--   WITH CHECK only looks at the new row: a member of company A could
--   UPDATE a property they can see and set company_id to company B (any
--   live company where they are a member), or set user_id to themselves —
--   moving another landlord's property, and with it every child row keyed
--   off property_id, into a company or account they control.
--   Insert accepted a company_id the caller merely belongs to as a viewer,
--   and any user_id.
--
-- FIX:
--   * UPDATE: developer, the property's own user, or
--     has_property_permission(id, 'write') (owner / admin / editor — never
--     viewer); new row must still sit in a live company.
--   * INSERT: developer, or user_id = caller AND
--     ((company_id IS NULL) OR has_company_write(company_id)), plus
--     company_is_live(company_id) as before. company_is_live(NULL) is false
--     for non-developers, which matches the live policy today.
--   * BEFORE UPDATE trigger: changing company_id or user_id requires the
--     caller to administer BOTH the old and the new company
--     (user_is_company_admin: platform admin, company owner, or uca
--     is_admin/is_owner). A property with no company counts as
--     administered by its own user. Developers / service role exempt.
--   properties_delete (developer or owner) is unchanged; properties_select
--   is unchanged.
--
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS properties_insert ON public.properties;
CREATE POLICY properties_insert ON public.properties
  FOR INSERT
  WITH CHECK (
    public.is_developer()
    OR (
      user_id = (SELECT auth.uid())
      AND (company_id IS NULL OR public.has_company_write(company_id))
      AND public.company_is_live(company_id)
    )
  );

DROP POLICY IF EXISTS properties_update ON public.properties;
CREATE POLICY properties_update ON public.properties
  FOR UPDATE
  USING (
    public.is_developer()
    OR user_id = (SELECT auth.uid())
    OR public.has_property_permission(id, 'write')
  )
  WITH CHECK (
    public.is_developer()
    OR (
      (user_id = (SELECT auth.uid()) OR public.has_property_permission(id, 'write'))
      AND public.company_is_live(company_id)
    )
  );

-- ── Moving a property between companies / owners ───────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_property_ownership_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR public.is_developer() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  IF (CASE WHEN OLD.company_id IS NULL THEN OLD.user_id = v_uid
           ELSE public.user_is_company_admin(OLD.company_id) END)
     AND
     (CASE WHEN NEW.company_id IS NULL THEN NEW.user_id = v_uid
           ELSE public.user_is_company_admin(NEW.company_id) END)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'only an owner or admin of both companies can move a property or change its owner'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_property_ownership_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS properties_ownership_guard ON public.properties;
CREATE TRIGGER properties_ownership_guard
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_property_ownership_guard();

NOTIFY pgrst, 'reload schema';
