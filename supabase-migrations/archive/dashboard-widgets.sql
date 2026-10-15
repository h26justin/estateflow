-- Dashboard widget customization — stored on user_profiles as JSONB
-- Format: array of { key: string, enabled: boolean }
-- Order of array = display order

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB DEFAULT NULL;

-- Note: NULL = use default set. Only populated when user customizes.
