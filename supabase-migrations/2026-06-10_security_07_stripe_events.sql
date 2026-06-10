-- ===========================================================================
-- Security hardening 07 — stripe_events idempotency table (cross-agent contract 2)
-- ===========================================================================
-- The stripe-webhook edge function (service role) uses this table to dedupe
-- Stripe deliveries: INSERT ... ON CONFLICT DO NOTHING, and skip processing
-- when the row already existed.
--
-- RLS is enabled with NO client policies (deny-all for anon/authenticated);
-- only the service role (which bypasses RLS) reads/writes it.
--
-- Idempotent. ROLLBACK: DROP TABLE public.stripe_events;
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id    text PRIMARY KEY,
  type        text,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stripe_events IS
  'Stripe webhook idempotency ledger. Service-role only: RLS enabled with no client policies by design (deny-all). Webhook does INSERT ... ON CONFLICT (event_id) DO NOTHING and skips already-seen events.';

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION:
--   SELECT relrowsecurity FROM pg_class WHERE relname='stripe_events'; -> t
--   SELECT count(*) FROM pg_policies WHERE tablename='stripe_events';  -> 0
-- ===========================================================================
