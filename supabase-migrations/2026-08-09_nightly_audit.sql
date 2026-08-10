-- Nightly audit: DB-side check function + run history table + cron job.
--
-- The nightly-audit edge function calls public.nightly_audit_checks() with the
-- service role to gather every SQL-side health signal in one round trip, adds
-- its own HTTP/Stripe/canary probes, stores the digest in nightly_audit_runs,
-- and emails the report. Scheduled 05:15 UTC daily (clear of every other job:
-- lodgify 04/12/18h, xero 06h, autopilot 07:30, compliance 08h, trials 09:30,
-- backups Mon 03h, hmrc */28d 04h, epc monthly 05:30 on the 2nd).
--
-- Verify after applying:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobid;
--   SELECT public.nightly_audit_checks();   -- as service role only

-- ── Run history ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nightly_audit_runs (
  id         bigserial PRIMARY KEY,
  ran_at     timestamptz NOT NULL DEFAULT now(),
  overall    text        NOT NULL,             -- GREEN | AMBER | RED
  report     text        NOT NULL,             -- the human digest as sent
  results    jsonb       NOT NULL              -- every check with status+detail
);
ALTER TABLE public.nightly_audit_runs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.nightly_audit_runs IS
  'Nightly audit digests. Service-role only: RLS enabled with no client policies by design (deny-all for anon/authenticated). Written by the nightly-audit edge function.';

-- ── DB-side checks ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nightly_audit_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  checks   jsonb := '[]'::jsonb;
  meta     jsonb := '{}'::jsonb;
  n        bigint; n2 bigint; n3 bigint; n4 bigint;
  t        timestamptz;
  names    text;
  names2   text;
