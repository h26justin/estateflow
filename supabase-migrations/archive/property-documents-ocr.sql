-- Document OCR Vault — ADD columns to existing property_documents table
-- The existing DocumentsTab uses: name, file_url, file_path, file_type, file_size, category
-- This migration extends it with AI extraction capability without breaking anything.

ALTER TABLE property_documents
  ADD COLUMN IF NOT EXISTS extraction_status TEXT DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS extracted_fields JSONB,
  ADD COLUMN IF NOT EXISTS extraction_error TEXT,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

-- Allowed values for extraction_status:
--   'not_requested' — user hasn't asked for AI extraction
--   'pending'       — queued for extraction
--   'processing'    — extraction in progress
--   'completed'     — extraction done, extracted_fields populated
--   'failed'        — extraction failed, see extraction_error

CREATE INDEX IF NOT EXISTS idx_prop_docs_ext_status ON property_documents(extraction_status);
