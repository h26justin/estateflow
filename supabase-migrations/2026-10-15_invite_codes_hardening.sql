-- ----------------------------------------------------------------------------
-- Company join codes: server-side generation, defaults, and a redemption
-- rate limit (15 Oct 2026, HIGH — guessable join codes).
--
-- Before: the browser generated codes as ABC-XXXX (3 letters of the company
-- name + 4 chars of a 32-char alphabet via Math.random ≈ 1M space) and
-- inserted them directly; codes defaulted to never expiring and unlimited
-- uses; redeem_company_invite() had no attempt limit. A signed-in attacker
-- who knows a company's name could enumerate the suffix and join as editor.
--
-- After:
--   1. create_company_invite(...) SECURITY DEFINER: same admin/owner test as
--      the old INSERT policy, code = 3-char name prefix (readability only) +
--      16 chars from gen_random_bytes over a 32-char alphabet = 80 bits.
--      Defaults: expires in 14 days, max 25 uses, unless the caller asks
--      explicitly (p_expires_at / p_no_expiry, p_max_uses / p_unlimited_uses).
--   2. The direct INSERT policy is dropped (nothing else inserts: checked the
--      repo and every public function on live). The identity-guard trigger
--      now also stops an admin rewriting `code` to a weak value via UPDATE.
--   3. invite_redeem_attempts + redeem_company_invite(): every attempt is
--      recorded; after 10 failed attempts in an hour the user gets
--      'too_many_attempts' (successful redemptions are not counted).
--      Because a RAISE would roll back the attempt row, invite failures are
--      now RETURNED as error_code (company_id NULL) instead of raised; only
--      'not_signed_in' and 'too_many_attempts' still raise. The return type
--      gains an error_code column, so the function is dropped + re-created.
--      Everything the previous live body did is kept (revoked / expired /
--      exhausted / soft-deleted-company checks, role mapping, no role
--      downgrade on conflict, used_count bump).
--   4. Existing active never-expiring codes in the weak ABC-XXXX format get
--      expires_at = now() + 30 days, so current links keep working for now.
--
-- Pre-apply read-only counts on hqrhqbkqxzllmzhcofrh (15 Oct 2026):
--   company_invites total 1; weak format 1; weak + active + never-expiring 0
--   → step 4 updates 0 rows today. invite_redeem_attempts and
--   create_company_invite did not exist.
--
-- Client: src/lib/api/invitations.js calls create_company_invite and reads
-- error_code from redeem_company_invite. Deploy the front end right after
-- this migration; until then an old cached bundle cannot create codes (no
-- INSERT policy) and treats a returned error_code as success (no access is
-- granted — only the toast is wrong).
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.create_company_invite(uuid, text, timestamptz, integer, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.redeem_company_invite(text);
--   -- re-create the previous redeem_company_invite(text) RETURNS TABLE(company_id uuid, role text, company_name text)
--   -- from 2026-10-15 pg_get_functiondef (raises invite_* errors), grant authenticated;
--   -- re-create policy "Company admins create invites" FOR INSERT WITH CHECK
--   --   (created_by = auth.uid() AND (admin/owner via user_company_access OR companies.owner_id = auth.uid()));
--   -- restore enforce_company_invite_identity_guard() from 2026-10-15_company_invites_update_check.sql;
--   DROP TABLE IF EXISTS public.invite_redeem_attempts;
-- ----------------------------------------------------------------------------

-- ── 1. Attempt log (service-side only) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invite_redeem_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  succeeded    boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS invite_redeem_attempts_user_time_idx
  ON public.invite_redeem_attempts (user_id, attempted_at DESC);
ALTER TABLE public.invite_redeem_attempts ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the SECURITY DEFINER functions touch it.
REVOKE ALL ON TABLE public.invite_redeem_attempts FROM PUBLIC, anon, authenticated;

-- ── 2. Server-side code generation ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_company_invite(
  p_company_id     uuid,
  p_role           text        DEFAULT 'editor',
  p_expires_at     timestamptz DEFAULT NULL,
  p_max_uses       integer     DEFAULT NULL,
  p_label          text        DEFAULT NULL,
  p_no_expiry      boolean     DEFAULT false,
  p_unlimited_uses boolean     DEFAULT false
)
 RETURNS public.company_invites
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 32 symbols, no I / O / 0 / 1. 256 % 32 = 0, so byte % 32 is unbiased.
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_uid      uuid := auth.uid();
  v_role     text := lower(coalesce(nullif(trim(p_role), ''), 'editor'));
  v_name     text;
  v_deleted  timestamptz;
  v_prefix   text;
  v_suffix   text;
  v_bytes    bytea;
  v_expires  timestamptz;
  v_max      integer;
  v_label    text := nullif(left(trim(coalesce(p_label, '')), 100), '');
  v_row      public.company_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  -- Same test as the dropped "Company admins create invites" INSERT policy.
  IF NOT (
       EXISTS (SELECT 1 FROM user_company_access uca
                WHERE uca.user_id = v_uid::text
                  AND uca.company_id = p_company_id
                  AND (uca.is_admin = true OR uca.is_owner = true))
    OR EXISTS (SELECT 1 FROM companies c
                WHERE c.id = p_company_id AND c.owner_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.name, c.deleted_at INTO v_name, v_deleted FROM companies c WHERE c.id = p_company_id;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'company_unavailable';
  END IF;

  IF v_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  IF p_no_expiry THEN
    v_expires := NULL;
  ELSIF p_expires_at IS NULL THEN
    v_expires := now() + interval '14 days';
  ELSIF p_expires_at <= now() OR p_expires_at > now() + interval '366 days' THEN
    RAISE EXCEPTION 'invalid_expiry';
  ELSE
    v_expires := p_expires_at;
  END IF;

  IF p_unlimited_uses THEN
    v_max := NULL;
  ELSIF p_max_uses IS NULL THEN
    v_max := 25;
  ELSIF p_max_uses < 1 OR p_max_uses > 1000 THEN
    RAISE EXCEPTION 'invalid_max_uses';
  ELSE
    v_max := p_max_uses;
  END IF;

  -- Prefix is for humans only (which company is this?) and carries no
  -- entropy; the 16-char suffix carries 80 bits.
  v_prefix := rpad(left(upper(regexp_replace(coalesce(v_name, ''), '[^A-Za-z0-9]', '', 'g')), 3), 3, 'X');

  FOR attempt IN 1..5 LOOP
    v_bytes  := extensions.gen_random_bytes(16);
    v_suffix := '';
    FOR i IN 0..15 LOOP
      v_suffix := v_suffix || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO company_invites (company_id, created_by, code, max_uses, expires_at, role, is_admin, label)
      VALUES (p_company_id, v_uid, v_prefix || '-' || v_suffix, v_max, v_expires, v_role, v_role = 'admin', v_label)
      RETURNING * INTO v_row;
      RETURN v_row;
    EXCEPTION WHEN unique_violation THEN
      -- 2^-80 per try; loop is belt and braces.
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'code_generation_failed';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_company_invite(uuid, text, timestamptz, integer, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company_invite(uuid, text, timestamptz, integer, text, boolean, boolean) TO authenticated, service_role;

-- Codes are only created through the RPC now.
DROP POLICY IF EXISTS "Company admins create invites" ON public.company_invites;
REVOKE INSERT ON TABLE public.company_invites FROM anon, authenticated;

-- ── 3. Identity guard: also pin the code itself ─────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_company_invite_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_developer() THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a join code cannot be moved to another company; create a new one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'a join code cannot be changed; revoke it and create a new one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.enforce_company_invite_identity_guard() FROM PUBLIC, anon, authenticated;

-- ── 4. Rate-limited redemption ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.redeem_company_invite(text);
CREATE FUNCTION public.redeem_company_invite(p_code text)
 RETURNS TABLE(company_id uuid, role text, company_name text, error_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_max_failures constant integer  := 10;
  c_window       constant interval := interval '1 hour';
  v_invite   company_invites%ROWTYPE;
  v_user_id  uuid;
  v_email    text;
  v_co_name  text;
  v_role     text;
  v_deleted  timestamptz;
  v_fails    integer;
  v_err      text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  -- Serialise this user's attempts so parallel requests can't overshoot
  -- the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('redeem_company_invite:' || v_user_id::text, 0));

  SELECT count(*) INTO v_fails
    FROM invite_redeem_attempts a
   WHERE a.user_id = v_user_id
     AND a.succeeded = false
     AND a.attempted_at > now() - c_window;
  IF v_fails >= c_max_failures THEN
    RAISE EXCEPTION 'too_many_attempts'
      USING HINT = 'Too many invalid invite codes. Wait an hour and try again.';
  END IF;

  -- Housekeeping: nothing older than a day is ever needed.
  DELETE FROM invite_redeem_attempts a
   WHERE a.user_id = v_user_id AND a.attempted_at < now() - interval '1 day';

  IF p_code IS NULL OR length(p_code) > 64 THEN
    v_err := 'invite_not_found';
  ELSE
    SELECT * INTO v_invite
    FROM company_invites ci
    WHERE upper(ci.code) = upper(trim(p_code))
    LIMIT 1;

    IF NOT FOUND THEN
      v_err := 'invite_not_found';
    ELSIF v_invite.revoked_at IS NOT NULL THEN
      v_err := 'invite_revoked';
    ELSIF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
      v_err := 'invite_expired';
    ELSIF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
      v_err := 'invite_exhausted';
    ELSE
      -- Don't join people to a soft-deleted (tombstoned) company pending purge.
      SELECT c.deleted_at INTO v_deleted FROM companies c WHERE c.id = v_invite.company_id;
      IF v_deleted IS NOT NULL THEN
        v_err := 'company_unavailable';
      END IF;
    END IF;
  END IF;

  IF v_err IS NOT NULL THEN
    -- Returned, not raised: a RAISE would roll back this attempt row.
    INSERT INTO invite_redeem_attempts (user_id, succeeded) VALUES (v_user_id, false);
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, v_err;
    RETURN;
  END IF;

  v_role := COALESCE(v_invite.role, CASE WHEN v_invite.is_admin THEN 'admin' ELSE 'editor' END);
  IF v_role NOT IN ('admin','editor','viewer') THEN
    v_role := 'editor';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO user_company_access (user_id, company_id, email, role, is_admin, is_owner)
  VALUES (
    v_user_id::text,
    v_invite.company_id,
    v_email,
    v_role,
    v_role = 'admin',
    false
  )
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET role     = CASE
                     WHEN user_company_access.role = 'admin' THEN 'admin'
                     WHEN EXCLUDED.role = 'admin' THEN 'admin'
                     WHEN user_company_access.role = 'editor' THEN 'editor'
                     WHEN EXCLUDED.role = 'editor' THEN 'editor'
                     ELSE EXCLUDED.role
                   END,
        is_admin = (user_company_access.is_admin OR EXCLUDED.is_admin),
        email    = COALESCE(user_company_access.email, EXCLUDED.email);

  UPDATE company_invites
  SET used_count = used_count + 1
  WHERE id = v_invite.id;

  INSERT INTO invite_redeem_attempts (user_id, succeeded) VALUES (v_user_id, true);

  SELECT c.name INTO v_co_name FROM companies c WHERE c.id = v_invite.company_id;

  RETURN QUERY SELECT v_invite.company_id, v_role, v_co_name, NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.redeem_company_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_company_invite(text) TO authenticated, service_role;

-- ── 5. Existing weak, never-expiring codes: 30 more days ───────────────────
UPDATE public.company_invites
   SET expires_at = now() + interval '30 days'
 WHERE revoked_at IS NULL
   AND expires_at IS NULL
   AND code ~ '^[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$';

NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- VERIFY (read-only, after apply):
--   -- expect relrowsecurity = true and no policies
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invite_redeem_attempts'::regclass;
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='invite_redeem_attempts';
--   -- expect no INSERT policy left on company_invites
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='company_invites';
--   -- expect authenticated + service_role only (no anon, no PUBLIC)
--   SELECT p.oid::regprocedure, p.proacl FROM pg_proc p
--    WHERE p.pronamespace='public'::regnamespace
--      AND p.proname IN ('create_company_invite','redeem_company_invite');
--   -- expect 0
--   SELECT count(*) FROM public.company_invites
--    WHERE revoked_at IS NULL AND expires_at IS NULL AND code ~ '^[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$';
--   -- after the first code is created in the app: expect ^[A-Z0-9]{3}-[A-HJ-NP-Z2-9]{16}$,
--   -- expires_at ≈ now()+14d, max_uses 25
--   SELECT code, expires_at, max_uses FROM public.company_invites ORDER BY created_at DESC LIMIT 1;
-- ----------------------------------------------------------------------------
