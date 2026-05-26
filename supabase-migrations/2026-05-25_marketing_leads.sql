-- marketing_leads — captures from landing-page forms (Section 24 calculator,
-- MTD ITSA page, blog CTAs etc.) that don't yet have an authenticated user.
-- One row per email; subsequent submissions update payload/source.
--
-- Service-role only; no client should ever read this. Used by the
-- `lead-capture` edge function.

CREATE TABLE IF NOT EXISTS public.marketing_leads (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL,                  -- e.g. 'section-24-calc'
  payload     JSONB,                          -- form context, e.g. their numbers
  ip          TEXT,                           -- for rate-limit + abuse triage
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_user_id UUID                      -- set if they later become a paying user
    REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS marketing_leads_email_idx  ON public.marketing_leads (email);
CREATE INDEX IF NOT EXISTS marketing_leads_source_idx ON public.marketing_leads (source);
CREATE INDEX IF NOT EXISTS marketing_leads_ip_idx     ON public.marketing_leads (ip, created_at);

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY clauses — RLS-enabled with no policy means service-role-only access.
