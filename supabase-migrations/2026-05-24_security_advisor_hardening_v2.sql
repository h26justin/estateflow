-- Follow-up to 2026-05-24_security_advisor_hardening.sql.
--
-- The previous migration REVOKE'd EXECUTE from `anon` on a bunch of
-- SECURITY DEFINER functions — but Postgres GRANTs EXECUTE TO PUBLIC by
-- default when a function is created, and `anon` is a member of PUBLIC.
-- So the revoke only had effect for functions whose original migration
-- had also explicitly revoked from PUBLIC. For the rest, anon still
-- inherited EXECUTE via PUBLIC.
--
-- Fix: REVOKE EXECUTE FROM PUBLIC explicitly, then grant back to
-- `authenticated` where needed.
--
-- Also closes the new advisor finding: `contractors` table has RLS
-- enabled but no policies, so nobody can read or write it. Add the
-- standard per-user-or-company policy.

-- ── A. Properly revoke anon access via PUBLIC ──────────────────────────
-- Trigger-only fns: nobody calls these directly.
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_statement_email_token() FROM PUBLIC;

-- Cron-only fns: pg_cron runs as postgres, doesn't need PUBLIC grant.
REVOKE EXECUTE ON FUNCTION public.prune_old_backups()                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_soft_deleted_older_than_30_days() FROM PUBLIC;

-- RLS helpers: revoke from PUBLIC, grant back to authenticated only.
-- (authenticated needs EXECUTE for RLS policies to evaluate.)
REVOKE EXECUTE ON FUNCTION public.is_developer()                FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_developer()                TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin()           FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_platform_admin()           TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_is_admin()               FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_is_admin()               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_is_company_admin(uuid)   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_is_company_admin(uuid)   TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_company_access(uuid)      FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_company_access(uuid)      TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_property_access(uuid)     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_property_access(uuid)     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_has_company_access(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_has_company_access(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.company_has_billing_access(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.company_has_billing_access(uuid) TO authenticated;

-- Admin RPC: revoke from PUBLIC, grant to authenticated (internal admin
-- check inside the function rejects non-admins).
REVOKE EXECUTE ON FUNCTION public.list_auth_users() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_auth_users() TO authenticated;

-- Client-called fns that require a signed-in user.
REVOKE EXECUTE ON FUNCTION public.create_company_for_owner(text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_company_for_owner(text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.find_companies_by_name_fuzzy(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.find_companies_by_name_fuzzy(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_company_invite(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.redeem_company_invite(text) TO authenticated;

-- ── B. RLS policy on contractors ──────────────────────────────────────
-- Table has user_id + company_id. Standard pattern: owner sees their
-- own contractors, plus any contractors attached to a company they have
-- access to via the company_access helper.
DROP POLICY IF EXISTS contractors_owner ON public.contractors;
CREATE POLICY contractors_owner ON public.contractors
  FOR ALL
  USING (
    user_id = auth.uid()
    OR (company_id IS NOT NULL AND public.has_company_access(company_id))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (company_id IS NOT NULL AND public.has_company_access(company_id))
  );
