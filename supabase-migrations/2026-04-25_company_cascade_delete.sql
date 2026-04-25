-- Migration: cascade-aware company soft-delete
-- Adds deletion_batch_id to companies and properties so that when a company is
-- cascade-deleted, both it and its properties share the same batch UUID. On
-- restore, we use the batch ID to re-link them.
--
-- Existing soft-delete columns (deleted_at, deleted_by) were already present;
-- this migration only adds the new batch-tracking column.
--
-- Run in Supabase SQL Editor. Idempotent.

alter table companies
  add column if not exists deletion_batch_id uuid;

alter table properties
  add column if not exists deletion_batch_id uuid;

-- Helpful indexes for restore queries (filtered to nullable column)
create index if not exists idx_companies_deletion_batch
  on companies(deletion_batch_id) where deletion_batch_id is not null;

create index if not exists idx_properties_deletion_batch
  on properties(deletion_batch_id) where deletion_batch_id is not null;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
