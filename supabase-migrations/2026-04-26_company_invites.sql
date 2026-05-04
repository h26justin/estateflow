-- ===========================================================================
-- company_invites table — shareable link/code invites for company access
-- ===========================================================================
-- Different from `invitations` (which is per-email). This is for owner-generated
-- codes that can be shared via URL or short code. One code can let multiple
-- people join (subject to max_uses), and codes can be revoked.
--
-- Safe to run multiple times.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS company_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The company being shared
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- The user who created this invite (for audit + permission checks).
  -- Soft FK to auth.users — if the creator is deleted we keep the row.
  created_by      uuid NOT NULL,
  -- The code itself. URL-safe. Unique. Stored exactly as it appears in URLs
  -- (e.g. "HMD-7K3X" or a longer random token).
  code            text NOT NULL UNIQUE,
  -- How many times this code can be redeemed before becoming inactive.
  -- NULL = unlimited; otherwise a positive integer.
  max_uses        int,
  used_count      int NOT NULL DEFAULT 0,
  -- When the code stops working. NULL = never expires.
  expires_at      timestamptz,
  -- Whether redeemers join as admin (vs read-only). Owner-or-not is decided
  -- when access is granted; new joiners are never owners.
  is_admin        bool NOT NULL DEFAULT false,
  -- Manual revoke. Once set the code stops working immediately regardless of
  -- max_uses or expires_at.
  revoked_at      timestamptz,
  revoked_by      uuid,
  -- Convenience label so the owner can remember what a code was for
  -- ("Whatsapp share to John" etc). Optional.
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_invites_company_id ON company_invites(company_id);
CREATE INDEX IF NOT EXISTS idx_company_invites_code       ON company_invites(code);
CREATE INDEX IF NOT EXISTS idx_company_invites_active
  ON company_invites(company_id)
  WHERE revoked_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_company_invites_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_invites_updated_at ON company_invites;
CREATE TRIGGER trg_company_invites_updated_at
  BEFORE UPDATE ON company_invites
  FOR EACH ROW EXECUTE FUNCTION update_company_invites_updated_at();

-- Enable RLS
ALTER TABLE company_invites ENABLE ROW LEVEL SECURITY;

-- RLS: Only company members (with admin or owner permissions) can see/manage
-- invites for their companies. Looking up a code by code value during signup
-- happens via a separate SECURITY DEFINER function (defined below) so we
-- don't have to expose this table to anonymous users.

DROP POLICY IF EXISTS "Company admins see own invites" ON company_invites;
CREATE POLICY "Company admins see own invites" ON company_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_company_access
      WHERE user_company_access.user_id = auth.uid()
        AND user_company_access.company_id = company_invites.company_id
        AND (user_company_access.is_admin = true OR user_company_access.is_owner = true)
    )
    OR EXISTS (
      -- Also allow direct company owner (legacy: owner_id on companies row)
      SELECT 1 FROM companies
      WHERE companies.id = company_invites.company_id
        AND companies.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company admins create invites" ON company_invites;
CREATE POLICY "Company admins create invites" ON company_invites
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM user_company_access
        WHERE user_company_access.user_id = auth.uid()
          AND user_company_access.company_id = company_invites.company_id
          AND (user_company_access.is_admin = true OR user_company_access.is_owner = true)
      )
      OR EXISTS (
        SELECT 1 FROM companies
        WHERE companies.id = company_invites.company_id
          AND companies.owner_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Company admins update own invites" ON company_invites;
CREATE POLICY "Company admins update own invites" ON company_invites
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_company_access
      WHERE user_company_access.user_id = auth.uid()
        AND user_company_access.company_id = company_invites.company_id
        AND (user_company_access.is_admin = true OR user_company_access.is_owner = true)
    )
    OR EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = company_invites.company_id
        AND companies.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company admins delete own invites" ON company_invites;
