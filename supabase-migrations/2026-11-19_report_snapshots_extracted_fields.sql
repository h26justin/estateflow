-- APPLIED 19 Nov 2026 to hqrhqbkqxzllmzhcofrh (Justin approved: "do all 1-6") via MCP apply_migration;
-- verified live: tables/columns present, RLS on, policies as below.
-- Step 6: frozen month-end report snapshots (rent brief C7) and the assisted
-- extraction approval queue (Deals brief §9).
--
-- report_snapshots: the figures as issued, frozen. A later correction is a new
-- snapshot that supersedes the old one (a dated restatement), never an edit.
create table if not exists public.report_snapshots (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete cascade,
  agent_id        uuid references public.estate_agents(id) on delete set null,
  kind            text not null check (kind in ('agent_rent_report','month_end_rent','deals')),
  as_of           date not null,
  period          text check (period is null or period ~ '^[0-9]{4}-[0-9]{2}$'),
  formula_version text not null,
  summary         jsonb not null,
  lines           jsonb,
  supersedes      uuid references public.report_snapshots(id) on delete set null,
  note            text check (note is null or char_length(note) <= 1000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists report_snapshots_idx on public.report_snapshots (kind, as_of desc);
alter table public.report_snapshots enable row level security;
-- Visible to the creator and to members of the company it covers.
create policy report_snapshots_select on public.report_snapshots for select to authenticated using (
  is_developer() or created_by = (select auth.uid()) or (company_id is not null and has_company_access(company_id)));
create policy report_snapshots_insert on public.report_snapshots for insert to authenticated with check (
  created_by = (select auth.uid()) and (company_id is null or has_company_write(company_id)));

-- extracted_fields: values suggested from an uploaded document, waiting for a
-- person to approve or reject. Approving writes a source-linked value
-- elsewhere (a deal_cost_lines row); the suggestion row records who decided.
create table if not exists public.extracted_fields (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals(id) on delete cascade,
  document_id   uuid references public.deal_documents(id) on delete set null,
  field         text not null check (char_length(field) <= 80),
  value_number  numeric(14,2),
  value_text    text check (value_text is null or char_length(value_text) <= 500),
  page          integer,
  quote         text check (quote is null or char_length(quote) <= 1000),
  confidence    numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  applied_to    text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists extracted_fields_deal_idx on public.extracted_fields (deal_id, status);
alter table public.extracted_fields enable row level security;
create policy extracted_fields_select on public.extracted_fields for select to authenticated using (
  exists (select 1 from public.deals d where d.id = extracted_fields.deal_id and (
    d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_access(d.company_id)) or public.is_platform_admin())));
create policy extracted_fields_insert on public.extracted_fields for insert to authenticated with check (
  exists (select 1 from public.deals d where d.id = extracted_fields.deal_id and (
    d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())));
-- Review: only pending rows can be decided, by someone with write access.
create policy extracted_fields_update on public.extracted_fields for update to authenticated using (
  status = 'pending' and exists (select 1 from public.deals d where d.id = extracted_fields.deal_id and (
    d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())))
  with check (reviewed_by = (select auth.uid()));
-- Rollback: drop table if exists public.extracted_fields; drop table if exists public.report_snapshots;
