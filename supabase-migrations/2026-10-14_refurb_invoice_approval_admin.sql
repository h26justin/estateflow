-- ----------------------------------------------------------------------------
-- refurb_invoices: only a company owner / admin can approve (security
-- hotfix, 14 Oct 2026)
--
-- HOLE: 2026-09-25_refurb_invoices.sql gives INSERT / UPDATE to
-- has_company_write(company_id), i.e. owner, admin AND editor, and
-- approval_status is just another column. Any editor could therefore set
-- approval_status = 'approved' on a contractor invoice (or create one already
-- approved, via create_refurb_invoice(), which runs as the caller), or
-- quietly un-approve one. Approval is a sign-off control and must sit with
-- the people who run the company.
--
-- FIX: a BEFORE INSERT/UPDATE trigger. Moving an invoice INTO or OUT OF
-- 'approved' (including inserting it as 'approved') requires
-- user_is_company_admin(company_id) (platform admin, company owner, or a uca
-- row with is_admin / is_owner) or is_developer(). On update the caller must
-- administer both the old and the new company_id. Editors can still import
-- invoices as 'received' / 'awaiting_approval' and move between those two.
-- Service role (auth.uid() IS NULL) is exempt. The client hides / disables
-- the Approved option for non-admins (src/components/RefurbInvoices.jsx).
--
-- This only records an approval decision. Nothing here pays, posts or
-- sends anything.
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_refurb_invoice_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_touches_approval boolean;
BEGIN
  IF auth.uid() IS NULL OR public.is_developer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_touches_approval := NEW.approval_status = 'approved';
  ELSE
    v_touches_approval := NEW.approval_status IS DISTINCT FROM OLD.approval_status
      AND (NEW.approval_status = 'approved' OR OLD.approval_status = 'approved');
  END IF;

  IF NOT v_touches_approval THEN
    RETURN NEW;
  END IF;

  IF public.user_is_company_admin(NEW.company_id)
     AND (TG_OP = 'INSERT' OR public.user_is_company_admin(OLD.company_id)) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a company owner or admin can approve an invoice or withdraw an approval'
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_refurb_invoice_approval() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refurb_invoices_approval_guard ON public.refurb_invoices;
CREATE TRIGGER refurb_invoices_approval_guard
  BEFORE INSERT OR UPDATE ON public.refurb_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_refurb_invoice_approval();
