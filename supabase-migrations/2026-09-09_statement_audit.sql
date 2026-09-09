-- Rental Statement Audit register (2026-09-09).
--
-- A standalone register of managing-agent rental statements used to audit the
-- statements themselves and reconcile them against the bank account. It is
-- deliberately NOT linked to properties, tenancies, rent_payments or any other
-- portfolio table: property addresses and tenant names are stored exactly as
-- printed on the statement, and the audit never reads figures held elsewhere
-- in the app. (The existing statement importer, which does write into the
-- rent tracker, is a separate feature and is untouched by this migration.)
--
-- Three tables, all owner-scoped (user_id = auth.uid()):
--   statement_audit_series      one row per landlord company / statement run,
--                               carrying the number the audit starts from
--   statement_audit_statements  one row per statement number in the run,
--                               including placeholders for missing numbers
--   statement_audit_lines       one row per transaction on a statement,
--                               each stamped with the statement number + date
--
-- Applied to production via the Supabase MCP as a gated change; see
-- DEPLOYMENT_RUNBOOK.md.

create table if not exists public.statement_audit_series (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  series_key        text not null,
  landlord_company  text not null,
  landlord_name     text,
  agent             text,
  start_number      integer not null default 71,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, series_key)
);

create table if not exists public.statement_audit_statements (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  series_key                text not null,
  statement_number          integer not null,
  statement_date            date,
  agent                     text,
  landlord_name             text,
  landlord_company          text,
  status                    text not null default 'not_uploaded' check (status in (
                              'not_uploaded','uploaded_awaiting_import','importing','imported_awaiting_review',
                              'previously_imported_checked','correction_required','possible_duplicate','import_error',
                              'discrepancy_found','ready_for_bank_check','fully_reconciled')),
  statement_checked         boolean not null default false,
  checked_by                text,
  checked_at                date,
  notes                     text,
  correction_required       boolean not null default false,
  bank_payment_matched      boolean not null default false,
  bank_paid_date            date,
  bank_paid_amount          numeric(12,2),
  file_name                 text,
  raw_text                  text,
  previous_balance          numeric(12,2),
  new_balance               numeric(12,2),
  payment_amount            numeric(12,2),
  stated_income_total       numeric(12,2),
  stated_expenditure_total  numeric(12,2),
  invoice_number            text,
  invoice_date              date,
  invoice_fees              numeric(12,2),
  import_errors             jsonb not null default '[]'::jsonb,
  last_import_summary       jsonb,
  imported_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (user_id, series_key, statement_number)
);

create table if not exists public.statement_audit_lines (
  id                uuid primary key default gen_random_uuid(),
  statement_id      uuid not null references public.statement_audit_statements(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  statement_number  integer not null,
  statement_date    date,
  line_no           integer not null default 0,
  section           text check (section in ('income','expenditure','summary')),
  line_type         text not null check (line_type in (
                      'rent','arrears','other_income','management_fee','maintenance','other_deduction','credit')),
  property_address  text,
  tenant_name       text,
  period_start      date,
  period_end        date,
  transaction_date  date,
  description       text,
  gross_rent        numeric(12,2) not null default 0,
  fee_amount        numeric(12,2) not null default 0,
  vat_amount        numeric(12,2) not null default 0,
  deduction_amount  numeric(12,2) not null default 0,
  credit_amount     numeric(12,2) not null default 0,
  net_amount        numeric(12,2) not null default 0,
  fee_pct           numeric(6,2),
  fee_basis         numeric(12,2),
  review_status     text not null default 'imported' check (review_status in (
                      'imported','previously_imported_checked','correction_required','possible_duplicate','import_error','excluded')),
  flags             jsonb not null default '[]'::jsonb,
  error_reason      text,
  original_values   jsonb,
  line_key          text,
  raw_text          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists statement_audit_statements_series_idx
  on public.statement_audit_statements (user_id, series_key, statement_number);
create index if not exists statement_audit_lines_statement_idx
  on public.statement_audit_lines (statement_id, line_no);
create index if not exists statement_audit_lines_user_number_idx
  on public.statement_audit_lines (user_id, statement_number);

alter table public.statement_audit_series      enable row level security;
alter table public.statement_audit_statements  enable row level security;
alter table public.statement_audit_lines       enable row level security;

-- Supabase grants anon full DML on new public tables by default; nothing here
-- is public.
revoke all on public.statement_audit_series     from anon;
revoke all on public.statement_audit_statements from anon;
revoke all on public.statement_audit_lines      from anon;

-- Owner-only access. The audit is one person's working paper; it is not
-- shared through company or property access like the portfolio tables.
do $$
declare t text;
begin
  foreach t in array array['statement_audit_series','statement_audit_statements','statement_audit_lines'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

comment on table public.statement_audit_series is
  'Rental Statement Audit: one row per landlord company / agent statement run. Owner-only; not linked to portfolio tables.';
comment on table public.statement_audit_statements is
  'Rental Statement Audit: one row per statement number (placeholders for missing numbers have status not_uploaded). Owner-only; not linked to portfolio tables.';
comment on table public.statement_audit_lines is
  'Rental Statement Audit: one row per transaction on a statement, addresses and tenants exactly as printed. Owner-only; not linked to portfolio tables.';
