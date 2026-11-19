-- Deals transformation, migrations 1 to 3 (DEALS_TRANSFORMATION_PLAN.md).
-- NOT YET APPLIED. A production change on hqrhqbkqxzllmzhcofrh: apply only
-- with Justin's explicit go-ahead, via MCP apply_migration named
-- `deal_stage_events_attention`. Additive and reversible (rollback at the end).
--
-- 1. deal_stage_events: an immutable history of stage changes, written by a
--    trigger so no screen can forget to log. There are no UPDATE or DELETE
--    policies, so the history cannot be rewritten from the client.
-- 2. Attention status, kept separate from the stage (a solicitor delay never
--    moves a deal backwards), plus an owner and due date for the next action.
-- 3. Post-completion stages (refurbishment, ready_to_let, let) need no DDL:
--    deals.status has no check constraint. Only the app's stage list changes.

begin;

create table if not exists public.deal_stage_events (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  old_status  text,
  new_status  text not null,
  comment     text check (comment is null or char_length(comment) <= 1000),
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);
create index if not exists deal_stage_events_deal_idx on public.deal_stage_events (deal_id, changed_at desc);

alter table public.deal_stage_events enable row level security;

-- Same visibility as deal_milestones: the deal's owner, company members, and
-- platform admins.
create policy deal_stage_events_select on public.deal_stage_events for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_stage_events.deal_id and (
    d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_access(d.company_id)) or public.is_platform_admin())));
-- Insert allowed for the comment-bearing path; the trigger covers the rest.
create policy deal_stage_events_insert on public.deal_stage_events for insert to authenticated with check (
  changed_by = (select auth.uid()) and
  exists (select 1 from public.deals d where d.id = deal_stage_events.deal_id and (
    d.user_id = (select auth.uid()) or (d.company_id is not null and public.has_company_write(d.company_id)) or public.is_platform_admin())));

create or replace function public.log_deal_stage_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.deal_stage_events (deal_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.log_deal_stage_change() from public, anon, authenticated;

drop trigger if exists deals_stage_change_log on public.deals;
create trigger deals_stage_change_log after update of status on public.deals
  for each row execute function public.log_deal_stage_change();

alter table public.deals
  add column if not exists attention_status text,
  add column if not exists next_action_owner text,
  add column if not exists next_action_due date;
alter table public.deals drop constraint if exists deals_attention_status_check;
alter table public.deals add constraint deals_attention_status_check check (
  attention_status is null or attention_status in ('on_track','awaiting_response','blocked','at_risk','overdue','on_hold'));
alter table public.deals drop constraint if exists deals_next_action_owner_len;
alter table public.deals add constraint deals_next_action_owner_len check (next_action_owner is null or char_length(next_action_owner) <= 120);

commit;

-- Rollback (additive only; no existing data changes):
-- drop trigger if exists deals_stage_change_log on public.deals;
-- drop function if exists public.log_deal_stage_change();
-- drop table if exists public.deal_stage_events;
-- alter table public.deals drop constraint if exists deals_attention_status_check,
--   drop constraint if exists deals_next_action_owner_len,
--   drop column if exists attention_status, drop column if exists next_action_owner,
--   drop column if exists next_action_due;
