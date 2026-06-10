-- Portfolio Autopilot — daily digest of prioritised, human-approved actions.
--
-- A daily cron (supabase-functions/portfolio-autopilot) scans each live
-- company's portfolio and writes candidate actions here. Every row is a
-- DRAFT — the landlord approves/dismisses from the Autopilot panel; nothing
-- is auto-sent or auto-executed.
--
-- Feature-flagged behind feature_flags key "portfolio_autopilot" (the
-- integrator owns the consolidated feature_flags seed migration — this file
-- does NOT seed the row).

create table if not exists public.autopilot_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  -- kind: 'arrears' | 'compliance' | 'tenancy_renewal' | 'mortgage' (text, not
  -- an enum, so new kinds need no schema migration)
  kind text not null,
  -- severity: 'high' | 'medium' | 'low' — drives panel grouping + ordering
  severity text not null default 'medium',
  title text not null,
  -- draft_body: the human-readable, AI-or-template drafted message/action.
  -- Always review-before-acting; never sent automatically.
  draft_body text,
  due_date date,
  -- status: 'open' (awaiting review) | 'acted' | 'dismissed'
  status text not null default 'open',
  -- dedupe_key: stable per (kind, property, window) so re-running the cron
  -- updates the existing open row rather than piling up duplicates.
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autopilot_actions_user_status_idx
  on public.autopilot_actions (user_id, status, created_at desc);

create index if not exists autopilot_actions_company_idx
  on public.autopilot_actions (company_id, status);

-- One open row per logical action. Lets the cron upsert on re-run.
create unique index if not exists autopilot_actions_open_dedupe_idx
  on public.autopilot_actions (user_id, dedupe_key)
  where status = 'open' and dedupe_key is not null;

alter table public.autopilot_actions enable row level security;

-- SELECT: developer, owning user, or anyone with company/property access.
drop policy if exists "autopilot_actions_select" on public.autopilot_actions;
create policy "autopilot_actions_select" on public.autopilot_actions
  for select using (
    is_developer()
    or user_id = auth.uid()
    or has_company_access(company_id)
    or (property_id is not null and has_property_access(property_id))
  );

-- UPDATE (approve/dismiss): only on live companies, by owner or a writer.
drop policy if exists "autopilot_actions_update" on public.autopilot_actions;
create policy "autopilot_actions_update" on public.autopilot_actions
  for update using (
    company_is_live(company_id)
    and (
      user_id = auth.uid()
      or has_company_access(company_id)
      or (property_id is not null and has_property_permission(property_id, 'write'))
    )
  );

-- DELETE: same gate as update (used for hard-dismiss).
drop policy if exists "autopilot_actions_delete" on public.autopilot_actions;
create policy "autopilot_actions_delete" on public.autopilot_actions
  for delete using (
    user_id = auth.uid()
    or has_company_access(company_id)
    or (property_id is not null and has_property_permission(property_id, 'write'))
  );

-- No INSERT policy for clients: rows are written exclusively by the cron via
-- the service role (which bypasses RLS). Landlords only read/approve/dismiss.

-- ── pg_cron schedule ─────────────────────────────────────────────────────────
-- Runs daily at ~07:30 UTC. The CRON_SECRET placeholder below MUST be replaced
-- with the real secret value (matching the Supabase `CRON_SECRET` function
-- secret) at apply time — pg_cron stores the command as static text, so it
-- can't read an env var. Idempotent: unschedule any prior job of the same name
-- first.
--
-- Requires the pg_cron + pg_net extensions (already enabled for the existing
-- compliance-reminders / trial-emails crons).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'portfolio-autopilot-daily') then
    perform cron.unschedule('portfolio-autopilot-daily');
  end if;
end $$;

select cron.schedule(
  'portfolio-autopilot-daily',
  '30 7 * * *',
  $cron$
  select net.http_post(
    url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/portfolio-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'REPLACE_WITH_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

notify pgrst, 'reload schema';
