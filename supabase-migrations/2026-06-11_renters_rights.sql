-- Renters Rights Act compliance copilot.
--
-- Adds rra_compliance: one tracking row per (company, property) capturing
-- the landlord's progress against the Renters Rights Act — PRS database
-- registration, ombudsman membership, and periodic-tenancy conversion.
-- Awaab's-Law repair timers are derived at read-time from maintenance_jobs
-- (no schema change there) so this migration only owns the tracker table.
--
-- All legal status here is GUIDANCE the landlord self-attests; the app
-- never asserts legal compliance on their behalf.
--
-- ROLLBACK: DROP TABLE public.rra_compliance;

CREATE TABLE IF NOT EXISTS public.rra_compliance (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL DEFAULT auth.uid(),
  property_id          uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  prs_registered       boolean NOT NULL DEFAULT false,
  prs_reference        text,
  ombudsman_registered boolean NOT NULL DEFAULT false,
  ombudsman_reference  text,
  periodic_converted   boolean NOT NULL DEFAULT false,
  periodic_converted_at date,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rra_compliance_company_property_uniq
  ON public.rra_compliance (company_id, COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS rra_compliance_company_idx  ON public.rra_compliance (company_id);
CREATE INDEX IF NOT EXISTS rra_compliance_property_idx ON public.rra_compliance (property_id);
CREATE INDEX IF NOT EXISTS rra_compliance_user_idx     ON public.rra_compliance (user_id);

ALTER TABLE public.rra_compliance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rra_compliance_select ON public.rra_compliance;
CREATE POLICY rra_compliance_select ON public.rra_compliance
  FOR SELECT USING (
    public.is_developer()
    OR user_id = auth.uid()
    OR (property_id IS NOT NULL AND public.has_property_access(property_id))
    OR public.has_company_access(company_id)
  );

DROP POLICY IF EXISTS rra_compliance_insert ON public.rra_compliance;
CREATE POLICY rra_compliance_insert ON public.rra_compliance
  FOR INSERT WITH CHECK (
    public.has_company_access(company_id)
    AND (property_id IS NULL OR public.has_property_permission(property_id, 'write'))
    AND public.company_is_live(company_id)
  );

DROP POLICY IF EXISTS rra_compliance_update ON public.rra_compliance;
CREATE POLICY rra_compliance_update ON public.rra_compliance
  FOR UPDATE USING (
    public.has_company_access(company_id)
    AND (property_id IS NULL OR public.has_property_permission(property_id, 'write'))
  ) WITH CHECK (
    public.has_company_access(company_id)
    AND (property_id IS NULL OR public.has_property_permission(property_id, 'write'))
    AND public.company_is_live(company_id)
  );

DROP POLICY IF EXISTS rra_compliance_delete ON public.rra_compliance;
CREATE POLICY rra_compliance_delete ON public.rra_compliance
  FOR DELETE USING (
    public.has_company_access(company_id)
    AND (property_id IS NULL OR public.has_property_permission(property_id, 'write'))
  );

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.rra_compliance_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rra_compliance_touch() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rra_compliance_touch() FROM anon;

DROP TRIGGER IF EXISTS rra_compliance_touch_trg ON public.rra_compliance;
CREATE TRIGGER rra_compliance_touch_trg
  BEFORE UPDATE ON public.rra_compliance
  FOR EACH ROW EXECUTE FUNCTION public.rra_compliance_touch();

NOTIFY pgrst, 'reload schema';
