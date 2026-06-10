-- 2026-06-10 perf: auth_rls_initplan remediation (advisor lint 0003)
-- Wraps every auth.uid()/auth.role()/auth.email() call in the flagged RLS
-- policies in a scalar subselect, e.g. (select auth.uid()), so Postgres
-- evaluates it once per query (InitPlan) instead of once per row.
-- Policy semantics (roles, command, qual, with_check) are preserved exactly
-- as read from live pg_policies on 2026-06-10.
--
-- SKIPPED HERE (owned by the parallel security migration, which is rewriting
-- or splitting these policies): properties, deals, subscriptions, companies,
-- user_company_access, storage.objects, and the property child tables with
-- FOR ALL policies (rent_payments, compliance_items, maintenance_jobs,
-- property_expenses, tenancy_details). Re-run the performance advisor after
-- both migrations are applied.
--
-- Also handled separately in 2026-06-10_perf_rls_consolidate.sql (do not
-- duplicate here): feature_flags.ff_read, feature_flag_users.ffu_read,
-- audit_log SELECT policies, user_profiles.user_profiles_select_own,
-- user_backups."Service role manages all backups".

-- address_book ---------------------------------------------------------------
drop policy if exists address_book_own on public.address_book;
create policy address_book_own on public.address_book
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- audit_log (insert only; SELECT policies merged in consolidate migration) ---
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- bank_accounts ---------------------------------------------------------------
drop policy if exists bank_accounts_select_own on public.bank_accounts;
create policy bank_accounts_select_own on public.bank_accounts
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists bank_accounts_insert_own on public.bank_accounts;
create policy bank_accounts_insert_own on public.bank_accounts
  for insert to public
  with check ((select auth.uid()) = user_id);

drop policy if exists bank_accounts_update_own on public.bank_accounts;
create policy bank_accounts_update_own on public.bank_accounts
  for update to public
  using ((select auth.uid()) = user_id);

drop policy if exists bank_accounts_delete_own on public.bank_accounts;
create policy bank_accounts_delete_own on public.bank_accounts
  for delete to public
  using ((select auth.uid()) = user_id);

-- bank_connections ------------------------------------------------------------
drop policy if exists bank_connections_select_own on public.bank_connections;
create policy bank_connections_select_own on public.bank_connections
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists bank_connections_insert_own on public.bank_connections;
create policy bank_connections_insert_own on public.bank_connections
  for insert to public
  with check ((select auth.uid()) = user_id);

drop policy if exists bank_connections_update_own on public.bank_connections;
create policy bank_connections_update_own on public.bank_connections
  for update to public
  using ((select auth.uid()) = user_id);

drop policy if exists bank_connections_delete_own on public.bank_connections;
create policy bank_connections_delete_own on public.bank_connections
  for delete to public
  using ((select auth.uid()) = user_id);

-- bank_transactions -----------------------------------------------------------
drop policy if exists bank_transactions_select_own on public.bank_transactions;
create policy bank_transactions_select_own on public.bank_transactions
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists bank_transactions_insert_own on public.bank_transactions;
create policy bank_transactions_insert_own on public.bank_transactions
  for insert to public
  with check ((select auth.uid()) = user_id);

drop policy if exists bank_transactions_update_own on public.bank_transactions;
create policy bank_transactions_update_own on public.bank_transactions
  for update to public
  using ((select auth.uid()) = user_id);

drop policy if exists bank_transactions_delete_own on public.bank_transactions;
create policy bank_transactions_delete_own on public.bank_transactions
  for delete to public
  using ((select auth.uid()) = user_id);

-- company_documents -----------------------------------------------------------
drop policy if exists "Users see own company documents" on public.company_documents;
create policy "Users see own company documents" on public.company_documents
  for select to public
  using (user_id = (select auth.uid()));

drop policy if exists "Users insert own company documents" on public.company_documents;
create policy "Users insert own company documents" on public.company_documents
  for insert to public
  with check (user_id = (select auth.uid()));

drop policy if exists "Users update own company documents" on public.company_documents;
create policy "Users update own company documents" on public.company_documents
  for update to public
  using (user_id = (select auth.uid()));

