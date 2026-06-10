-- 2026-06-10 perf: multiple_permissive_policies remediation (advisor lint 0006)
-- Consolidates duplicate permissive RLS policies so each table has at most one
-- permissive policy per role per action. Permissive policies are OR-combined
-- by Postgres, so merging USING/WITH CHECK clauses with OR (or dropping a
-- policy whose predicate is subsumed by another) preserves semantics exactly.
-- auth.* calls in recreated policies are wrapped as (select auth.*()) per
-- advisor lint 0003.
--
-- Tables consolidated here: user_backups (15 lints), feature_flags (5),
-- feature_flag_users (5), feature_flag_companies (5), company_settings (3),
-- user_profiles (1), audit_log (1), admin_announcements (1).
--
-- SKIPPED (owned by the parallel security migration, which is splitting their
-- FOR ALL policies): properties, deals, rent_payments, compliance_items,
-- maintenance_jobs, property_expenses, tenancy_details (plus subscriptions,
-- companies, user_company_access, storage.objects). Re-run the advisor after
-- both migrations are applied.

-- user_backups: the FOR ALL service-role policy is redundant — service_role
-- bypasses RLS entirely, and (auth.role() = 'service_role') is false for every
-- role that is subject to RLS. Dropping it clears all 15 overlaps and changes
-- nothing in effect.
drop policy if exists "Service role manages all backups" on public.user_backups;

-- admin_announcements: split the FOR ALL write policy into action-specific
-- policies; SELECT stays with announcements_read (qual: true), which already
-- subsumes is_platform_admin() for reads.
drop policy if exists announcements_write on public.admin_announcements;
drop policy if exists announcements_insert on public.admin_announcements;
create policy announcements_insert on public.admin_announcements
  for insert to authenticated
  with check (is_platform_admin());
drop policy if exists announcements_update on public.admin_announcements;
create policy announcements_update on public.admin_announcements
  for update to authenticated
  using (is_platform_admin())
  with check (is_platform_admin());
drop policy if exists announcements_delete on public.admin_announcements;
create policy announcements_delete on public.admin_announcements
  for delete to authenticated
  using (is_platform_admin());

-- feature_flags: split ff_write (FOR ALL) into insert/update/delete; merge its
-- SELECT grant into ff_read (is_developer() is OR-added — a no-op widening,
-- since developers are authenticated, kept for exact union semantics).
drop policy if exists ff_write on public.feature_flags;
drop policy if exists ff_read on public.feature_flags;
create policy ff_read on public.feature_flags
  for select to public
  using (((select auth.role()) = 'authenticated'::text) or is_developer());
drop policy if exists ff_insert on public.feature_flags;
create policy ff_insert on public.feature_flags
  for insert to public
  with check (is_developer());
drop policy if exists ff_update on public.feature_flags;
create policy ff_update on public.feature_flags
  for update to public
  using (is_developer())
  with check (is_developer());
drop policy if exists ff_delete on public.feature_flags;
create policy ff_delete on public.feature_flags
  for delete to public
  using (is_developer());

-- feature_flag_users: same split; ffu_read already includes is_developer().
drop policy if exists ffu_write on public.feature_flag_users;
drop policy if exists ffu_read on public.feature_flag_users;
create policy ffu_read on public.feature_flag_users
  for select to public
  using (is_developer() or ((user_id)::text = ((select auth.uid()))::text));
drop policy if exists ffu_insert on public.feature_flag_users;
create policy ffu_insert on public.feature_flag_users
  for insert to public
  with check (is_developer());
drop policy if exists ffu_update on public.feature_flag_users;
create policy ffu_update on public.feature_flag_users
  for update to public
  using (is_developer())
  with check (is_developer());
drop policy if exists ffu_delete on public.feature_flag_users;
create policy ffu_delete on public.feature_flag_users
  for delete to public
  using (is_developer());

-- feature_flag_companies: same split; ffc_read already includes is_developer()
-- and contains no direct auth.* calls, so it is left untouched.
drop policy if exists ffc_write on public.feature_flag_companies;
drop policy if exists ffc_insert on public.feature_flag_companies;
create policy ffc_insert on public.feature_flag_companies
  for insert to public
  with check (is_developer());
drop policy if exists ffc_update on public.feature_flag_companies;
create policy ffc_update on public.feature_flag_companies
  for update to public
  using (is_developer())
  with check (is_developer());
drop policy if exists ffc_delete on public.feature_flag_companies;
create policy ffc_delete on public.feature_flag_companies
  for delete to public
  using (is_developer());

-- company_settings: merge company_settings_all (FOR ALL to public:
-- is_developer() OR has_company_access) into the action-specific policies by
-- OR, and carry its DELETE grant into a new delete policy. Recreated TO public
-- so a single policy covers each action for every role (the merged predicates
-- are all false for anon, as before).
drop policy if exists company_settings_all on public.company_settings;
drop policy if exists company_settings_select on public.company_settings;
create policy company_settings_select on public.company_settings
  for select to public
  using (user_has_company_access(company_id) or is_developer() or has_company_access(company_id));
drop policy if exists company_settings_insert on public.company_settings;
create policy company_settings_insert on public.company_settings
  for insert to public
  with check (user_is_company_admin(company_id) or is_developer() or has_company_access(company_id));
drop policy if exists company_settings_update on public.company_settings;
create policy company_settings_update on public.company_settings
  for update to public
  using (user_is_company_admin(company_id) or is_developer() or has_company_access(company_id))
  with check (user_is_company_admin(company_id) or is_developer() or has_company_access(company_id));
drop policy if exists company_settings_delete on public.company_settings;
create policy company_settings_delete on public.company_settings
  for delete to public
  using (is_developer() or has_company_access(company_id));

-- user_profiles: user_profiles_select_own (auth.uid() = user_id) is strictly
-- subsumed by user_profiles_select (is_developer() OR user_id::text =
-- auth.uid()::text) — drop the redundant policy.
drop policy if exists user_profiles_select_own on public.user_profiles;

-- audit_log: merge the two overlapping SELECT policies ("Users can view own
-- audit entries" + audit_own) into one OR-combined policy, with auth.uid()
-- wrapped per lint 0003.
drop policy if exists "Users can view own audit entries" on public.audit_log;
drop policy if exists audit_own on public.audit_log;
create policy audit_own on public.audit_log
  for select to public
  using (
    (user_id = (select auth.uid()))
    or is_platform_admin()
    or ((company_id)::text in (
      select (companies.id)::text as id
      from companies
      where (companies.owner_id)::text = ((select auth.uid()))::text
      union
      select (user_company_access.company_id)::text as company_id
      from user_company_access
      where user_company_access.user_id = ((select auth.uid()))::text
    ))
  );

-- Verification (run manually after applying):
-- select tablename, cmd, count(*)
--   from pg_policies, unnest(roles) r(role)
--   where schemaname = 'public' and permissive = 'PERMISSIVE'
--     and tablename in ('user_backups','feature_flags','feature_flag_users',
--                       'feature_flag_companies','company_settings',
--                       'user_profiles','audit_log','admin_announcements')
--   group by tablename, cmd, role having count(*) > 1;  -- expect zero rows
-- Then re-run the Supabase performance advisor: multiple_permissive_policies
-- should drop from 64 to only the security-migration tables (~28).
