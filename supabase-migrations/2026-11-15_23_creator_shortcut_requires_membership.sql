-- ----------------------------------------------------------------------------
-- Property creator shortcut only while the creator is still in the company
-- (security fix, 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- !!! DIFF AGAINST LIVE FIRST !!! The two function bodies below are copied
-- from the LATEST repo definitions:
--   has_property_permission(uuid, text) — 2026-06-10_security_01_helpers.sql
--   has_rent_permission(uuid, text)     — 2026-09-02_rent_editor_permission.sql
-- and the policies from 2026-10-14_properties_write_guard.sql
-- (properties_update) and 2026-06-10_security_05 (properties_delete). The
-- repo may lag production. Before applying, run the VERIFY "before" queries,
-- diff the live bodies / policy text against what this file replaces, and
-- merge any live-only change into this file. Only the creator-shortcut lines
-- are meant to change.
--
-- WHAT:
--   * has_property_permission / has_rent_permission: the shortcut
--       IF v_prop_owner = auth.uid() THEN RETURN true;
--     now also requires the caller to be the company owner or to have a
--     user_company_access row for the property's company (matched the same
--     way the functions already match members: user_id or email).
--     Properties with no company are unchanged (both functions already return
--     false for them before reaching the shortcut). Apart from that condition
--     and its two comment lines, each body is the repo body unchanged; grants
--     are re-stated as they are today (CREATE OR REPLACE keeps the ACL anyway).
--   * properties_update: the "user_id = caller" branch (USING and WITH CHECK)
--     becomes "user_id = caller AND (company_id IS NULL OR
--     has_company_access(company_id))".
--   * properties_delete: same change to its creator branch.
--     properties_select / properties_insert are not touched.
--
-- WHY (exploit): the creator of a property kept full write / delete rights on
--   it (and on all its rent, expense, tenancy, compliance and refurb rows via
--   has_property_permission / has_rent_permission) after being REMOVED from
--   the company, so an ex-employee or ex-partner could still alter or delete
--   the company's records.
--
-- KNOWN LIMIT (deliberately as briefed): a creator who is still a member but
--   was DEMOTED to viewer keeps the shortcut (full access) on the properties
--   they created. Closing that too means requiring a write-capable role in
--   the shortcut, which makes it redundant for members — i.e. dropping the
--   shortcut for company properties. Decide before applying.
--
-- CLIENT BEHAVIOUR CHANGE: users removed from a company lose all write /
--   delete access to properties they created there (they already lost read
--   access through has_company_access / has_property_access). Current members
--   and company owners are unaffected.
--
-- Idempotent: CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- ROLLBACK: re-run, in this order,
--   supabase-migrations/2026-06-10_security_01_helpers.sql   (has_property_permission body + grants;
--                                                             then 2026-06-10_security_10_advisor_followup.sql's
--                                                             REVOKE ... has_property_permission ... FROM anon)
--   the function section (part 1) of 2026-09-02_rent_editor_permission.sql
--     (has_rent_permission body), then
--     REVOKE EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) FROM PUBLIC, anon;
--   and restore the two policies:
--   DROP POLICY IF EXISTS properties_update ON public.properties;
--   CREATE POLICY properties_update ON public.properties FOR UPDATE
--     USING (public.is_developer() OR user_id = (SELECT auth.uid()) OR public.has_property_permission(id, 'write'))
--     WITH CHECK (public.is_developer() OR ((user_id = (SELECT auth.uid()) OR public.has_property_permission(id, 'write'))
--                 AND public.company_is_live(company_id)));
--   DROP POLICY IF EXISTS properties_delete ON public.properties;
--   CREATE POLICY properties_delete ON public.properties FOR DELETE
--     USING (is_developer() OR user_id::text = auth.uid()::text);
--   NOTIFY pgrst, 'reload schema';
--   (If the live text captured below differs, restore the captured text.)
-- ----------------------------------------------------------------------------