drop policy if exists "Users delete own company documents" on public.company_documents;
create policy "Users delete own company documents" on public.company_documents
  for delete to public
  using (user_id = (select auth.uid()));

-- company_invites -------------------------------------------------------------
drop policy if exists "Company admins create invites" on public.company_invites;
create policy "Company admins create invites" on public.company_invites
  for insert to public
  with check (
    (created_by = (select auth.uid()))
    and (
      (exists (
        select 1 from user_company_access
        where user_company_access.user_id = ((select auth.uid()))::text
          and user_company_access.company_id = company_invites.company_id
          and (user_company_access.is_admin = true or user_company_access.is_owner = true)
      ))
      or (exists (
        select 1 from companies
        where companies.id = company_invites.company_id
          and companies.owner_id = (select auth.uid())
      ))
    )
  );

drop policy if exists "Company admins see own invites" on public.company_invites;
create policy "Company admins see own invites" on public.company_invites
  for select to public
  using (
    (exists (
      select 1 from user_company_access
      where user_company_access.user_id = ((select auth.uid()))::text
        and user_company_access.company_id = company_invites.company_id
        and (user_company_access.is_admin = true or user_company_access.is_owner = true)
    ))
    or (exists (
      select 1 from companies
      where companies.id = company_invites.company_id
        and companies.owner_id = (select auth.uid())
    ))
  );

drop policy if exists "Company admins update own invites" on public.company_invites;
create policy "Company admins update own invites" on public.company_invites
  for update to public
  using (
    (exists (
      select 1 from user_company_access
      where user_company_access.user_id = ((select auth.uid()))::text
        and user_company_access.company_id = company_invites.company_id
        and (user_company_access.is_admin = true or user_company_access.is_owner = true)
    ))
    or (exists (
      select 1 from companies
      where companies.id = company_invites.company_id
        and companies.owner_id = (select auth.uid())
    ))
  );

drop policy if exists "Company admins delete own invites" on public.company_invites;
create policy "Company admins delete own invites" on public.company_invites
  for delete to public
  using (
    (exists (
      select 1 from user_company_access
      where user_company_access.user_id = ((select auth.uid()))::text
        and user_company_access.company_id = company_invites.company_id
        and (user_company_access.is_admin = true or user_company_access.is_owner = true)
    ))
    or (exists (
      select 1 from companies
      where companies.id = company_invites.company_id
        and companies.owner_id = (select auth.uid())
    ))
  );

-- contractors -----------------------------------------------------------------
drop policy if exists contractors_owner on public.contractors;
create policy contractors_owner on public.contractors
  for all to public
  using ((user_id = (select auth.uid())) or ((company_id is not null) and has_company_access(company_id)))
  with check ((user_id = (select auth.uid())) or ((company_id is not null) and has_company_access(company_id)));

-- deal_contacts / deal_documents / deal_milestones ------------------------------
drop policy if exists deal_contacts_all on public.deal_contacts;
create policy deal_contacts_all on public.deal_contacts
  for all to authenticated
  using (exists (
    select 1 from deals d
    where d.id = deal_contacts.deal_id
      and ((d.user_id = (select auth.uid())) or is_platform_admin())
  ));

drop policy if exists deal_documents_all on public.deal_documents;
create policy deal_documents_all on public.deal_documents
  for all to authenticated
  using (exists (
    select 1 from deals d
    where d.id = deal_documents.deal_id
      and ((d.user_id = (select auth.uid())) or is_platform_admin())
  ));

drop policy if exists deal_milestones_all on public.deal_milestones;
create policy deal_milestones_all on public.deal_milestones
  for all to authenticated
  using (exists (
    select 1 from deals d
    where d.id = deal_milestones.deal_id
      and ((d.user_id = (select auth.uid())) or is_platform_admin())
  ));

-- deposit_protection ------------------------------------------------------------
drop policy if exists dp_own on public.deposit_protection;
create policy dp_own on public.deposit_protection
  for all to authenticated
  using (user_id = (select auth.uid()));

