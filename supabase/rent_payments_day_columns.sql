-- Add day-level date range columns to rent_payments
-- Run in Supabase SQL Editor

alter table rent_payments
  add column if not exists period_start date,
  add column if not exists period_end   date;

-- Index for day-range queries
create index if not exists rent_payments_period_idx
  on rent_payments(property_id, period_start, period_end);
