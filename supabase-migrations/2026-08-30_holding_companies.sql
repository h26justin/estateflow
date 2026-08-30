-- ===========================================================================
-- HOLDING COMPANIES — a company type for companies that hold companies
-- ===========================================================================
-- Follow-on from 2026-08-30_corporate_shareholders.sql. A holding company
-- (e.g. a family holdco that owns the operating PropCos) has no properties
-- of its own, so presenting it like an operating company gives an empty
-- portfolio and misleading tax maths. Two columns on companies:
--
--   company_type — 'operating' (default, every existing row) or 'holding'.
--                  Holding companies swap the properties view for a group
--                  view (their stakes in other companies, derived from
--                  company_shareholders.shareholder_company_id links), are
--                  hidden from property pickers, and get a dividend-income
--                  Company P&L instead of an empty rent P&L.
--   ct_passive   — holding companies only. HMRC's associated-company rule
--                  divides the corporation tax thresholds by the number of
--                  associated companies, but EXCLUDES passive holding
--                  companies (ones that only hold shares and pass dividends
--                  through — no trade, fees, interest, or other assets).
--                  true (default) = passive, excluded from the app's
--                  associated-company count; false = active, counted.
--                  Ignored for operating companies (always counted).
--
-- Safe to run multiple times.
-- ===========================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_type text NOT NULL DEFAULT 'operating';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ct_passive boolean NOT NULL DEFAULT true;

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_company_type_check;
ALTER TABLE companies ADD CONSTRAINT companies_company_type_check
  CHECK (company_type IN ('operating','holding'));

COMMENT ON COLUMN companies.company_type IS
  'operating (default — owns properties) or holding (owns other companies; shown as a group view, no property picker, dividend-income P&L).';
COMMENT ON COLUMN companies.ct_passive IS
  'Holding companies only: true = passive holdco (shares + pass-through dividends only), excluded from the associated-company count that splits CT thresholds; false = active (charges fees/interest, holds assets, or retains dividends), counted.';
