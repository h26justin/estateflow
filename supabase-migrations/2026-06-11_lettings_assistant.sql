-- AI Lettings Assistant — inbound applicant enquiry capture + AI triage.
--
-- Sits on top of the existing lettings pipeline. Each inbound enquiry from
-- a prospective tenant is stored as a row here. The `lettings-assistant`
-- edge function calls Claude to (a) draft a reply, (b) pre-screen the
-- applicant against the landlord's criteria, and (c) score the lead.
-- Everything Claude produces is a DRAFT — the landlord reviews, edits and
-- copies the reply themselves; nothing is auto-sent.
--
-- Gated client-side behind the `ai_lettings` feature flag and the Investor
-- subscription tier.

CREATE TABLE IF NOT EXISTS public.letting_enquiries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applicant_name  TEXT,
  applicant_email TEXT,
  message         TEXT,
  ai_reply_draft  TEXT,
  ai_score        INT,
  ai_screening    JSONB,
  status          TEXT NOT NULL DEFAULT 'new',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS letting_enquiries_property_idx
  ON public.letting_enquiries (property_id);
CREATE INDEX IF NOT EXISTS letting_enquiries_company_idx
  ON public.letting_enquiries (company_id);
CREATE INDEX IF NOT EXISTS letting_enquiries_user_status_idx
  ON public.letting_enquiries (user_id, status, created_at DESC);

ALTER TABLE public.letting_enquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS letting_enquiries_select ON public.letting_enquiries;
DROP POLICY IF EXISTS letting_enquiries_insert ON public.letting_enquiries;
DROP POLICY IF EXISTS letting_enquiries_update ON public.letting_enquiries;
DROP POLICY IF EXISTS letting_enquiries_delete ON public.letting_enquiries;

CREATE POLICY letting_enquiries_select ON public.letting_enquiries
  FOR SELECT USING (
    public.is_developer()
    OR user_id = auth.uid()
    OR public.has_property_access(property_id)
  );

CREATE POLICY letting_enquiries_insert ON public.letting_enquiries
  FOR INSERT WITH CHECK (
    public.has_property_permission(property_id, 'write')
    AND public.company_is_live(company_id)
  );

CREATE POLICY letting_enquiries_update ON public.letting_enquiries
  FOR UPDATE USING (
    public.has_property_permission(property_id, 'write')
    AND public.company_is_live(company_id)
  );

CREATE POLICY letting_enquiries_delete ON public.letting_enquiries
  FOR DELETE USING (
    public.has_property_permission(property_id, 'write')
    AND public.company_is_live(company_id)
  );

NOTIFY pgrst, 'reload schema';
