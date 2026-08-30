-- ===========================================================================
-- CORPORATE SHAREHOLDERS — let a company be owned by another company
-- ===========================================================================
-- Cap tables aren't only people: a company is often owned by a holding
-- company (e.g. an operating PropCo whose PSCs are two family holding
-- companies). Two additions to company_shareholders:
--
--   shareholder_type       — 'individual' (default, existing rows) or
--                            'company'. Corporate shareholders get NO
--                            personal dividend tax estimate: dividends paid
--                            between UK companies are normally exempt from
--                            corporation tax, so the band-rate estimate the
--                            P&L applies to people is simply wrong for them.
--                            Personal tax arises later, when the holding
--                            company pays ITS shareholders — which the app
--                            can model when the holding company is linked:
--   shareholder_company_id — optional link to the holding company's own
--                            record in `companies`. When set, "My share" /
--                            personal-income reports look through the chain:
--                            your effective stake in the operating company =
--                            (holding co's %) × (your % of the holding co),
--                            recursively, using the tax band on YOUR row of
--                            the holding company for the dividend estimate.
--
-- tax_band is left in place but ignored for company rows (the UI hides the
-- picker); existing corporate rows mis-entered as people keep their band
-- harmlessly.
--
-- Safe to run multiple times.
-- ===========================================================================

ALTER TABLE company_shareholders
  ADD COLUMN IF NOT EXISTS shareholder_type text NOT NULL DEFAULT 'individual';

ALTER TABLE company_shareholders
  ADD COLUMN IF NOT EXISTS shareholder_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

-- Re-assertable constraints (ADD CONSTRAINT has no IF NOT EXISTS).
ALTER TABLE company_shareholders DROP CONSTRAINT IF EXISTS company_shareholders_type_check;
ALTER TABLE company_shareholders ADD CONSTRAINT company_shareholders_type_check
  CHECK (shareholder_type IN ('individual','company'));

-- A company cannot hold shares in itself, and only company rows may link.
ALTER TABLE company_shareholders DROP CONSTRAINT IF EXISTS company_shareholders_link_check;
ALTER TABLE company_shareholders ADD CONSTRAINT company_shareholders_link_check
  CHECK (
    shareholder_company_id IS NULL
    OR (shareholder_type = 'company' AND shareholder_company_id <> company_id)
  );

CREATE INDEX IF NOT EXISTS idx_company_shareholders_holding
  ON company_shareholders(shareholder_company_id)
  WHERE shareholder_company_id IS NOT NULL;

COMMENT ON COLUMN company_shareholders.shareholder_type IS
  'individual (person) or company (corporate shareholder, e.g. a holding company). Company rows get no personal dividend tax estimate.';
COMMENT ON COLUMN company_shareholders.shareholder_company_id IS
  'When the shareholder is itself a company managed in this app, its companies.id — lets reports look through holding chains for effective personal ownership.';
