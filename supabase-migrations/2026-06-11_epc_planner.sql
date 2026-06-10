-- ===========================================================================
-- EPC C retrofit planner  (Feature 10 — flag: epc_planner)
-- ===========================================================================
-- Stores per-property EPC retrofit plans: the current rating, the target
-- (EPC C by the 2030 MEES deadline), a prioritised JSONB list of retrofit
-- measures (each with a rough cost + expected SAP uplift) and the estimated
-- total cost. The measures + costs are produced as AI guidance by the
-- epc-planner edge function and saved here so the property's "EPC plan" tab
-- and the deal/ROI view can reuse them without re-calling Claude.
--
-- DEPENDS ON (apply first):
--   2026-06-10_security_01_helpers.sql  (has_property_permission, company_is_live)
--   row-level-security.sql              (has_property_access, has_company_access,
--                                         is_developer)
--   audit-and-soft-delete.sql           (audit_trigger_fn)
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.epc_assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  company_id     uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL DEFAULT auth.uid(),
  current_rating text,
  target_rating  text NOT NULL DEFAULT 'C',
  measures       jsonb NOT NULL DEFAULT '[]'::jsonb,
  est_total_cost numeric,
  deadline       date NOT NULL DEFAULT '2030-12-31',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_epc_assessments_property_id ON public.epc_assessments (property_id);
CREATE INDEX IF NOT EXISTS idx_epc_assessments_company_id  ON public.epc_assessments (company_id);
CREATE INDEX IF NOT EXISTS idx_epc_assessments_user_id     ON public.epc_assessments (user_id);

ALTER TABLE public.epc_assessments ENABLE ROW LEVEL SECURITY;

-- ── SELECT: developer, owner, or anyone with access to the property ──────────
DROP POLICY IF EXISTS epc_assessments_select ON public.epc_assessments;
CREATE POLICY epc_assessments_select ON public.epc_assessments
  FOR SELECT USING (
    is_developer()
    OR user_id = (SELECT auth.uid())
    OR has_property_access(property_id)
  );

-- ── INSERT: write permission on the property + company live ──────────────────
DROP POLICY IF EXISTS epc_assessments_insert ON public.epc_assessments;
CREATE POLICY epc_assessments_insert ON public.epc_assessments
  FOR INSERT WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

-- ── UPDATE: write permission on the property + company live ──────────────────
DROP POLICY IF EXISTS epc_assessments_update ON public.epc_assessments;
CREATE POLICY epc_assessments_update ON public.epc_assessments
  FOR UPDATE USING (
    is_developer()
    OR has_property_permission(property_id, 'write')
  ) WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

-- ── DELETE: write permission on the property ─────────────────────────────────
DROP POLICY IF EXISTS epc_assessments_delete ON public.epc_assessments;
CREATE POLICY epc_assessments_delete ON public.epc_assessments
  FOR DELETE USING (
    is_developer()
    OR has_property_permission(property_id, 'write')
  );

-- ── Audit trail (mirrors other property-scoped tables) ───────────────────────
DROP TRIGGER IF EXISTS epc_assessments_audit ON public.epc_assessments;
CREATE TRIGGER epc_assessments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.epc_assessments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

NOTIFY pgrst, 'reload schema';
