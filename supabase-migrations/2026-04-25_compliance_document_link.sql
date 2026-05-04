-- Migration: link compliance items to source documents
-- Run this in the Supabase SQL Editor before deploying the new app code.
-- Safe to re-run: every statement is IF NOT EXISTS / idempotent.

alter table compliance_items
  add column if not exists document_id uuid references property_documents(id) on delete set null;

create index if not exists idx_compliance_document
  on compliance_items(document_id)
  where document_id is not null;

-- Tell PostgREST to refresh its schema cache so the API sees the new column.
notify pgrst, 'reload schema';
