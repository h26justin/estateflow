-- Lodgify sync: once daily (05:30 UTC) → three times daily.
--
-- 04:00 / 12:00 / 18:00 UTC = 5am / 1pm / 7pm UK during BST (an hour
-- earlier in winter — immaterial for booking syncs). alter_job keeps the
-- existing command (and the embedded cron secret) untouched; only the
-- schedule changes.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'lodgify-daily-sync'),
  schedule => '0 4,12,18 * * *'
);

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'lodgify-daily-sync';
