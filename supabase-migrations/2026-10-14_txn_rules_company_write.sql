-- ----------------------------------------------------------------------------
-- txn_rules: company rules need company write access (security hotfix,
-- 14 Oct 2026)
--
-- HOLE (live pg_policies, 14 Oct 2026): insert / update / delete were
--   (user_id = auth.uid() OR has_company_access(company_id))
--   AND company_is_live(company_id)
-- so (a) a read-only viewer could create, rewrite or delete the company's
-- bookkeeping rules (has_company_access is true for any member), and (b) any
-- user could insert a rule with THEIR user_id against ANY live company_id,
-- injecting categorisation rules that bookkeeping-ai applies to another
-- company's bank transactions. Update had no WITH CHECK, so a rule could
-- also be re-pointed at another company.
--
-- FIX: writes on a company rule need has_company_write(company_id)
-- (owner / admin / editor) on a live company; personal rules
-- (company_id IS NULL) stay writable by their own user. INSERT also pins
-- user_id = caller. UPDATE gets a WITH CHECK so the new row is held to the
-- same rule. Developer bypass kept. SELECT is unchanged.
--
-- Idempotent: DROP POLICY IF EXISTS / CREATE POLICY.
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS txn_rules_insert ON public.txn_rules;
CREATE POLICY txn_rules_insert ON public.txn_rules
  FOR INSERT
  WITH CHECK (
    public.is_developer()
    OR (
      user_id = (SELECT auth.uid())
      AND (
        company_id IS NULL
        OR (public.has_company_write(company_id) AND public.company_is_live(company_id))
      )
    )
  );

DROP POLICY IF EXISTS txn_rules_update ON public.txn_rules;
CREATE POLICY txn_rules_update ON public.txn_rules
  FOR UPDATE
  USING (
    public.is_developer()
    OR (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (public.has_company_write(company_id) AND public.company_is_live(company_id))
  )
  WITH CHECK (
    public.is_developer()
    OR (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (public.has_company_write(company_id) AND public.company_is_live(company_id))
  );

DROP POLICY IF EXISTS txn_rules_delete ON public.txn_rules;
CREATE POLICY txn_rules_delete ON public.txn_rules
  FOR DELETE
  USING (
    public.is_developer()
    OR (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (public.has_company_write(company_id) AND public.company_is_live(company_id))
  );

NOTIFY pgrst, 'reload schema';
