-- Pre-deploy schema fix
-- Ensures property_documents has the soft-delete columns the front-end expects.
-- Safe to run even if columns already exist (uses IF NOT EXISTS).

ALTER TABLE property_documents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- Index for the predicate the front-end uses most often
-- (querying "active" rows where deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_prop_docs_deleted_at
  ON property_documents(deleted_at)
  WHERE deleted_at IS NULL;

-- Reload PostgREST schema cache so column changes are visible immediately
NOTIFY pgrst, 'reload schema';
