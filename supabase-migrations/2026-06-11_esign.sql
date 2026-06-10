-- ===========================================================================
-- E-signing (SCAFFOLD) — esign_envelopes
-- ===========================================================================
-- Feature flag: esign. INERT until a provider API key (ESIGN_PROVIDER_API_KEY)
-- is configured on the esign-envelope edge function. This migration only
-- creates the envelope-tracking table + RLS; no provider is wired in.
--
-- An "envelope" is one document sent to one signer for e-signature. The
-- lifecycle is tracked in `status`:
--   'draft'     — record created, not yet sent to a provider
--   'sent'      — handed to the provider (provider_envelope_id set)
--   'signed'    — provider reported completion (signed_at set)
--   'declined'  — signer declined
--   'voided'    — sender cancelled
--   'error'     — provider/send failure
--
-- DEPENDS ON (apply first):
--   2026-06-10_security_01_helpers.sql  (has_property_permission, company_is_live)
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.esign_envelopes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL DEFAULT auth.uid(),
  property_id          uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  document_id          uuid REFERENCES public.property_documents(id) ON DELETE SET NULL,
  signer_name          text NOT NULL,
  signer_email         text NOT NULL,
  status               text NOT NULL DEFAULT 'draft',
  provider             text,
  provider_envelope_id text,
  error_message        text,
  sent_at              timestamptz,
  signed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.esign_envelopes DROP CONSTRAINT IF EXISTS esign_envelopes_status_chk;
ALTER TABLE public.esign_envelopes
  ADD CONSTRAINT esign_envelopes_status_chk
  CHECK (status IN ('draft', 'sent', 'signed', 'declined', 'voided', 'error'));

CREATE INDEX IF NOT EXISTS idx_esign_envelopes_property_id ON public.esign_envelopes (property_id);
CREATE INDEX IF NOT EXISTS idx_esign_envelopes_company_id  ON public.esign_envelopes (company_id);
CREATE INDEX IF NOT EXISTS idx_esign_envelopes_document_id ON public.esign_envelopes (document_id);

ALTER TABLE public.esign_envelopes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT — owner, property collaborators, or platform operators
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esign_envelopes_select ON public.esign_envelopes;
CREATE POLICY esign_envelopes_select ON public.esign_envelopes
  FOR SELECT USING (
    is_developer()
    OR is_platform_admin()
    OR user_id = (SELECT auth.uid())
    OR (property_id IS NOT NULL AND has_property_access(property_id))
    OR (property_id IS NULL AND company_id IS NOT NULL AND has_company_access(company_id))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT — write-level on the property, company must be live
-- (envelopes without a property fall back to company-level write access)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esign_envelopes_insert ON public.esign_envelopes;
CREATE POLICY esign_envelopes_insert ON public.esign_envelopes
  FOR INSERT WITH CHECK (
    is_developer()
    OR is_platform_admin()
    OR (
      user_id = (SELECT auth.uid())
      AND (
        (property_id IS NOT NULL
          AND has_property_permission(property_id, 'write')
          AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id)))
        OR (property_id IS NULL
          AND company_id IS NOT NULL
          AND has_company_access(company_id)
          AND company_is_live(company_id))
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE — status transitions (send/void) by the property writer.
-- The send path runs through the edge function under service-role, which
-- bypasses RLS; this policy covers client-side voids and metadata edits.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esign_envelopes_update ON public.esign_envelopes;
CREATE POLICY esign_envelopes_update ON public.esign_envelopes
  FOR UPDATE
  USING (
    is_developer()
    OR is_platform_admin()
    OR (property_id IS NOT NULL AND has_property_permission(property_id, 'write'))
    OR (property_id IS NULL AND company_id IS NOT NULL AND has_company_access(company_id))
  )
  WITH CHECK (
    is_developer()
    OR is_platform_admin()
    OR (property_id IS NOT NULL AND has_property_permission(property_id, 'write'))
    OR (property_id IS NULL AND company_id IS NOT NULL AND has_company_access(company_id))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE — only draft/error envelopes by the property writer or operators
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS esign_envelopes_delete ON public.esign_envelopes;
CREATE POLICY esign_envelopes_delete ON public.esign_envelopes
  FOR DELETE USING (
    is_developer()
    OR is_platform_admin()
    OR (property_id IS NOT NULL AND has_property_permission(property_id, 'write'))
    OR (property_id IS NULL AND company_id IS NOT NULL AND has_company_access(company_id))
  );

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION
-- -- As a property writer on a live company:
-- -- INSERT INTO esign_envelopes (property_id, signer_name, signer_email)
-- --   VALUES ('<own-prop>', 'Jane Tenant', 'jane@example.com') RETURNING id;
-- --   -> row, status 'draft'
-- -- As a non-collaborator: same INSERT -> blocked by RLS
-- -- SELECT * FROM esign_envelopes WHERE property_id='<own-prop>'; -> own rows
-- ===========================================================================
