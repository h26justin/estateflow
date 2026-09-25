-- ============================================================================
-- Rent Tracker rebuild, Stage 5: arrears payment plans.
--
-- A plan repays a historic arrears balance in instalments. Progress is derived
-- from rent_allocations with target historic_arrears (optionally linked to the
-- plan), so current-month performance and plan compliance stay separate.
-- Status is computed (on track / due soon / broken / completed); only
-- 'paused' and a manual 'completed' are stored, in status_override.
--
-- Additive only. Idempotent. Applied to production as rent_payment_plans.
-- ============================================================================

create table if not exists public.payment_plans (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references public.properties(id) on delete cascade,
  tenancy_id         uuid references public.tenancies(id) on delete set null,
  company_id         uuid references public.companies(id) on delete set null,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opening_balance    numeric(12,2) not null check (opening_balance > 0),
  start_date         date not null,
  instalment_amount  numeric(12,2) not null check (instalment_amount > 0),
  frequency          text not null default 'monthly' check (frequency in ('weekly','fortnightly','four_weekly','monthly')),
  due_day            smallint check (due_day between 1 and 31),
  status_override    text check (status_override is null or status_override in ('paused','completed')),
  notes              text,
  document_url       text,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
create index if not exists idx_payment_plans_property on public.payment_plans(property_id, start_date desc);
create index if not exists idx_payment_plans_tenancy on public.payment_plans(tenancy_id);

-- An allocation to historic arrears can name the plan it pays.
alter table public.rent_allocations add column if not exists payment_plan_id uuid references public.payment_plans(id) on delete set null;
create index if not exists idx_rent_alloc_plan on public.rent_allocations(payment_plan_id) where payment_plan_id is not null;

drop trigger if exists trg_payment_plans_company on public.payment_plans;
create trigger trg_payment_plans_company before insert or update on public.payment_plans
  for each row execute function public.rent_tracker_default_company();
drop trigger if exists payment_plans_updated_at on public.payment_plans;
create trigger payment_plans_updated_at before update on public.payment_plans
  for each row execute function public.update_updated_at();
drop trigger if exists audit_trigger on public.payment_plans;
create trigger audit_trigger after insert or update or delete on public.payment_plans
  for each row execute function public.audit_trigger_fn();

alter table public.payment_plans enable row level security;
drop policy if exists payment_plans_select on public.payment_plans;
drop policy if exists payment_plans_insert on public.payment_plans;
drop policy if exists payment_plans_update on public.payment_plans;
drop policy if exists payment_plans_delete on public.payment_plans;
create policy payment_plans_select on public.payment_plans for select
  using (is_developer() or has_property_access(property_id));
create policy payment_plans_insert on public.payment_plans for insert
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = payment_plans.property_id)));
create policy payment_plans_update on public.payment_plans for update
  using (has_rent_permission(property_id, 'write'))
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = payment_plans.property_id)));
create policy payment_plans_delete on public.payment_plans for delete
  using (has_rent_permission(property_id, 'delete'));

revoke all on public.payment_plans from anon;
grant select, insert, update, delete on public.payment_plans to authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select policyname from pg_policies where tablename='payment_plans';
-- select column_name from information_schema.columns where table_name='rent_allocations' and column_name='payment_plan_id';
