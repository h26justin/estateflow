-- ----------------------------------------------------------------------------
-- autopilot_actions: company-wide update / delete needs write access
-- (security fix, 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- WHAT: in autopilot_actions_update and autopilot_actions_delete the branch
--   has_company_access(company_id) becomes has_company_write(company_id).
--   Everything else is kept: company_is_live() on update, the addressee
--   branch (user_id = caller) and the property-write branch. UPDATE gains an
--   explicit WITH CHECK equal to its USING (previously implicit, same effect).
--   auth.uid() is wrapped as (SELECT auth.uid()) per the initplan convention.
--   autopilot_actions_select is NOT touched; there is still no client INSERT
--   policy (the cron writes rows with the service role).
--
-- WHY (exploit): any member, including a read-only viewer, could mark the
--   company's autopilot suggestions acted / dismissed / snoozed or delete
--   them, hiding compliance and arrears prompts from the people who act on
--   them.
--
-- CLIENT BEHAVIOUR CHANGE: viewers can no longer act on, dismiss, snooze or
--   delete company autopilot actions unless the action is addressed to them
--   (user_id) — src/lib/api/autopilot.js actOnAutopilotAction /
--   dismissAutopilotAction / snoozeAutopilotAction and the status update at
--   ~l.73. Hide those buttons for viewers.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS autopilot_actions_update ON public.autopilot_actions;
--   CREATE POLICY autopilot_actions_update ON public.autopilot_actions
--     FOR UPDATE USING (
--       company_is_live(company_id)
--       AND ((user_id = auth.uid()) OR has_company_access(company_id)
--            OR ((property_id IS NOT NULL) AND has_property_permission(property_id, 'write'))));
--   DROP POLICY IF EXISTS autopilot_actions_delete ON public.autopilot_actions;
--   CREATE POLICY autopilot_actions_delete ON public.autopilot_actions
--     FOR DELETE USING (
--       (user_id = auth.uid()) OR has_company_access(company_id)
--       OR ((property_id IS NOT NULL) AND has_property_permission(property_id, 'write')));
--   NOTIFY pgrst, 'reload schema';
--   (If the live update policy turns out to have a separate WITH CHECK, copy
--   it from pg_policies before applying and use that in the rollback.)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS autopilot_actions_update ON public.autopilot_actions;
CREATE POLICY autopilot_actions_update ON public.autopilot_actions
  FOR UPDATE
  USING (
    company_is_live(company_id)
    AND (
      user_id = (SELECT auth.uid())
      OR public.has_company_write(company_id)
      OR (property_id IS NOT NULL AND has_property_permission(property_id, 'write'))
    )
  )
  WITH CHECK (
    company_is_live(company_id)
    AND (
      user_id = (SELECT auth.uid())
      OR public.has_company_write(company_id)
      OR (property_id IS NOT NULL AND has_property_permission(property_id, 'write'))
    )
  );

DROP POLICY IF EXISTS autopilot_actions_delete ON public.autopilot_actions;
CREATE POLICY autopilot_actions_delete ON public.autopilot_actions
  FOR DELETE
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_company_write(company_id)
    OR (property_id IS NOT NULL AND has_property_permission(property_id, 'write'))
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   -- BEFORE: capture the exact live text (incl. any WITH CHECK) for rollback
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'autopilot_actions' ORDER BY policyname;
--   -- AFTER: update/delete mention has_company_write, not has_company_access.
