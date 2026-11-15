-- ----------------------------------------------------------------------------
-- statement_imports: recording an import into a company needs write access
-- (security fix, 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- WHAT: statement_imports_insert keeps user_id = caller and, when company_id
--   is set, requires has_company_write(company_id) instead of
--   has_company_access(company_id). Personal imports (company_id NULL) are
--   unchanged. The table stays append-only (no update / delete policy);
--   statement_imports_select is NOT touched.
--
-- WHY (exploit): a read-only viewer could insert a fake statement-import audit
--   record (agent, statement reference, fingerprint, lines) into the
--   company's import history, which the importer uses to warn on duplicate
--   statements — blocking or confusing the real import.
--
-- CLIENT BEHAVIOUR CHANGE: a viewer completing a statement import into a
--   company now fails at the audit-record insert
--   (src/lib/api/statementImports.js ~l.215). Viewers were already refused
--   on the rent_receipts / property_expenses rows the import writes, so the
--   import UI should not be offered to viewers at all.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS statement_imports_insert ON public.statement_imports;
--   CREATE POLICY statement_imports_insert ON public.statement_imports
--     FOR INSERT WITH CHECK ((user_id = auth.uid()) AND ((company_id IS NULL) OR has_company_access(company_id)));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS statement_imports_insert ON public.statement_imports;
CREATE POLICY statement_imports_insert ON public.statement_imports
  FOR INSERT
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (company_id IS NULL OR public.has_company_write(company_id))
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'statement_imports' ORDER BY policyname;
