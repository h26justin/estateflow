-- ===========================================================================
-- Feature 7 — Tenant referencing + Right-to-Rent (INERT SCAFFOLD)
-- ===========================================================================
-- Partner-agnostic store for tenant reference / Right-to-Rent (RTR) checks
-- ordered from the lettings flow. Rows are created locally; the actual
-- provider order is performed by the referencing-request edge function and
-- is INERT until REFERENCING_PROVIDER_API_KEY is configured. Until then a
-- check stays in 'draft'.
--
-- This is distinct from the older tenant_references table: that is a simple
-- per-property local note list; this models a partner-order lifecycle with a
-- provider reference, structured result, and RTR support.
--
-- Gated client-side behind feature flag key "referencing" (seeded by the
-- integrator's consolidated feature_flags migration — NOT here).
--
-- Depends on 2026-06-10_security_01_helpers.sql (helpers) and properties.
-- Idempotent. ROLLBACK: DROP TABLE public.referencing_checks;
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.referencing_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id    UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  applicant_name  TEXT NOT NULL,
  applicant_email TEXT,
  check_type     TEXT NOT NULL DEFAULT 'reference'
                   CHECK (check_type IN ('reference', 'right_to_rent')),
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'ordered', 'in_progress', 'completed', 'failed', 'cancelled')),
  provider_ref   TEXT,
  result         JSONB,
  ordered_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referencing_checks_property
  ON public.referencing_checks(property_id);
CREATE INDEX IF NOT EXISTS idx_referencing_checks_company
  ON public.referencing_checks(company_id);

ALTER TABLE public.referencing_checks ENABLE ROW LEVEL SECURITY;

-- Read: developer, owner of the row, or any member with property access.
DROP POLICY IF EXISTS "referencing_checks_select" ON public.referencing_checks;
CREATE POLICY "referencing_checks_select" ON public.referencing_checks
FOR SELECT USING (
  is_developer()
  OR user_id = auth.uid()
  OR has_property_access(property_id)
);

-- Insert: writer on the property AND the owning company is live.
DROP POLICY IF EXISTS "referencing_checks_insert" ON public.referencing_checks;
CREATE POLICY "referencing_checks_insert" ON public.referencing_checks
FOR INSERT WITH CHECK (
  is_developer()
  OR (
    has_property_permission(property_id, 'write')
    AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
  )
);

-- Update: writer on the property AND company live.
DROP POLICY IF EXISTS "referencing_checks_update" ON public.referencing_checks;
CREATE POLICY "referencing_checks_update" ON public.referencing_checks
FOR UPDATE
USING (
  is_developer()
  OR has_property_permission(property_id, 'write')
)
WITH CHECK (
  is_developer()
  OR (
    has_property_permission(property_id, 'write')
    AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
  )
);

-- Delete: writer on the property (allow cancelling/cleanup even when not live).
DROP POLICY IF EXISTS "referencing_checks_delete" ON public.referencing_checks;
CREATE POLICY "referencing_checks_delete" ON public.referencing_checks
FOR DELETE USING (
  is_developer()
  OR has_property_permission(property_id, 'write')
);

NOTIFY pgrst, 'reload schema';
