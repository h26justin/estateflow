-- Xero two-way sync scaffold.
--
-- Xero is the dominant SMB accounting software in the UK. Many serious
-- landlords use it (or pay their accountant to). The audit flagged this
-- as a top gap vs Hammock / Landlord Vision / Lendlord, all of which
-- offer Xero integration.
--
-- Sync approach:
--   • Each property → Xero Tracking Category (so the user can run P&L
--     reports by property)
--   • Each rent_payment → Xero "Receive Money" bank transaction
--   • Each property_expense → Xero "Spend Money" bank transaction
--   • Each mortgage statement line item → categorised as needed
--
-- Phase 1 (this migration): connection + sync map + log infrastructure.
-- Phase 2: actual sync logic in supabase-functions/xero-sync.
--
-- Justin needs to:
--   1. Register an app at https://developer.xero.com/myapps (free)
--   2. Set redirect URI: https://<supabase-ref>.supabase.co/functions/v1/xero-oauth-callback
--   3. Provide XERO_CLIENT_ID + XERO_CLIENT_SECRET as supabase secrets
--
-- Tier-gated to Investor (£5/property) — most starter landlords don't
-- run Xero. Enforcement is client-side via canUseInvestorFeatures().
--
-- Applied via Supabase MCP on 2026-05-24.

CREATE TABLE IF NOT EXISTS public.xero_connections (
  user_id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL,                       -- Xero organisation ID
  tenant_name       TEXT,                                -- friendly org name
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  scopes            TEXT[],
  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT,                                -- 'ok' | 'error'
  last_sync_error   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.xero_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS xero_connections_own ON public.xero_connections;
CREATE POLICY xero_connections_own ON public.xero_connections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Mapping table: our entity → Xero entity, so we never double-create.
CREATE TABLE IF NOT EXISTS public.xero_sync_map (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('property','rent_payment','expense','contact')),
  local_id        UUID NOT NULL,                         -- Our PK (property.id, rent_payments.id, etc)
  xero_id         TEXT NOT NULL,                         -- Xero's GUID
  xero_kind       TEXT,                                  -- e.g. 'BankTransaction', 'TrackingCategoryOption'
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, entity_type, local_id)
);

ALTER TABLE public.xero_sync_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS xero_sync_map_own ON public.xero_sync_map;
CREATE POLICY xero_sync_map_own ON public.xero_sync_map
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS xero_sync_map_entity_idx
  ON public.xero_sync_map (user_id, entity_type);

-- Sync history — useful for debugging and showing "Last sync: 2 mins ago — 14 records"
CREATE TABLE IF NOT EXISTS public.xero_sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  direction     TEXT NOT NULL CHECK (direction IN ('to_xero','from_xero','both')),
  status        TEXT NOT NULL CHECK (status IN ('running','ok','error','partial')),
  records_created INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  records_failed  INT DEFAULT 0,
  error_message TEXT,
  details       JSONB
);

ALTER TABLE public.xero_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS xero_sync_log_own ON public.xero_sync_log;
CREATE POLICY xero_sync_log_own ON public.xero_sync_log
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS xero_sync_log_user_idx
  ON public.xero_sync_log (user_id, started_at DESC);

-- updated_at trigger
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS xero_connections_updated_at ON public.xero_connections;
    CREATE TRIGGER xero_connections_updated_at BEFORE UPDATE ON public.xero_connections
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.xero_connections IS 'Per-user OAuth connection to a Xero organisation. Tokens stored unencrypted for now; rotate to pgsodium once live.';
COMMENT ON TABLE public.xero_sync_map IS 'Maps our local entity IDs to Xero IDs so resync never duplicates.';
COMMENT ON TABLE public.xero_sync_log IS 'Audit trail of sync runs. UI shows last entry as "Last sync: ..."';
