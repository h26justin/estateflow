-- Three new columns on properties to capture mortgage information that
-- the existing rate × term × amount model can't express:
--
--  - mortgage_type: 'repayment' | 'interest_only' | 'mixed' | 'bridging'
--    For tax (Section 24) + reporting we need to know what KIND of
--    mortgage it is. Existing calcMonthlyMortgage assumed repayment;
--    UI updates to honour this field land in the same commit.
--
--  - mortgage_monthly_payment: numeric (£/month, optional override).
--    When set, the app DISPLAYS this number instead of the back-
--    calculated value. Critical for messy real-world mortgages where
--    fees, part-and-part splits, or product transitions mean the
--    formula doesn't match the user's actual direct debit.
--
--  - mortgage_fees: numeric. Setup / arrangement / legal fees the
--    bank charged to put the mortgage in place. Separate from
--    purchase-time stamp_duty / legal_fees because those refer to the
--    PROPERTY acquisition, not the loan facility.
--
-- Applied via Supabase MCP on 2026-05-23.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS mortgage_type            text,
  ADD COLUMN IF NOT EXISTS mortgage_monthly_payment numeric,
  ADD COLUMN IF NOT EXISTS mortgage_fees            numeric DEFAULT 0;

COMMENT ON COLUMN public.properties.mortgage_type            IS 'repayment | interest_only | mixed | bridging — drives the monthly calculation';
COMMENT ON COLUMN public.properties.mortgage_monthly_payment IS 'Optional: user-quoted actual monthly direct debit. When set, displays instead of calculated value';
COMMENT ON COLUMN public.properties.mortgage_fees            IS 'Setup/arrangement/legal fees the bank charged to set up this mortgage';
