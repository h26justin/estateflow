-- Track when the current mortgage product (fixed/tracker rate) ends.
-- Distinct from mortgage_term (full loan length) — this is when the
-- user needs to remortgage to a new product or revert to SVR.
--
-- Drives 90/60/30-day remortgage notifications. Pairs with a future
-- broker referral partnership for revenue (£200-500/deal).
--
-- Applied via Supabase MCP on 2026-05-24.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS mortgage_product_end_date DATE;

COMMENT ON COLUMN public.properties.mortgage_product_end_date IS
  'When the current rate product (fixed/tracker) expires. After this date the loan reverts to SVR unless remortgaged. Drives the 90/60/30-day remortgage alerts.';

CREATE INDEX IF NOT EXISTS properties_mortgage_product_end_idx
  ON public.properties (user_id, mortgage_product_end_date)
  WHERE deleted_at IS NULL AND mortgage_product_end_date IS NOT NULL;
