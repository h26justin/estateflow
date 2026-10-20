-- =============================================================================
-- Daily Stripe subscription quantity sync
-- =============================================================================
-- Schedules the sync-subscription-quantity edge function (02:15 UTC daily).
-- Before this, a subscription's quantity was set once at checkout and never
-- updated, so billing didn't follow the portfolio as properties were added or
-- removed. See supabase-functions/sync-subscription-quantity/index.ts.
--
-- Applied to production 2026-10-20 (migration name
-- subscription_quantity_sync_cron), after a dry run and one manual run.
-- Reuses the CRON_SECRET embedded in trial-emails-daily (same approach as
-- 2026-06-17_fix_cron_auth_headers.sql) so the value never appears here.
-- =============================================================================

DO $$
DECLARE
  v_secret text;
  v_base   text := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1';
BEGIN
  SELECT (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    INTO v_secret
  FROM cron.job
  WHERE jobname = 'trial-emails-daily';

  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE EXCEPTION 'Could not read CRON_SECRET from trial-emails-daily cron; aborting';
  END IF;

  PERFORM cron.schedule(
    'daily-subscription-quantity-sync',
    '15 2 * * *',
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
    $f$, v_base || '/sync-subscription-quantity', v_secret)
  );
END $$;
