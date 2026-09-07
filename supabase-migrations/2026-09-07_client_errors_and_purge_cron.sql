-- ============================================================================
-- Client error telemetry + scheduled trash purge.
--
-- 1. public.client_errors: the browser's ErrorBoundary and window error
--    handlers (src/lib/errorReporter.js) insert one row per crash. Until now
--    a crash was visible only to the user who hit it. The nightly audit
--    reads the last 24h ("App errors (24h)"), and rows older than 30 days
--    are purged with the rest of the trash.
--    RLS: any signed-in user may insert a row about themselves; only
--    developers and platform admins may read. No update, no delete.
-- 2. purge_soft_deleted_older_than_30_days() has existed since the trash
--    feature but was never scheduled; the nightly audit has warned about
--    rows past the horizon. It now runs daily at 04:30 UTC and also clears
--    old client_errors.
--
-- Additive except for the purge schedule. Idempotent.
-- ============================================================================

create table if not exists public.client_errors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users(id) on delete set null,
  kind        text not null default 'error' check (kind in ('boundary','error','unhandledrejection')),
  message     text not null check (length(message) <= 2000),
  stack       text check (stack is null or length(stack) <= 8000),
  page        text check (page is null or length(page) <= 300),
  component   text check (component is null or length(component) <= 200),
  user_agent  text check (user_agent is null or length(user_agent) <= 400),
  build_id    text check (build_id is null or length(build_id) <= 40),
  created_at  timestamptz not null default now()
);
create index if not exists idx_client_errors_created on public.client_errors(created_at desc);

alter table public.client_errors enable row level security;
drop policy if exists client_errors_insert_own on public.client_errors;
drop policy if exists client_errors_select_admin on public.client_errors;
create policy client_errors_insert_own on public.client_errors for insert
  with check (auth.uid() is not null and user_id = auth.uid());
create policy client_errors_select_admin on public.client_errors for select
  using (is_developer() or is_platform_admin());

revoke all on public.client_errors from anon;
revoke all on public.client_errors from authenticated;
grant insert on public.client_errors to authenticated;
grant select on public.client_errors to authenticated;   -- row access still gated by the select policy

-- Purge: add client_errors retention, then schedule.
create or replace function public.purge_soft_deleted_older_than_30_days()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  delete from properties        where deleted_at < now() - interval '30 days';
  delete from companies         where deleted_at < now() - interval '30 days';
  delete from tenancy_details   where deleted_at < now() - interval '30 days';
  delete from compliance_items  where deleted_at < now() - interval '30 days';
  delete from maintenance_jobs  where deleted_at < now() - interval '30 days';
  delete from property_expenses where deleted_at < now() - interval '30 days';
  delete from deals             where deleted_at < now() - interval '30 days';
  delete from client_errors     where created_at < now() - interval '30 days';
end;
$$;
revoke all on function public.purge_soft_deleted_older_than_30_days() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-soft-deleted-daily') then
    perform cron.unschedule('purge-soft-deleted-daily');
  end if;
  perform cron.schedule('purge-soft-deleted-daily', '30 4 * * *', $cron$select public.purge_soft_deleted_older_than_30_days()$cron$);
end $$;

notify pgrst, 'reload schema';

-- Verification:
-- select policyname, cmd from pg_policies where tablename='client_errors';
-- select jobname, schedule, active from cron.job where jobname='purge-soft-deleted-daily';
