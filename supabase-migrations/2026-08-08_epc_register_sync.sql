-- ===========================================================================
-- EPC register auto-fetch  (extends Feature 10 — flag: epc_planner)
-- ===========================================================================
-- Pulls each property's real EPC from the official England & Wales register
-- (Get energy performance of buildings data, the service that replaced
-- epc.opendatacommunities.org in May 2026) via the new epc-sync edge
-- function, and logs the certificate against the property:
--
--   • epc_certificates        — one row per (property, certificate), the full
--                               register snapshot incl. the official
--                               find-energy-certificate.service.gov.uk link.
--   • properties.epc_*        — denormalised headline fields so lists,
--                               EpcPlanner and epc-planner can read the
--                               current band without a join. epc_sync_status
--                               mirrors the geocode_status pattern:
--                               found | not_found | no_postcode | error.
--   • monthly cron            — re-checks every property so new/renewed
--                               certificates and expiry dates stay current.
--
-- The edge function also upserts the property's compliance_items row
-- (cert_type 'epc') so the Compliance tab, expiry badges, daily reminder
-- emails and Autopilot's missing-EPC detector all light up automatically.
--
-- DEPENDS ON (apply first):
--   2026-06-10_security_01_helpers.sql  (has_property_permission, company_is_live)
--   row-level-security.sql              (has_property_access, is_developer)
--   audit-and-soft-delete.sql           (audit_trigger_fn)
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

-- ── Headline EPC fields on properties ───────────────────────────────────────
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS epc_rating text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS epc_expiry_date date;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS epc_certificate_number text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS epc_last_checked_at timestamptz;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS epc_sync_status text;

-- ── Certificate log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.epc_certificates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  company_id         uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL DEFAULT auth.uid(),
  certificate_number text NOT NULL,
  uprn               text,
  register_address   text,
  current_rating     text,
  potential_rating   text,
  lodgement_date     date,
  expiry_date        date,
  certificate_url    text,
  matched_by         text,          -- address | postcode_single
  raw                jsonb,         -- full register payload for audit/debug
  fetched_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, certificate_number)
);

CREATE INDEX IF NOT EXISTS idx_epc_certificates_property_id ON public.epc_certificates (property_id);
CREATE INDEX IF NOT EXISTS idx_epc_certificates_company_id  ON public.epc_certificates (company_id);
CREATE INDEX IF NOT EXISTS idx_epc_certificates_expiry      ON public.epc_certificates (expiry_date);

ALTER TABLE public.epc_certificates ENABLE ROW LEVEL SECURITY;

-- ── SELECT: developer, owner, or anyone with access to the property ──────────
DROP POLICY IF EXISTS epc_certificates_select ON public.epc_certificates;
CREATE POLICY epc_certificates_select ON public.epc_certificates
  FOR SELECT USING (
    is_developer()
    OR user_id = (SELECT auth.uid())
    OR has_property_access(property_id)
  );

-- Writes normally arrive via the epc-sync edge function (service role, which
-- bypasses RLS after its own permission checks). These policies additionally
-- let editors tidy up rows from the UI, mirroring epc_assessments.
DROP POLICY IF EXISTS epc_certificates_insert ON public.epc_certificates;
CREATE POLICY epc_certificates_insert ON public.epc_certificates
  FOR INSERT WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

DROP POLICY IF EXISTS epc_certificates_update ON public.epc_certificates;
CREATE POLICY epc_certificates_update ON public.epc_certificates
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

DROP POLICY IF EXISTS epc_certificates_delete ON public.epc_certificates;
CREATE POLICY epc_certificates_delete ON public.epc_certificates
  FOR DELETE USING (
    is_developer()
    OR has_property_permission(property_id, 'write')
  );

-- ── Audit trail (mirrors other property-scoped tables) ───────────────────────
DROP TRIGGER IF EXISTS epc_certificates_audit ON public.epc_certificates;
CREATE TRIGGER epc_certificates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.epc_certificates
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ── Monthly register re-check (2nd of month, 05:30 UTC) ──────────────────────
-- Reuses the CRON_SECRET already embedded in the proven-good trial-emails
-- cron so the literal value is never written into this migration.
DO $$
DECLARE
  v_secret text;
  v_base   text := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1';
BEGIN
  SELECT (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    INTO v_secret
  FROM cron.job
  WHERE jobname = 'trial-emails-daily';

  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE EXCEPTION 'Could not read CRON_SECRET from trial-emails-daily cron; aborting (no jobs changed)';
  END IF;

  PERFORM cron.schedule(
    'epc-register-monthly',
    '30 5 2 * *',
    format($f$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $f$, v_base || '/epc-sync', v_secret)
  );
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify (run after):
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'epc-register-monthly';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'properties' AND column_name LIKE 'epc%';
