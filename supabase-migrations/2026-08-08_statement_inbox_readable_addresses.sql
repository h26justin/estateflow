-- ===========================================================================
-- Statement inbox — readable forwarding addresses (<company-slug>-<key>@…)
-- ===========================================================================
-- The forwarding-address local part was a bare hex token
-- (e.g. 4efc4f1b4576cf9a@inbox.ownproperly.com): unguessable but
-- unidentifiable — with several companies you can't tell which address
-- routes where when auditing a Gmail forwarding rule months later.
--
-- New format: <slug>-<key>, e.g. alicat-3f9c2a7b1d4e@inbox.ownproperly.com
--   * slug = first word of the company name, lowercased, a-z0-9 only,
--     max 12 chars ('company' fallback if the name yields nothing)
--   * key  = extensions.gen_random_bytes(6) → 12 hex chars (48 bits).
--     Still far beyond blind guessing via email — the ingest fn drops
--     unknown tokens silently — while the slug carries the identity.
--
-- The WHOLE local part is stored in companies.statement_email_token, so
-- the ingest-statement-email edge function's exact-match lookup is
-- untouched — no edge-function redeploy needed.
--
-- EXISTING addresses are NOT rewritten: they keep working until the owner
-- clicks Rotate (silently breaking live agent forwarding rules is worse
-- than an ugly address). New companies + rotations get the new format.
--
-- Also part of this change (client side, same PR): the UI Rotate button
-- now calls regenerate_statement_email_token() instead of writing a
-- client-generated 16-hex token directly, so rotation stops downgrading
-- entropy and picks up the new format from one server-side code path.
--
-- Idempotent. ROLLBACK: restore set_statement_email_token() and
-- regenerate_statement_email_token() from
-- 2026-08-03_fix_pgcrypto_schema_qualification.sql;
--   DROP FUNCTION public.statement_email_slug(text);
-- ===========================================================================

-- ── Slug from company name ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.statement_email_slug(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    -- first word of the name, sanitised: "AliCat Property Group" → "alicat"
    NULLIF(left(regexp_replace(lower(split_part(btrim(coalesce(p_name, '')), ' ', 1)), '[^a-z0-9]', '', 'g'), 12), ''),
    -- whole name sanitised, if the first word had no usable characters
    NULLIF(left(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g'), 12), ''),
    'company'
  )
$$;

REVOKE ALL ON FUNCTION public.statement_email_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.statement_email_slug(text) TO authenticated;

-- ── New companies get readable addresses ─────────────────────────────────────
-- (Trigger companies_set_statement_email_token already exists from
--  2026-05-24_company_statement_email_token.sql and points at this function.)
CREATE OR REPLACE FUNCTION public.set_statement_email_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.statement_email_token IS NULL THEN
    NEW.statement_email_token :=
      public.statement_email_slug(NEW.name) || '-' ||
      encode(extensions.gen_random_bytes(6), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

-- ── Rotation issues the new format too ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_statement_email_token(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug  text;
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  IF NOT (is_platform_admin() OR user_is_company_admin(p_company_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT public.statement_email_slug(name) INTO v_slug
  FROM public.companies
  WHERE id = p_company_id;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;

  -- Retry on the (vanishingly unlikely) UNIQUE collision.
  LOOP
    v_token := v_slug || '-' || encode(extensions.gen_random_bytes(6), 'hex');
    BEGIN
      UPDATE public.companies
      SET statement_email_token = v_token
      WHERE id = p_company_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- try a new key
    END;
  END LOOP;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_statement_email_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_statement_email_token(uuid) TO authenticated;

COMMENT ON COLUMN public.companies.statement_email_token IS
  'Local part of the company''s inbox.ownproperly.com forwarding address. Format: <name-slug>-<12-hex random key> (e.g. alicat-3f9c2a7b1d4e). Legacy rows keep bare 16/32-hex tokens until rotated. The random key is what makes the address unguessable — routing is exact-match on this whole value.';

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION:
--   SELECT public.statement_email_slug('AliCat Property Group');  -- 'alicat'
--   SELECT public.statement_email_slug('  --- ');                 -- 'company'
--   -- as company admin (via app): Rotate → address like alicat-3f9c2a7b1d4e@…
--   -- as non-member: regenerate_statement_email_token → permission_denied
-- ===========================================================================