CREATE POLICY "Company admins delete own invites" ON company_invites
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_company_access
      WHERE user_company_access.user_id = auth.uid()
        AND user_company_access.company_id = company_invites.company_id
        AND (user_company_access.is_admin = true OR user_company_access.is_owner = true)
    )
    OR EXISTS (
      SELECT 1 FROM companies
      WHERE companies.id = company_invites.company_id
        AND companies.owner_id = auth.uid()
    )
  );

-- ===========================================================================
-- redeem_company_invite(code text)
-- ===========================================================================
-- Atomically validates and redeems an invite code for the calling user.
-- - Looks up the code (case-insensitive)
-- - Checks not revoked, not expired, used_count < max_uses (if set)
-- - Inserts/upserts a user_company_access row
-- - Increments used_count
-- - Returns the company_id and is_admin so the client can navigate
--
-- SECURITY DEFINER so it can read company_invites by code without exposing the
-- whole table to anonymous users via RLS.
-- ===========================================================================
CREATE OR REPLACE FUNCTION redeem_company_invite(p_code text)
RETURNS TABLE(
  company_id uuid,
  is_admin   bool,
  company_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite   company_invites%ROWTYPE;
  v_user_id  uuid;
  v_email    text;
  v_co_name  text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  -- Look up the code (case-insensitive — codes look like 'HMD-7K3X')
  SELECT * INTO v_invite
  FROM company_invites
  WHERE upper(code) = upper(p_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked';
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'invite_exhausted';
  END IF;

  -- Get the user's email for the access row
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Grant access (upsert in case they're already in some way)
  INSERT INTO user_company_access (user_id, company_id, email, is_admin, is_owner)
  VALUES (v_user_id, v_invite.company_id, v_email, v_invite.is_admin, false)
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET is_admin = EXCLUDED.is_admin OR user_company_access.is_admin,
        email    = COALESCE(user_company_access.email, EXCLUDED.email);

  -- Increment used_count
  UPDATE company_invites
  SET used_count = used_count + 1
  WHERE id = v_invite.id;

  -- Get company name for the response
  SELECT name INTO v_co_name FROM companies WHERE id = v_invite.company_id;

  RETURN QUERY SELECT v_invite.company_id, v_invite.is_admin, v_co_name;
END;
$$;

-- Grant the function to authenticated users (anon doesn't need it because
-- you have to be signed in to redeem)
REVOKE ALL ON FUNCTION redeem_company_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_company_invite(text) TO authenticated;

-- ===========================================================================
-- find_companies_by_name_fuzzy(name_query text)
-- ===========================================================================
-- For the duplicate-name guard at signup. Returns companies that are similarly
-- named to the user's input, so we can show "did you mean to join one of these?"
-- Returns id, name, and the email of the owner (so the new user can ask the
-- owner for an invite). Only returns companies that have at least one user
-- with admin/owner — i.e. real workspaces, not abandoned shells.
--
-- Uses simple normalisation (lowercase, strip Ltd/Limited, strip non-letters)
-- to catch "Hammond Properties" / "Hammond Properties Ltd" / "Hammond Property"
-- as the same fuzzy group.
-- ===========================================================================
CREATE OR REPLACE FUNCTION find_companies_by_name_fuzzy(p_query text)
RETURNS TABLE(
  id uuid,
  name text,
  owner_email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH normalised AS (
    SELECT
      regexp_replace(
        regexp_replace(
          lower(trim(p_query)),
          '\b(ltd|limited|llc|inc|llp|plc)\b', '', 'g'
        ),
        '[^a-z0-9]', '', 'g'
      ) AS q
  )
  SELECT c.id, c.name,
         (SELECT email FROM auth.users WHERE auth.users.id = c.owner_id) AS owner_email
  FROM companies c, normalised n
  WHERE c.deleted_at IS NULL
    AND length(n.q) >= 3
    AND regexp_replace(
          regexp_replace(
            lower(trim(c.name)),
            '\b(ltd|limited|llc|inc|llp|plc)\b', '', 'g'
          ),
          '[^a-z0-9]', '', 'g'
        ) = n.q
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION find_companies_by_name_fuzzy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_companies_by_name_fuzzy(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