-- insurance_policies ------------------------------------------------------------
drop policy if exists insurance_policies_read_write on public.insurance_policies;
create policy insurance_policies_read_write on public.insurance_policies
  for all to public
  using (is_developer() or (user_id = ((select auth.uid()))::text) or has_company_access(company_id))
  with check (is_developer() or (user_id = ((select auth.uid()))::text) or has_company_access(company_id));

-- invitations -------------------------------------------------------------------
drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (invited_by = (select auth.uid()));

drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using ((email = (select auth.email())) or (invited_by = (select auth.uid())) or user_is_company_admin(company_id));

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
  for update to authenticated
  using ((email = (select auth.email())) or (invited_by = (select auth.uid())));

-- legal_notices -------------------------------------------------------------------
drop policy if exists notices_own on public.legal_notices;
create policy notices_own on public.legal_notices
  for all to authenticated
  using (user_id = (select auth.uid()));

-- lettings_progressions -------------------------------------------------------------
drop policy if exists "Users manage own lettings progressions" on public.lettings_progressions;
create policy "Users manage own lettings progressions" on public.lettings_progressions
  for all to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- mtd_settings / mtd_submissions -------------------------------------------------
drop policy if exists mtd_settings_own on public.mtd_settings;
create policy mtd_settings_own on public.mtd_settings
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists mtd_submissions_own on public.mtd_submissions;
create policy mtd_submissions_own on public.mtd_submissions
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- notifications --------------------------------------------------------------------
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own on public.notifications
  for insert to public
  with check ((select auth.uid()) = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to public
  using ((select auth.uid()) = user_id);

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to public
  using ((select auth.uid()) = user_id);

-- portfolio_insights ------------------------------------------------------------------
drop policy if exists portfolio_insights_select_own on public.portfolio_insights;
create policy portfolio_insights_select_own on public.portfolio_insights
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists portfolio_insights_delete_own on public.portfolio_insights;
create policy portfolio_insights_delete_own on public.portfolio_insights
  for delete to public
  using ((select auth.uid()) = user_id);

-- property_documents (insert only; other policies have no direct auth.* calls) --
drop policy if exists property_documents_insert on public.property_documents;
create policy property_documents_insert on public.property_documents
  for insert to authenticated
  with check (
    is_developer()
    or (
      (user_id = (select auth.uid()))
      and (exists (
        select 1 from properties p
        where p.id = property_documents.property_id
          and has_company_access(p.company_id)
      ))
    )
  );

-- property_inspections ------------------------------------------------------------
drop policy if exists inspections_select_own on public.property_inspections;
create policy inspections_select_own on public.property_inspections
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists inspections_insert_own on public.property_inspections;
create policy inspections_insert_own on public.property_inspections
  for insert to public
  with check ((select auth.uid()) = user_id);

drop policy if exists inspections_update_own on public.property_inspections;
create policy inspections_update_own on public.property_inspections
  for update to public
  using ((select auth.uid()) = user_id);

drop policy if exists inspections_delete_own on public.property_inspections;
create policy inspections_delete_own on public.property_inspections
  for delete to public
  using ((select auth.uid()) = user_id);

-- property_notes --------------------------------------------------------------------
drop policy if exists property_notes_select on public.property_notes;
create policy property_notes_select on public.property_notes
  for select to public
  using (is_developer() or (user_id = (select auth.uid())) or has_property_access(property_id));

drop policy if exists property_notes_insert on public.property_notes;
create policy property_notes_insert on public.property_notes
  for insert to public
  with check (
    ((user_id = (select auth.uid())) or has_property_access(property_id))
    and ((user_email = (select auth.email())) or is_developer())
  );

drop policy if exists property_notes_update on public.property_notes;
create policy property_notes_update on public.property_notes
  for update to public
  using (is_developer() or (user_id = (select auth.uid())) or has_property_access(property_id));

drop policy if exists property_notes_delete on public.property_notes;
create policy property_notes_delete on public.property_notes
  for delete to public
  using (is_developer() or (user_id = (select auth.uid())) or has_property_access(property_id));

-- referrals ---------------------------------------------------------------------------
drop policy if exists referrals_own on public.referrals;
create policy referrals_own on public.referrals
  for all to authenticated
  using ((referrer_id = (select auth.uid())) or is_platform_admin());

-- rent_history ---------------------------------------------------------------------------
drop policy if exists rh_own on public.rent_history;
create policy rh_own on public.rent_history
  for all to authenticated
  using (user_id = (select auth.uid()));

-- right_to_rent ---------------------------------------------------------------------------
drop policy if exists rtr_own on public.right_to_rent;
create policy rtr_own on public.right_to_rent
  for all to authenticated
  using ((user_id = (select auth.uid())) or is_platform_admin())
  with check (user_id = (select auth.uid()));

-- tenant_messages / tenant_profiles ----------------------------------------------------------
-- Owned by 2026-06-10_tenant_portal_access.sql, which replaces the legacy
-- tenant_messages_tenant / tenant_own policies with invite-bound, initplan-safe
-- policies. Deliberately not touched here so re-running this migration can
-- never resurrect the legacy permissive shapes.

-- tenant_references ----------------------------------------------------------------------------
drop policy if exists tenant_references_select_own on public.tenant_references;
create policy tenant_references_select_own on public.tenant_references
  for select to public
  using ((select auth.uid()) = user_id);

drop policy if exists tenant_references_insert_own on public.tenant_references;
create policy tenant_references_insert_own on public.tenant_references
  for insert to public
  with check ((select auth.uid()) = user_id);

drop policy if exists tenant_references_update_own on public.tenant_references;
create policy tenant_references_update_own on public.tenant_references
  for update to public
  using ((select auth.uid()) = user_id);

drop policy if exists tenant_references_delete_own on public.tenant_references;
create policy tenant_references_delete_own on public.tenant_references
  for delete to public
  using ((select auth.uid()) = user_id);

-- user_backups (user policies; the service-role FOR ALL policy is dropped in the
-- consolidate migration) ------------------------------------------------------------
drop policy if exists "Users view own backups" on public.user_backups;
create policy "Users view own backups" on public.user_backups
  for select to public
  using (user_id = (select auth.uid()));

drop policy if exists "Users insert own backups" on public.user_backups;
create policy "Users insert own backups" on public.user_backups
  for insert to public
  with check (user_id = (select auth.uid()));

drop policy if exists "Users delete own backups" on public.user_backups;
create policy "Users delete own backups" on public.user_backups
  for delete to public
  using (user_id = (select auth.uid()));

-- user_profiles (select_own is dropped in the consolidate migration) -----------------
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to public
  using (is_developer() or ((user_id)::text = ((select auth.uid()))::text));

drop policy if exists user_profiles_insert on public.user_profiles;
create policy user_profiles_insert on public.user_profiles
  for insert to public
  with check (is_developer() or ((user_id)::text = ((select auth.uid()))::text));

drop policy if exists user_profiles_update on public.user_profiles;
create policy user_profiles_update on public.user_profiles
  for update to public
  using (is_developer() or ((user_id)::text = ((select auth.uid()))::text));

-- xero_* -------------------------------------------------------------------------------
drop policy if exists xero_connections_own on public.xero_connections;
create policy xero_connections_own on public.xero_connections
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists xero_cron_schedules_own on public.xero_cron_schedules;
create policy xero_cron_schedules_own on public.xero_cron_schedules
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists xero_sync_log_own on public.xero_sync_log;
create policy xero_sync_log_own on public.xero_sync_log
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists xero_sync_map_own on public.xero_sync_map;
create policy xero_sync_map_own on public.xero_sync_map
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists xero_sync_settings_own on public.xero_sync_settings;
create policy xero_sync_settings_own on public.xero_sync_settings
  for all to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Verification (run manually after applying):
-- select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and (qual ~ 'auth\.(uid|role|email)\(\)' or with_check ~ 'auth\.(uid|role|email)\(\)')
--     and qual !~ 'SELECT auth\.' and coalesce(with_check, '') !~ 'SELECT auth\.'
--   order by tablename;  -- should only list tables owned by the security migration
-- Then re-run the Supabase performance advisor and confirm auth_rls_initplan
-- count drops from 98 to only the security-migration tables.
