-- ===========================================================================
-- API ACCESS TOKENS — read-only programmatic access to a user's portfolio
-- ===========================================================================
-- Backs the `api-access` edge function: a user mints a personal token in
-- Settings → Security → API Access, then any external client they trust
-- (e.g. a Claude session) can GET their portfolio data with
-- `Authorization: Bearer opat_…`.
--
-- Security model:
--   - Only a SHA-256 hash of the token is stored. The plaintext is shown
--     once at creation and never again. token_prefix (first 12 chars) is
--     kept so the user can recognise which token is which.
--   - scopes is '{read}' only for now — the edge function refuses anything
--     but GET on data routes regardless, so the column is forward-looking.
--   - Rows are minted and revoked ONLY via the api-access edge function
--     (service role): there are deliberately NO insert/update policies for
--     authenticated users. Clients may read their own token metadata and
--     delete their own rows (tidy-up of revoked tokens).
--
-- Safe to run multiple times.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS api_access_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  name         TEXT NOT NULL DEFAULT 'API token',
  token_prefix TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scopes       TEXT[] NOT NULL DEFAULT '{read}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_access_tokens_user ON api_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_access_tokens_hash ON api_access_tokens(token_hash);

ALTER TABLE api_access_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_access_tokens_select" ON api_access_tokens;
CREATE POLICY "api_access_tokens_select" ON api_access_tokens
FOR SELECT USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "api_access_tokens_delete" ON api_access_tokens;
CREATE POLICY "api_access_tokens_delete" ON api_access_tokens
FOR DELETE USING (user_id::text = auth.uid()::text);

COMMENT ON TABLE api_access_tokens IS
  'Personal read-only API tokens for the api-access edge function. Hash-only storage; minted/revoked via the edge function (service role) — no client insert/update policies by design.';
