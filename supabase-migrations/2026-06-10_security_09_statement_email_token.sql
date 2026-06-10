-- ===========================================================================
-- Security hardening 09 — lengthen statement-email inbox tokens (+ rotation)
-- ===========================================================================
-- companies.statement_email_token is embedded in the public forwarding address
-- <token>@inbox.ownproperly.com. It was 16 hex chars (8 bytes / 64 bits). The
-- real exposure is address leakage with no revocation path. This migration:
--   * upgrades NEW companies to 32 hex chars (16 bytes / 128 bits) by updating
--     the auto-generate trigger;
--   * adds regenerate_statement_email_token(company_id), an owner/admin-only
--     SECURITY DEFINER rotation that issues a fresh 32-hex token.
--
-- EXISTING tokens are NOT mass-rotated: their addresses keep working until the
-- owner regenerates, so no forwarding rules break. (The UNIQUE constraint on
-- the column is preserved.)
--
-- Idempotent. ROLLBACK: restore set_statement_email_token() to gen_random_bytes(8);
--   DROP FUNCTION public.regenerate_statement_email_token(uuid);
-- ===========================================================================

-- ── New companies get 128-bit tokens ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_statement_email_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.statement_email_token IS NULL THEN
    NEW.statement_email_token := encode(gen_random_bytes(16), 'hex');  -- 32 hex chars
  END IF;
  RETURN NEW;
END;
$$;

-- (Trigger companies_set_statement_email_token already exists from
--  2026-05-24_company_statement_email_token.sql and points at this function.)

-- ── On-demand rotation (owner/admin only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_statement_email_token(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  IF NOT (is_platform_admin() OR user_is_company_admin(p_company_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Retry on the (vanishingly unlikely) UNIQUE collision.
  LOOP
    v_token := encode(gen_random_bytes(16), 'hex');
    BEGIN
      UPDATE public.companies
      SET statement_email_token = v_token
      WHERE id = p_company_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- try a new token
    END;
  END LOOP;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_statement_email_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_statement_email_token(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- NOTE: this closes the token-length / no-rotation half of the finding.
-- Per-sender allow-list / DKIM verification and per-company AI-spend rate
-- limiting are edge-function concerns (ingest-statement-email) and are NOT in
-- this migration group — see notes/skipped.
--
-- VERIFICATION:
--   -- as company admin:
--   SELECT length(public.regenerate_statement_email_token('<co>'));  -> 32
--   -- as non-member: same call -> permission_denied
-- ===========================================================================
