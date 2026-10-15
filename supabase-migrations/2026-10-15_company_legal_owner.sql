-- ===========================================================================
-- companies.legal_owner — who legally owns a company's properties (MTD ITSA)
-- ===========================================================================
-- WHY: MTD ITSA (personal UK property income) must leave out rent from
-- properties held in a limited company — that income is corporation tax.
-- Companies in EstateFlow are used both as real limited companies AND as
-- plain portfolio groupings for personally owned property (184/185 live
-- properties carry a company_id), and company_type is only
-- 'operating' / 'holding', so nothing today says which is which.
--
-- WHAT: a nullable text flag set by the user in Companies settings:
--   'personal'        — the properties are owned personally (in MTD)
--   'limited_company' — the properties are owned by the company (left out)
--   NULL              — not set yet; treated as personal, so MTD figures are
--                       unchanged until the user chooses.
-- Existing rows stay NULL (no default, no backfill).
--
-- ACCESS: no policy or grant is loosened. Writes go through the existing
-- companies_update RLS policy (company owner / developer) and the
-- enforce_company_billing_guard trigger, which only blocks changes to
-- billing / ownership columns (is_free_tier, free_tier_*, trial_ends_at,
-- owner_id) — legal_owner is not one of them, so an owner can set it.
-- No column-level grants are needed while authenticated holds table-level
-- SELECT/UPDATE on companies (verify on the live DB before applying: if
-- companies ever moves to column-level grants, add legal_owner to them).
--
-- Idempotent. Not yet applied to production.
-- ROLLBACK:
--   ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_legal_owner_check;
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS legal_owner;
--   NOTIFY pgrst, 'reload schema';
-- ===========================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_owner text;

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_legal_owner_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_legal_owner_check
  CHECK (legal_owner IS NULL OR legal_owner IN ('personal', 'limited_company'));

COMMENT ON COLUMN public.companies.legal_owner IS
  'Legal owner of the company''s properties for Making Tax Digital: personal (included in personal MTD ITSA figures), limited_company (corporation tax, excluded), NULL = not set (treated as personal).';

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION (as a regular company owner, not admin):
--   UPDATE companies SET legal_owner = 'limited_company' WHERE id = '<own-co>';  -> OK
--   UPDATE companies SET legal_owner = 'partnership'     WHERE id = '<own-co>';  -> ERROR (check)
--   UPDATE companies SET legal_owner = NULL              WHERE id = '<own-co>';  -> OK
--   UPDATE companies SET legal_owner = 'personal'   WHERE id = '<other-co>';     -> 0 rows (RLS)
-- ===========================================================================
