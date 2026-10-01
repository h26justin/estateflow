-- Agent weekly report schedules.
--
-- One row = one letting agent's weekly rent + lettings report, emailed as a
-- PDF by the agent-weekly-report edge function (pg_cron, Mondays 07:00 UK).
-- First row: Propertunity (Gareth), every property they manage in Justin's
-- portfolio; the RMS Blyth units drop out because RMS is their agent.
--
-- enabled defaults to false: a schedule only sends once its owner has seen a
-- preview and switched it on.

create table if not exists public.agent_report_schedules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  agent_id      uuid not null references public.estate_agents(id) on delete cascade,
  recipients    text[] not null default '{}',
  cc            text[] not null default '{}',
  weekday       smallint not null default 1 check (weekday between 0 and 6), -- 0 = Sunday, UK time
  send_hour     smallint not null default 7 check (send_hour between 0 and 23), -- UK time
  enabled       boolean not null default false,
  last_sent_at  timestamptz,
  last_status   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, agent_id)
);

alter table public.agent_report_schedules enable row level security;

-- Owner only. The edge function reads with the service role.
drop policy if exists agent_report_schedules_select on public.agent_report_schedules;
create policy agent_report_schedules_select on public.agent_report_schedules for select
  using (user_id = auth.uid());
drop policy if exists agent_report_schedules_insert on public.agent_report_schedules;
create policy agent_report_schedules_insert on public.agent_report_schedules for insert
  with check (user_id = auth.uid()
    and exists (select 1 from public.estate_agents a where a.id = agent_id and a.user_id = auth.uid()));
drop policy if exists agent_report_schedules_update on public.agent_report_schedules;
create policy agent_report_schedules_update on public.agent_report_schedules for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.estate_agents a where a.id = agent_id and a.user_id = auth.uid()));
drop policy if exists agent_report_schedules_delete on public.agent_report_schedules;
create policy agent_report_schedules_delete on public.agent_report_schedules for delete
  using (user_id = auth.uid());

revoke all on public.agent_report_schedules from anon;
grant select, insert, update, delete on public.agent_report_schedules to authenticated;
revoke truncate, references, trigger on public.agent_report_schedules from authenticated;

notify pgrst, 'reload schema';

-- Seed (run once, by hand, not part of the migration): Propertunity, off
-- until the preview is approved.
--   insert into public.agent_report_schedules (user_id, agent_id, recipients, cc)
--   select a.user_id, a.id, array['<agent email>'], array['<owner email>']
--   from public.estate_agents a where a.name = 'Propertunity' and a.user_id = '<owner uid>';
--
-- Cron (secret copied from the existing cron jobs, never written here):
--   select cron.schedule('agent-weekly-report', '0 * * * *', $$ select net.http_post(
--     url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/agent-weekly-report',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body := '{}'::jsonb, timeout_milliseconds := 60000) $$);
-- The function sends a schedule only when it is that schedule's weekday and
-- send hour in Europe/London and it has not already gone out today, so the
-- hourly UTC cron covers both GMT and BST.

-- Verification:
-- select relname, relrowsecurity from pg_class where relname = 'agent_report_schedules';
-- select policyname, cmd from pg_policies where tablename = 'agent_report_schedules' order by 2;
