-- ===========================================================================
-- "Remember this device for 30 days" — trusted-device MFA exemption
-- ===========================================================================
-- EstateFlow's MFA step-up is enforced entirely app-side (src/lib/AuthContext
-- .jsx): signInWithPassword returns a usable AAL1 session, and the app holds
-- the UI behind a TOTP challenge until getAuthenticatorAssuranceLevel() reports
-- AAL2. There is no native Supabase "trusted device" concept.
--
-- This migration adds an opt-in exemption: after a user completes the TOTP
-- challenge they may tick "remember this device for 30 days". We mint a
-- high-entropy token, store ONLY its SHA-256 hash here, and hand the raw token
-- to the browser (localStorage). On a later sign-in the app passes that token
-- to is_device_trusted(); if the hash matches an unexpired row for the user the
-- app skips the challenge.
--
-- SECURITY MODEL (why this can't be bypassed client-side):
--   * The table has RLS enabled with NO policies and all privileges revoked
--     from anon/authenticated — clients can never read or write it directly.
--     Every access goes through the SECURITY DEFINER functions below.
--   * trust_this_device() refuses to issue a token unless the CURRENT session
--     is already AAL2 (auth.jwt()->>'aal'). A password-only AAL1 session cannot
--     self-issue a token to skip its own second factor.
--   * is_device_trusted() only ever reports whether a hash matches; it never
--     returns the token and is safe to call from an AAL1 session (that is the
--     whole point — it runs before the challenge).
--   * Expiry is a HARD 30-day cap (no sliding window): the user re-verifies at
--     least every 30 days regardless of activity. last_used_at is informational.
--
-- gen_random_bytes/digest/encode are called unqualified under
-- `SET search_path = public, pg_temp`, matching the proven pattern in
-- 2026-05-24_company_statement_email_token.sql.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  label        text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL,
  CONSTRAINT trusted_devices_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS trusted_devices_user_id_idx    ON public.trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS trusted_devices_expires_at_idx ON public.trusted_devices(expires_at);

-- RLS on, no policies, no direct grants: the table is reachable ONLY through
-- the SECURITY DEFINER functions below.
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trusted_devices FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- trust_this_device — mint a 30-day token for the current device. AAL2 only.
-- ---------------------------------------------------------------------------
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

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.trusted_devices (user_id, token_hash, label, user_agent, expires_at)
  VALUES (v_uid, encode(digest(v_token, 'sha256'), 'hex'), p_label, p_user_agent, v_exp)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('token', v_token, 'id', v_id, 'expires_at', v_exp);
END;
$$;

-- ---------------------------------------------------------------------------
-- is_device_trusted — is this token a live trust token for the caller?
-- Safe to call from an AAL1 session: it runs BEFORE the challenge and only
-- ever returns a boolean. Bumps last_used_at and clears the user's expired
-- rows opportunistically.
-- ---------------------------------------------------------------------------
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
     AND token_hash = encode(digest(p_token, 'sha256'), 'hex')
     AND expires_at > now();

  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_trusted_devices — the caller's live devices (never the hash/token).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_trusted_devices()
RETURNS TABLE (id uuid, label text, user_agent text, created_at timestamptz, last_used_at timestamptz, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, label, user_agent, created_at, last_used_at, expires_at
    FROM public.trusted_devices
   WHERE user_id = auth.uid()
     AND expires_at > now()
   ORDER BY created_at DESC;
$$;

-- ---------------------------------------------------------------------------
-- revoke_trusted_device / revoke_all_trusted_devices — caller-scoped deletes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_trusted_device(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.trusted_devices WHERE id = p_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.revoke_all_trusted_devices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  WITH del AS (
    DELETE FROM public.trusted_devices WHERE user_id = auth.uid() RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  RETURN v_count;
END;
$$;

-- Execute granted to authenticated only — never anon.
REVOKE ALL ON FUNCTION public.trust_this_device(text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_device_trusted(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_trusted_devices()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_trusted_device(uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_all_trusted_devices()    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trust_this_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_device_trusted(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_trusted_devices()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_trusted_device(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_trusted_devices()  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION
-- -- Table locked down (RLS on, no policies):
-- --   SELECT relrowsecurity FROM pg_class WHERE relname='trusted_devices';   -> t
-- --   SELECT count(*) FROM pg_policies WHERE tablename='trusted_devices';     -> 0
-- -- Functions present & SECURITY DEFINER:
-- --   SELECT proname, prosecdef FROM pg_proc
-- --   WHERE proname IN ('trust_this_device','is_device_trusted','list_trusted_devices',
-- --                     'revoke_trusted_device','revoke_all_trusted_devices');
-- -- AAL guard: calling trust_this_device() from an AAL1 session must RAISE
-- --   'Two-factor verification required before trusting a device'.
-- -- anon cannot execute: only `authenticated` is in each function's ACL.
-- ===========================================================================
