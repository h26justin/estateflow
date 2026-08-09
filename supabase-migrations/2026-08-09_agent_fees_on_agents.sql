-- ===========================================================================
-- Management fees move onto the agency; properties link to their agent
-- ===========================================================================
-- Model change requested the same day the per-company fee table shipped
-- (before any data was written to it): the fee % belongs to the AGENCY, not
-- to a (company, agent) pair, and each property records who manages it.
-- Changing an agency's fee in one place then flows through every property
-- it manages, portfolio-wide.
--
--   estate_agents.fee_percent / vat_treatment — the agency's standard fee
--   properties.managed_by_agent_id            — who manages this property
--                                               (FK version of the legacy
--                                                free-text managed_by)
--   company_agent_fees                        — DROPPED (superseded, empty)
--
-- The Company P&L computes each company's management fee per agent as
-- fee_percent × rent collected from that company's properties managed by
-- the agent.
--
-- Safe to run multiple times.
-- ===========================================================================

-- ── Agency fee settings ────────────────────────────────────────────────────

ALTER TABLE estate_agents
  ADD COLUMN IF NOT EXISTS fee_percent numeric(5,2)
    CHECK (fee_percent IS NULL OR (fee_percent >= 0 AND fee_percent <= 100));

-- 'ex_vat' = VAT (20%) added on top of the % when computing the cost;
-- 'inc_vat' = the % is already VAT-inclusive. UK agents usually quote
-- "X% plus VAT", so ex_vat is the default.
ALTER TABLE estate_agents
  ADD COLUMN IF NOT EXISTS vat_treatment text NOT NULL DEFAULT 'ex_vat'
    CHECK (vat_treatment IN ('inc_vat','ex_vat'));

-- ── Property → managing agent link ─────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS managed_by_agent_id uuid REFERENCES estate_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_properties_managed_by_agent ON properties(managed_by_agent_id);

-- ── estate_agents read policy ──────────────────────────────────────────────
-- Was: readable when a company_agent_fees row links the agent to an
-- accessible company. Now: readable when the caller can access any company
-- with a property managed by the agent. (Replaced BEFORE the old table is
-- dropped so the policy never dangles.)

DROP POLICY IF EXISTS "estate_agents_select" ON estate_agents;
CREATE POLICY "estate_agents_select" ON estate_agents
FOR SELECT USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM properties p
    WHERE p.managed_by_agent_id = estate_agents.id AND has_company_access(p.company_id)
  )
);

-- ── Retire the per-company fee table ───────────────────────────────────────
-- Shipped earlier today, zero rows written, superseded by the agency-level
-- fee. Dropped rather than left to rot.

DROP TABLE IF EXISTS company_agent_fees;
