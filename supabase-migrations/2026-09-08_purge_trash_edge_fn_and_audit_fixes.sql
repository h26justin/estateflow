-- ============================================================================
-- Trash purge moves to an edge function; two nightly-audit false positives.
--
-- Context: the audit had been RED/AMBER for 8 nights (1-8 Sept 2026). Of the
-- five items under "Needs attention" on 8 Sept, three were caused or
-- prolonged by what this migration changes:
--
-- 1. purge-soft-deleted-daily (scheduled 7 Sept by
--    2026-09-07_client_errors_and_purge_cron.sql) failed on its first run:
--    purge_soft_deleted_older_than_30_days() deletes from tenancy_details by
--    deleted_at, a column that table has never had. It was also rows-only,
--    so a purged deal / property / company left its documents and photos
--    orphaned in Storage. The purge now runs as the purge-trash edge
--    function (supabase-functions/purge-trash), which removes the files
--    through the Storage API before deleting the rows, service-role, same
--    04:30 UTC slot. The SQL function is dropped so nobody schedules it
--    again.
--
-- 2. nightly_audit_checks(): the "Compliance reminders" check counted items
--    inside their reminder window with no reminder sent, but an item CREATED
--    inside its window (e.g. the demo portfolio seeded at 21:21 on 7 Sept)
--    cannot have been reminded before the next 08:00 run. Items younger than
--    26 hours are now ignored. This is also the first time the function is
--    in the repo; until now it lived only in production.
--
-- The cron command needs the x-cron-secret header. It is copied from the
-- existing nightly-audit-daily job at apply time so the secret is never
-- written into this file (the half-applied-placeholder trap of Aug 2026).
--
-- Idempotent.
-- ============================================================================

drop function if exists public.purge_soft_deleted_older_than_30_days();

do $$
declare
  secret text;
  cmd    text;
begin
  select (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    into secret
  from cron.job where jobname = 'nightly-audit-daily';
  if secret is null or secret = '' or secret like '%REPLACE_WITH%' then
    raise exception 'purge-soft-deleted-daily: could not read x-cron-secret from nightly-audit-daily';
  end if;

  cmd := format($f$
    SELECT net.http_post(
      url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/purge-trash',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $f$, secret);

  if exists (select 1 from cron.job where jobname = 'purge-soft-deleted-daily') then
    perform cron.unschedule('purge-soft-deleted-daily');
  end if;
  perform cron.schedule('purge-soft-deleted-daily', '30 4 * * *', cmd);
end $$;

-- ----------------------------------------------------------------------------
-- nightly_audit_checks(): SQL-side checks for the nightly-audit edge function.
-- Service-role only. Only change from the production definition of 8 Sept
-- 2026 is the created_at guard in the compliance_reminders check.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nightly_audit_checks()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND j.schedule ~ '^\S+\s+\S+\s+\*\s+\*\s+\*$'
    AND j.jobname <> 'nightly-audit-daily'
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
  SELECT max(sent_at), count(*) FILTER (WHERE sent_at > now() - interval '24 hours')
    INTO t, n FROM public.trial_email_log;

  checks := checks || jsonb_build_object(
    'name', 'trial_emails', 'group', 'users', 'label', 'Trial emails',
    'status', 'ok',
    'detail', n || ' sent 24h · last ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 86400)::text || 'd ago', 'never'));

  ------------------------------------------------------------------
  -- Items inside their reminder window for 2+ days with no reminder sent.
  -- Items younger than 26 hours are skipped: the 08:00 compliance-reminders
  -- run has not had a chance at them yet.
  SELECT count(*) INTO n
  FROM public.compliance_items ci
  WHERE ci.deleted_at IS NULL
    AND ci.expiry_date IS NOT NULL
    AND ci.expiry_date >= current_date
    AND (ci.expiry_date - COALESCE(ci.reminder_days, 30)) <= current_date - 2
    AND ci.last_reminder_sent_at IS NULL
    AND ci.created_at < now() - interval '26 hours';

  checks := checks || jsonb_build_object(
    'name', 'compliance_reminders', 'group', 'syncs', 'label', 'Compliance reminders',
    'status', CASE WHEN n > 0 THEN 'warn' ELSE 'ok' END,
    'detail', n || ' item(s) stuck in reminder window unreminded');

  ------------------------------------------------------------------
  SELECT max(updated_at), count(*) FILTER (WHERE status = 'open')
    INTO t, n FROM public.autopilot_actions;

  checks := checks || jsonb_build_object(
    'name', 'autopilot', 'group', 'syncs', 'label', 'Autopilot',
    'status', CASE WHEN t IS NULL OR t < now() - interval '26 hours' THEN 'warn' ELSE 'ok' END,
    'detail', 'last activity ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 3600)::text || 'h ago', 'never')
              || ' · ' || n || ' open actions');

  ------------------------------------------------------------------
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
  SELECT max(created_at) INTO t FROM public.user_backups;

  checks := checks || jsonb_build_object(
    'name', 'backups', 'group', 'syncs', 'label', 'User backups',
    'status', CASE WHEN t IS NULL OR t < now() - interval '8 days' THEN 'warn' ELSE 'ok' END,
    'detail', 'last backup ' ||
              COALESCE(round(extract(epoch FROM now() - t) / 86400)::text || 'd ago', 'never'));

  ------------------------------------------------------------------
  SELECT count(*), string_agg(tablename, ', ') INTO n, names
  FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;

  checks := checks || jsonb_build_object(
    'name', 'rls', 'group', 'security', 'label', 'RLS coverage',
    'status', CASE WHEN n > 0 THEN 'fail' ELSE 'ok' END,
    'detail', CASE WHEN n > 0 THEN n || ' table(s) WITHOUT RLS: ' || names
                   ELSE 'all public tables enabled' END);

  ------------------------------------------------------------------
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
  SELECT (SELECT count(*) FROM public.companies  WHERE deleted_at < now() - interval '31 days'),
         (SELECT count(*) FROM public.properties WHERE deleted_at < now() - interval '31 days')
    INTO n, n2;

  checks := checks || jsonb_build_object(
    'name', 'purge', 'group', 'security', 'label', 'Soft-delete purge',
    'status', CASE WHEN n + n2 > 0 THEN 'warn' ELSE 'ok' END,
    'detail', (n + n2) || ' row(s) past the 31-day purge horizon');

  ------------------------------------------------------------------
  SELECT count(*) FILTER (WHERE NOT accepted AND expires_at > now()),
         count(*) FILTER (WHERE NOT accepted AND expires_at <= now())
    INTO n, n2
  FROM public.invitations;

  checks := checks || jsonb_build_object(
    'name', 'invites', 'group', 'users', 'label', 'Invites',
    'status', 'ok', 'detail', n || ' pending · ' || n2 || ' expired unaccepted');

  ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(subdomain ORDER BY subdomain), '[]'::jsonb) INTO meta
  FROM public.companies WHERE subdomain IS NOT NULL AND deleted_at IS NULL;

  RETURN jsonb_build_object('checks', checks, 'subdomains', meta, 'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.nightly_audit_checks() FROM public, anon, authenticated;

-- Verification:
-- select jobname, schedule, active, command like '%purge-trash%' as edge_fn from cron.job where jobname='purge-soft-deleted-daily';
-- select proname from pg_proc where proname='purge_soft_deleted_older_than_30_days';   -- expect none
-- select public.nightly_audit_checks() -> 'checks';
