-- trial_email_log — tracks which trial-onboarding emails have been sent
-- so the daily cron doesn't re-send. One row per (user_id, day_offset).
--
-- Idempotency contract: the `trial-emails` edge function upserts here
-- with ON CONFLICT(user_id,day_offset) so re-runs are safe.

CREATE TABLE IF NOT EXISTS public.trial_email_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_offset  INT  NOT NULL,
  template    TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day_offset)
);

CREATE INDEX IF NOT EXISTS trial_email_log_user_idx ON public.trial_email_log (user_id);

-- RLS: nobody reads this from the client. Service-role only.
ALTER TABLE public.trial_email_log ENABLE ROW LEVEL SECURITY;

-- Add an opt-out flag on user_profiles so users can unsubscribe.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.email_unsubscribed
  IS 'When true, trial-onboarding emails and marketing emails are suppressed. Transactional emails (billing, security) still send.';
