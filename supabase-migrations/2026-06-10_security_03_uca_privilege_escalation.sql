-- ===========================================================================
-- Security hardening 03 — user_company_access privilege-escalation fix (CRITICAL)
-- ===========================================================================
-- LIVE BUG: the uca_insert/uca_update/uca_delete policies are
--   (is_developer() OR has_company_access(company_id))
-- and has_company_access() is true for ANY member (incl. viewer). With the
-- `authenticated` role holding column UPDATE on role/is_admin/is_owner, a
-- low-privilege collaborator can UPDATE their own row to is_admin=true /
-- is_owner=true / role='admin' and seize company-wide control. (The repo file
-- row-level-security.sql:222-251 already had a safer owner-only version, but
-- production has drifted back to the membership-only form.)
--
-- FIX: writes are allowed only for the company owner, an existing company
-- admin, the operator (developer), OR a self-service join — and a self-service
-- write may NEVER set is_owner, and may only set is_admin/elevated role when a
-- matching invitation actually granted it. This preserves every legitimate
-- write path used by src/ via the anon client:
--   * grantCompanyAccess / setAllCompanyAccess / AccessModal.addUser
--     / adminMergeCompanies / adminTransferCompany  -> owner/admin branch
--   * acceptInvitation self-upsert (per-email invites)               -> self branch
--   * redeem_company_invite (SECURITY DEFINER, bypasses RLS)         -> unaffected
--
-- user_company_access.user_id is TEXT, so caller comparison uses auth.uid()::text.
-- Idempotent. ROLLBACK: restore the policies from row-level-security.sql.
-- ===========================================================================

ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;

-- ── SELECT: self, company owner/admin, or developer ──────────────────────────
DROP POLICY IF EXISTS "uca_select" ON public.user_company_access;
CREATE POLICY "uca_select" ON public.user_company_access
FOR SELECT USING (
  is_developer()
  OR user_id = auth.uid()::text
  OR user_is_company_admin(company_id)
);

-- ── INSERT ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "uca_insert" ON public.user_company_access;
CREATE POLICY "uca_insert" ON public.user_company_access
FOR INSERT WITH CHECK (
  is_developer()
  OR (
    -- Owner / existing admin manages members. They may not self-grant
    -- ownership unless they are the real company owner.
    user_is_company_admin(company_id)
    AND (
      is_owner IS NOT TRUE
      OR EXISTS (SELECT 1 FROM companies c WHERE c.id = company_id AND c.owner_id = auth.uid())
    )
  )
  OR (
    -- Self-service join (invite acceptance / code redeem fallback).
    user_id = auth.uid()::text
    AND is_owner IS NOT TRUE
    AND (
      (is_admin IS NOT TRUE AND (role IS NULL OR role IN ('viewer', 'editor')))
      OR EXISTS (
        SELECT 1 FROM invitations i
        WHERE i.company_id = user_company_access.company_id
          AND i.email = auth.email()
          AND i.is_admin = true
      )
    )
  )
);

-- ── UPDATE ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "uca_update" ON public.user_company_access;
CREATE POLICY "uca_update" ON public.user_company_access
FOR UPDATE
USING (
  is_developer()
  OR user_is_company_admin(company_id)
  OR user_id = auth.uid()::text
)
WITH CHECK (
  is_developer()
  OR (
    user_is_company_admin(company_id)
    AND (
      is_owner IS NOT TRUE
      OR EXISTS (SELECT 1 FROM companies c WHERE c.id = company_id AND c.owner_id = auth.uid())
    )
  )
  OR (
    -- A user editing their OWN row may never escalate themselves.
    user_id = auth.uid()::text
    AND is_admin IS NOT TRUE
    AND is_owner IS NOT TRUE
    AND (role IS NULL OR role IN ('viewer', 'editor'))
  )
);

-- ── DELETE: owner/admin/developer only ───────────────────────────────────────
DROP POLICY IF EXISTS "uca_delete" ON public.user_company_access;
CREATE POLICY "uca_delete" ON public.user_company_access
FOR DELETE USING (
  is_developer()
  OR user_is_company_admin(company_id)
);

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION (as a viewer collaborator, not developer/owner):
--   -- self-escalation must FAIL:
--   UPDATE user_company_access SET is_admin = true
--     WHERE user_id = auth.uid()::text AND company_id = '<co>';   -> 0 rows / error
--   UPDATE user_company_access SET is_owner = true
--     WHERE user_id = auth.uid()::text AND company_id = '<co>';   -> blocked
--   -- owner managing a member still works (run as owner).
-- ===========================================================================
