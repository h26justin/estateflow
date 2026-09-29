-- ============================================================================
-- External loans: money lent INTO a company from outside the mortgage book
-- (private lender, director, family, bridging), with the monthly schedule
-- worked out in the app (src/lib/externalLoans.js) and each month ticked off
-- once it has been paid.
--
-- Rules:
--   • A tick (external_loan_payments row) RECORDS that a payment was made.
--     Nothing here moves money, talks to a bank or approves a payment.
--   • The schedule is derived from the loan's terms, not stored. A tick
--     keys on period number and stores the amount and date actually paid.
--   • Unticking soft-deletes the tick (deleted_at), so the history of who
--     ticked and unticked what is kept.
--   • One live tick per loan period.
--
-- Additive: two new tables, no change to existing tables or rows.
-- Needs has_company_access / has_company_write / company_is_live /
-- update_updated_at, all live in production (checked 2026-09-29).
-- ============================================================================

create table if not exists public.external_loans (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id        uuid references public.properties(id) on delete set null,
  lender_name        text not null check (char_length(trim(lender_name)) > 0),
  lender_type        text not null default 'private'
                       check (lender_type in ('private', 'director', 'family', 'bridging', 'bank', 'other')),
  reference          text,
  principal          numeric not null check (principal > 0),
  received_date      date not null,
  term_months        integer not null check (term_months between 1 and 600),
  annual_rate        numeric not null default 0 check (annual_rate >= 0 and annual_rate <= 100),
  repayment_type     text not null default 'repayment'
                       check (repayment_type in ('repayment', 'interest_only', 'rolled_up')),
  first_payment_date date,
  purpose            text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid,
  constraint external_loans_first_payment check (first_payment_date is null or first_payment_date >= received_date)
);

create table if not exists public.external_loan_payments (
  id          uuid primary key default gen_random_uuid(),
  loan_id     uuid not null references public.external_loans(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period      integer not null check (period >= 1),
  due_date    date,
  amount      numeric not null check (amount >= 0),
  paid_date   date not null default current_date,
  notes       text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid
);

create index if not exists idx_external_loans_company on public.external_loans(company_id) where deleted_at is null;
create index if not exists idx_external_loans_property on public.external_loans(property_id) where property_id is not null;
create index if not exists idx_external_loan_payments_loan on public.external_loan_payments(loan_id);
create unique index if not exists uq_external_loan_payments_period
  on public.external_loan_payments(loan_id, period) where deleted_at is null;

drop trigger if exists external_loans_updated_at on public.external_loans;
create trigger external_loans_updated_at before update on public.external_loans
  for each row execute function public.update_updated_at();

-- ── Row-level security ───────────────────────────────────────────────────
alter table public.external_loans enable row level security;
alter table public.external_loan_payments enable row level security;

drop policy if exists external_loans_select on public.external_loans;
create policy external_loans_select on public.external_loans for select
  using (public.is_developer() or user_id = auth.uid() or public.has_company_access(company_id));

-- A linked property must belong to the same company.
drop policy if exists external_loans_insert on public.external_loans;
create policy external_loans_insert on public.external_loans for insert
  with check (
    public.has_company_write(company_id) and public.company_is_live(company_id)
    and (property_id is null or exists (select 1 from public.properties p where p.id = property_id and p.company_id = external_loans.company_id))
  );

drop policy if exists external_loans_update on public.external_loans;
create policy external_loans_update on public.external_loans for update
  using (public.has_company_write(company_id))
  with check (
    public.has_company_write(company_id) and public.company_is_live(company_id)
    and (property_id is null or exists (select 1 from public.properties p where p.id = property_id and p.company_id = external_loans.company_id))
  );

-- Ticks follow their loan's company.
drop policy if exists external_loan_payments_select on public.external_loan_payments;
create policy external_loan_payments_select on public.external_loan_payments for select
  using (exists (select 1 from public.external_loans l where l.id = loan_id
                 and (public.is_developer() or l.user_id = auth.uid() or public.has_company_access(l.company_id))));

drop policy if exists external_loan_payments_insert on public.external_loan_payments;
create policy external_loan_payments_insert on public.external_loan_payments for insert
  with check (exists (select 1 from public.external_loans l where l.id = loan_id and l.deleted_at is null
                      and public.has_company_write(l.company_id) and public.company_is_live(l.company_id)));

drop policy if exists external_loan_payments_update on public.external_loan_payments;
create policy external_loan_payments_update on public.external_loan_payments for update
  using (exists (select 1 from public.external_loans l where l.id = loan_id and public.has_company_write(l.company_id)))
  with check (exists (select 1 from public.external_loans l where l.id = loan_id and public.has_company_write(l.company_id)));

-- No DELETE policies: deletes are soft (deleted_at) on both tables.
revoke all on public.external_loans from anon;
revoke all on public.external_loan_payments from anon;
grant select, insert, update on public.external_loans to authenticated;
grant select, insert, update on public.external_loan_payments to authenticated;
-- Supabase default privileges hand authenticated DELETE/TRUNCATE on new
-- tables; take them back so soft delete is the only way out.
revoke delete, truncate, references, trigger on public.external_loans from authenticated;
revoke delete, truncate, references, trigger on public.external_loan_payments from authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select relname, relrowsecurity from pg_class where relname in ('external_loans','external_loan_payments');
-- select tablename, policyname, cmd from pg_policies where tablename like 'external_loan%' order by 1, 3;
-- Applied to production 2026-09-29 (external_loans + external_loans_tighten_grants);
-- verified: RLS on, 6 policies, authenticated = INSERT,SELECT,UPDATE only, anon none.
