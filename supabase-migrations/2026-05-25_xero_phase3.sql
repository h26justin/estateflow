-- Xero Phase 3 — everything left.
--
-- Adds (all user-toggleable except encryption):
--   - sync_real_tenant_emails    : push tenant_email/tenant_phone into the Xero contact
--   - sync_reverse_changes       : pull amount/date edits from Xero back to OwnProperly
--   - sync_deposits_separate     : split deposit_amount from tenancy_details into its own Xero post
--   - deposits_account_code      : where to post deposits (Xero usually wants a liability account)
--   - sync_refurb_separate       : push refurb_costs (paid rows) as their own SPEND lines
--   - refurb_account_code        : optional code for refurb (capital vs revenue is the user's call)
--   - enable_daily_cron          : opt in to the daily reconciliation pull cron
--   - enable_webhook             : opt in to receiving Xero push webhooks
--   - webhook_signing_key        : per-connection HMAC key Xero displays after subscribing
--   - secondary_tracking_category_id  : optional second Xero tracking dimension
--   - secondary_tracking_options : property → option ID map for the second dim
--
-- Plus application-level encryption of OAuth tokens (always on once
-- OWNPROPERLY_TOKEN_KEY is set). Stored as iv_hex:ciphertext_hex in
-- new TEXT columns. Migration runs whether the secret is set or not —
-- the edge functions only encrypt if the key is configured, so users
-- without the secret stay on the legacy plaintext columns until they
-- reconnect.
--
-- Applied via Supabase MCP on 2026-05-25.

-- ── New toggles + mappings on xero_sync_settings ─────────────────────
ALTER TABLE public.xero_sync_settings
  ADD COLUMN IF NOT EXISTS sync_real_tenant_emails        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sync_reverse_changes           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sync_deposits_separate         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposits_account_code          TEXT,
  ADD COLUMN IF NOT EXISTS sync_refurb_separate           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS refurb_account_code            TEXT,
  ADD COLUMN IF NOT EXISTS enable_daily_cron              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS enable_webhook                 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS webhook_signing_key            TEXT,
  ADD COLUMN IF NOT EXISTS secondary_tracking_category_id TEXT,
  ADD COLUMN IF NOT EXISTS secondary_tracking_options     JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── App-level token encryption columns on xero_connections ───────────
-- Same shape will apply to mtd_settings + bank_connections in a future
-- pass — this migration handles Xero only since it's the active integration.
ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS encrypted_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT;

COMMENT ON COLUMN public.xero_connections.encrypted_access_token IS
  'AES-GCM(iv_hex:ciphertext_hex). Edge function uses this when set; falls back to plaintext access_token for legacy rows.';

-- ── Idempotent re-sync state ─────────────────────────────────────────
-- When the user clicks "Re-sync everything" we wipe the xero_sync_map
-- entries for that (user, company) so subsequent syncs re-push. We also
-- track the wipe so the UI can show "X items will be re-pushed".
-- For now we don't need a separate table — DELETE FROM xero_sync_map
-- WHERE user_id=? AND company_id=? handles it.

-- ── New columns for reverse-sync tracking ────────────────────────────
-- When pulling changes back from Xero, we store the Xero-side version of
-- the record at last pull so we can detect changes. Stored as a hash to
-- keep the column small.
ALTER TABLE public.xero_sync_map
  ADD COLUMN IF NOT EXISTS last_xero_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS last_xero_synced_at   TIMESTAMPTZ;

-- ── Reconciliation cron table ────────────────────────────────────────
-- pg_cron rows can fire an edge function (via pg_net) on a schedule.
-- We model the schedule per (user, company) so each tenant can choose
-- whether to enable daily cron without affecting others.

CREATE TABLE IF NOT EXISTS public.xero_cron_schedules (
  user_id     UUID NOT NULL,
  company_id  UUID NOT NULL,
  cron_job_id BIGINT,                                -- pg_cron job ID for unschedule
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  PRIMARY KEY (user_id, company_id)
);

ALTER TABLE public.xero_cron_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xero_cron_schedules_own ON public.xero_cron_schedules;
CREATE POLICY xero_cron_schedules_own ON public.xero_cron_schedules
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.xero_cron_schedules IS
  'Per-(user,company) opt-in for the daily Xero reconciliation cron. Row exists ↔ cron is enabled.';
