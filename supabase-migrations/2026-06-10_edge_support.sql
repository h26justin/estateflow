-- Edge-function support tables for the 2026-06-10 security pass.
--
-- 1. oauth_nonces       — one-time nonces minted by the OAuth "start" step
--                         (xero-oauth-callback / hmrc-oauth-callback) and
--                         burned at callback. Defeats forged/replayed state.
-- 2. xero_connections.pending_sync_at — set by xero-webhook when Xero pushes
--                         a change; xero-cron-reconcile picks these up and
--                         xero-sync clears the flag on a successful run.
-- 3. xero_sync_locks    — per-(user, company) advisory lock with TTL so two
--                         overlapping xero-sync runs can't double-post
--                         BankTransactions to Xero.
--
-- Apply BEFORE deploying the updated edge functions (the OAuth start step
-- inserts into oauth_nonces and fails clearly if the table is missing).

-- ── 1. One-time OAuth nonces ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.oauth_nonces (
  nonce       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'unknown',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes'
);

CREATE INDEX IF NOT EXISTS oauth_nonces_expires_idx ON public.oauth_nonces (expires_at);

-- RLS: nobody reads or writes this from the client. Service-role only.
ALTER TABLE public.oauth_nonces ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.oauth_nonces IS
  'One-time nonces for OAuth state CSRF binding. Inserted at action=start, deleted (burned) at callback. Rows past expires_at are invalid and cleaned opportunistically.';

-- ── 2. Webhook → pending sync flag ───────────────────────────────────
ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS pending_sync_at TIMESTAMPTZ;

COMMENT ON COLUMN public.xero_connections.pending_sync_at IS
  'Set by xero-webhook when Xero reports a change. xero-cron-reconcile triggers a reconcile pull for flagged connections; xero-sync clears it on a successful run.';

-- ── 3. Per-connection sync lock with TTL ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_sync_locks (
  user_id      UUID NOT NULL,
  company_id   UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, company_id)
);

-- RLS: service-role only.
ALTER TABLE public.xero_sync_locks ENABLE ROW LEVEL SECURITY;

-- Acquire: returns TRUE when the lock was taken (no row, or previous lock
-- expired). Returns FALSE when another run currently holds it.
CREATE OR REPLACE FUNCTION public.acquire_xero_sync_lock(
  p_user_id UUID, p_company_id UUID, p_ttl_seconds INT DEFAULT 600
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  got BOOLEAN;
BEGIN
  INSERT INTO public.xero_sync_locks (user_id, company_id, locked_until)
  VALUES (p_user_id, p_company_id, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET locked_until = EXCLUDED.locked_until
    WHERE xero_sync_locks.locked_until < now()
  RETURNING TRUE INTO got;
  RETURN COALESCE(got, FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.release_xero_sync_lock(
  p_user_id UUID, p_company_id UUID
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.xero_sync_locks
  WHERE user_id = p_user_id AND company_id = p_company_id;
$$;

-- Only the service role (edge functions) may take/release locks.
REVOKE EXECUTE ON FUNCTION public.acquire_xero_sync_lock(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_xero_sync_lock(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Verification (run manually) ──────────────────────────────────────
-- SELECT to_regclass('public.oauth_nonces');                        -- not null
-- SELECT to_regclass('public.xero_sync_locks');                     -- not null
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'xero_connections' AND column_name = 'pending_sync_at';
-- SELECT public.acquire_xero_sync_lock('00000000-0000-0000-0000-000000000001'::uuid,
--                                      '00000000-0000-0000-0000-000000000002'::uuid, 5);  -- true
-- SELECT public.acquire_xero_sync_lock('00000000-0000-0000-0000-000000000001'::uuid,
--                                      '00000000-0000-0000-0000-000000000002'::uuid, 5);  -- false (held)
-- SELECT public.release_xero_sync_lock('00000000-0000-0000-0000-000000000001'::uuid,
--                                      '00000000-0000-0000-0000-000000000002'::uuid);
