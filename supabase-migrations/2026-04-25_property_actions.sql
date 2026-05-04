-- Migration: property action menu — archive, mark-as-sold
-- Run in Supabase SQL Editor. Idempotent.

alter table properties
  add column if not exists archived_at timestamptz,
  add column if not exists sale_price  numeric,
  add column if not exists sale_date   date;

create index if not exists idx_properties_archived
  on properties(archived_at)
  where archived_at is not null;

-- Refresh PostgREST cache
notify pgrst, 'reload schema';
