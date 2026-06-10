-- ===========================================================================
-- Security hardening 10 — advisor follow-up after the 2026-06-10 pass
-- ===========================================================================
-- APPLIED TO PRODUCTION 2026-06-10 (user-approved). Two hygiene items the
-- security advisor flagged after the main pass landed:
--
-- 1) audit_trigger_fn was recreated in security_06 (RAISE WARNING handler)
--    without re-pinning search_path, which dropped the 2026-05-20 hardening.
--    Restore it.
-- 2) The new SECURITY DEFINER helpers picked up Supabase's default anon
--    EXECUTE grant. anon never legitimately calls them — they are RLS
--    helpers, trigger functions, or authenticated-only RPCs — so revoke,
--    matching the existing pattern on has_company_access / is_developer.
--
-- Idempotent. ROLLBACK: GRANT EXECUTE ... TO anon; ALTER FUNCTION
--   public.audit_trigger_fn() RESET search_path;
-- ===========================================================================

ALTER FUNCTION public.audit_trigger_fn() SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.company_is_live(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_property_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_company_billing_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_subscription_billing_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_document_path_ownership() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tenant_messages_readonly_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.regenerate_statement_email_token(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_of_property(uuid) FROM anon;

-- The trigger-guard functions also carry the DEFAULT PUBLIC EXECUTE grant,
-- which anon inherits — a direct anon revoke alone does not remove it.
-- Trigger firing does not check EXECUTE at runtime, so revoking is safe.
REVOKE ALL ON FUNCTION public.enforce_company_billing_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_subscription_billing_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_document_path_ownership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_messages_readonly_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stamp_rent_payment_period() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_trigger_fn() FROM PUBLIC;
-- stamp_rent_payment_period also had DIRECT anon/authenticated grants from
-- Supabase default privileges (not just PUBLIC), so revoke those explicitly.
REVOKE EXECUTE ON FUNCTION public.stamp_rent_payment_period() FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFICATION: re-run the Supabase security advisor — the
-- function_search_path_mutable WARN on audit_trigger_fn and the
-- anon_security_definer_function_executable WARNs on the functions above
-- should clear.
