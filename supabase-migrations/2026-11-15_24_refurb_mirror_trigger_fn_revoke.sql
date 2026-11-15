-- ----------------------------------------------------------------------------
-- Housekeeping from the live security advisor (15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT: revoke EXECUTE on the two refurb mirror TRIGGER functions
--   (2026-09-02_refurb_projects.sql) from anon, authenticated and PUBLIC.
--
-- WHY: they carry Supabase's default EXECUTE grants, so they are exposed as
--   callable RPCs (/rest/v1/rpc/...) although they are trigger functions.
--   Calling a trigger function directly just errors, but the advisor flags it
--   and there is no reason to expose them. Trigger firing does not check
--   EXECUTE, so the refurb_projects / refurb_lines triggers keep working
--   (same reasoning as 2026-06-10_security_10_advisor_followup.sql).
--
-- CLIENT BEHAVIOUR CHANGE: none.
--
-- Idempotent: REVOKE is a no-op when the grant is absent.
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.refurb_lines_mirror_trg() TO anon, authenticated, PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.refurb_projects_mirror_trg() TO anon, authenticated, PUBLIC;
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.refurb_lines_mirror_trg() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refurb_projects_mirror_trg() FROM anon, authenticated, PUBLIC;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   SELECT proname, proacl FROM pg_proc
--    WHERE proname IN ('refurb_lines_mirror_trg', 'refurb_projects_mirror_trg');
--   -- expect no anon= / authenticated= / =X (PUBLIC) entries.
--   -- Then edit a refurb line in the app: the property's refurb totals still update.
