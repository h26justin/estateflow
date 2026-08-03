-- ===========================================================================
-- Fix: signup broken — "function gen_random_bytes(integer) does not exist"
-- ===========================================================================
-- pgcrypto lives in the `extensions` schema, but four SECURITY DEFINER
-- functions call gen_random_bytes()/digest() UNQUALIFIED under a pinned
-- `SET search_path = public, pg_temp`. That search_path can never resolve
-- pgcrypto, so every call fails at runtime:
--
--   * set_statement_email_token()            — BEFORE INSERT trigger on
--     public.companies. This is the signup killer: the onboarding wizard's
--     create_company_for_owner() RPC inserts a company, the trigger fires,
--     and the whole insert aborts. New customers cannot create a company.
--   * regenerate_statement_email_token(uuid) — owner/admin token rotation.
--   * trust_this_device(text,text)           — "remember this device" MFA.
--   * is_device_trusted(text)                — MFA device check.
--
-- Fix: schema-qualify the pgcrypto calls (extensions.gen_random_bytes,
-- extensions.digest). The pinned search_path stays as-is — qualifying the
-- calls is tighter than widening the path. encode() is pg_catalog, fine.
--
-- Column DEFAULTs that reference gen_random_bytes (e.g. tenant portal access
-- tokens) are NOT affected: defaults are resolved to function OIDs at DDL
-- time, so only plpgsql bodies (parsed at call time) hit this.
--
-- Idempotent (CREATE OR REPLACE, bodies otherwise unchanged).
-- ROLLBACK: re-run the previous definitions from
--   2026-06-10_security_09_statement_email_token.sql and
--   2026-06-22_trusted_devices.sql (they restore the unqualified calls).
-- ===========================================================================

-- ── Trigger: auto-issue statement-email token on company insert ─────────────
CREATE OR REPLACE FUNCTION public.set_statement_email_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.statement_email_token IS NULL THEN
    NEW.statement_email_token := encode(extensions.gen_random_bytes(16), 'hex');  -- 32 hex chars
  END IF;
  RETURN NEW;
END;
$$;

-- ── Owner/admin-only token rotation ──────────────────────────────────────────
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

  LOOP
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
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

-- ── Trusted devices: issue a 30-day token (AAL2 sessions only) ───────────────
CREATE OR REPLACE FUNCTION public.trust_this_device(p_user_agent text DEFAULT NULL, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text;
  v_id    uuid;
  v_exp   timestamptz := now() + interval '30 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- The session must have actually cleared the second factor. This is the
  -- guard that stops an AAL1 (password-only) session from issuing itself a
  -- token to bypass MFA.
  IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'Two-factor verification required before trusting a device';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.trusted_devices (user_id, token_hash, label, user_agent, expires_at)
  VALUES (v_uid, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_label, p_user_agent, v_exp)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('token', v_token, 'id', v_id, 'expires_at', v_exp);
END;
$$;

-- ── Trusted devices: does the presented token match? ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_device_trusted(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_token IS NULL OR length(p_token) = 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.trusted_devices
   WHERE user_id = v_uid AND expires_at <= now();

  UPDATE public.trusted_devices
     SET last_used_at = now()
   WHERE user_id = v_uid
     AND token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND expires_at > now();

  RETURN FOUND;
END;
$$;
