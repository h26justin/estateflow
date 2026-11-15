-- ----------------------------------------------------------------------------
-- deal_milestones / deal_contacts / deal_documents: role-aware writes
-- (security fix, 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- WHAT: each table's single FOR ALL policy (<t>_all, TO authenticated) is
--   replaced by four policies, all TO authenticated:
--     <t>_select  — exactly the old rule: the parent deal's creator, OR
--                   has_company_access(deal company), OR platform admin
--     <t>_insert / <t>_update / <t>_delete
--                 — the parent deal's creator, OR (deal company set AND
--                   has_company_write(deal company)), OR platform admin
--   This uses only deals.id / deals.user_id / deals.company_id as seen in the
--   live policy; deals itself has no current definition in the repo.
--   No liveness gate is added (deals.company_id may be NULL and the brief for
--   this table keeps the write rule to the expression above).
--
-- WHY (exploit): has_company_access() is true for read-only viewers, so a
--   viewer could add / edit / delete a colleague's purchase-tracker
--   milestones, solicitor / agent contacts and deal documents.
--
-- CLIENT BEHAVIOUR CHANGE: viewers can still open a colleague's deal and see
--   its milestones, contacts and documents, but adding / editing / deleting
--   them fails (src/lib/api/deals.js: milestone insert ~l.144/230, delete
--   ~l.266, update ~l.282; contact insert ~l.164/299, update ~l.295, delete
--   ~l.305; document insert ~l.191/353, delete ~l.409). Deal creators keep
--   full access to their own deals whatever their role.
--   NOTE: the deals table's own policies are not changed here; if live
--   deals_update / deals_delete also use has_company_access, viewers can still
--   edit the deal row itself (follow-up).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DO $rb$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY['deal_milestones','deal_contacts','deal_documents'] LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
--       EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
--         USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = %I.deal_id
--           AND (d.user_id = (SELECT auth.uid())
--                OR (d.company_id IS NOT NULL AND has_company_access(d.company_id))
--                OR is_platform_admin())))
--         WITH CHECK (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = %I.deal_id
--           AND (d.user_id = (SELECT auth.uid())
--                OR (d.company_id IS NOT NULL AND has_company_access(d.company_id))
--                OR is_platform_admin())))$p$, t || '_all', t, t, t);
--     END LOOP;
--   END $rb$;
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DO $build$
DECLARE
  t text;
  v_read  text := $r$EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = %I.deal_id
        AND (
          d.user_id = (SELECT auth.uid())
          OR (d.company_id IS NOT NULL AND has_company_access(d.company_id))
          OR is_platform_admin()
        )
    )$r$;
  v_write text := $w$EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = %I.deal_id
        AND (
          d.user_id = (SELECT auth.uid())
          OR (d.company_id IS NOT NULL AND public.has_company_write(d.company_id))
          OR is_platform_admin()
        )
    )$w$;
BEGIN
  FOREACH t IN ARRAY ARRAY['deal_milestones', 'deal_contacts', 'deal_documents'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'skipping %: table not found', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

    -- Reads: unchanged.
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
                   t || '_select', t, format(v_read, t));
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                   t || '_insert', t, format(v_write, t));
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   t || '_update', t, format(v_write, t), format(v_write, t));
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                   t || '_delete', t, format(v_write, t));
  END LOOP;
END $build$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('deal_milestones','deal_contacts','deal_documents')
--    ORDER BY tablename, policyname;   -- 12 rows, no cmd = 'ALL'
--   -- Storage: the property-documents storage policy still lets any company
--   -- member READ deal files (unchanged, intended); uploads stay own-folder.
