-- =============================================================================
-- OwnProperly: Compliance Reminder System
-- =============================================================================
-- Run in Supabase > SQL Editor

-- Track when we last sent a reminder for each compliance item, so we don't spam
ALTER TABLE compliance_items
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_compliance_expiry_reminder
  ON compliance_items(expiry_date, last_reminder_sent_at)
  WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

-- Ensure user_profiles has notifications JSONB column with compliance_expiry default
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notifications JSONB DEFAULT '{"rent_arrears": true, "lease_expiry": true, "compliance_expiry": true}';

-- =============================================================================
-- After running, deploy the compliance-reminders Edge Function via Supabase dashboard.
-- Then schedule it daily by running the snippet below AFTER the function is deployed.
-- Replace YOUR_SERVICE_ROLE_KEY with your actual service role key from Project Settings > API.
-- =============================================================================

-- Uncomment and edit to schedule daily:
--
-- SELECT cron.schedule(
--   'daily-compliance-reminders',
--   '0 8 * * *',  -- 08:00 UTC every day (09:00 UK during BST, 08:00 in GMT)
--   $cron$
--     SELECT net.http_post(
--       url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/compliance-reminders',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--       ),
--       body := jsonb_build_object('trigger', 'daily_cron')
--     );
--   $cron$
-- );

-- To verify scheduled: SELECT jobname, schedule FROM cron.job;
-- To unschedule:      SELECT cron.unschedule('daily-compliance-reminders');
