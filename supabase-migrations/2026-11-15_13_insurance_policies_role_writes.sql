-- ----------------------------------------------------------------------------
-- insurance_policies: role-aware writes (security fix, 15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT: the single FOR ALL policy insurance_policies_read_write is replaced by
--   insurance_policies_select  — exactly the old read rule (unchanged reads)
--   insurance_policies_insert  — developer, OR a personal policy
--                                (company_id IS NULL) created by the caller,
--                                OR has_company_write(company_id) AND
--                                company_is_live(company_id)
--   insurance_policies_update  — USING: developer, own personal policy, or
--                                has_company_write(company_id);
--                                WITH CHECK: as insert
--   insurance_policies_delete  — developer, own personal policy, or
--                                has_company_write(company_id)
--   NOTE user_id is TEXT on this table (compared with auth.uid()::text).
--   This table has no definition in the repo; only the columns visible in the
--   live policy (user_id text, company_id uuid) are used.
--
-- WHY (exploit): has_company_access() is true for any member, so a read-only
--   viewer could create, edit or soft-delete the company's insurance policies
--   (cover dates, insurer, premium) through PostgREST.
--
-- CLIENT BEHAVIOUR CHANGE: viewers can no longer add / edit / renew / delete
--   company insurance policies (InsurancePage -> src/lib/api/insurance.js
--   createInsurancePolicy / updateInsurancePolicy / deleteInsurancePolicy /
--   renewInsurancePolicy). A creator of a company policy who has since been
--   demoted to viewer or removed also loses write access. Expired (not live)
--   companies can no longer create or edit policies (delete still allowed).
--   Personal policies (company_id IS NULL) keep working for their creator.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS insurance_policies_select ON public.insurance_policies;
--   DROP POLICY IF EXISTS insurance_policies_insert ON public.insurance_policies;
--   DROP POLICY IF EXISTS insurance_policies_update ON public.insurance_policies;
--   DROP POLICY IF EXISTS insurance_policies_delete ON public.insurance_policies;
--   CREATE POLICY insurance_policies_read_write ON public.insurance_policies
--     FOR ALL TO public
--     USING (is_developer() OR (user_id = ((SELECT auth.uid()))::text) OR has_company_access(company_id))
--     WITH CHECK (is_developer() OR (user_id = ((SELECT auth.uid()))::text) OR has_company_access(company_id));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS insurance_policies_read_write ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_select ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_insert ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_update ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_delete ON public.insurance_policies;

-- Reads: unchanged.
CREATE POLICY insurance_policies_select ON public.insurance_policies
  FOR SELECT TO public
  USING (
    is_developer()
    OR (user_id = ((SELECT auth.uid()))::text)
    OR has_company_access(company_id)
  );

CREATE POLICY insurance_policies_insert ON public.insurance_policies
  FOR INSERT TO public
  WITH CHECK (
    is_developer()
    OR (company_id IS NULL AND user_id = ((SELECT auth.uid()))::text)
    OR (
      company_id IS NOT NULL
      AND public.has_company_write(company_id)
      AND public.company_is_live(company_id)
    )
  );

CREATE POLICY insurance_policies_update ON public.insurance_policies
  FOR UPDATE TO public
  USING (
    is_developer()
    OR (company_id IS NULL AND user_id = ((SELECT auth.uid()))::text)
    OR (company_id IS NOT NULL AND public.has_company_write(company_id))
  )
  WITH CHECK (
    is_developer()
    OR (company_id IS NULL AND user_id = ((SELECT auth.uid()))::text)
    OR (
      company_id IS NOT NULL
      AND public.has_company_write(company_id)
      AND public.company_is_live(company_id)
    )
  );

CREATE POLICY insurance_policies_delete ON public.insurance_policies
  FOR DELETE TO public
  USING (
    is_developer()
    OR (company_id IS NULL AND user_id = ((SELECT auth.uid()))::text)
    OR (company_id IS NOT NULL AND public.has_company_write(company_id))
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   -- BEFORE: confirm column types the policies assume
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'insurance_policies'
--      AND column_name IN ('user_id', 'company_id');   -- expect user_id text, company_id uuid
--   -- AFTER:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'insurance_policies';  -- 4 rows, no ALL