BEGIN
  ------------------------------------------------------------------
  -- Cron health: failures, stale daily jobs, placeholder secrets
  SELECT count(*) INTO n
  FROM cron.job_run_details d
  WHERE d.start_time > now() - interval '25 hours' AND d.status <> 'succeeded';

  SELECT count(*), string_agg(j.jobname, ', ') INTO n2, names
  FROM cron.job j
  WHERE j.active
    AND j.schedule ~ '^\S+\s+\S+\s+\*\s+\*\s+\*$'   -- runs at least daily
    AND j.jobname <> 'nightly-audit-daily'          -- can't self-report being dead: no run = no email
    AND NOT EXISTS (
      SELECT 1 FROM cron.job_run_details d
      WHERE d.jobid = j.jobid AND d.start_time > now() - interval '26 hours');

  SELECT count(*), string_agg(j.jobname, ', ') INTO n3, names2
  FROM cron.job j WHERE j.command LIKE '%REPLACE_WITH%';

  SELECT count(*) INTO n4 FROM cron.job WHERE active;

  checks := checks || jsonb_build_object(
    'name', 'cron', 'group', 'platform', 'label', 'Cron',
    'status', CASE WHEN n2 > 0 OR n3 > 0 THEN 'fail' WHEN n > 0 THEN 'warn' ELSE 'ok' END,
    'detail', n4 || ' active · ' || n || ' failed (25h) · ' || n2 || ' stale daily'
              || COALESCE(' (' || names || ')', '')
              || CASE WHEN n3 > 0 THEN ' · PLACEHOLDER SECRET: ' || names2 ELSE '' END);

  ------------------------------------------------------------------
  -- pg_net outbound calls (short retention — best-effort window)
  SELECT count(*) FILTER (WHERE COALESCE(error_msg, '') ILIKE '%timeout%'),
         count(*) FILTER (WHERE status_code >= 400
                             OR (error_msg IS NOT NULL AND error_msg NOT ILIKE '%timeout%'))
    INTO n, n2
  FROM net._http_response WHERE created > now() - interval '25 hours';

  checks := checks || jsonb_build_object(
    'name', 'http_calls', 'group', 'platform', 'label', 'Cron HTTP',
    'status', CASE WHEN n2 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', n2 || ' failures' || CASE WHEN n > 0 THEN ' (' || n || ' timeout(s) ignored)' ELSE '' END);

  ------------------------------------------------------------------
  -- Signups + orphan users (auth row with no landlord or tenant profile)
  SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours'),
         count(*) FILTER (WHERE created_at > now() - interval '7 days')
    INTO n, n2
  FROM auth.users WHERE email NOT LIKE 'audit-canary%';

  checks := checks || jsonb_build_object(
    'name', 'signups', 'group', 'users', 'label', 'Signups',
    'status', 'ok', 'detail', n || ' new 24h · ' || n2 || ' in 7d');

  SELECT count(*), string_agg(left(u.email, 60), ', ') INTO n3, names
  FROM auth.users u
  WHERE u.created_at < now() - interval '1 hour'
    AND u.email NOT LIKE 'audit-canary%'
    AND NOT EXISTS (SELECT 1 FROM public.user_profiles p  WHERE p.user_id  = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.tenant_profiles tp WHERE tp.user_id = u.id);

  checks := checks || jsonb_build_object(
    'name', 'orphan_users', 'group', 'users', 'label', 'Profiles',
    'status', CASE WHEN n3 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', CASE WHEN n3 > 0
      THEN n3 || ' auth user(s) without any profile: ' || names
      ELSE 'every auth user has a profile' END);

  ------------------------------------------------------------------
  -- Trials (companies.trial_ends_at is the gate; >32d = self-grant breach)
  SELECT count(*) FILTER (WHERE trial_ends_at > now()),
         count(*) FILTER (WHERE trial_ends_at BETWEEN now() AND now() + interval '3 days'),
         count(*) FILTER (WHERE trial_ends_at > now() + interval '32 days')
    INTO n, n2, n3
  FROM public.companies WHERE deleted_at IS NULL;

  checks := checks || jsonb_build_object(
    'name', 'trials', 'group', 'money', 'label', 'Trials',
    'status', CASE WHEN n3 > 0 THEN 'fail' ELSE 'ok' END,
    'detail', n || ' in trial · ' || n2 || ' expiring ≤3d'
              || CASE WHEN n3 > 0 THEN ' · ' || n3 || ' BEYOND 32d CAP (self-grant guard breached?)' ELSE '' END);

  ------------------------------------------------------------------
  -- Subscriptions (DB view of Stripe state)
  SELECT count(*) FILTER (WHERE status IN ('active', 'trialing')),
         count(*) FILTER (WHERE status = 'past_due'),
         count(*) FILTER (WHERE status = 'active' AND current_period_end < now() - interval '2 days')
    INTO n, n2, n3
  FROM public.subscriptions;

  checks := checks || jsonb_build_object(
    'name', 'subscriptions', 'group', 'money', 'label', 'Subscriptions',
    'status', CASE WHEN n2 > 0 OR n3 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', n || ' active/trialing · ' || n2 || ' past_due · ' || n3 || ' period-lapsed-but-active');

  ------------------------------------------------------------------
  -- Stripe webhook liveness (DB side: are events still arriving?)
  SELECT max(received_at),
         count(*) FILTER (WHERE received_at > now() - interval '24 hours')
    INTO t, n
  FROM public.stripe_events;

  SELECT count(*) INTO n2 FROM public.subscriptions WHERE status IN ('active', 'trialing');

  checks := checks || jsonb_build_object(
    'name', 'stripe_events', 'group', 'money', 'label', 'Stripe events',
    'status', CASE WHEN n2 > 0 AND (t IS NULL OR t < now() - interval '35 days') THEN 'warn' ELSE 'ok' END,
    'detail', n || ' received 24h · last ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 86400)::text || 'd ago', 'never')
              || ' (monthly billing ⇒ expect ≥1 per cycle)');

  ------------------------------------------------------------------
  -- Trial onboarding emails
  SELECT max(sent_at), count(*) FILTER (WHERE sent_at > now() - interval '24 hours')
    INTO t, n FROM public.trial_email_log;

  checks := checks || jsonb_build_object(
    'name', 'trial_emails', 'group', 'users', 'label', 'Trial emails',
    'status', 'ok',
    'detail', n || ' sent 24h · last ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 86400)::text || 'd ago', 'never'));

  ------------------------------------------------------------------
  -- Compliance reminders: items sitting in their reminder window ≥2 days
  -- with no reminder ever sent means the daily job is skipping them.
  SELECT count(*) INTO n
  FROM public.compliance_items ci
  WHERE ci.deleted_at IS NULL
    AND ci.expiry_date IS NOT NULL
    AND ci.expiry_date >= current_date
    AND (ci.expiry_date - COALESCE(ci.reminder_days, 30)) <= current_date - 2
    AND ci.last_reminder_sent_at IS NULL;

  checks := checks || jsonb_build_object(
    'name', 'compliance_reminders', 'group', 'syncs', 'label', 'Compliance reminders',
    'status', CASE WHEN n > 0 THEN 'warn' ELSE 'ok' END,
    'detail', n || ' item(s) stuck in reminder window unreminded');

  ------------------------------------------------------------------
  -- Autopilot freshness + backlog
  SELECT max(updated_at), count(*) FILTER (WHERE status = 'open')
    INTO t, n FROM public.autopilot_actions;

  checks := checks || jsonb_build_object(
    'name', 'autopilot', 'group', 'syncs', 'label', 'Autopilot',
    'status', CASE WHEN t IS NULL OR t < now() - interval '26 hours' THEN 'warn' ELSE 'ok' END,
    'detail', 'last activity ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 3600)::text || 'h ago', 'never')
              || ' · ' || n || ' open actions');

  ------------------------------------------------------------------
  -- Lodgify STL sync freshness
  SELECT count(*) FILTER (WHERE status = 'active'),
         count(*) FILTER (WHERE status = 'active'
                            AND (last_sync_status = 'error'
                                 OR last_synced_at IS NULL
                                 OR last_synced_at < now() - interval '26 hours')),
         max(last_synced_at)
    INTO n, n2, t
  FROM public.lodgify_connections;

  checks := checks || jsonb_build_object(
    'name', 'lodgify', 'group', 'syncs', 'label', 'Lodgify STL',
    'status', CASE WHEN n2 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', n || ' active connection(s) · ' || n2 || ' stale/errored · last sync ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 3600)::text || 'h ago', 'never'));

  ------------------------------------------------------------------
  -- Xero: enabled cron schedules ran; webhook flags drained
  SELECT count(*) INTO n
  FROM public.xero_cron_schedules
  WHERE last_run_at IS NULL OR last_run_at < now() - interval '26 hours';

  SELECT count(*) INTO n2
  FROM public.xero_connections
  WHERE pending_sync_at IS NOT NULL AND pending_sync_at < now() - interval '24 hours';

  SELECT count(*) INTO n3 FROM public.xero_cron_schedules;

  checks := checks || jsonb_build_object(
    'name', 'xero', 'group', 'syncs', 'label', 'Xero',
    'status', CASE WHEN n > 0 OR n2 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', CASE WHEN n3 = 0 THEN 'no cron schedules enabled'
                   ELSE n3 || ' schedule(s) · ' || n || ' stale' END
              || ' · ' || n2 || ' undrained webhook flag(s)');

  ------------------------------------------------------------------
  -- EPC register sync (monthly job — 35-day staleness horizon)
  SELECT max(epc_last_checked_at), count(*) FILTER (WHERE epc_sync_status = 'error')
    INTO t, n
  FROM public.properties WHERE deleted_at IS NULL;

  checks := checks || jsonb_build_object(
    'name', 'epc', 'group', 'syncs', 'label', 'EPC register',
    'status', CASE WHEN n > 0 OR t IS NULL OR t < now() - interval '35 days' THEN 'warn' ELSE 'ok' END,
    'detail', 'last checked ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 86400)::text || 'd ago', 'never')
              || ' · ' || n || ' sync error(s)');

  ------------------------------------------------------------------
  -- Weekly user backups (Mon 03:00 — 8-day horizon)
  SELECT max(created_at) INTO t FROM public.user_backups;

  checks := checks || jsonb_build_object(
    'name', 'backups', 'group', 'syncs', 'label', 'User backups',
    'status', CASE WHEN t IS NULL OR t < now() - interval '8 days' THEN 'warn' ELSE 'ok' END,
    'detail', 'last backup ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 86400)::text || 'd ago', 'never'));

  ------------------------------------------------------------------
  -- RLS coverage: every public table must have RLS enabled
  SELECT count(*), string_agg(tablename, ', ') INTO n, names
  FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;

  checks := checks || jsonb_build_object(
    'name', 'rls', 'group', 'security', 'label', 'RLS coverage',
    'status', CASE WHEN n > 0 THEN 'fail' ELSE 'ok' END,
    'detail', CASE WHEN n > 0 THEN n || ' table(s) WITHOUT RLS: ' || names
                   ELSE 'all public tables enabled' END);

  ------------------------------------------------------------------
  -- SECURITY DEFINER functions must pin search_path (the pgcrypto lesson)
  SELECT count(*), string_agg(p.proname, ', ') INTO n, names
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
                    WHERE c LIKE 'search_path=%');

  checks := checks || jsonb_build_object(
    'name', 'definers', 'group', 'security', 'label', 'SECURITY DEFINER',
    'status', CASE WHEN n > 0 THEN 'fail' ELSE 'ok' END,
    'detail', CASE WHEN n > 0 THEN n || ' function(s) without pinned search_path: ' || names
                   ELSE 'all functions pin search_path' END);

  ------------------------------------------------------------------
  -- Soft-delete purge horizon (30-day retention promise; purge cron unscheduled)
  SELECT (SELECT count(*) FROM public.companies  WHERE deleted_at < now() - interval '31 days'),
         (SELECT count(*) FROM public.properties WHERE deleted_at < now() - interval '31 days')
    INTO n, n2;

  checks := checks || jsonb_build_object(
    'name', 'purge', 'group', 'security', 'label', 'Soft-delete purge',
    'status', CASE WHEN n + n2 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', (n + n2) || ' row(s) past the 31-day purge horizon');

  ------------------------------------------------------------------
  -- Invitations hygiene
  SELECT count(*) FILTER (WHERE NOT accepted AND expires_at > now()),
         count(*) FILTER (WHERE NOT accepted AND expires_at <= now())
    INTO n, n2
  FROM public.invitations;

  checks := checks || jsonb_build_object(
    'name', 'invites', 'group', 'users', 'label', 'Invites',
    'status', 'ok', 'detail', n || ' pending · ' || n2 || ' expired unaccepted');

  ------------------------------------------------------------------
  -- Meta for the edge function's own probes
  SELECT COALESCE(jsonb_agg(subdomain ORDER BY subdomain), '[]'::jsonb) INTO meta
  FROM public.companies WHERE subdomain IS NOT NULL AND deleted_at IS NULL;

  RETURN jsonb_build_object('checks', checks, 'subdomains', meta, 'generated_at', now());
END;
$fn$;

-- Service-role only. Explicit revokes: Supabase default privileges would
-- otherwise grant EXECUTE to anon/authenticated on creation.
REVOKE ALL ON FUNCTION public.nightly_audit_checks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nightly_audit_checks() FROM anon;
REVOKE ALL ON FUNCTION public.nightly_audit_checks() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nightly_audit_checks() TO service_role;

-- ── Cron job ───────────────────────────────────────────────────────────
-- Reads CRON_SECRET out of the known-good trial-emails-daily job so the
-- secret never appears in this file (house pattern, see
-- 2026-06-17_fix_cron_auth_headers.sql).
DO $$
DECLARE
  v_secret text;
  v_base   text := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1';
BEGIN
  SELECT (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    INTO v_secret
  FROM cron.job WHERE jobname = 'trial-emails-daily';

  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE EXCEPTION 'Could not read CRON_SECRET from trial-emails-daily cron; aborting (no jobs changed)';
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nightly-audit-daily';

  PERFORM cron.schedule('nightly-audit-daily', '15 5 * * *', format($f$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $f$, v_base || '/nightly-audit', v_secret));
END $$;
