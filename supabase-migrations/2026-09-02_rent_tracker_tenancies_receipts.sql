-- ============================================================================
-- Rent Tracker rebuild, Stage 2: tenancies, non-chargeable periods, receipts
-- and allocations.
--
-- Why: rent_payments is one row per property per period that holds BOTH the
-- expectation and the money. That is why payments cannot be split between
-- current rent and arrears, why a four-weekly Housing Benefit cycle has no
-- home, why tenancy dates never enter the collection rate, and why duplicates
-- keep appearing. This migration adds the missing entities ALONGSIDE the
-- existing table. Nothing is dropped, renamed, retyped or deleted.
--
-- Compatibility bridge: a period's received amount is the sum of its
-- rent_allocations (target current_rent) when any exist, otherwise the legacy
-- rent_payments.amount. Nothing downstream changes until Stage 4 switches the
-- collection rate to the new arithmetic.
--
-- Additive only. Idempotent. Safe to re-run.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- ── tenancies ──────────────────────────────────────────────────────────────
-- Many per property over time; at most one covering any given day.
create table if not exists public.tenancies (
  id                       uuid primary key default gen_random_uuid(),
  property_id              uuid not null references public.properties(id) on delete cascade,
  company_id               uuid references public.companies(id) on delete set null,
  user_id                  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_name              text,
  tenant_ref               text,                       -- stable, user-visible tenant reference
  tenancy_start            date not null,
  tenancy_end              date,                       -- contractual / confirmed end; null = periodic
  notice_received_date     date,
  expected_move_out        date,
  rent_amount              numeric(12,2),
  rent_frequency           text not null default 'monthly'
                           check (rent_frequency in ('monthly','four_weekly','fortnightly','weekly','quarterly')),
  rent_due_day             smallint check (rent_due_day between 1 and 31),
  rent_due_anchor          date,                       -- first due date for non-monthly cycles
  payment_window_days      smallint not null default 5 check (payment_window_days between 0 and 60),
  status                   text not null default 'rented'
                           check (status in ('rented','notice_given','vacant','refurbishment','ended')),
  payment_source           text not null default 'tenant'
                           check (payment_source in ('tenant','housing_benefit','universal_credit','mixed','other')),
  benefit_type             text,
  benefit_contribution     numeric(12,2),
  tenant_contribution      numeric(12,2),
  benefit_frequency        text check (benefit_frequency is null or benefit_frequency in ('weekly','fortnightly','four_weekly','monthly')),
  benefit_next_payment_date date,
  benefit_paid_to          text check (benefit_paid_to is null or benefit_paid_to in ('landlord','tenant')),
  benefit_reference        text,
  opening_arrears          numeric(12,2) not null default 0,
  opening_arrears_date     date,
  notes                    text,
  needs_confirmation       boolean not null default false, -- seeded from property fields, awaiting a human
  confirmed_at             timestamptz,
  confirmed_by             uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  created_by               uuid default auth.uid(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  constraint tenancies_dates_chk check (tenancy_end is null or tenancy_end >= tenancy_start),
  -- One tenancy per unit per day. Ended tenancies still count: history must
  -- not overlap either. Open-ended tenancies run to infinity.
  constraint tenancies_no_overlap exclude using gist (
    property_id with =,
    daterange(tenancy_start, coalesce(tenancy_end, 'infinity'::date), '[]') with &&
  )
);
create index if not exists idx_tenancies_property on public.tenancies(property_id, tenancy_start desc);
create index if not exists idx_tenancies_company  on public.tenancies(company_id);

-- ── non_chargeable_periods ─────────────────────────────────────────────────
-- Approved gaps where no rent is collectible: vacant, refurbishment, agreed
-- rent-free. Excluded from the collection-rate denominator.
create table if not exists public.non_chargeable_periods (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  tenancy_id   uuid references public.tenancies(id) on delete set null,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  start_date   date not null,
  end_date     date,                                   -- null = still open
  reason       text not null default 'vacant' check (reason in ('vacant','refurbishment','rent_free','other')),
  notes        text,
  approved_by  uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  constraint ncp_dates_chk check (end_date is null or end_date >= start_date)
);
create index if not exists idx_ncp_property on public.non_chargeable_periods(property_id, start_date desc);

-- ── rent_receipts ──────────────────────────────────────────────────────────
-- A dated cash event. Refunds, bounces and reversals are receipts of kind
-- refund/bounce that point at the receipt they reverse, so nothing is deleted.
create table if not exists public.rent_receipts (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties(id) on delete cascade,
  tenancy_id           uuid references public.tenancies(id) on delete set null,
  company_id           uuid references public.companies(id) on delete set null,
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  received_date        date not null,
  amount               numeric(12,2) not null,          -- negative for refund/bounce
  kind                 text not null default 'receipt' check (kind in ('receipt','refund','bounce','adjustment')),
  reverses_receipt_id  uuid references public.rent_receipts(id) on delete set null,
  payer                text not null default 'tenant' check (payer in ('tenant','housing_benefit','universal_credit','other')),
  source               text not null default 'manual' check (source in ('manual','statement','bank','xero','stl','other')),
  source_ref           text,
  import_batch_id      uuid references public.import_batches(id) on delete set null,
  reference            text,
  notes                text,
  review_status        text not null default 'ok' check (review_status in ('ok','needs_review')),
  review_reason        text,
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  constraint rent_receipts_sign_chk check (
    (kind in ('receipt','adjustment') and amount <> 0) or (kind in ('refund','bounce') and amount < 0)
  )
);
create unique index if not exists uq_rent_receipts_source_ref
  on public.rent_receipts(user_id, source_ref) where source_ref is not null;
create index if not exists idx_rent_receipts_property on public.rent_receipts(property_id, received_date desc);
create index if not exists idx_rent_receipts_tenancy  on public.rent_receipts(tenancy_id);
create index if not exists idx_rent_receipts_review   on public.rent_receipts(review_status) where review_status = 'needs_review';

-- ── rent_allocations ───────────────────────────────────────────────────────
-- How a receipt is applied: to a rent period (current rent), to historic
-- arrears, to a deposit, or left unallocated for review. One receipt may split
-- across several targets; one period may draw from several receipts.
create table if not exists public.rent_allocations (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null references public.rent_receipts(id) on delete cascade,
  rent_payment_id  uuid references public.rent_payments(id) on delete set null,
  tenancy_id       uuid references public.tenancies(id) on delete set null,
  target           text not null default 'current_rent'
                   check (target in ('current_rent','historic_arrears','deposit','other','unallocated')),
  amount           numeric(12,2) not null,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  constraint rent_alloc_target_chk check (target <> 'current_rent' or rent_payment_id is not null)
);
create index if not exists idx_rent_alloc_receipt on public.rent_allocations(receipt_id);
create index if not exists idx_rent_alloc_period  on public.rent_allocations(rent_payment_id);

-- ── rent_payments: link to tenancy, carry the expectation explicitly ───────
alter table public.rent_payments add column if not exists tenancy_id      uuid references public.tenancies(id) on delete set null;
alter table public.rent_payments add column if not exists expected_amount numeric(12,2);
alter table public.rent_payments add column if not exists due_date        date;
create index if not exists idx_rent_payments_tenancy on public.rent_payments(tenancy_id) where tenancy_id is not null;

-- ── company_id defaults from the property ──────────────────────────────────
create or replace function public.rent_tracker_default_company()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if new.company_id is null and new.property_id is not null then
    select company_id into new.company_id from public.properties where id = new.property_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_tenancies_company on public.tenancies;
create trigger trg_tenancies_company before insert or update on public.tenancies
  for each row execute function public.rent_tracker_default_company();
drop trigger if exists trg_rent_receipts_company on public.rent_receipts;
create trigger trg_rent_receipts_company before insert or update on public.rent_receipts
  for each row execute function public.rent_tracker_default_company();

-- updated_at / updated_by stamps (update_updated_at() already exists)
drop trigger if exists tenancies_updated_at on public.tenancies;
create trigger tenancies_updated_at before update on public.tenancies
  for each row execute function public.update_updated_at();
drop trigger if exists rent_receipts_updated_at on public.rent_receipts;
create trigger rent_receipts_updated_at before update on public.rent_receipts
  for each row execute function public.update_updated_at();

-- Audit trail (who / when / from-to diff) — same trigger the rest of the app uses.
drop trigger if exists audit_trigger on public.tenancies;
create trigger audit_trigger after insert or update or delete on public.tenancies
  for each row execute function public.audit_trigger_fn();
drop trigger if exists audit_trigger on public.rent_receipts;
create trigger audit_trigger after insert or update or delete on public.rent_receipts
  for each row execute function public.audit_trigger_fn();
drop trigger if exists audit_trigger on public.rent_allocations;
create trigger audit_trigger after insert or update or delete on public.rent_allocations
  for each row execute function public.audit_trigger_fn();
drop trigger if exists audit_trigger on public.non_chargeable_periods;
create trigger audit_trigger after insert or update or delete on public.non_chargeable_periods
  for each row execute function public.audit_trigger_fn();

-- ── Row level security ─────────────────────────────────────────────────────
-- Same shape as rent_payments: read via property access, write via the
-- property permission gate plus company liveness. Stage 7 swaps the write
-- gate for has_rent_permission (per-user edit_rent override); until then the
-- role floor applies.
alter table public.tenancies              enable row level security;
alter table public.non_chargeable_periods enable row level security;
alter table public.rent_receipts          enable row level security;
alter table public.rent_allocations       enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['tenancies','non_chargeable_periods','rent_receipts']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select
      using (is_developer() or has_property_access(property_id))$p$, t, t);
    execute format($p$create policy %I_insert on public.%I for insert
      with check (has_property_permission(property_id, 'write')
        and company_is_live((select company_id from public.properties where id = %I.property_id)))$p$, t, t, t);
    execute format($p$create policy %I_update on public.%I for update
      using (has_property_permission(property_id, 'write'))
      with check (has_property_permission(property_id, 'write')
        and company_is_live((select company_id from public.properties where id = %I.property_id)))$p$, t, t, t);
    execute format($p$create policy %I_delete on public.%I for delete
      using (has_property_permission(property_id, 'delete'))$p$, t, t);
  end loop;
