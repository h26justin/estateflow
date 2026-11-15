-- ----------------------------------------------------------------------------
-- property_notes: only the note's author or someone who can write the
-- property may edit / delete a note (security fix, 15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT: property_notes_update and property_notes_delete are recreated with
--   has_property_access(property_id) replaced by
--   has_property_permission(property_id, 'write'). The author branch
--   (user_id = caller) and the developer branch stay. UPDATE gains an explicit
--   WITH CHECK equal to its USING (previously implicit, same effect).
--   property_notes_select and property_notes_insert are NOT touched (any
--   member may still read and add notes, as today). No liveness gate is added
--   here because insert is not liveness-gated either.
--
-- WHY (exploit): has_property_access() is true for read-only viewers, so a
--   viewer could edit or delete any colleague's note on a property (notes are
--   the property's activity record).
--
-- CLIENT BEHAVIOUR CHANGE: viewers can still add notes and edit / delete their
--   OWN notes, but can no longer delete other people's notes
--   (deleteNote in src/lib/api/properties.js ~l.269, used by
--   src/components/feature/NotesTimeline.jsx). Hide the delete control on
--   other authors' notes for viewers.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DROP POLICY IF EXISTS property_notes_update ON public.property_notes;
--   CREATE POLICY property_notes_update ON public.property_notes
--     FOR UPDATE TO public
--     USING (is_developer() OR (user_id = (SELECT auth.uid())) OR has_property_access(property_id));
--   DROP POLICY IF EXISTS property_notes_delete ON public.property_notes;
--   CREATE POLICY property_notes_delete ON public.property_notes
--     FOR DELETE TO public
--     USING (is_developer() OR (user_id = (SELECT auth.uid())) OR has_property_access(property_id));
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS property_notes_update ON public.property_notes;
CREATE POLICY property_notes_update ON public.property_notes
  FOR UPDATE TO public
  USING (
    is_developer()
    OR (user_id = (SELECT auth.uid()))
    OR public.has_property_permission(property_id, 'write')
  )
  WITH CHECK (
    is_developer()
    OR (user_id = (SELECT auth.uid()))
    OR public.has_property_permission(property_id, 'write')
  );

DROP POLICY IF EXISTS property_notes_delete ON public.property_notes;
CREATE POLICY property_notes_delete ON public.property_notes
  FOR DELETE TO public
  USING (
    is_developer()
    OR (user_id = (SELECT auth.uid()))
    OR public.has_property_permission(property_id, 'write')
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only):
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'property_notes' ORDER BY policyname;
--   -- update/delete mention has_property_permission, not has_property_access;
--   -- select/insert unchanged.
