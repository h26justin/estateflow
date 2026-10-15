-- weekly_summary_log: one row per user per week the weekly-summary edge
-- function has sent (or is sending) the Monday portfolio summary email.
--
-- Idempotency contract: the function INSERTs (user_id, week_start) before it
-- sends; a duplicate-key error means the week is already done, so overlapping
-- or repeated cron runs never send twice. If the send fails the function
-- deletes its row so the next hourly run retries.
--
-- week_start is the Monday (Europe/London) of the week the email covers.
--
-- RLS on, no policies: nobody reads or writes this from the client. The edge
-- function uses the service role.

create table if not exists public.weekly_summary_log (
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null,
  sent_at     timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_summary_log enable row level security;
revoke all on public.weekly_summary_log from anon, authenticated;

comment on table public.weekly_summary_log is
  'Weekly portfolio summary emails sent, one row per user per week (Monday, UK). Service role only; written by the weekly-summary edge function.';

-- Cron (NOT scheduled by this migration). Copy the secret from the existing
-- cron jobs; never write it here. Hourly, so the Monday 07:00 Europe/London
-- send hour is hit in both GMT and BST and any batch left over is picked up
-- by the next run:
--
--   select cron.schedule('weekly-summary', '5 * * * *', $$ select net.http_post(
--     url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/weekly-summary',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body := '{}'::jsonb, timeout_milliseconds := 120000) $$);
--
-- Verification:
--   select relname, relrowsecurity from pg_class where relname = 'weekly_summary_log';  -- t
--   select count(*) from pg_policies where tablename = 'weekly_summary_log';           -- 0
--
-- Rollback: select cron.unschedule('weekly-summary'); drop table public.weekly_summary_log;
