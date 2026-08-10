# Nightly audit

A fully automatic production audit that runs **every night at 05:15 UTC** and
emails a tick/cross digest. No Claude session, no tokens, no manual step —
pg_cron → `nightly-audit` edge function → Resend email + row in
`nightly_audit_runs`.

- Function: `supabase-functions/nightly-audit/index.ts`
- DB checks + cron: `supabase-migrations/2026-08-09_nightly_audit.sql`
  (`public.nightly_audit_checks()`, service-role only)
- History: `select ran_at, overall, report from nightly_audit_runs order by id desc;`
- Recipient: `AUDIT_EMAIL_TO` secret (default `justin@forta.productions`)

## What it checks

**Website**
- Marketing site up (www + apex, 200 + title marker, latency), legal pages
- Blog + the 3 SEO landing pages (content markers)
- Sitemap + robots
- App JS bundle actually loads; service-worker BUILD_ID decoded to deploy age
- Every tenant-portal subdomain: HTTP 200 **and** `get_company_branding_by_subdomain` returns

**Platform**
- Supabase auth `/health`, REST reachability
- **Signup canary** — a real end-to-end synthetic signup each night: create
  user → sign in → RLS'd `user_profiles` upsert → `create_company_for_owner`
  (fires the pgcrypto `set_statement_email_token` trigger that silently broke
  signups May–Aug 2026) → verifies token format + ~14d trial → deletes itself.
  Canary emails look like `audit-canary+<ts>@ownproperly.com`; they are
  excluded from all other counts and cleaned up in a `finally`.
- Cron: failures in 25h, daily jobs that didn't run in 26h, placeholder
  secrets (`REPLACE_WITH…`) in any job command
- pg_net outbound failures (timeouts ignored — long-running fns show as
  timeout even on success)
- Resend domain verified

**Money**
- Stripe API key valid; webhook endpoint enabled and pointed at
  `…/functions/v1/stripe-webhook`; events received in 24h; undelivered
  events older than 2h
- DB ↔ Stripe subscription status drift; DB subs unknown to Stripe
- `past_due` subs; `active` subs whose period lapsed >2d (webhook drift)
- Trials: in-trial count, expiring ≤3d, any trial beyond the 32-day
  self-grant cap (guard breach ⇒ RED)

**Users & onboarding**
- New signups 24h / 7d
- Orphan auth users (no landlord or tenant profile — the signup profile
  upsert is client-side only, so this catches half-completed signups)
- Trial-email log freshness; invitation hygiene

**Syncs & jobs**
- Autopilot activity in 26h + open-action backlog
- Lodgify STL: active connections synced in 26h, no error status
- Xero: enabled cron schedules ran; webhook `pending_sync_at` flags drained
- Compliance reminders: items sitting ≥2 days inside their reminder window
  with no reminder ever sent
- EPC register: checked within 35d, no sync errors
- Weekly user backups within 8d

**Security**
- Every public table has RLS enabled (RED if not)
- Every SECURITY DEFINER function pins `search_path` (RED if not)
- Soft-deleted rows past the 31-day purge horizon

Overall = worst check: any 🔴 → RED, any 🟡 → AMBER, else GREEN. The email
ends with a "Needs attention" list of every non-green line.

## Operating it

Manual run (from SQL editor / Claude session — reuses the stored secret, so
nothing sensitive leaves the DB):

```sql
DO $$
DECLARE v_secret text;
BEGIN
  SELECT (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1] INTO v_secret
  FROM cron.job WHERE jobname = 'trial-emails-daily';
  PERFORM net.http_post(
    url := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1/nightly-audit',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
```

Body flags: `{"dry_run": true}` skips the email; `{"skip_canary": true}`
skips the synthetic signup. Result is also stored in `nightly_audit_runs`
regardless.

Change schedule: `select cron.unschedule('nightly-audit-daily');` then
re-run the DO block at the bottom of the migration with a new cron
expression. Change recipient: set the `AUDIT_EMAIL_TO` function secret.

## Adding a check

- SQL-side (DB state): add a block to `public.nightly_audit_checks()` —
  append a `jsonb_build_object('name', …, 'group', …, 'label', …, 'status',
  ok|warn|fail, 'detail', …)` to `checks`, redeploy via migration.
- HTTP/API-side: add to the relevant section of
  `supabase-functions/nightly-audit/index.ts` and redeploy the function.
- Add the new `name` to the `order` array in `index.ts` so it slots into the
  digest sensibly.

## What it deliberately does not cover (weekly Claude audit territory)

- Supabase advisors diff (needs the management API), dependency/CVE scan,
  code-level review, real-browser click-through of authenticated app flows,
  accessibility. Run those as an on-demand or scheduled Claude session; this
  digest is the deterministic every-night floor.
