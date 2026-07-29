-- deal_documents: allow company collaborators, not just the deal creator.
--
-- The old deal_documents_all policy only granted access when the current
-- user CREATED the deal (deals.user_id = auth.uid()) or is platform admin.
-- But deals themselves are visible/editable to everyone with access to the
-- deal's company (see deals_select / deals_update), so a collaborator could
-- open a colleague's deal and then hit "new row violates row-level security
-- policy for table deal_documents" on upload.
--
-- Align document access with deal access: creator OR company access OR
-- platform admin. FOR ALL with an explicit WITH CHECK mirroring USING, so
-- inserts follow the same rule. auth.uid() is wrapped in a scalar subquery
-- per the 2026-06-10 RLS initplan convention.

drop policy if exists deal_documents_all on public.deal_documents;

create policy deal_documents_all on public.deal_documents
  for all to authenticated
  using (
    exists (
      select 1 from public.deals d
      where d.id = deal_documents.deal_id
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
      where d.id = deal_documents.deal_id
        and (
          d.user_id = (select auth.uid())
          or (d.company_id is not null and has_company_access(d.company_id))
          or is_platform_admin()
        )
    )
  );
