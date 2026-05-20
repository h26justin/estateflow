-- Three audit fixes bundled because they're each small and independent:
--
-- 1. audit_log had two competing INSERT policies. Postgres RLS allows
--    insert if ANY policy permits. The loose policy ("Users can insert
--    own audit entries") had `OR user_id IS NULL` as an escape — any
--    authenticated user could forge audit entries claiming any company.
--    The strict `audit_insert` policy (user_id = auth.uid()) stays;
--    we drop the loose one.
--
-- 2. feature_flags read was `USING (true)` — anonymous users could list
--    every flag including unreleased ones (product roadmap leak).
--    Tighten to authenticated. ff_write stays developer-only.
--
-- 3. Performance indexes on hot query paths identified by the audit
--    (verified missing via pg_indexes inspection).
--
-- Applied via Supabase MCP on 2026-05-20.

-- ── audit_log policy cleanup ──────────────────────────────────────
drop policy if exists "Users can insert own audit entries" on public.audit_log;

-- ── feature_flags read access ─────────────────────────────────────
drop policy if exists "ff_read" on public.feature_flags;
create policy "ff_read" on public.feature_flags for select
  using (auth.role() = 'authenticated');

-- ── Performance indexes ───────────────────────────────────────────
-- properties: by company and by user-sorted, partial WHERE deleted_at
-- IS NULL since every active query filters that.
create index if not exists idx_properties_company_active
  on public.properties (company_id)
  where deleted_at is null;

create index if not exists idx_properties_user_sort_active
  on public.properties (user_id, sort_order)
  where deleted_at is null;

-- compliance_items: queried by property and by expiry.
create index if not exists idx_compliance_items_property_active
  on public.compliance_items (property_id)
  where deleted_at is null;

create index if not exists idx_compliance_items_expiry_active
  on public.compliance_items (expiry_date)
  where deleted_at is null and expiry_date is not null;

-- maintenance_jobs: queried by property
create index if not exists idx_maintenance_jobs_property_active
  on public.maintenance_jobs (property_id)
  where deleted_at is null;

-- property_expenses: queried by property + ordered by date
create index if not exists idx_property_expenses_property_date_active
  on public.property_expenses (property_id, date desc)
  where deleted_at is null;
