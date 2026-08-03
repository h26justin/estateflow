-- ===========================================================================
-- Add user_profiles.yield_basis — column referenced by the app but never
-- created by any migration
-- ===========================================================================
-- App.jsx selects `yield_basis` in its one-shot profile read on every boot:
--   .select('is_developer, platform_admin, nav_items, yield_basis, account_type')
-- Because the column does not exist, that select 400s for EVERY signed-in
-- user, the profile row comes back null, and is_developer / platform_admin /
-- nav_items / account_type prefs are silently lost each session. The yield
-- settings toggle (FeatureComponents.jsx) also writes this column and fails.
--
-- Values written by the UI are 'cost' | 'value'. Left unconstrained to match
-- the style of the other pref columns (e.g. account_type).
--
-- Idempotent. ROLLBACK: ALTER TABLE public.user_profiles DROP COLUMN yield_basis;
-- ===========================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS yield_basis text;
