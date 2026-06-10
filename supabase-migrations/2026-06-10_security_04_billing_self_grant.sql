-- ===========================================================================
-- Security hardening 04 — billing self-grant fix (CRITICAL)
-- ===========================================================================
-- LIVE BUG (two findings):
--   * companies_update has USING (owner_id = auth.uid()) with NO WITH CHECK, and
--     `authenticated` holds column UPDATE on is_free_tier — an owner can set
--     is_free_tier=true and unlock full paid entitlements with zero payment.
--   * subscriptions sub_update / sub_insert constrain only owner_id (no
--     WITH CHECK on values), and `authenticated`+`anon` hold INSERT/UPDATE on
--     every billing column — an owner can write status='active', tier='investor',
--     current_period_end far ahead and be treated as paying forever.
--
-- WHY TRIGGERS (not just WITH CHECK): blocking *changes* to specific columns
-- needs OLD-vs-NEW comparison, which WITH CHECK cannot express. BEFORE triggers
-- give a clean, reviewable guard that:
--   * lets the service role through (auth.uid() IS NULL) — so the Stripe webhook
--     and create-checkout edge function (both service-role) are UNAFFECTED;
--   * lets the platform operator through (is_platform_admin()/is_developer()) —
--     so the admin tools setCompanyFreeTier / endTrialNow / extendTrial / merge
--     / transfer keep working via the authenticated anon client;
--   * blocks a regular owner from mutating billing-critical columns.
--
-- We also REVOKE INSERT on subscriptions from authenticated/anon (no client
-- code inserts subscription rows — create-checkout does it as service role)
-- and REVOKE all writes on subscriptions from anon entirely (anon never writes
-- billing). The webhook/edge functions use the service role and are unaffected.
--
-- Idempotent. ROLLBACK notes inline.
-- ===========================================================================

-- ── Subscriptions: lock down client writes ───────────────────────────────────
-- anon must never write billing.  ROLLBACK: GRANT INSERT,UPDATE,DELETE ON
-- public.subscriptions TO anon;
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon;
-- No client path inserts subscription rows (service role only).  ROLLBACK:
-- GRANT INSERT ON public.subscriptions TO authenticated;
REVOKE INSERT ON public.subscriptions FROM authenticated;

CREATE OR REPLACE FUNCTION public.enforce_subscription_billing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role (edge functions / Stripe webhook): no JWT -> trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Platform operator (admin tools run under the authenticated anon client).
  IF is_platform_admin() OR is_developer() THEN
    RETURN NEW;
  END IF;

  -- Regular authenticated owner: forbid changing billing-critical columns.
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'subscriptions are managed by billing only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status                 IS DISTINCT FROM OLD.status
     OR NEW.tier                IS DISTINCT FROM OLD.tier
     OR NEW.stripe_customer_id  IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.stripe_price_id     IS DISTINCT FROM OLD.stripe_price_id
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end  IS DISTINCT FROM OLD.current_period_end
     OR NEW.cancel_at_period_end IS DISTINCT FROM OLD.cancel_at_period_end
     OR NEW.property_count      IS DISTINCT FROM OLD.property_count
     OR NEW.owner_id            IS DISTINCT FROM OLD.owner_id
     OR NEW.company_id          IS DISTINCT FROM OLD.company_id
  THEN
    RAISE EXCEPTION 'billing fields can only be changed by the billing system'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_billing_guard ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_billing_guard
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_billing_guard();

-- ── Companies: protect billing / ownership columns ───────────────────────────
-- An owner can still rename / recolour / edit agent fields on their company,
-- but cannot self-grant free tier, extend their own trial, or hand off ownership.
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

DROP TRIGGER IF EXISTS trg_companies_billing_guard ON public.companies;
CREATE TRIGGER trg_companies_billing_guard
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_billing_guard();

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION (as a regular company owner, not admin):
--   INSERT INTO companies (name, owner_id, is_free_tier)
--     VALUES ('x', auth.uid(), true);                                    -> ERROR
--   INSERT INTO companies (name, owner_id, trial_ends_at)
--     VALUES ('x', auth.uid(), now() + interval '10 years');             -> ERROR
--   SELECT create_company_for_owner('x','X','#fff');                     -> OK
--   UPDATE companies SET is_free_tier = true WHERE id = '<own-co>';      -> ERROR
--   UPDATE companies SET name = 'New name' WHERE id = '<own-co>';        -> OK
--   UPDATE subscriptions SET status='active' WHERE owner_id=auth.uid();  -> ERROR
--   INSERT INTO subscriptions (owner_id, status) VALUES (auth.uid(),'active'); -> ERROR
-- As platform admin: setCompanyFreeTier / endTrialNow must still succeed.
-- ROLLBACK: DROP TRIGGER trg_subscriptions_billing_guard ON subscriptions;
--           DROP TRIGGER trg_companies_billing_guard ON companies;
--           DROP FUNCTION enforce_subscription_billing_guard();
--           DROP FUNCTION enforce_company_billing_guard();
--           GRANT INSERT ON subscriptions TO authenticated;
--           GRANT INSERT,UPDATE,DELETE ON subscriptions TO anon;
-- ===========================================================================
