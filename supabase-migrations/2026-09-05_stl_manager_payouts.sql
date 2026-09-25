-- ============================================================================
-- Short-Term Let Income: manager payout ledger.
--
-- Manager payouts were computed live from the current percentage and never
-- stored, so changing a manager's rate, or a Booking.com invoice landing after
-- the stay, silently restated a fortnight that had already been paid. This
-- table records each payment as it was made: who, which period, how much, the
-- rate and basis applied, and a per-room snapshot of the figures behind it.
--
-- Rows are written once and deleted if wrong (no update policy); the audit
-- trigger keeps the history. manager_name is snapshotted so the ledger
-- survives the manager being removed (manager_id then nulls out).
--
-- Additive only. Idempotent.
-- ============================================================================

create table if not exists public.stl_manager_payouts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  manager_id    uuid references public.stl_managers(id) on delete set null,
  manager_name  text not null check (length(btrim(manager_name)) >= 1),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_from   date not null,
  period_to     date not null check (period_to >= period_from),
  amount        numeric(12,2) not null check (amount >= 0),
  base_amount   numeric(12,2) not null default 0,
  percentage    numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  basis         text not null check (basis in ('net_after_platform_fees','gross')),
  breakdown     jsonb not null default '[]'::jsonb,
  notes         text,
  paid_on       date not null default current_date,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
create index if not exists idx_stl_manager_payouts_company on public.stl_manager_payouts(company_id, period_from desc);
-- One payment per manager per exact period. Manager-less rows (manager since
-- removed) are exempt; NULLs are distinct in a unique index.
create unique index if not exists uq_stl_manager_payouts_period
  on public.stl_manager_payouts(manager_id, period_from, period_to) where manager_id is not null;

drop trigger if exists audit_trigger on public.stl_manager_payouts;
create trigger audit_trigger after insert or update or delete on public.stl_manager_payouts
  for each row execute function public.audit_trigger_fn();

alter table public.stl_manager_payouts enable row level security;
drop policy if exists stl_manager_payouts_select on public.stl_manager_payouts;
drop policy if exists stl_manager_payouts_insert on public.stl_manager_payouts;
drop policy if exists stl_manager_payouts_delete on public.stl_manager_payouts;
create policy stl_manager_payouts_select on public.stl_manager_payouts for select
  using (is_developer() or has_company_access(company_id));
-- Writes: anyone who may edit rent on a property of that company (same rule
-- as stl_managers). No update policy: a wrong row is deleted and re-recorded.
create policy stl_manager_payouts_insert on public.stl_manager_payouts for insert
  with check (exists (select 1 from public.properties p where p.company_id = stl_manager_payouts.company_id and has_rent_permission(p.id, 'write'))
    and company_is_live(company_id));
create policy stl_manager_payouts_delete on public.stl_manager_payouts for delete
  using (exists (select 1 from public.properties p where p.company_id = stl_manager_payouts.company_id and has_rent_permission(p.id, 'delete')));

revoke all on public.stl_manager_payouts from anon;
grant select, insert, delete on public.stl_manager_payouts to authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select policyname, cmd from pg_policies where tablename='stl_manager_payouts';
-- select indexname from pg_indexes where tablename='stl_manager_payouts';
