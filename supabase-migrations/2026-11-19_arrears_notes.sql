-- APPLIED 19 Nov 2026 to hqrhqbkqxzllmzhcofrh (Justin approved: "do all 1-6") via MCP apply_migration;
-- verified live: tables/columns present, RLS on, policies as below.
-- Rent step 5: versioned arrears notes and the month-end review queue
-- (rent brief C6). Each note is a version: editing writes a new row that
-- supersedes the previous one, so history is never lost. Insert and select
-- only; there is no update or delete from the client.
create table if not exists public.arrears_notes (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  tenancy_id      uuid references public.tenancies(id) on delete set null,
  period          text check (period is null or period ~ '^[0-9]{4}-[0-9]{2}$'),
  reason          text check (reason is null or char_length(reason) <= 2000),
  response        text check (response is null or char_length(response) <= 2000),
  payment_plan    text check (payment_plan is null or char_length(payment_plan) <= 1000),
  next_action     text check (next_action is null or char_length(next_action) <= 1000),
  follow_up_date  date,
  owner           text check (owner is null or char_length(owner) <= 120),
  status          text not null default 'open' check (status in ('open','needs_investigation','awaiting_review','resolved')),
  supersedes      uuid references public.arrears_notes(id) on delete set null,
  author          uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists arrears_notes_property_idx on public.arrears_notes (property_id, created_at desc);
alter table public.arrears_notes enable row level security;
create policy arrears_notes_select on public.arrears_notes for select to authenticated using (
  is_developer() or has_property_access(property_id));
create policy arrears_notes_insert on public.arrears_notes for insert to authenticated with check (
  author = (select auth.uid()) and has_rent_permission(property_id, 'write')
  and company_is_live((select p.company_id from public.properties p where p.id = arrears_notes.property_id)));
-- Rollback: drop table if exists public.arrears_notes;
