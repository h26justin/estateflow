-- MTD ITSA (Making Tax Digital for Income Tax Self Assessment) scaffold.
--
-- HMRC mandate hits 6 Apr 2026 for landlords with property income > £50k,
-- 6 Apr 2027 for £30k+. Quarterly submissions of property income + allowable
-- expenses must be filed within ~1 month of each quarter end.
--
-- Tax year runs 6 Apr → 5 Apr. Quarters:
--   Q1: 6 Apr – 5 Jul  (deadline 5 Aug)
--   Q2: 6 Jul – 5 Oct  (deadline 5 Nov)
--   Q3: 6 Oct – 5 Jan  (deadline 5 Feb)
--   Q4: 6 Jan – 5 Apr  (deadline 5 May)
--
-- This migration provisions:
--   - mtd_settings (per-user HMRC creds + NINO + business ID)
--   - mtd_submissions (one row per (user, tax_year, quarter) with summary
--     snapshot, status, and HMRC response if/when submitted)
--
-- HMRC API integration lives in supabase-functions/mtd-submit. While we
-- await Justin's HMRC dev credentials (4-week lead time), the submit
-- function returns a mock response in sandbox mode — UI + aggregation
-- ship now so users can preview their quarterly position immediately.
--
-- Applied via Supabase MCP on 2026-05-24.

CREATE TABLE IF NOT EXISTS public.mtd_settings (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nino                 TEXT,                              -- National Insurance Number, e.g. 'QQ123456C'
  mtd_business_id      TEXT,                              -- HMRC-issued property business ID
  hmrc_access_token    TEXT,                              -- OAuth access token (encrypted ideally)
  hmrc_refresh_token   TEXT,                              -- OAuth refresh token
  hmrc_token_expires_at TIMESTAMPTZ,
  sandbox_mode         BOOLEAN NOT NULL DEFAULT TRUE,     -- Until we go live with HMRC production
  cash_basis           BOOLEAN NOT NULL DEFAULT TRUE,     -- Cash-basis is default for most landlords
  property_business_type TEXT NOT NULL DEFAULT 'uk-property' CHECK (property_business_type IN ('uk-property','fhl-property','foreign-property')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mtd_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY mtd_settings_own ON public.mtd_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.mtd_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_year        TEXT NOT NULL,                          -- e.g. '2026-27'
  quarter_number  SMALLINT NOT NULL CHECK (quarter_number BETWEEN 1 AND 4),
  period_from     DATE NOT NULL,
  period_to       DATE NOT NULL,
  deadline        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','accepted','rejected','error')),
  summary_json    JSONB,                                  -- The income/expenses payload (HMRC schema)
  hmrc_reference  TEXT,                                   -- Submission ID returned by HMRC
  hmrc_response   JSONB,                                  -- Raw HMRC response (success or error body)
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tax_year, quarter_number)
);

ALTER TABLE public.mtd_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY mtd_submissions_own ON public.mtd_submissions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS mtd_submissions_user_year_idx
  ON public.mtd_submissions (user_id, tax_year, quarter_number);

CREATE INDEX IF NOT EXISTS mtd_submissions_deadline_idx
  ON public.mtd_submissions (deadline) WHERE status = 'draft';

-- updated_at trigger (assumes set_updated_at() exists from earlier migrations)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS mtd_settings_updated_at ON public.mtd_settings;
    CREATE TRIGGER mtd_settings_updated_at BEFORE UPDATE ON public.mtd_settings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS mtd_submissions_updated_at ON public.mtd_submissions;
    CREATE TRIGGER mtd_submissions_updated_at BEFORE UPDATE ON public.mtd_submissions
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.mtd_settings IS 'Per-user HMRC MTD ITSA configuration. Tokens stored unencrypted for now; rotate to pgsodium when HMRC live creds land.';
COMMENT ON TABLE public.mtd_submissions IS 'One row per (user, tax_year, quarter). Holds the aggregated summary + HMRC response.';
