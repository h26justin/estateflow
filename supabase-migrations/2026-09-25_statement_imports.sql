-- ============================================================================
-- Statement import audit trail (Properly updates brief, part 1, 25 Sep 2026).
--
-- One row per approved managing-agent statement import. It keeps, for the
-- record: the statement (agent, number / reference, date, period, landlord as
-- printed), a content fingerprint used to warn on a second upload, the
-- original PDF (company_documents for a manual upload, property_documents for
-- an emailed one), the header totals and balance check, and EVERY line: what
-- was read, what Properly suggested, what the person corrected, the status,
-- and what was written. The money itself lives where it always has
-- (rent_receipts / rent_allocations / rent_payments / property_expenses), all
-- tagged with import_batch_id so the batch can be reverted as a whole.
--
-- Append-only: no update or delete policy. Additive; nothing existing changes.
-- ============================================================================

create table if not exists public.statement_imports (
  id                    uuid primary key default gen_random_uuid(),
  import_batch_id       uuid references public.import_batches(id) on delete set null,
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id            uuid references public.companies(id) on delete set null,
  agent                 text,
  statement_ref         text,
  statement_date        date,
  period_start          date,
  period_end            date,
  landlord_on_statement text,
  fingerprint           text,
  filename              text,
  company_document_id   uuid references public.company_documents(id) on delete set null,
  property_document_id  uuid references public.property_documents(id) on delete set null,
  header                jsonb,
  balance               jsonb,
  lines                 jsonb not null default '[]'::jsonb,
  summary               jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists idx_statement_imports_ref on public.statement_imports (company_id, agent, statement_ref);
create index if not exists idx_statement_imports_fingerprint on public.statement_imports (fingerprint);
create index if not exists idx_statement_imports_batch on public.statement_imports (import_batch_id);

alter table public.statement_imports enable row level security;

drop policy if exists statement_imports_select on public.statement_imports;
create policy statement_imports_select on public.statement_imports for select
  using (public.is_developer() or user_id = auth.uid() or (company_id is not null and public.has_company_access(company_id)));

drop policy if exists statement_imports_insert on public.statement_imports;
create policy statement_imports_insert on public.statement_imports for insert
  with check (user_id = auth.uid() and (company_id is null or public.has_company_access(company_id)));

revoke all on public.statement_imports from anon;
grant select, insert on public.statement_imports to authenticated;

notify pgrst, 'reload schema';

-- Verification:
-- select relrowsecurity from pg_class where relname = 'statement_imports';
-- select policyname, cmd from pg_policies where tablename = 'statement_imports';
