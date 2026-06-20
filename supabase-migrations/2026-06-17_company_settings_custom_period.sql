-- 2026-06-17: custom reporting period on company_settings
-- Adds an explicit custom date range so a company's default reporting period
-- can be 'tax_year', 'calendar_year', or 'custom'. When year_type = 'custom'
-- the two date columns below define the range used by Reports.
-- Both nullable: only populated when year_type = 'custom'. Idempotent.

alter table public.company_settings
  add column if not exists custom_period_start date,
  add column if not exists custom_period_end   date;

-- Guard: when a custom period is set, end must not precede start.
-- (NULLs are allowed so tax_year/calendar_year rows are unaffected.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_settings_custom_period_order'
  ) then
    alter table public.company_settings
      add constraint company_settings_custom_period_order
      check (
        custom_period_start is null
        or custom_period_end is null
        or custom_period_end >= custom_period_start
      );
  end if;
end $$;
