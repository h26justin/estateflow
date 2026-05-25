-- Add encrypted token columns to mtd_settings (HMRC OAuth tokens).
--
-- Mirrors the Xero pattern (2026-05-25_xero_phase3.sql + 2026-05-25_xero_
-- connections_nullable_plaintext.sql). The hmrc-oauth-callback and mtd-submit
-- edge functions will now write ciphertext to encrypted_hmrc_*_token and
-- set the legacy plaintext columns to NULL when OWNPROPERLY_TOKEN_KEY is
-- configured. Without the key configured they fall back to plaintext (no
-- regression for users connected before encryption shipped).
--
-- After this migration, every NEW HMRC OAuth connection (and the next
-- token refresh of every existing one) will be at-rest-encrypted.
--
-- Apply via Supabase Dashboard SQL editor.

-- 1. Add the encrypted columns.
ALTER TABLE public.mtd_settings
  ADD COLUMN IF NOT EXISTS encrypted_hmrc_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_hmrc_refresh_token TEXT;

COMMENT ON COLUMN public.mtd_settings.encrypted_hmrc_access_token  IS 'AES-GCM ciphertext; format: iv_hex:ciphertext_hex';
COMMENT ON COLUMN public.mtd_settings.encrypted_hmrc_refresh_token IS 'AES-GCM ciphertext; format: iv_hex:ciphertext_hex';

-- 2. Drop NOT NULL on the legacy plaintext columns (if present), so the
--    encryption path can null them out. Use a conditional ALTER so this
--    works even if the original schema already allowed NULL.
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.mtd_settings ALTER COLUMN hmrc_access_token  DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.mtd_settings ALTER COLUMN hmrc_refresh_token DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
