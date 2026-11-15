-- ----------------------------------------------------------------------------
-- refurb invoices: once approved, only a company owner / admin may change or
-- delete the invoice or its allocations (security fix, 15 Nov 2026).
-- NOT YET APPLIED — gated production change.
--
-- WHAT:
--   1. public.enforce_refurb_invoice_approval() (the existing guard from
--      2026-10-14_refurb_invoice_approval_admin.sql) is replaced with a
--      version that, in addition to its existing approval-transition rule,
--      rejects ANY UPDATE (including a soft delete via deleted_at) or DELETE
--      of a row whose OLD.approval_status = 'approved' unless the caller is
--      user_is_company_admin(OLD.company_id) or is_developer(). The trigger
--      refurb_invoices_approval_guard is recreated to fire on
--      INSERT OR UPDATE OR DELETE (was INSERT OR UPDATE).
--   2. New trigger refurb_invoice_allocations_approved_lock with function
--      public.enforce_refurb_invoice_allocation_lock(): INSERT / UPDATE /
--      DELETE of an allocation whose invoice is currently 'approved' needs
--      user_is_company_admin(invoice company) or is_developer().
--   Service role (auth.uid() IS NULL, or auth.role() = 'service_role') is
--   exempt in both, so RPCs / edge functions / the purge cron keep working.
--   When an admin deletes an approved invoice, the ON DELETE CASCADE to its
--   allocations runs after the invoice row is gone, so the allocation lookup
--   finds no invoice and the cascade is allowed.
--
-- WHY (exploit): approval is a sign-off control, but editors (has_company_write)
--   could still edit the amounts, supplier or allocations of an invoice after
--   an admin approved it, or delete / soft-delete it, so what was approved is
--   not what is on record.
--
-- CLIENT BEHAVIOUR CHANGE: editors can no longer edit, soft-delete or
--   re-allocate an APPROVED refurb invoice (src/lib/api/refurbInvoices.js
--   update ~l.61, soft delete ~l.71). Unapproved invoices behave as before.
--   Side effect to note: a non-admin who deletes a refurb_project or a
--   property that carries allocations of an approved invoice will now be
--   refused (the cascade to refurb_invoice_allocations hits the lock); an
--   admin must withdraw the approval or do the delete.
--   Logging payments against an approved invoice writes refurb_lines (not
--   this table) and is unaffected.
--
-- DIFF AGAINST LIVE FIRST: this reproduces enforce_refurb_invoice_approval()
--   from the repo (2026-10-14). Before applying, compare with
--   pg_get_functiondef on production; if live differs, merge.
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS refurb_invoice_allocations_approved_lock ON public.refurb_invoice_allocations;
--   DROP FUNCTION IF EXISTS public.enforce_refurb_invoice_allocation_lock();
--   -- then re-run supabase-migrations/2026-10-14_refurb_invoice_approval_admin.sql
--   -- in full (restores the previous function body and recreates
--   -- refurb_invoices_approval_guard as BEFORE INSERT OR UPDATE).
-- ----------------------------------------------------------------------------

-- ── 1. Invoice guard: approval transitions (unchanged) + approved lock ──────
CREATE OR REPLACE FUNCTION public.enforce_refurb_invoice_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_touches_approval boolean;
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(auth.role(), '') = 'service_role'
     OR public.is_developer() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Approved invoices are locked to company owners / admins.
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.approval_status = 'approved'
     AND NOT public.user_is_company_admin(OLD.company_id) THEN
    RAISE EXCEPTION 'This invoice has been approved; only a company owner or admin can change or delete it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
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
  BEFORE INSERT OR UPDATE OR DELETE ON public.refurb_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_refurb_invoice_approval();

-- ── 2. Allocations of an approved invoice ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_refurb_invoice_allocation_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status  text;
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(auth.role(), '') = 'service_role'
     OR public.is_developer() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- The invoice the row belongs to now (OLD side for UPDATE / DELETE).
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT approval_status, company_id INTO v_status, v_company
      FROM public.refurb_invoices WHERE id = OLD.invoice_id;
    IF v_status = 'approved' AND NOT public.user_is_company_admin(v_company) THEN
      RAISE EXCEPTION 'This invoice has been approved; only a company owner or admin can change its allocations'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- The invoice the row is being attached to (NEW side for INSERT / UPDATE).
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT approval_status, company_id INTO v_status, v_company
      FROM public.refurb_invoices WHERE id = NEW.invoice_id;
    IF v_status = 'approved' AND NOT public.user_is_company_admin(v_company) THEN
      RAISE EXCEPTION 'This invoice has been approved; only a company owner or admin can change its allocations'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_refurb_invoice_allocation_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refurb_invoice_allocations_approved_lock ON public.refurb_invoice_allocations;
CREATE TRIGGER refurb_invoice_allocations_approved_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.refurb_invoice_allocations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_refurb_invoice_allocation_lock();

-- VERIFY (read-only):
--   -- BEFORE: live body must match the repo's 2026-10-14 version
--   SELECT pg_get_functiondef('public.enforce_refurb_invoice_approval()'::regprocedure);
--   SELECT tgname, tgtype FROM pg_trigger
--    WHERE tgrelid IN ('public.refurb_invoices'::regclass, 'public.refurb_invoice_allocations'::regclass)
--      AND NOT tgisinternal;
--   -- auth.role() must exist (used for the service-role exemption):
--   SELECT to_regprocedure('auth.role()') IS NOT NULL;                 -- expect true
--   -- Approved invoices that would become admin-only (informational):
--   SELECT count(*) FROM public.refurb_invoices WHERE approval_status = 'approved';
--   -- AFTER, as an editor on an approved invoice:
--   UPDATE refurb_invoices SET notes = 'x' WHERE id = '<approved id>';              -> ERROR 42501
--   UPDATE refurb_invoices SET deleted_at = now() WHERE id = '<approved id>';        -> ERROR 42501
--   DELETE FROM refurb_invoice_allocations WHERE invoice_id = '<approved id>';       -> ERROR 42501
--   -- as an editor on a 'received' invoice: same statements succeed.
