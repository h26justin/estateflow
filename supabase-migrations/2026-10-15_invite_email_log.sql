-- invite_email_log: one row per invitation email the send-invite edge
-- function sends (or is about to send). Backs the anti-relay caps (15 Oct 2026).
--
-- Why: anyone who signs up owns a company and can create invitations to any
-- address, with an attacker-chosen company name and inviter name in the
-- subject — i.e. a free spam / phishing relay on our sending domain. The
-- function now enforces, from this table:
--   * per sender:     8 emails / hour, 20 / day
--   * per recipient:  3 emails / day (across ALL senders)
--   * per invitation: re-sent at most once an hour
-- It reserves the row BEFORE calling Resend (so concurrent bursts are capped
-- too) and deletes it again if the send fails.
--
-- Access: RLS on, no policies, privileges revoked from anon + authenticated.
-- Only the service role (the edge function) reads or writes it.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying send-invite. The
-- function fails CLOSED (503, no email) if this table is missing — a missing
-- counter must not reopen the relay.
--
-- Idempotent. ROLLBACK: DROP TABLE public.invite_email_log;

create table if not exists public.invite_email_log (
  id               bigint generated always as identity primary key,
  sender_id        uuid not null references auth.users(id) on delete cascade,
  recipient_email  text not null,          -- lower(trim(email))
  invitation_ids   uuid[] not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists invite_email_log_sender_created_idx
  on public.invite_email_log (sender_id, created_at desc);
create index if not exists invite_email_log_recipient_created_idx
  on public.invite_email_log (recipient_email, created_at desc);
create index if not exists invite_email_log_invitation_ids_idx
  on public.invite_email_log using gin (invitation_ids);

alter table public.invite_email_log enable row level security;
revoke all on table public.invite_email_log from anon, authenticated;
grant all on table public.invite_email_log to service_role;

comment on table public.invite_email_log is
  'Invitation emails sent by the send-invite edge function; rate-limit ledger. Service role only.';

-- Verification:
--   select relrowsecurity from pg_class where oid = 'public.invite_email_log'::regclass;  -- t
--   select count(*) from pg_policies where tablename = 'invite_email_log';               -- 0
--   select has_table_privilege('authenticated', 'public.invite_email_log', 'select');    -- f