end $rls$;

-- Allocations inherit their receipt's property.
drop policy if exists rent_allocations_select on public.rent_allocations;
drop policy if exists rent_allocations_insert on public.rent_allocations;
drop policy if exists rent_allocations_update on public.rent_allocations;
drop policy if exists rent_allocations_delete on public.rent_allocations;
create policy rent_allocations_select on public.rent_allocations for select
  using (is_developer() or has_property_access((select property_id from public.rent_receipts r where r.id = receipt_id)));
create policy rent_allocations_insert on public.rent_allocations for insert
  with check (has_property_permission((select property_id from public.rent_receipts r where r.id = receipt_id), 'write'));
create policy rent_allocations_update on public.rent_allocations for update
  using (has_property_permission((select property_id from public.rent_receipts r where r.id = receipt_id), 'write'))
  with check (has_property_permission((select property_id from public.rent_receipts r where r.id = receipt_id), 'write'));
create policy rent_allocations_delete on public.rent_allocations for delete
  using (has_property_permission((select property_id from public.rent_receipts r where r.id = receipt_id), 'delete'));

revoke all on public.tenancies, public.non_chargeable_periods, public.rent_receipts, public.rent_allocations from anon;
grant select, insert, update, delete on public.tenancies, public.non_chargeable_periods, public.rent_receipts, public.rent_allocations to authenticated;

-- ── Verification (run by hand after applying) ──────────────────────────────
-- select table_name, count(*) from information_schema.columns
--  where table_schema='public' and table_name in ('tenancies','non_chargeable_periods','rent_receipts','rent_allocations')
--  group by 1;
-- select tablename, policyname from pg_policies where tablename in ('tenancies','rent_receipts','rent_allocations','non_chargeable_periods') order by 1,2;
-- select column_name from information_schema.columns where table_name='rent_payments' and column_name in ('tenancy_id','expected_amount','due_date');
