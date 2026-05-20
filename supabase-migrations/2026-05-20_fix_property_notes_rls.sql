-- property_notes had RLS enabled but ZERO policies. With RLS on +
-- default-deny, every write silently failed — confirmed by 0 rows in
-- the table despite the UI calling supabase.from('property_notes').
-- The feature has been broken for everyone since RLS was enabled.
--
-- Applied via Supabase MCP on 2026-05-20.

drop policy if exists "property_notes_select" on public.property_notes;
create policy "property_notes_select" on public.property_notes for select
  using (is_developer() or user_id = auth.uid() or has_property_access(property_id));

drop policy if exists "property_notes_insert" on public.property_notes;
create policy "property_notes_insert" on public.property_notes for insert
  with check (
    (user_id = auth.uid() or has_property_access(property_id))
    -- Don't let a user spoof someone else's email on the note
    and (user_email = auth.email() or is_developer())
  );

drop policy if exists "property_notes_update" on public.property_notes;
create policy "property_notes_update" on public.property_notes for update
  using (is_developer() or user_id = auth.uid() or has_property_access(property_id));

drop policy if exists "property_notes_delete" on public.property_notes;
create policy "property_notes_delete" on public.property_notes for delete
  using (is_developer() or user_id = auth.uid() or has_property_access(property_id));
