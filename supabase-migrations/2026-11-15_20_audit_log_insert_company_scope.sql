-- ----------------------------------------------------------------------------
-- audit_log: a client may only write audit entries for itself and for a
-- company it belongs to (security fix, 15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT: audit_insert (FOR INSERT TO authenticated) keeps
--   user_id = (SELECT auth.uid()) and adds
--   (company_id IS NULL OR has_company_access(company_id)).
--   audit_own (SELECT) is NOT touched. audit_log.company_id is uuid
--   (archive/audit-and-soft-delete.sql; written as company_id by
--   src/lib/api/audit.js logAction).
--
-- WHY (exploit): the insert check only pinned user_id, so any signed-in user
--   could forge entries (e.g. 'property.deleted', 'admin.user_deleted') into
--   ANOTHER company's audit log, which that company's owner and members read
--   as the record of who did what.
--
-- CLIENT BEHAVIOUR CHANGE: none for legitimate use. logAction() is called with
--   the caller's own company; a failure is swallowed (try/catch). The audit
--   trigger audit_trigger_fn() is SECURITY DEFINER and not subject to this
--   policy as long as its owner bypasses RLS (see VERIFY). The delete-user
--   edge function writes with the service role (unaffected). The
--   AdminDashboard impersonation insert (~l.1126) sends no company_id, so it
--   is unaffected. trash.js logs 'company.deleted' / 'company.restored' with
--   the company's id: has_company_access() must stay true for the owner of a
--   soft-deleted company (check the live body; if G9 adds deleted_at IS NULL
--   to has_company_access, those two log lines will start failing silently).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS audit_insert ON public.audit_log;
--   CREATE POLICY audit_insert ON public.audit_log
--     FOR INSERT TO authenticated
--     WITH CHECK (user_id = (SELECT auth.uid()));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_insert ON public.audit_log;
CREATE POLICY audit_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (company_id IS NULL OR public.has_company_access(company_id))
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   -- BEFORE: column type and the trigger function's owner
--   SELECT data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'company_id';  -- uuid
--   SELECT p.proname, r.rolname, r.rolbypassrls, p.prosecdef
--     FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
--    WHERE p.oid = 'public.audit_trigger_fn()'::regprocedure;   -- expect prosecdef true, rolbypassrls true
--   SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.audit_log'::regclass;  -- expect false
--   SELECT pg_get_functiondef('public.has_company_access(uuid)'::regprocedure);  -- owner + member branches
--   -- AFTER:
--   SELECT policyname, cmd, roles, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'audit_log' ORDER BY policyname;
