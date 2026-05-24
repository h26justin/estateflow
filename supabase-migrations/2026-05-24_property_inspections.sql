-- Property inspection scheduling.
--
-- Periodic mid-tenancy and check-in / check-out inspections are a UK
-- landlord legal best-practice (and required by some lender / insurer
-- clauses). Arthur Online + Landlord Vision both ship this; we don't.
-- This table tracks scheduled + completed inspections with photo
-- evidence stored in the existing property-documents bucket.
--
-- Applied via Supabase MCP on 2026-05-24.

CREATE TABLE IF NOT EXISTS public.property_inspections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inspection_type TEXT NOT NULL DEFAULT 'mid_term',
  scheduled_date  DATE,
  completed_date  DATE,
  inspector_name  TEXT,
  notes           TEXT,
  overall_condition TEXT,
  photos          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID
);

CREATE INDEX IF NOT EXISTS property_inspections_property_idx
  ON public.property_inspections (property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS property_inspections_scheduled_idx
  ON public.property_inspections (user_id, scheduled_date)
  WHERE deleted_at IS NULL AND completed_date IS NULL;

ALTER TABLE public.property_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspections_select_own ON public.property_inspections;
DROP POLICY IF EXISTS inspections_insert_own ON public.property_inspections;
DROP POLICY IF EXISTS inspections_update_own ON public.property_inspections;
DROP POLICY IF EXISTS inspections_delete_own ON public.property_inspections;

CREATE POLICY inspections_select_own ON public.property_inspections
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY inspections_insert_own ON public.property_inspections
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY inspections_update_own ON public.property_inspections
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY inspections_delete_own ON public.property_inspections
  FOR DELETE USING (auth.uid() = user_id);
