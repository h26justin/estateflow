-- ----------------------------------------------------------------------------
-- Billing: a 'trialing' subscription row must not grant liveness on its own
-- (15 Oct 2026, HIGH — billing bypass).
--
-- create-checkout used to upsert subscriptions.status = 'trialing' as soon as
-- it created the Stripe customer, i.e. before any payment. company_is_live()
-- counted 'trialing' as live with no expiry, so opening checkout and
-- abandoning it unlocked a company permanently. The column default was also
-- 'trialing', so any insert that omitted status did the same.
--
-- The edge function now writes 'incomplete' (or leaves an existing status
-- alone). This migration:
--   1. changes the subscriptions.status default to 'incomplete';
--   2. repairs rows that are 'trialing' with no Stripe subscription behind
--      them (no stripe_subscription_id, no billing period in the future)
--      → 'incomplete';
--   3. hardens company_is_live(): 'trialing' only counts with a
--      stripe_subscription_id or a current_period_end in the future.
--      'active' / 'past_due' behave as before; free tier and the in-app
--      trial (companies.trial_ends_at) are unchanged.
--
-- Only stripe-webhook (service role) sets active / trialing / past_due; the
-- trg_subscriptions_billing_guard trigger already stops clients writing
-- billing fields. The webhook upserts on company_id, so an 'incomplete' row
-- created by create-checkout is updated in place on checkout.session.completed
-- and customer.subscription.created/updated.
--
-- Pre-apply read-only count on hqrhqbkqxzllmzhcofrh (15 Oct 2026):
--   status='trialing' AND stripe_subscription_id IS NULL → 3 rows, all with
--   stripe_customer_id NULL (so not created via checkout), all on companies
--   with is_free_tier = true. They stay live through is_free_tier after the
--   repair. No row has a future current_period_end without a subscription id.
--
-- Idempotent: SET DEFAULT, a guarded UPDATE and CREATE OR REPLACE.
--
-- ROLLBACK (restores the vulnerable behaviour — only if something breaks):
--   ALTER TABLE public.subscriptions ALTER COLUMN status SET DEFAULT 'trialing';
--   -- and re-create company_is_live() with
--   --   AND s.status IN ('active', 'trialing', 'past_due')
--   -- in place of the status test below. The repaired rows can be found by
--   -- status = 'incomplete' AND stripe_customer_id IS NULL AND updated_at
--   -- at apply time.
-- ----------------------------------------------------------------------------

ALTER TABLE public.subscriptions ALTER COLUMN status SET DEFAULT 'incomplete';

UPDATE public.subscriptions
   SET status = 'incomplete', updated_at = now()
 WHERE status = 'trialing'
   AND stripe_subscription_id IS NULL
   AND (current_period_end IS NULL OR current_period_end <= now());

CREATE OR REPLACE FUNCTION public.company_is_live(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    is_developer()
    OR is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.company_id = p_company_id
        AND (
          s.status IN ('active', 'past_due')
          -- A trial only counts when Stripe actually holds a subscription.
          -- A bare 'trialing' row (written before any payment) never does.
          OR (s.status = 'trialing'
              AND (s.stripe_subscription_id IS NOT NULL
                   OR s.current_period_end > now()))
        )
    )
    OR EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = p_company_id
        AND (c.is_free_tier = true OR c.trial_ends_at > now())
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.company_is_live(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_is_live(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- VERIFY (read-only, after apply):
--   -- expect 'incomplete'
--   SELECT column_default FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='subscriptions' AND column_name='status';
--   -- expect 0
--   SELECT count(*) FROM public.subscriptions
--    WHERE status='trialing' AND stripe_subscription_id IS NULL
--      AND (current_period_end IS NULL OR current_period_end <= now());
--   -- expect the new trialing clause in the body
--   SELECT pg_get_functiondef('public.company_is_live(uuid)'::regprocedure);
--   -- expect {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   SELECT proacl FROM pg_proc WHERE oid='public.company_is_live(uuid)'::regprocedure;
--   -- every company that was live before should still be live unless it was
--   -- live ONLY through a bare trialing row (expect 0 rows today):
--   SELECT s.company_id FROM public.subscriptions s JOIN public.companies c ON c.id=s.company_id
--    WHERE s.status='incomplete' AND NOT coalesce(c.is_free_tier,false)
--      AND NOT coalesce(c.trial_ends_at > now(), false);
-- ----------------------------------------------------------------------------
