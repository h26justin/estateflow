-- Deal photos + collaborator access to deal sub-records.
--
-- Deals page audit, 2 Sep 2026. Three problems found on the LIVE schema:
--
--   1. deal_documents rows became company-shared on 2026-07-29, but the
--      property-documents STORAGE policy still only lets the UPLOADER read a
--      deal file (its deal_documents branch checks d.user_id = auth.uid()).
--      A collaborator sees the row, clicks it, and gets "Could not view".
--      This is the blocker for "another user can see the attached photos".
--
--   2. deal_milestones_all and deal_contacts_all still grant the deal
--      CREATOR (or platform admin) only. Deals themselves are visible to
--      everyone with access to the deal's company, so a collaborator opens a
--      colleague's deal and the Purchase Tracker / Contacts tabs silently
--      fail (the UI swallowed the error and showed "no contacts yet").
--
--   3. deal_documents has no caption and no record of who uploaded it, both
--      needed for a shared photo gallery. user_profiles is self-readable
--      only, so the uploader's display name is denormalised onto the row at
--      upload time (the uploader can read their own profile).
--
-- Apply as a gated production change (DEPLOYMENT_RUNBOOK.md). The app code
-- that ships with this migration inserts `caption` and `uploaded_by`, so run
-- it BEFORE (or in the same window as) the frontend deploy.

-- ── 1. deal_documents: caption + uploaded_by ─────────────────────────────────
alter table public.deal_documents
  add column if not exists caption     text,
  add column if not exists uploaded_by text;

-- ── 2. deal_milestones / deal_contacts: align with deal access ───────────────
-- Creator OR company access OR platform admin, mirroring deal_documents_all
-- (2026-07-29). FOR ALL with an explicit WITH CHECK so inserts follow the
-- same rule. auth.uid() wrapped in a scalar subquery per the 2026-06-10
-- initplan convention.

drop policy if exists deal_milestones_all on public.deal_milestones;
create policy deal_milestones_all on public.deal_milestones
  for all to authenticated
  using (
    exists (
      select 1 from public.deals d
      where d.id = deal_milestones.deal_id
        and (
          d.user_id = (select auth.uid())
          or (d.company_id is not null and has_company_access(d.company_id))
          or is_platform_admin()
        )
    )
  )
  with check (
    exists (
      select 1 from public.deals d
      where d.id = deal_milestones.deal_id
        and (
          d.user_id = (select auth.uid())
          or (d.company_id is not null and has_company_access(d.company_id))
          or is_platform_admin()
        )
    )
  );

drop policy if exists deal_contacts_all on public.deal_contacts;
create policy deal_contacts_all on public.deal_contacts
  for all to authenticated
  using (
    exists (
      select 1 from public.deals d
      where d.id = deal_contacts.deal_id
        and (
          d.user_id = (select auth.uid())
          or (d.company_id is not null and has_company_access(d.company_id))
          or is_platform_admin()
        )
    )
  )
  with check (
    exists (
      select 1 from public.deals d
      where d.id = deal_contacts.deal_id
        and (
          d.user_id = (select auth.uid())
          or (d.company_id is not null and has_company_access(d.company_id))
          or is_platform_admin()
        )
    )
  );

-- ── 3. Storage: let deal collaborators read deal files ───────────────────────
-- Identical to the live policy (2026-06-10 security_02 consolidated) except
-- the deal_documents branch, which now follows the deal's access rule via a
-- join to deals rather than the uploader only. The WITH CHECK (write side)
-- is unchanged: uploads stay anchored under the caller's own uid folder, and
-- the enforce_document_path_ownership trigger keeps deal_documents.file_path
-- honest, so the EXISTS branch cannot be forged.
drop policy if exists "Users access own files in property-documents" on storage.objects;

create policy "Users access own files in property-documents" on storage.objects
  for all
  using (
    bucket_id = 'property-documents'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] = 'inspections' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'companies'   and (storage.foldername(name))[2] = auth.uid()::text)
      or exists (
        select 1 from public.property_documents d
        where d.file_path = storage.objects.name
          and (d.user_id = auth.uid() or public.has_property_access(d.property_id))
      )
      or exists (
        select 1 from public.company_documents d
        where d.file_path = storage.objects.name
          and (d.user_id = auth.uid() or public.has_company_access(d.company_id))
      )
      or exists (
        select 1 from public.deal_documents d
        join public.deals dl on dl.id = d.deal_id
        where d.file_path = storage.objects.name
          and (
            d.user_id = auth.uid()
            or dl.user_id = auth.uid()
            or (dl.company_id is not null and public.has_company_access(dl.company_id))
          )
      )
    )
  )
  with check (
    bucket_id = 'property-documents'
    and auth.uid() is not null
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] = 'inspections' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'companies'   and (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

-- ===========================================================================
-- VERIFY (live DB, after applying)
--   a. select column_name from information_schema.columns
--        where table_name='deal_documents' and column_name in ('caption','uploaded_by');
--      -> 2 rows
--   b. select policyname, qual from pg_policies
--        where tablename in ('deal_milestones','deal_contacts');
--      -> both quals mention has_company_access
--   c. select qual from pg_policies where schemaname='storage'
--        and policyname = 'Users access own files in property-documents';
--      -> deal_documents branch joins deals and mentions has_company_access
--   d. As a collaborator (not the creator) on a shared company: open a
--      colleague's deal -> Photos & Documents -> click a photo -> it opens.
--      Purchase Tracker lists milestones; Contacts loads.
--   e. As an unrelated user: a signed URL for someone else's deal file is
--      still refused (row not visible, createSignedUrl errors).
-- ===========================================================================
