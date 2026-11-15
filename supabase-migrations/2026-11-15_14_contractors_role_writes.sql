-- ----------------------------------------------------------------------------
-- contractors: role-aware writes (security fix, 15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT: the FOR ALL policy contractors_owner is replaced by
--   contractors_select — exactly the old rule (unchanged reads)
--   contractors_insert — a personal contractor (company_id IS NULL) created
--                        by the caller, OR has_company_write(company_id) AND
--                        company_is_live(company_id)
--   contractors_update — USING: own personal row or has_company_write;
--                        WITH CHECK: as insert
--   contractors_delete — own personal row or has_company_write(company_id)
--   This table has no definition in the repo; only user_id (uuid) and
--   company_id (uuid, nullable) from the live policy are used.
--
-- WHY (exploit): has_company_access() is true for any member, so a read-only
--   viewer could add, edit or delete the company's contractor directory
--   (names, phone, email used for maintenance / refurb work).
--
-- CLIENT BEHAVIOUR CHANGE: viewers can no longer add or remove company
--   contractors (ContractorsPage in src/components/DashboardComponents.jsx:
--   insert ~l.733, delete ~l.751; createContractor in
--   src/lib/api/refurbWorkspace.js ~l.253). A user who created a company
--   contractor and was later demoted to viewer / removed also loses write
--   access to it. Personal contractors (company_id NULL) are unaffected.
--   Expired (not live) companies cannot add or edit; delete still allowed.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS contractors_select ON public.contractors;
--   DROP POLICY IF EXISTS contractors_insert ON public.contractors;
--   DROP POLICY IF EXISTS contractors_update ON public.contractors;
--   DROP POLICY IF EXISTS contractors_delete ON public.contractors;
--   CREATE POLICY contractors_owner ON public.contractors
--     FOR ALL TO public
--     USING ((user_id = (SELECT auth.uid())) OR ((company_id IS NOT NULL) AND has_company_access(company_id)))
--     WITH CHECK ((user_id = (SELECT auth.uid())) OR ((company_id IS NOT NULL) AND has_company_access(company_id)));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS contractors_owner ON public.contractors;
DROP POLICY IF EXISTS contractors_select ON public.contractors;
DROP POLICY IF EXISTS contractors_insert ON public.contractors;
DROP POLICY IF EXISTS contractors_update ON public.contractors;
DROP POLICY IF EXISTS contractors_delete ON public.contractors;

-- Reads: unchanged.
CREATE POLICY contractors_select ON public.contractors
  FOR SELECT TO public
  USING (
    (user_id = (SELECT auth.uid()))
    OR ((company_id IS NOT NULL) AND has_company_access(company_id))
  );

CREATE POLICY contractors_insert ON public.contractors
  FOR INSERT TO public
  WITH CHECK (
    (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (
      company_id IS NOT NULL
      AND public.has_company_write(company_id)
      AND public.company_is_live(company_id)
    )
  );

CREATE POLICY contractors_update ON public.contractors
  FOR UPDATE TO public
  USING (
    (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (company_id IS NOT NULL AND public.has_company_write(company_id))
  )
  WITH CHECK (
    (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (
      company_id IS NOT NULL
      AND public.has_company_write(company_id)
      AND public.company_is_live(company_id)
    )
  );

CREATE POLICY contractors_delete ON public.contractors
  FOR DELETE TO public
  USING (
    (company_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (company_id IS NOT NULL AND public.has_company_write(company_id))
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'contractors'
--      AND column_name IN ('user_id', 'company_id');   -- expect both uuid, company_id nullable
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'contractors';  -- 4 rows, no ALL
