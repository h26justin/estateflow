-- ----------------------------------------------------------------------------
-- Trusted-device RPCs: explicit REVOKE from anon (security hotfix,
-- 14 Oct 2026)
--
-- HOLE: 2026-06-22_trusted_devices.sql revokes EXECUTE from PUBLIC and grants
-- authenticated, but Supabase's default privileges grant EXECUTE on new
-- public functions to anon directly (not via PUBLIC), so the REVOKE ... FROM
-- PUBLIC does not remove it. The functions return early when auth.uid() is
-- NULL, so this is defence in depth rather than a live exploit, but anon
-- should not be able to call 2FA device-trust code at all (same pattern as
-- 2026-06-10_security_10_advisor_followup.sql).
--
-- FIX: REVOKE EXECUTE ... FROM anon, PUBLIC on all five; re-assert the
-- authenticated grant. Every caller in src/ (LoginPage, AuthContext,
-- TwoFactorPanel) runs with a session.
--
-- Idempotent: REVOKE / GRANT are repeatable. Each statement is guarded so
-- a missing function does not abort the file.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.trust_this_device(text, text)',
    'public.is_device_trusted(text)',
    'public.list_trusted_devices()',
    'public.revoke_trusted_device(uuid)',
    'public.revoke_all_trusted_devices()'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN
      RAISE NOTICE 'skipping %: function does not exist', f;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
