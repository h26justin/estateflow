-- Xero Phase 2 — multi-company support + granular sync controls.
--
-- Current schema problem: xero_connections is keyed PRIMARY KEY (user_id).
-- That means each user can have exactly ONE Xero connection. Users with
-- multiple OwnProperly companies (e.g. one SPV per property) need to be
-- able to link a SEPARATE Xero org per company.
--
-- Changes:
--   1. Add company_id to xero_connections + xero_sync_map + xero_sync_log
--   2. New xero_sync_settings table — per-connection toggles + mappings
--      (account codes, default bank account, per-property overrides,
--      tracking category state)
--   3. Add reconciliation columns to rent_payments + property_expenses
--      so we can mirror Xero's IsReconciled flag back into OwnProperly
--   4. Backfill: assign Justin's existing connection to his ExH company
--
-- Migration runs idempotently — safe to re-apply.

-- ── 1. xero_connections: multi-company support ─────────────────────────
ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- Backfill: for any existing connection without a company_id, set it to
-- the user's first owned company. There's only one such row right now
-- (Justin's ExH connection) but we want this to be safe regardless.
UPDATE public.xero_connections xc
SET company_id = (
  SELECT c.id FROM public.companies c
  WHERE c.owner_id = xc.user_id AND c.deleted_at IS NULL
  ORDER BY c.created_at ASC LIMIT 1
)
WHERE company_id IS NULL;

-- Drop the old single-column PK and replace with composite.
ALTER TABLE public.xero_connections DROP CONSTRAINT IF EXISTS xero_connections_pkey;
ALTER TABLE public.xero_connections
  ADD CONSTRAINT xero_connections_pkey PRIMARY KEY (user_id, company_id);

-- RLS policy still covers (user_id = auth.uid()) — composite PK doesn't
-- change that.

-- ── 2. xero_sync_settings ─────────────────────────────────────────────
-- Per-connection toggles + mappings. One row per (user_id, company_id).
CREATE TABLE IF NOT EXISTS public.xero_sync_settings (
  user_id     UUID NOT NULL,
  company_id  UUID NOT NULL,

  -- Direction + scope toggles
  sync_rent                     BOOLEAN NOT NULL DEFAULT TRUE,
  sync_expenses                 BOOLEAN NOT NULL DEFAULT TRUE,
  sync_mortgage_interest        BOOLEAN NOT NULL DEFAULT FALSE,
  sync_tracking_categories      BOOLEAN NOT NULL DEFAULT TRUE,
  sync_real_tenant_contacts     BOOLEAN NOT NULL DEFAULT FALSE,
  pull_reconciliation           BOOLEAN NOT NULL DEFAULT TRUE,

  -- Chart-of-accounts mapping (null = auto-pick first matching type)
  income_account_code           TEXT,
  expense_account_code          TEXT,
  mortgage_interest_account_code TEXT,

  -- Default bank account (Xero AccountID UUID) used when a property
  -- doesn't have an explicit override.
  default_bank_account_id       TEXT,

  -- Per-property overrides. Keys are OwnProperly property UUIDs (string),
  -- values are Xero bank account UUIDs. Empty object = use default for
  -- every property.
  per_property_bank_accounts    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Tracking category state. tracking_category_id is the Xero ID of
  -- the "Property" TrackingCategory we manage (or one the user nominates).
  -- property_tracking_options maps OwnProperly property UUIDs to the
  -- Xero TrackingOptionID for that property.
  tracking_category_id          TEXT,
  property_tracking_options     JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, company_id),
  FOREIGN KEY (user_id, company_id) REFERENCES public.xero_connections(user_id, company_id) ON DELETE CASCADE
);

ALTER TABLE public.xero_sync_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xero_sync_settings_own ON public.xero_sync_settings;
CREATE POLICY xero_sync_settings_own ON public.xero_sync_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- updated_at trigger if our standard fn exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS xero_sync_settings_updated_at ON public.xero_sync_settings;
    CREATE TRIGGER xero_sync_settings_updated_at BEFORE UPDATE ON public.xero_sync_settings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- Seed default settings rows for any existing connections that don't
-- have settings yet (Justin's ExH connection).
INSERT INTO public.xero_sync_settings (user_id, company_id)
SELECT user_id, company_id FROM public.xero_connections
ON CONFLICT (user_id, company_id) DO NOTHING;

-- ── 3. xero_sync_map: add company_id ──────────────────────────────────
-- Existing rows from Justin's earlier syncs need backfilling too so
-- subsequent syncs don't treat them as un-synced and re-push.
ALTER TABLE public.xero_sync_map
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.xero_sync_map m
SET company_id = (
  SELECT xc.company_id FROM public.xero_connections xc
  WHERE xc.user_id = m.user_id LIMIT 1
)
WHERE company_id IS NULL;

-- Make company_id part of the uniqueness so different companies can
-- independently sync the same OwnProperly entity (rare but possible
-- if a property gets re-assigned).
ALTER TABLE public.xero_sync_map DROP CONSTRAINT IF EXISTS xero_sync_map_user_id_entity_type_local_id_key;
ALTER TABLE public.xero_sync_map
  ADD CONSTRAINT xero_sync_map_unique
  UNIQUE (user_id, company_id, entity_type, local_id);

-- ── 4. xero_sync_log: add company_id ──────────────────────────────────
ALTER TABLE public.xero_sync_log
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

UPDATE public.xero_sync_log l
SET company_id = (
  SELECT xc.company_id FROM public.xero_connections xc
  WHERE xc.user_id = l.user_id LIMIT 1
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS xero_sync_log_company_idx
  ON public.xero_sync_log (user_id, company_id, started_at DESC);

-- ── 5. Reconciliation pull-back columns ──────────────────────────────
-- When Xero marks a BankTransaction as reconciled, we mirror that flag
-- back so OwnProperly's UI can show "✓ Reconciled in Xero" badges.
ALTER TABLE public.rent_payments
  ADD COLUMN IF NOT EXISTS xero_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS xero_reconciled_at TIMESTAMPTZ;

ALTER TABLE public.property_expenses
  ADD COLUMN IF NOT EXISTS xero_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS xero_reconciled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.rent_payments.xero_reconciled IS 'Mirrored from Xero BankTransaction.IsReconciled by xero-sync (pull direction).';
COMMENT ON COLUMN public.property_expenses.xero_reconciled IS 'Mirrored from Xero BankTransaction.IsReconciled by xero-sync (pull direction).';
COMMENT ON TABLE public.xero_sync_settings IS 'Per-(user,company) Xero sync toggles, account-code overrides, per-property bank account mappings, tracking category state.';
