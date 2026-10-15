-- ----------------------------------------------------------------------------
-- Bank feed, MTD and Xero map: clients cannot forge server-owned fields
-- (security hotfix, 14 Oct 2026)
--
-- HOLE (live, 14 Oct 2026): bank_accounts / bank_transactions have own-row
-- insert/update/delete policies (user_id = auth.uid(), no WITH CHECK on
-- update); mtd_submissions and xero_sync_map have FOR ALL own-row policies.
-- Every row is created by an edge function with the service role
-- (bank-plaid, bank-truelayer, mtd-submit, xero-sync), but the browser could
-- equally:
--   * insert bank_transactions / bank_accounts out of thin air, or rewrite
--     amount / posted_at / account_id / provider ids on real ones, which
--     then feed rent matching, bookkeeping categories and MTD figures;
--   * point matched_rent_payment_id at ANY rent_payments id (including
--     another landlord's), linking a foreign rent record to its feed;
--   * write mtd_submissions.status = 'submitted' / 'accepted' with a made-up
--     hmrc_reference and submitted_at (a forged HMRC filing record), or
--     re-open a filed quarter by upserting it back to 'draft', or delete it;
--   * insert / rewrite / delete xero_sync_map rows, which xero-sync trusts
--     to decide what already exists in Xero (double-posting or skipping).
--
-- Client writes that DO exist (grep of src/, 14 Oct 2026):
--   bank_transactions: matched_rent_payment_id, matched_at,
--     match_confidence (bank.js match/unmatch), ai_category,
--     ai_category_confidence (bookkeeping.js acceptSuggestion).
--   bank_accounts: none.
--   mtd_submissions: upsert of tax_year, quarter_number, period_from,
--     period_to, deadline, summary_json, status = 'draft' (MtdItsaPage).
--   xero_sync_map: none (never read or written by src/).
--
-- FIX: BEFORE triggers that apply only when auth.uid() IS NOT NULL (service
-- role / edge functions are unaffected), comparing whole rows as jsonb minus
-- an allow-list of client-writable columns, so a column added later is
-- server-owned by default:
--   * bank_transactions: no client INSERT; UPDATE may change only the five
--     columns above (+ updated_at); a non-null matched_rent_payment_id must
--     reference a rent_payments row on a property the caller has
--     has_property_permission(property_id, 'write') on.
--   * bank_accounts: no client INSERT; UPDATE may change only display_name
--     and company_id, and a non-null company_id needs has_company_write().
--   * mtd_submissions: INSERT must be status 'draft' with no HMRC fields;
--     UPDATE may not touch hmrc_reference / hmrc_response / submitted_at /
--     user_id, may only keep status or move a draft/rejected/error quarter
--     to 'draft', and a submitted/accepted quarter is frozen (no update, no
--     delete).
--   * xero_sync_map: writes revoked from anon/authenticated and the FOR ALL
--     policy replaced by a SELECT-only own-row policy. Only the service role
--     writes it.
--
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS.
-- ----------------------------------------------------------------------------

-- ── bank_transactions ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_bank_transaction_client_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_client_cols CONSTANT text[] := ARRAY['matched_rent_payment_id', 'matched_at', 'match_confidence',
                                         'ai_category', 'ai_category_confidence', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'bank transactions are imported by the bank feed and cannot be created by hand'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (to_jsonb(NEW) - c_client_cols) IS DISTINCT FROM (to_jsonb(OLD) - c_client_cols) THEN
    RAISE EXCEPTION 'bank transaction details come from the bank and cannot be edited'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.matched_rent_payment_id IS NOT NULL
     AND NEW.matched_rent_payment_id IS DISTINCT FROM OLD.matched_rent_payment_id
     AND NOT EXISTS (
       SELECT 1 FROM public.rent_payments rp
        WHERE rp.id = NEW.matched_rent_payment_id
          AND public.has_property_permission(rp.property_id, 'write'))
  THEN
    RAISE EXCEPTION 'you can only match a transaction to rent on a property you can edit'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_bank_transaction_client_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bank_transactions_client_guard ON public.bank_transactions;
CREATE TRIGGER bank_transactions_client_guard
  BEFORE INSERT OR UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bank_transaction_client_guard();

DROP POLICY IF EXISTS bank_transactions_update_own ON public.bank_transactions;
CREATE POLICY bank_transactions_update_own ON public.bank_transactions
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── bank_accounts ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_bank_account_client_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_client_cols CONSTANT text[] := ARRAY['display_name', 'company_id', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'bank accounts are added by connecting a bank, not by hand'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (to_jsonb(NEW) - c_client_cols) IS DISTINCT FROM (to_jsonb(OLD) - c_client_cols) THEN
    RAISE EXCEPTION 'bank account details come from the bank and cannot be edited'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.company_id IS NOT NULL
     AND NEW.company_id IS DISTINCT FROM OLD.company_id
     AND NOT public.has_company_write(NEW.company_id)
  THEN
    RAISE EXCEPTION 'you can only assign a bank account to a company you can edit'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_bank_account_client_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bank_accounts_client_guard ON public.bank_accounts;
CREATE TRIGGER bank_accounts_client_guard
  BEFORE INSERT OR UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bank_account_client_guard();

DROP POLICY IF EXISTS bank_accounts_update_own ON public.bank_accounts;
CREATE POLICY bank_accounts_update_own ON public.bank_accounts
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── mtd_submissions ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_mtd_submission_client_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('submitted', 'accepted') THEN
      RAISE EXCEPTION 'a quarter that has been submitted to HMRC cannot be deleted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft'
       OR NEW.hmrc_reference IS NOT NULL
       OR NEW.hmrc_response IS NOT NULL
       OR NEW.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new quarter must start as a draft; HMRC fields are set by the submission service'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status IN ('submitted', 'accepted') THEN
    RAISE EXCEPTION 'this quarter has already been submitted to HMRC and cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.user_id        IS DISTINCT FROM OLD.user_id
     OR NEW.hmrc_reference IS DISTINCT FROM OLD.hmrc_reference
     OR NEW.hmrc_response  IS DISTINCT FROM OLD.hmrc_response
     OR NEW.submitted_at   IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'HMRC submission fields are set by the submission service'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'submission status is set by the submission service'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_mtd_submission_client_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mtd_submissions_client_guard ON public.mtd_submissions;
CREATE TRIGGER mtd_submissions_client_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.mtd_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mtd_submission_client_guard();

-- ── xero_sync_map: server-only writes ─────────────────────────────────────
DROP POLICY IF EXISTS xero_sync_map_own ON public.xero_sync_map;
DROP POLICY IF EXISTS xero_sync_map_select_own ON public.xero_sync_map;
CREATE POLICY xero_sync_map_select_own ON public.xero_sync_map
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.xero_sync_map FROM anon, authenticated;
REVOKE ALL ON public.xero_sync_map FROM anon;

NOTIFY pgrst, 'reload schema';
