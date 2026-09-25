-- ============================================================================
-- Short-Term Let Income: platform fees and property managers.
--
-- 1. stl_bookings gains the fee fields Hostaway already sends per reservation
--    (channel commission, Hostaway commission, cleaning fee, tax, payment
--    status, raw fee lines) so the page can show what actually comes to us.
-- 2. stl_managers: a named manager with a percentage per company (e.g. a
--    manager taking 15% of income after platform fees for management and
--    cleaning). properties.stl_manager_id assigns one per unit so a
--    fortnightly payout can be calculated.
--
-- Additive only. Idempotent.
-- ============================================================================

alter table public.stl_bookings add column if not exists channel_commission    numeric(12,2);
alter table public.stl_bookings add column if not exists hostaway_commission   numeric(12,2);
alter table public.stl_bookings add column if not exists cleaning_fee          numeric(12,2);
alter table public.stl_bookings add column if not exists tax_amount            numeric(12,2);
alter table public.stl_bookings add column if not exists payment_status        text;
alter table public.stl_bookings add column if not exists fee_lines             jsonb;
alter table public.stl_bookings add column if not exists financials_synced_at  timestamptz;

create table if not exists public.stl_managers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null check (length(btrim(name)) >= 1),
  percentage       numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  basis            text not null default 'net_after_platform_fees' check (basis in ('net_after_platform_fees','gross')),
  payout_frequency text not null default 'fortnightly' check (payout_frequency in ('weekly','fortnightly','monthly')),
  active           boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create index if not exists idx_stl_managers_company on public.stl_managers(company_id);

alter table public.properties add column if not exists stl_manager_id uuid references public.stl_managers(id) on delete set null;
create index if not exists idx_properties_stl_manager on public.properties(stl_manager_id) where stl_manager_id is not null;

drop trigger if exists stl_managers_updated_at on public.stl_managers;
create trigger stl_managers_updated_at before update on public.stl_managers
  for each row execute function public.update_updated_at();
drop trigger if exists audit_trigger on public.stl_managers;
create trigger audit_trigger after insert or update or delete on public.stl_managers
  for each row execute function public.audit_trigger_fn();

alter table public.stl_managers enable row level security;
drop policy if exists stl_managers_select on public.stl_managers;
drop policy if exists stl_managers_insert on public.stl_managers;
drop policy if exists stl_managers_update on public.stl_managers;
drop policy if exists stl_managers_delete on public.stl_managers;
create policy stl_managers_select on public.stl_managers for select
  using (is_developer() or has_company_access(company_id));
-- Writes: anyone who may edit rent on a property of that company.
create policy stl_managers_insert on public.stl_managers for insert
  with check (exists (select 1 from public.properties p where p.company_id = stl_managers.company_id and has_rent_permission(p.id, 'write'))
    and company_is_live(company_id));
create policy stl_managers_update on public.stl_managers for update
  using (exists (select 1 from public.properties p where p.company_id = stl_managers.company_id and has_rent_permission(p.id, 'write')))
  with check (exists (select 1 from public.properties p where p.company_id = stl_managers.company_id and has_rent_permission(p.id, 'write')));
create policy stl_managers_delete on public.stl_managers for delete
  using (exists (select 1 from public.properties p where p.company_id = stl_managers.company_id and has_rent_permission(p.id, 'delete')));

revoke all on public.stl_managers from anon;
grant select, insert, update, delete on public.stl_managers to authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select column_name from information_schema.columns where table_name='stl_bookings' and column_name like '%commission%';
-- select policyname from pg_policies where tablename='stl_managers';
