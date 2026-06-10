-- ===========================================================================
-- Security hardening 01 — shared helper functions
-- ===========================================================================
-- Defines the SECURITY DEFINER predicates that the later security migrations
-- (05_role_and_liveness_policies) depend on. Run this FIRST.
--
--   company_is_live(company_id)        — billing/trial liveness gate
--   has_property_permission(prop, act) — role-aware permission check that
--                                        mirrors ROLE_DEFAULTS in src/App.jsx
--                                        / src/lib/api/_monolith.js
--
-- Idempotent (CREATE OR REPLACE). Safe to run multiple times.
--
-- ROLLBACK: DROP FUNCTION public.company_is_live(uuid);
--           DROP FUNCTION public.has_property_permission(uuid, text);
--           (only after the policies that reference them have been reverted).
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- company_is_live(company_id)  (cross-agent contract 5)
-- ─────────────────────────────────────────────────────────────────────────────
-- True when the company may still write data:
--   * developer / platform admin operator           (operational bypass)
--   * subscription status in ('active','trialing',
--     'past_due')                                     (paying / Stripe trial /
--                                                       failed-payment grace)
--   * companies.is_free_tier                          (admin-granted free use)
--   * trial_ends_at > now()                           (in-app trial window;
--                                                       a missing subscription
--                                                       row + valid trial counts
--                                                       as live)
--
-- 'past_due' stays live to match the React gate (App.jsx isCompanyLive):
-- Stripe retries failed cards for days, and a paying customer must not lose
-- write access over a single declined charge. Access ends when Stripe moves
-- the subscription to 'canceled'/'unpaid' (webhook-managed).
CREATE OR REPLACE FUNCTION public.company_is_live(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    is_developer()
    OR is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.company_id = p_company_id
        -- past_due included as a grace period, matching the React-side gate
        -- (App.jsx isCompanyLive): a single failed card retry must not lock a
        -- paying customer out of their data mid-billing-cycle.
        AND s.status IN ('active', 'trialing', 'past_due')
    )
    OR EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = p_company_id
        AND (c.is_free_tier = true OR c.trial_ends_at > now())
    );
$$;

REVOKE ALL ON FUNCTION public.company_is_live(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_is_live(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- has_property_permission(property_id, action)
-- ─────────────────────────────────────────────────────────────────────────────
-- Role-aware authorisation for the per-property child tables. Mirrors the
-- client ROLE_DEFAULTS (src/lib/api/_monolith.js): owner/admin can do anything,
-- editor can read + write (incl. delete of their team's records), viewer is
-- read-only. The legacy personal-owner (properties.user_id = caller) and the
-- company owner always have full access.
--
-- p_action is one of: 'select' | 'write' | 'delete'.
--   - 'write'  covers INSERT and UPDATE
--   - 'delete' covers DELETE
--   - 'select' covers reads (all members may read; column-level financial /
--     tenant-PII gating remains client-side — see notes).
--
-- The permissions JSONB overrides are intentionally NOT consulted here; the DB
-- check is the coarse role floor (block viewers from writing). Fine-grained
-- per-key overrides stay enforced in the React layer, which already gates the
-- UI. This keeps the DB rule simple and avoids breaking editor workflows.
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
  IF v_prop_owner = auth.uid() THEN
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
GRANT EXECUTE ON FUNCTION public.has_property_permission(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION (run as a normal collaborator, not developer):
--   SELECT public.company_is_live('<your-company-uuid>');     -- true while live
--   SELECT public.has_property_permission('<prop>', 'write'); -- false for viewer
--   SELECT public.has_property_permission('<prop>', 'select');-- true for viewer
-- ===========================================================================
