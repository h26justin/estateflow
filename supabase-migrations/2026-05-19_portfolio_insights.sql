-- AI-generated portfolio insights.
-- The portfolio-insights edge function reads the user's data, prompts Claude,
-- and writes the structured response here. The dashboard widget reads the
-- latest row for the user. We cache to keep the experience snappy and to
-- avoid burning tokens on every page load.

create table if not exists public.portfolio_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- insights: array of { category, severity, title, body, action_label, action_link }
  insights jsonb not null default '[]'::jsonb,
  -- summary stats captured at generation time so we can show what changed
  -- (e.g. "yield 5.1% (down from 5.4% last month)")
  stats jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  -- Token usage so we can monitor cost over time.
  tokens_input integer,
  tokens_output integer
);

create index if not exists portfolio_insights_user_id_generated_idx
  on public.portfolio_insights (user_id, generated_at desc);

alter table public.portfolio_insights enable row level security;

drop policy if exists "portfolio_insights_select_own" on public.portfolio_insights;
create policy "portfolio_insights_select_own" on public.portfolio_insights
  for select using (auth.uid() = user_id);

-- Inserts are done server-side via service role; no client-side insert
-- policy needed. The client-side regenerate flow calls the edge function
-- which writes with service role.

drop policy if exists "portfolio_insights_delete_own" on public.portfolio_insights;
create policy "portfolio_insights_delete_own" on public.portfolio_insights
  for delete using (auth.uid() = user_id);
