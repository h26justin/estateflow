-- ----------------------------------------------------------------------------
-- companies: no fresh in-app trial for an owner who already owns a company
-- (billing fix, 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- !!! DIFF AGAINST LIVE FIRST !!! The function body below is copied from the
-- LATEST repo definition of enforce_company_billing_guard()
-- (2026-06-10_security_04_billing_self_grant.sql; later files only revoke
-- grants on it). The repo may lag production. Before applying, run
--   SELECT pg_get_functiondef('public.enforce_company_billing_guard()'::regprocedure);
-- diff it against this file and merge any live-only change. Only the block
-- marked "NEW" is meant to differ.
--
-- WHAT: on a client INSERT into companies (auth.uid() set, not platform admin
--   / developer), if NEW.owner_id already owns any OTHER company row —
--   including soft-deleted ones (deleted_at set; this function is SECURITY
--   DEFINER so it sees them) — trial_ends_at is forced to NULL, i.e. the new
--   company gets no in-app trial and is live only once it has a subscription
--   or free tier. A first company keeps the existing rule (default trial,
--   anything beyond now() + 31 days rejected). UPDATE behaviour, the free-tier
--   checks, the service-role and admin bypasses are unchanged.
--
-- WHY (exploit): company_is_live() treats trial_ends_at > now() as live, and
--   a client INSERT may set up to now() + 31 days, so an owner whose trial
--   expired can create a new company every month (create_company_for_owner
--   or a direct POST) and keep using the product for free.
--
-- CLIENT BEHAVIOUR CHANGE / BUSINESS DECISION NEEDED:
--   * An owner adding a SECOND company (including legitimate multi-company
--     landlords who already pay for their first) gets no trial on it: the app
--     shows it as trial-expired (TrialExpiredGate / App.jsx treat a NULL
--     trial_ends_at as ended) until it is subscribed or an admin grants a
--     trial / free tier. Confirm this is wanted before applying; the
--     alternative is to only withhold the trial when none of the owner's
--     companies is live.
--   * Companies created by a platform admin / developer, or by the service
--     role, are unaffected.
--   * Limitation: soft-deleted companies are hard-deleted by the purge job
--     after 30 days, after which the owner would again get a trial.
--
-- Idempotent: CREATE OR REPLACE (the trigger trg_companies_billing_guard
-- already points at this function and is not recreated).
--
-- ROLLBACK: re-create the function exactly as in
--   supabase-migrations/2026-06-10_security_04_billing_self_grant.sql
--   (the CREATE OR REPLACE FUNCTION public.enforce_company_billing_guard()
--   statement only — do NOT re-run the rest of that file), or from the live
--   body captured before applying.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_company_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role
  END IF;

  IF is_platform_admin() OR is_developer() THEN
    RETURN NEW;  -- admin tools (free tier, end/extend trial, transfer, merge)
  END IF;

  -- INSERT: companies_insert RLS only checks owner_id = auth.uid(), and the
  -- client can POST /rest/v1/companies directly. Without this branch a signed-in
  -- user could create a company with is_free_tier=true or trial_ends_at far in
  -- the future and company_is_live() would treat it as live forever — the same
  -- self-grant bypass as the UPDATE case, just on row creation.
  --
  -- NOTE on trial_ends_at: a BEFORE trigger sees column defaults already
  -- applied, so a legitimately defaulted / RPC-set 14-day trial is
  -- indistinguishable from a client-supplied value. We therefore allow the
  -- standard trial window (14 days, marketing-site contract) plus generous
  -- slack, and reject anything beyond it.
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_free_tier IS TRUE
       OR NEW.free_tier_reason IS NOT NULL
       OR NEW.free_tier_granted_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'free tier can only be granted by an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- NEW (15 Nov 2026): one in-app trial per owner. If this owner already
    -- owns any other company (soft-deleted included), the new company starts
    -- without a trial instead of a fresh one.
    IF NEW.owner_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM companies c
          WHERE c.owner_id = NEW.owner_id
            AND c.id IS DISTINCT FROM NEW.id
       ) THEN
      NEW.trial_ends_at := NULL;
    END IF;
    IF NEW.trial_ends_at > now() + interval '31 days' THEN
      RAISE EXCEPTION 'trial period can only be set by an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_free_tier         IS DISTINCT FROM OLD.is_free_tier
     OR NEW.free_tier_reason  IS DISTINCT FROM OLD.free_tier_reason
     OR NEW.free_tier_granted_by IS DISTINCT FROM OLD.free_tier_granted_by
     OR NEW.trial_ends_at     IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.owner_id          IS DISTINCT FROM OLD.owner_id
  THEN
    RAISE EXCEPTION 'billing/ownership fields can only be changed by an administrator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- Keep the hardening from security_10 (CREATE OR REPLACE keeps the ACL, this
-- just re-states it).
REVOKE ALL ON FUNCTION public.enforce_company_billing_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_company_billing_guard() FROM anon;

-- VERIFY
--   BEFORE (read-only):
--   SELECT pg_get_functiondef('public.enforce_company_billing_guard()'::regprocedure);
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.companies'::regclass AND tgname = 'trg_companies_billing_guard';
--   -- How many owners already hold more than one company (these are the
--   -- people the business decision above affects):
--   SELECT owner_id, count(*) FROM public.companies GROUP BY owner_id HAVING count(*) > 1;
--   AFTER, as a regular owner who already owns a company:
--   SELECT create_company_for_owner('x','X','#fff');  -> OK, new row has trial_ends_at NULL
--   As a brand-new user: same call -> trial_ends_at set as before.
