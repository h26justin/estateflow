-- AI usage ledger + per-user rate limiting for the Claude-powered edge
-- functions (14 Oct 2026).
--
-- Every AI edge function that runs on behalf of a user reserves a row here
-- before calling Claude (supabase-functions/_shared/anthropic.ts →
-- checkAiRateLimit) and fills in the model + token counts afterwards
-- (recordAiUsage). The reservation count over the last hour / day is the
-- per-user cost cap: extract-document, bookkeeping-ai, lettings-assistant,
-- epc-planner, rra-notice, ai-listing-writer and ingest-statement-email.
--
-- Access:
--   * RLS on. A signed-in user can SELECT their own rows only (so a future
--     usage widget can read them); nobody else sees them.
--   * No INSERT / UPDATE / DELETE policies, and the table privileges are
--     revoked from anon + authenticated: only the service role (edge
--     functions) writes. A client cannot reset its own counter.
--
-- Until this migration is applied the edge functions fail OPEN on the
-- missing table (logged), so deploying the functions first does not break
-- the AI features — but the caps are not enforced until it is applied.
--
-- Idempotent. ROLLBACK: DROP TABLE public.ai_usage;

create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  function_name  text not null,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

create index if not exists ai_usage_user_fn_created_idx
  on public.ai_usage (user_id, function_name, created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.ai_usage from anon;
revoke insert, update, delete, truncate on table public.ai_usage from authenticated;
grant select on table public.ai_usage to authenticated;
grant all on table public.ai_usage to service_role;
