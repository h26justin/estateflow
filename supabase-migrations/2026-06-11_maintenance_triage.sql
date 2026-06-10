-- AI Maintenance Triage — adds nullable result columns to maintenance_jobs.
--
-- The triage edge function (maintenance-triage) analyses a repair's photos +
-- description with Claude and writes the structured result here as a DRAFT for
-- the landlord to review. No new RLS is required: these columns live on
-- maintenance_jobs and inherit its existing row-level policies (select/insert/
-- update/delete already gated by has_property_access / has_property_permission).
--
-- Columns:
--   ai_triage      jsonb        full triage blob: { severity, category,
--                               suggested_trade, diagnosis, suggested_priority,
--                               contractor_brief, confidence, model_used,
--                               disclaimer }
--   ai_severity    text         flattened severity for quick filtering/sorting
--                               (one of: low | medium | high | emergency)
--   ai_triaged_at  timestamptz  when triage last ran
--
-- ROLLBACK:
--   ALTER TABLE public.maintenance_jobs DROP COLUMN IF EXISTS ai_triage;
--   ALTER TABLE public.maintenance_jobs DROP COLUMN IF EXISTS ai_severity;
--   ALTER TABLE public.maintenance_jobs DROP COLUMN IF EXISTS ai_triaged_at;

ALTER TABLE public.maintenance_jobs ADD COLUMN IF NOT EXISTS ai_triage     jsonb;
ALTER TABLE public.maintenance_jobs ADD COLUMN IF NOT EXISTS ai_severity   text;
ALTER TABLE public.maintenance_jobs ADD COLUMN IF NOT EXISTS ai_triaged_at timestamptz;

NOTIFY pgrst, 'reload schema';
