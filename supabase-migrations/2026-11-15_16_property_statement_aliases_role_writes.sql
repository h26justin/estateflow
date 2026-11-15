-- ----------------------------------------------------------------------------
-- property_statement_aliases: writes need write permission on the property
-- and a live company (security fix, 15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT: _insert / _update / _delete are recreated:
--   insert  WITH CHECK  user_id = caller AND has_property_permission(property_id,'write')
--                       AND company_is_live(property's company)
--   update  USING       has_property_permission(property_id,'write')
--           WITH CHECK  has_property_permission(property_id,'write')
--                       AND company_is_live(property's company)
--   delete  USING       has_property_permission(property_id,'delete')
--                       (same role floor as 'write': owner / admin / editor)
--   has_property_permission() already returns true for developers / platform
--   admins. property_statement_aliases_select is NOT touched.
--
-- WHY (exploit): has_property_access() is true for read-only viewers, so a
--   viewer could teach or repoint the statement importer's label -> property
--   aliases that the whole team's imports use, silently routing a managing
--   agent's statement lines (rent / expenses) to the wrong property.
--
-- CLIENT BEHAVIOUR CHANGE: viewers' alias saves now fail (they were already
--   unable to write the rent / expense rows an import produces).
--   saveStatementAlias (src/lib/api/statements.js) is called from
--   src/components/StatementImportReview.jsx ~l.95 and
--   src/components/DataImporter.jsx ~l.208 inside try/catch, so the failure is
--   logged, not shown; deleteStatementAlias will surface an error. An editor
--   re-teaching a label they previously pointed at a property they can no
--   longer write (upsert on user_id, alias_norm) will be refused.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS property_statement_aliases_insert ON public.property_statement_aliases;
--   CREATE POLICY property_statement_aliases_insert ON public.property_statement_aliases
--     FOR INSERT WITH CHECK ((user_id = (SELECT auth.uid())) AND (has_property_access(property_id) OR is_developer()));
--   DROP POLICY IF EXISTS property_statement_aliases_update ON public.property_statement_aliases;
--   CREATE POLICY property_statement_aliases_update ON public.property_statement_aliases
--     FOR UPDATE USING (is_developer() OR (user_id = (SELECT auth.uid())) OR has_property_access(property_id));
--   DROP POLICY IF EXISTS property_statement_aliases_delete ON public.property_statement_aliases;
--   CREATE POLICY property_statement_aliases_delete ON public.property_statement_aliases
--     FOR DELETE USING (is_developer() OR (user_id = (SELECT auth.uid())) OR has_property_access(property_id));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS property_statement_aliases_insert ON public.property_statement_aliases;
CREATE POLICY property_statement_aliases_insert ON public.property_statement_aliases
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_property_permission(property_id, 'write')
    AND public.company_is_live((SELECT p.company_id FROM public.properties p
                                WHERE p.id = property_statement_aliases.property_id))
  );

DROP POLICY IF EXISTS property_statement_aliases_update ON public.property_statement_aliases;
CREATE POLICY property_statement_aliases_update ON public.property_statement_aliases
  FOR UPDATE
  USING (public.has_property_permission(property_id, 'write'))
  WITH CHECK (
    public.has_property_permission(property_id, 'write')
    AND public.company_is_live((SELECT p.company_id FROM public.properties p
                                WHERE p.id = property_statement_aliases.property_id))
  );

DROP POLICY IF EXISTS property_statement_aliases_delete ON public.property_statement_aliases;
CREATE POLICY property_statement_aliases_delete ON public.property_statement_aliases
  FOR DELETE
  USING (public.has_property_permission(property_id, 'delete'));

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'property_statement_aliases' ORDER BY policyname;
