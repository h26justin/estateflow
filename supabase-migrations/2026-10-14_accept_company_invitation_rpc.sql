-- ----------------------------------------------------------------------------
-- accept_company_invitation(p_token) — server-side invite acceptance
-- (security hotfix, 14 Oct 2026). ADDITIVE: creates one function, changes
-- no policy. Apply BEFORE deploying the client that calls it, and BEFORE
-- 2026-10-14_user_company_access_admin_only.sql (which removes the old
-- client-side path).
--
-- HOLE: per-email invitations were accepted by the browser: it flipped the
-- invitations rows to accepted and then upserted its own user_company_access
-- row. For that to work, uca_insert carried a "self-service join" branch:
--   user_id = auth.uid() AND is_owner IS NOT TRUE AND (plain member
--   OR EXISTS an is_admin invitation for this company and auth.email())
-- so ANY signed-in user could insert themselves into ANY company as a
-- viewer/editor with no invitation at all, and (combined with the
-- unchecked invitations_insert) as an admin. Nothing tied the self-insert
-- to a real, unexpired, unaccepted invitation token.
--
-- FIX: a SECURITY DEFINER RPC that does the whole acceptance atomically:
--   1. caller must be signed in; their email is read from auth.users;
--   2. the token must exist and belong to that email (case-insensitive) —
--      a wrong token and someone else's token give the same error;
--   3. the token's invite must not be expired;
--   4. if it is already accepted, the call is a no-op when the caller already
--      has access to that company, and an error otherwise;
--   5. every pending, unexpired invitation for the caller's email is marked
--      accepted (one invite email covers several companies but carries one
--      token — same behaviour as the old client code), and a
--      user_company_access row is upserted for each with the invite's
--      is_admin. is_owner is always false; an existing is_admin is never
--      downgraded.
-- Returns one (company_id, is_admin) row per company joined.
-- EXECUTE: authenticated only.
--
-- Error codes (mapped to friendly text in src/lib/api/_monolith.js):
--   not_signed_in, invite_invalid, invite_expired, invite_already_accepted
--
-- Idempotent: CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_token text)
 RETURNS TABLE(company_id uuid, is_admin boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   record;
  r       record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT i.id, i.company_id, i.email, i.is_admin, i.accepted, i.expires_at
    INTO v_inv
    FROM public.invitations i
   WHERE i.token::text = btrim(p_token)
   LIMIT 1
   FOR UPDATE;

  -- Unknown token and a token addressed to someone else look identical.
  IF NOT FOUND OR lower(btrim(v_inv.email)) <> lower(btrim(v_email)) THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_inv.accepted IS TRUE THEN
    IF EXISTS (SELECT 1 FROM public.user_company_access a
                WHERE a.company_id = v_inv.company_id
                  AND a.user_id = v_uid::text) THEN
      RETURN;  -- re-opened link after a successful accept: nothing to do
    END IF;
    RAISE EXCEPTION 'invite_already_accepted' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    UPDATE public.invitations i
       SET accepted = true, accepted_at = now()
     WHERE lower(btrim(i.email)) = lower(btrim(v_email))
       AND i.accepted IS NOT TRUE
       AND (i.expires_at IS NULL OR i.expires_at > now())
    RETURNING i.company_id AS inv_company_id, COALESCE(i.is_admin, false) AS inv_is_admin
  LOOP
    INSERT INTO public.user_company_access AS a (user_id, company_id, email, is_admin, is_owner)
    VALUES (v_uid::text, r.inv_company_id, v_email, r.inv_is_admin, false)
    ON CONFLICT (user_id, company_id) DO UPDATE
      SET is_admin = (a.is_admin IS TRUE) OR EXCLUDED.is_admin,
          email    = COALESCE(a.email, EXCLUDED.email);

    company_id := r.inv_company_id;
    is_admin   := r.inv_is_admin;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_company_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
