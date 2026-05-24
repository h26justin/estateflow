-- account_type on user_profiles — does this user file taxes as a sole-trader
-- (individual) or via a limited company? Drives which features show up.
--
-- Specifically: MTD ITSA only applies to individuals (sole-trader landlords).
-- Limited company landlords file Corporation Tax (CT600) annually instead —
-- they don't need or want the MTD pages clogging their nav.
--
--   'individual'       — sole-trader; MTD ITSA mandate applies from Apr 2026
--   'limited_company'  — operates via SPV; files Corp Tax, not ITSA
--   'mixed'            — has both; show everything
--   NULL               — not yet specified; default to showing everything
--                        (so existing users don't lose features overnight)
--
-- Surfaced in:
--   1. OnboardingWizard — new users pick at signup
--   2. Settings → Account → Tax setup section — existing users can change
--   3. ALL_NAV filter — auto-hides MTD nav if 'limited_company'
--
-- Applied via Supabase MCP on 2026-05-24.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT
  CHECK (account_type IN ('individual','limited_company','mixed'));

COMMENT ON COLUMN public.user_profiles.account_type IS
  'individual = sole-trader (MTD ITSA applies) | limited_company = SPV (no MTD ITSA, files CT600) | mixed = both | NULL = unspecified';