-- ── 1. has_property_permission ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_property_permission(p_property_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_prop_owner uuid;
  v_role       text;
  v_is_admin   boolean;
  v_is_owner   boolean;
BEGIN
  IF is_developer() OR is_platform_admin() THEN
    RETURN true;
  END IF;

  SELECT company_id, user_id INTO v_company_id, v_prop_owner
  FROM properties WHERE id = p_property_id LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Legacy personal owner of the row, or the company owner: full access.
  -- The creator shortcut only applies while the creator is still the
  -- company owner or a current member of the property's company.
  IF v_prop_owner = auth.uid()
     AND (
       EXISTS (SELECT 1 FROM companies WHERE id = v_company_id AND owner_id = auth.uid())
       OR EXISTS (SELECT 1 FROM user_company_access
                  WHERE company_id = v_company_id
                    AND (user_id = auth.uid()::text OR email = auth.email()))
     ) THEN
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_company_id AND owner_id = auth.uid()) THEN
    RETURN true;
  END IF;

  -- Collaborator: resolve effective role.
  SELECT role, is_admin, is_owner
    INTO v_role, v_is_admin, v_is_owner
  FROM user_company_access
  WHERE company_id = v_company_id
    AND (user_id = auth.uid()::text OR email = auth.email())
  LIMIT 1;

  IF v_role IS NULL AND v_is_admin IS NULL AND v_is_owner IS NULL THEN
    RETURN false;  -- not a member
  END IF;

  v_role := COALESCE(v_role, CASE WHEN v_is_admin THEN 'admin' ELSE 'editor' END);

  IF v_is_owner = true OR v_role IN ('owner', 'admin') THEN
    RETURN true;                         -- full access
  ELSIF v_role = 'editor' THEN
    RETURN p_action IN ('select', 'write', 'delete');
  ELSIF v_role = 'viewer' THEN
    RETURN p_action = 'select';          -- read-only
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.has_property_permission(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_property_permission(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_property_permission(uuid, text) TO authenticated;

-- ── 2. has_rent_permission ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_rent_permission(p_property_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_company_id uuid;
  v_prop_owner uuid;
  v_role       text;
  v_is_admin   boolean;
  v_is_owner   boolean;
  v_perms      jsonb;
  v_edit_rent  text;
BEGIN
  IF is_developer() OR is_platform_admin() THEN
    RETURN true;
  END IF;

  SELECT company_id, user_id INTO v_company_id, v_prop_owner
  FROM properties WHERE id = p_property_id LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  -- Legacy personal owner of the row, or the company owner: full access.
  -- The creator shortcut only applies while the creator is still the
  -- company owner or a current member of the property's company.
  IF v_prop_owner = auth.uid()
     AND (
       EXISTS (SELECT 1 FROM companies WHERE id = v_company_id AND owner_id = auth.uid())
       OR EXISTS (SELECT 1 FROM user_company_access
                  WHERE company_id = v_company_id
                    AND (user_id = auth.uid()::text OR email = auth.email()))
     ) THEN
    RETURN true;
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_company_id AND owner_id = auth.uid()) THEN
    RETURN true;
  END IF;

  -- Collaborator: resolve role AND the per-key overrides.
  SELECT role, is_admin, is_owner, permissions
    INTO v_role, v_is_admin, v_is_owner, v_perms
  FROM user_company_access
  WHERE company_id = v_company_id
    AND (user_id = auth.uid()::text OR email = auth.email())
  LIMIT 1;

  IF v_role IS NULL AND v_is_admin IS NULL AND v_is_owner IS NULL AND v_perms IS NULL THEN
    RETURN false;  -- not a member
  END IF;

  v_role := COALESCE(v_role, CASE WHEN v_is_admin THEN 'admin' ELSE 'editor' END);

  IF v_is_owner = true OR v_role IN ('owner', 'admin') THEN
    RETURN true;                         -- full access, overrides cannot restrict admins
  END IF;

  -- The edit_rent override wins over the role floor in BOTH directions:
  -- a viewer granted edit_rent can write, an editor with edit_rent revoked
  -- cannot. The JSONB stores booleans, so ->> yields 'true' / 'false'.
  v_edit_rent := COALESCE(v_perms, '{}'::jsonb) ->> 'edit_rent';

  IF v_edit_rent = 'false' THEN
    RETURN p_action = 'select';
  ELSIF v_edit_rent = 'true' THEN
    RETURN p_action IN ('select', 'write', 'delete');
  END IF;

  -- No override: same role floor as has_property_permission.
  IF v_role = 'editor' THEN
    RETURN p_action IN ('select', 'write', 'delete');
  ELSIF v_role = 'viewer' THEN
    RETURN p_action = 'select';
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) TO authenticated;

-- ── 3. properties_update / properties_delete creator branch ────────────────
DROP POLICY IF EXISTS properties_update ON public.properties;
CREATE POLICY properties_update ON public.properties
  FOR UPDATE
  USING (
    public.is_developer()
    OR (
      user_id = (SELECT auth.uid())
      AND (company_id IS NULL OR public.has_company_access(company_id))
    )
    OR public.has_property_permission(id, 'write')
  )
  WITH CHECK (
    public.is_developer()
    OR (
      (
        (
          user_id = (SELECT auth.uid())
          AND (company_id IS NULL OR public.has_company_access(company_id))
        )
        OR public.has_property_permission(id, 'write')
      )
      AND public.company_is_live(company_id)
    )
  );

DROP POLICY IF EXISTS properties_delete ON public.properties;
CREATE POLICY properties_delete ON public.properties
  FOR DELETE
  USING (
    is_developer()
    OR (
      user_id::text = auth.uid()::text
      AND (company_id IS NULL OR public.has_company_access(company_id))
    )
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY
--   BEFORE (capture and diff against this file):
--   SELECT pg_get_functiondef('public.has_property_permission(uuid,text)'::regprocedure);
--   SELECT pg_get_functiondef('public.has_rent_permission(uuid,text)'::regprocedure);
--   SELECT proname, proacl FROM pg_proc
--    WHERE proname IN ('has_property_permission', 'has_rent_permission');
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'properties' ORDER BY policyname;
--   SELECT pg_get_functiondef('public.has_company_access(uuid)'::regprocedure);  -- owner + member, as assumed
--   AFTER: same queries; only the creator-shortcut lines / branches differ, and
--   proacl is unchanged ({postgres, authenticated, service_role ...}, no anon).
--   As a user removed from company C who created property P in C:
--     SELECT has_property_permission('<P>', 'write');   -- false (was true)
--     UPDATE properties SET name = name WHERE id = '<P>'; -- 0 rows
