-- Deal growth assumptions: editable per-deal rent and capital growth rates
-- for the 10-year projection on the deal calculator and in the PDF pack.
-- Defaults match the projection's built-in assumptions (5% rent, 3% capital).
--
-- Apply as a gated production change (DEPLOYMENT_RUNBOOK.md) BEFORE the
-- frontend deploys: the editor writes these columns when a user changes the
-- percentages, and a save would fail without them. Reads use select *, so a
-- deploy without the columns only breaks editing the two fields, not viewing.

alter table public.deals
  add column if not exists rent_growth_percent    numeric default 5,
  add column if not exists capital_growth_percent numeric default 3;

-- VERIFY
--   select column_name, column_default from information_schema.columns
--     where table_name='deals' and column_name in ('rent_growth_percent','capital_growth_percent');
--   -> 2 rows, defaults 5 and 3
