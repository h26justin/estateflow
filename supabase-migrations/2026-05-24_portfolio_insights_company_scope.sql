-- Add company scoping to portfolio_insights.
--
-- Previously every user had one global insights row covering ALL their
-- companies. When the dashboard filter pills selected a single company,
-- the widget kept showing insights from everywhere — visually confusing
-- and not useful.
--
-- Now each (user_id, company_id) pair gets its own cached row. NULL
-- company_id = the legacy "all companies" view. Existing rows stay as
-- NULL so nothing breaks; new generates write per-company when the
-- client passes a company_id.
--
-- Applied via Supabase MCP on 2026-05-24.

ALTER TABLE public.portfolio_insights
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- Index for the "latest insights for this user + company" lookup that
-- the widget runs on every dashboard load.
CREATE INDEX IF NOT EXISTS portfolio_insights_user_company_generated_idx
  ON public.portfolio_insights (user_id, company_id, generated_at DESC);

COMMENT ON COLUMN public.portfolio_insights.company_id IS
  'NULL = insights cover all companies the user owns. Otherwise scoped to one company. Cache key is (user_id, company_id).';
