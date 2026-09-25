-- ============================================================================
-- Rent Tracker rebuild, Stage 3: manual overrides of a period's traffic-light
-- state.
--
-- Append-only. Every override records who, when, the state chosen and a
-- mandatory reason. The latest row for a period wins; state 'clear' removes
-- the override so nothing is ever deleted. Read via property access, written
-- via the rent gate (has_rent_permission) like every other rent table.
-- ============================================================================

create table if not exists public.rent_overrides (
  id               uuid primary key default gen_random_uuid(),
  rent_payment_id  uuid not null references public.rent_payments(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state            text not null check (state in ('paid','due','part_paid','missed','not_collectible','clear')),
  reason           text not null check (length(btrim(reason)) >= 3),
  expected_amount  numeric(12,2),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid()
);
create index if not exists idx_rent_overrides_period on public.rent_overrides(rent_payment_id, created_at desc);
create index if not exists idx_rent_overrides_property on public.rent_overrides(property_id);

drop trigger if exists audit_trigger on public.rent_overrides;
create trigger audit_trigger after insert or update or delete on public.rent_overrides
  for each row execute function public.audit_trigger_fn();

alter table public.rent_overrides enable row level security;
drop policy if exists rent_overrides_select on public.rent_overrides;
drop policy if exists rent_overrides_insert on public.rent_overrides;
create policy rent_overrides_select on public.rent_overrides for select
  using (is_developer() or has_property_access(property_id));
create policy rent_overrides_insert on public.rent_overrides for insert
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = rent_overrides.property_id)));
-- No update or delete policy: the log is append-only.

revoke all on public.rent_overrides from anon;
grant select, insert on public.rent_overrides to authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select policyname, cmd from pg_policies where tablename='rent_overrides';
-- select count(*) from public.rent_overrides;
