-- Drop NOT NULL on the legacy plaintext token columns on xero_connections.
--
-- When OWNPROPERLY_TOKEN_KEY is configured, the edge function writes
-- ciphertext to encrypted_access_token / encrypted_refresh_token and
-- sets the legacy plaintext columns to NULL. The original schema
-- (pre-encryption) required them non-null, which blocked the encryption
-- write path with a 23502 constraint violation.
--
-- Found in production during Justin's reconnect attempt: the OAuth
-- callback was silently swallowing the upsert error and returning a
-- 302 success redirect even though the row never landed.
--
-- Applied via Supabase MCP on 2026-05-25.

ALTER TABLE public.xero_connections
  ALTER COLUMN access_token  DROP NOT NULL,
  ALTER COLUMN refresh_token DROP NOT NULL;
