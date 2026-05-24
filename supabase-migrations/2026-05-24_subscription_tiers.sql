-- Subscription tier infrastructure for the Investor £5/property tier.
--
-- Tiers:
--   'starter'  — £2/property, existing default. All core landlord features.
--   'investor' — £5/property. Adds AI Insights, Deals Pipeline,
--                Remortgage broker alerts, future deal analyser.
--
-- Gating happens client-side via canUseInvestorFeatures() helper in
-- src/lib/tierGating.js. Stripe sees this as a different price ID —
-- when we add the Investor price in Stripe we'll wire create-checkout
-- to pass the right ID per tier.
--
-- Applied via Supabase MCP on 2026-05-24.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'starter';

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('starter','investor'));

CREATE INDEX IF NOT EXISTS subscriptions_tier_idx ON public.subscriptions (tier);

COMMENT ON COLUMN public.subscriptions.tier IS
  'starter (£2/prop, default) | investor (£5/prop adds AI Insights, Deals, remortgage broker alerts)';
