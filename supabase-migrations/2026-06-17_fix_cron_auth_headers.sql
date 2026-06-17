-- =============================================================================
-- Fix stale cron auth headers (backups + compliance + xero)
-- =============================================================================
-- Root cause: the 2026-05-19 / 2026-06-10 security hardening switched several
-- edge functions to a fail-closed cron-auth model (shared CRON_SECRET, or a
-- service-role-key match for create-user-backups), but the pg_cron job
-- definitions were never updated to send a matching header. They still send
-- the old `Authorization: Bearer <key>` only, so the functions reject them:
--   • weekly-user-backups     → service-role compare fails  → no backup since 18 May
--   • daily-compliance-reminders → wants x-cron-secret       → 403 (reminders not sending)
--   • xero-daily-reconciliation  → wrong secret value        → 401
-- (trial-emails-daily already sends the correct `x-cron-secret` and works — we
--  reuse that proven-good secret here so the value never needs hardcoding.)
--
-- create-user-backups was redeployed to accept `x-cron-secret` (preferred) in
-- addition to the legacy service-role bearer, and to emit CORS headers so the
-- browser "Create backup now" button stops failing with "Failed to fetch".
--
-- Also bumps net.http_post timeout to 60s: these functions take 11-17s, but
-- pg_net's 5s default disconnects early, so the cron can never observe the
-- real outcome (the function finishes server-side regardless).
-- =============================================================================

DO $$
DECLARE
  v_secret text;
  v_base   text := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1';
BEGIN
  -- Reuse the CRON_SECRET already embedded in the one cron that works, so the
  -- literal value is never written into this migration or echoed anywhere.
  SELECT (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    INTO v_secret
  FROM cron.job
  WHERE jobname = 'trial-emails-daily';

  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE EXCEPTION 'Could not read CRON_SECRET from trial-emails-daily cron; aborting (no jobs changed)';
  END IF;

  -- 1. Weekly user backups — function now accepts x-cron-secret (Mondays 03:00 UTC)
  PERFORM cron.schedule(
    'weekly-user-backups',
    '0 3 * * 1',
    format($f$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $f$, v_base || '/create-user-backups', v_secret)
  );

  -- 2. Daily compliance reminders — function reads x-cron-secret (08:00 UTC)
  PERFORM cron.schedule(
    'daily-compliance-reminders',
    '0 8 * * *',
    format($f$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $f$, v_base || '/compliance-reminders', v_secret)
  );

  -- 3. Xero daily reconcile — function checks Authorization: Bearer <CRON_SECRET> (06:00 UTC)
  PERFORM cron.schedule(
    'xero-daily-reconciliation',
    '0 6 * * *',
    format($f$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L
        ),
        timeout_milliseconds := 60000
      );
    $f$, v_base || '/xero-cron-reconcile', v_secret)
  );
END $$;

-- Verify (run after): all four cron jobs should be active and the three fixed
-- ones should now carry the x-cron-secret / correct bearer header.
--   SELECT jobname, active FROM cron.job ORDER BY jobid;
-- After the next scheduled run, confirm delivery:
--   SELECT id, status_code, error_msg, created FROM net._http_response ORDER BY created DESC LIMIT 10;
