-- Deals transformation step 1 (DEALS_TRANSFORMATION_PLAN.md items 4 and 6):
-- itemised acquisition costs, deal funding, and company cash positions.
-- APPLIED 19 Nov 2026 to hqrhqbkqxzllmzhcofrh (Justin approved) via MCP
-- apply_migration `deal_costs_funding_cash`; verified: 3 tables, RLS on, policies.
-- Additive only; existing deals keep their flat cost fields as the fallback
-- until lines are entered. Rollback at the end.
--
-- Money rules (Deals brief §6):
--   balance due for completion = completion costs - credits (on account,
--     deposit paid), from deal_cost_lines;
--   company cash need = balance due + other due costs - confirmed financing;
--   funding gap = cash need over a period - company cash available (counted
--     once per company, from the latest company_cash_positions row).
-- Every amount carries a state so an estimate is never shown as confirmed.

create table if not exists public.deal_cost_lines (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  category    text not null check (category in (
    'purchase_price','sdlt','legal_fee','legal_vat','disbursements','land_registry','searches',
    'survey','broker','auction','indemnity','other_purchase',
    'on_account','deposit_paid',
    'refurb','contingency','other')),
  label       text check (label is null or char_length(label) <= 200),
  amount      numeric(14,2) not null check (amount >= 0),
  state       text not null default 'estimate' check (state in ('estimate','quoted','confirmed','paid','actual')),
  due_date    date,
  vat_included boolean not null default true,
  source      text check (source is null or char_length(source) <= 300),
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists deal_cost_lines_deal_idx on public.deal_cost_lines (deal_id);

create table if not exists public.deal_funding (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals(id) on delete cascade,
  source        text not null check (source in ('mortgage','bridge','loan','investor','company_cash','other')),
  label         text check (label is null or char_length(label) <= 200),
  amount        numeric(14,2) not null check (amount >= 0),
  state         text not null default 'expected' check (state in ('expected','confirmed','received')),
  expected_date date,
  notes         text check (notes is null or char_length(notes) <= 1000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists deal_funding_deal_idx on public.deal_funding (deal_id);

create table if not exists public.company_cash_positions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  as_of       date not null default current_date,
  amount      numeric(14,2) not null,
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists company_cash_positions_co_idx on public.company_cash_positions (company_id, as_of desc, created_at desc);

alter table public.deal_cost_lines enable row level security;
alter table public.deal_funding enable row level security;
alter table public.company_cash_positions enable row level security;

-- Deal sub-records: same rules as deal_milestones.
do $$
declare t text;
begin
  foreach t in array array['deal_cost_lines','deal_funding'] loop
    execute format($f$create policy %1$s_select on public.%1$s for select to authenticated using (
      exists (select 1 from public.deals d where d.id = %1$s.deal_id and (
        d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_access(d.company_id)) or public.is_platform_admin())))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated with check (
      exists (select 1 from public.deals d where d.id = %1$s.deal_id and (
        d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$s for update to authenticated using (
      exists (select 1 from public.deals d where d.id = %1$s.deal_id and (
        d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())))
      with check (
      exists (select 1 from public.deals d where d.id = %1$s.deal_id and (
        d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$s for delete to authenticated using (
      exists (select 1 from public.deals d where d.id = %1$s.deal_id and (
        d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())))$f$, t);
  end loop;
end $$;

-- Company cash: readable by company members, written by those with write
-- access. Rows are a history (latest wins), so there is no update policy;
-- a mistake is corrected by adding a new position, or deleted by a writer.
create policy company_cash_positions_select on public.company_cash_positions for select to authenticated using (
  public.has_company_access(company_id) or public.is_platform_admin());
create policy company_cash_positions_insert on public.company_cash_positions for insert to authenticated with check (
  public.has_company_write(company_id) or public.is_platform_admin());
create policy company_cash_positions_delete on public.company_cash_positions for delete to authenticated using (
  public.has_company_write(company_id) or public.is_platform_admin());

-- Rollback:
-- drop table if exists public.company_cash_positions;
-- drop table if exists public.deal_funding;
-- drop table if exists public.deal_cost_lines;
