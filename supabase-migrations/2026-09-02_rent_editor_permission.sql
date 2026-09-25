-- ===========================================================================
-- Rent Tracker stage 7: Rent Tracker Editor permission at the database layer
-- ===========================================================================
--
-- WHY
--   The Team & Access tab now offers a fourth preset, "Rent Tracker Editor",
--   stored as role = 'viewer' with permissions = {"view_rent":true,
--   "edit_rent":true} on user_company_access. Nothing about the role column
--   changes (it still allows admin | editor | viewer only).
--
--   Until now the rent_payments write policies called
--   has_property_permission(), which DELIBERATELY ignores the permissions
--   JSONB and applies the coarse role floor (viewer = read-only). That is the
--   right floor for every other table, but it means a Rent Tracker Editor
--   could see the edit controls in the UI and then be refused by RLS, and it
--   means an editor whose admin has switched edit_rent OFF could still write
--   rent rows through the API.
--
--   has_rent_permission() is a rent-only variant that honours the edit_rent
--   override in both directions and otherwise falls back to exactly the same
--   role floor as has_property_permission(). Only the three rent_payments
--   write policies switch to it; has_property_permission() and every other
--   table are untouched.
--
-- RESOLUTION ORDER (mirrors has_property_permission until the last step)
--   1. developer / platform admin                      -> true
--   2. property not found                              -> false
--   3. legacy personal owner of the property row       -> true
--   4. company owner (companies.owner_id)              -> true
--   5. not a member of the company                     -> false
--   6. member row flagged is_owner, or role admin      -> true
--   7. permissions->>'edit_rent' = 'false'             -> select only
--   8. permissions->>'edit_rent' = 'true'              -> select/write/delete
--   9. role floor: editor -> select/write/delete, viewer -> select
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS. Safe to re-run.
-- ROLLBACK: re-run supabase-migrations/2026-06-10_security_05_role_and_liveness_policies.sql
--   (its DO block recreates rent_payments_rls_insert/update/delete against
--   has_property_permission), then DROP FUNCTION public.has_rent_permission(uuid, text).
-- ===========================================================================

-- ── 1. Helper ──────────────────────────────────────────────────────────────
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
  IF v_prop_owner = auth.uid() THEN
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

COMMENT ON FUNCTION public.has_rent_permission(uuid, text) IS
  'Rent-only variant of has_property_permission: same owner/admin shortcuts and role floor, but honours the edit_rent key in user_company_access.permissions so the Rent Tracker Editor preset (viewer + edit_rent) can write rent_payments and an editor with edit_rent revoked cannot. p_action: select | write | delete.';

-- Match the anon revoke applied to has_property_permission in security_10.
REVOKE EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.has_rent_permission(uuid, text) TO authenticated;

-- ── 2. rent_payments write policies ────────────────────────────────────────
-- Shapes copied from 2026-06-10_security_05_role_and_liveness_policies.sql
-- with has_property_permission -> has_rent_permission. The company_is_live
-- clauses are unchanged. The SELECT policy (rent_payments_rls_select) is not
-- touched: read access is unaffected by this stage.
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rent_payments_rls_insert ON public.rent_payments;
CREATE POLICY rent_payments_rls_insert ON public.rent_payments
  FOR INSERT WITH CHECK (
    has_rent_permission(property_id, 'write')
    AND company_is_live((SELECT company_id FROM public.properties WHERE id = rent_payments.property_id))
  );

DROP POLICY IF EXISTS rent_payments_rls_update ON public.rent_payments;
CREATE POLICY rent_payments_rls_update ON public.rent_payments
  FOR UPDATE
  USING (has_rent_permission(property_id, 'write'))
  WITH CHECK (
    has_rent_permission(property_id, 'write')
    AND company_is_live((SELECT company_id FROM public.properties WHERE id = rent_payments.property_id))
  );

DROP POLICY IF EXISTS rent_payments_rls_delete ON public.rent_payments;
CREATE POLICY rent_payments_rls_delete ON public.rent_payments
  FOR DELETE USING (has_rent_permission(property_id, 'delete'));

NOTIFY pgrst, 'reload schema';

-- ── 3. Verification (run by hand after applying) ───────────────────────────
-- Policies should now reference has_rent_permission, nothing else changed:
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'rent_payments'
--   ORDER BY policyname;
--   -- expect rent_payments_rls_insert/update/delete to mention has_rent_permission
--   -- and rent_payments_rls_select / rent_payments_tenant_select unchanged.
--
-- Function attributes (security definer, stable, pinned search_path):
--   SELECT proname, prosecdef, provolatile, proconfig
--   FROM pg_proc WHERE proname = 'has_rent_permission';
--
-- Behavioural spot check as a Rent Tracker Editor (viewer + edit_rent):
--   -- as that user (set request.jwt.claims or use the app):
--   SELECT has_rent_permission('<property_id>', 'write');      -- expect true
--   SELECT has_property_permission('<property_id>', 'write');  -- expect false (unchanged floor)
-- and as a plain viewer both should be false; as an editor with
-- permissions = {"edit_rent": false} has_rent_permission(...,'write') is false.

-- ── 4. Stage 2 tables use the same rent gate ───────────────────────────────
-- tenancies, non_chargeable_periods, rent_receipts and rent_allocations were
-- created (2026-09-02_rent_tracker_tenancies_receipts.sql) with the coarse
-- has_property_permission floor. A Rent Tracker Editor must be able to record
-- receipts and confirm tenancies, so their write policies switch too. SELECT
-- policies are unchanged.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenancies','non_chargeable_periods','rent_receipts']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_insert ON public.%I FOR INSERT
      WITH CHECK (has_rent_permission(property_id, 'write')
        AND company_is_live((SELECT company_id FROM public.properties WHERE id = %I.property_id)))$p$, t, t, t);
    EXECUTE format($p$CREATE POLICY %I_update ON public.%I FOR UPDATE
      USING (has_rent_permission(property_id, 'write'))
      WITH CHECK (has_rent_permission(property_id, 'write')
        AND company_is_live((SELECT company_id FROM public.properties WHERE id = %I.property_id)))$p$, t, t, t);
    EXECUTE format($p$CREATE POLICY %I_delete ON public.%I FOR DELETE
      USING (has_rent_permission(property_id, 'delete'))$p$, t, t);
  END LOOP;
END $rls$;

DROP POLICY IF EXISTS rent_allocations_insert ON public.rent_allocations;
DROP POLICY IF EXISTS rent_allocations_update ON public.rent_allocations;
DROP POLICY IF EXISTS rent_allocations_delete ON public.rent_allocations;
CREATE POLICY rent_allocations_insert ON public.rent_allocations FOR INSERT
  WITH CHECK (has_rent_permission((SELECT property_id FROM public.rent_receipts r WHERE r.id = receipt_id), 'write'));
CREATE POLICY rent_allocations_update ON public.rent_allocations FOR UPDATE
  USING (has_rent_permission((SELECT property_id FROM public.rent_receipts r WHERE r.id = receipt_id), 'write'))
  WITH CHECK (has_rent_permission((SELECT property_id FROM public.rent_receipts r WHERE r.id = receipt_id), 'write'));
CREATE POLICY rent_allocations_delete ON public.rent_allocations FOR DELETE
  USING (has_rent_permission((SELECT property_id FROM public.rent_receipts r WHERE r.id = receipt_id), 'delete'));

NOTIFY pgrst, 'reload schema';
