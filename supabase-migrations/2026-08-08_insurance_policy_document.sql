-- ── Insurance policy documents ───────────────────────────────────────────────
-- insurance_policies.document_id — links a policy to its schedule/certificate
-- PDF stored as a company document (policies are company-scoped; the file
-- lives in the private property-documents bucket under company_documents).
-- Nullable and additive: safe on live data.

alter table insurance_policies add column if not exists document_id uuid references company_documents(id) on delete set null;
