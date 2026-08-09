-- ===========================================================================
-- Company ownership, estate agents, and management fees
-- ===========================================================================
-- Three new tables powering the Company P&L / profit-share feature:
--
--   company_shareholders  — who owns what % of each company. Shareholders do
--                           NOT have to be app users: rows are name-based with
--                           an optional soft link to auth.users (user_id) so
--                           the report can recognise "you" when signed in.
--   estate_agents         — directory of letting/managing agents, owned by
--                           the account that created them (cross-company).
--   company_agent_fees    — the fee % a company pays an agent on rent
--                           collected. One row per (company, agent).
--
-- Also adds an optional per-shareholder tax_band so the Company P&L can
-- estimate dividend tax on each shareholder's profit share.
--
-- Access model:
--   read   — anyone with company access (has_company_access)
--   write  — company owner or an is_admin collaborator (matches the
--            user_company_access write posture; RolePermissionsModal gates
--            the UI on edit_company_settings)
--
-- Safe to run multiple times.
-- ===========================================================================

-- ── COMPANY_SHAREHOLDERS ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_shareholders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Display name — the source of truth. Shareholders need not be app users.
  name          text NOT NULL,
  -- Optional contact + soft link to an auth user. When user_id (or email)
  -- matches the signed-in user, reports label the row "you" and compute
  -- their personal income figures.
  email         text,
  user_id       uuid,
  -- Ownership percentage, 0–100 with 2dp. The app warns when a company's
  -- rows don't sum to 100 but the DB doesn't enforce it (cap tables are
  -- often entered incrementally).
  percentage    numeric(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  -- Optional dividend tax band for the after-tax estimate on the P&L:
  -- 'basic' | 'higher' | 'additional'. NULL = don't estimate dividend tax.
  tax_band      text CHECK (tax_band IS NULL OR tax_band IN ('basic','higher','additional')),
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_shareholders_company ON company_shareholders(company_id);

-- ── ESTATE_AGENTS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estate_agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account that created (and manages) this agent record. Agents are a
  -- per-account directory shared across that account's companies.
  user_id       uuid NOT NULL,
  name          text NOT NULL,
  contact_name  text,
  email         text,
  phone         text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estate_agents_user ON estate_agents(user_id);

-- ── COMPANY_AGENT_FEES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_agent_fees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES estate_agents(id) ON DELETE CASCADE,
  -- Fee as % of rent collected, 0–100 with 2dp.
  fee_percent   numeric(5,2) NOT NULL CHECK (fee_percent >= 0 AND fee_percent <= 100),
  -- 'inc_vat' = the % already includes VAT; 'ex_vat' = VAT (20%) is added on
  -- top when the P&L computes the cost. Same vocabulary as deals.agent_fee_vat.
  vat_treatment text NOT NULL DEFAULT 'inc_vat' CHECK (vat_treatment IN ('inc_vat','ex_vat')),
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_company_agent_fees_company ON company_agent_fees(company_id);
CREATE INDEX IF NOT EXISTS idx_company_agent_fees_agent   ON company_agent_fees(agent_id);

-- ── updated_at triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_ownership_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_company_shareholders_updated_at ON company_shareholders;
CREATE TRIGGER trg_company_shareholders_updated_at
  BEFORE UPDATE ON company_shareholders
  FOR EACH ROW EXECUTE FUNCTION update_ownership_updated_at();

DROP TRIGGER IF EXISTS trg_estate_agents_updated_at ON estate_agents;
CREATE TRIGGER trg_estate_agents_updated_at
  BEFORE UPDATE ON estate_agents
  FOR EACH ROW EXECUTE FUNCTION update_ownership_updated_at();

DROP TRIGGER IF EXISTS trg_company_agent_fees_updated_at ON company_agent_fees;
CREATE TRIGGER trg_company_agent_fees_updated_at
  BEFORE UPDATE ON company_agent_fees
  FOR EACH ROW EXECUTE FUNCTION update_ownership_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Write access = company owner or an is_admin collaborator (developers pass
-- everywhere). Read = anyone with company access.

ALTER TABLE company_shareholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_agent_fees   ENABLE ROW LEVEL SECURITY;

-- Helper predicate used by the write policies below, inlined per policy to
-- avoid a new SECURITY DEFINER surface:
--   company owner:  companies.owner_id = auth.uid()
--   company admin:  user_company_access.is_admin

-- company_shareholders
DROP POLICY IF EXISTS "company_shareholders_select" ON company_shareholders;
CREATE POLICY "company_shareholders_select" ON company_shareholders
FOR SELECT USING (
  is_developer() OR has_company_access(company_id)
);

DROP POLICY IF EXISTS "company_shareholders_insert" ON company_shareholders;
CREATE POLICY "company_shareholders_insert" ON company_shareholders
FOR INSERT WITH CHECK (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
  OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text AND is_admin = true)
);

DROP POLICY IF EXISTS "company_shareholders_update" ON company_shareholders;
CREATE POLICY "company_shareholders_update" ON company_shareholders
FOR UPDATE USING (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
  OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text AND is_admin = true)
);

DROP POLICY IF EXISTS "company_shareholders_delete" ON company_shareholders;
CREATE POLICY "company_shareholders_delete" ON company_shareholders
FOR DELETE USING (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
  OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text AND is_admin = true)
);

-- estate_agents: creator manages their directory; collaborators on any
-- company that pays the agent can read it (so fee rows render for them).
DROP POLICY IF EXISTS "estate_agents_select" ON estate_agents;
CREATE POLICY "estate_agents_select" ON estate_agents
FOR SELECT USING (
  is_developer()
  OR user_id::text = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM company_agent_fees f
    WHERE f.agent_id = estate_agents.id AND has_company_access(f.company_id)
  )
);

DROP POLICY IF EXISTS "estate_agents_insert" ON estate_agents;
CREATE POLICY "estate_agents_insert" ON estate_agents
FOR INSERT WITH CHECK (
  is_developer() OR user_id::text = auth.uid()::text
);

DROP POLICY IF EXISTS "estate_agents_update" ON estate_agents;
CREATE POLICY "estate_agents_update" ON estate_agents
FOR UPDATE USING (
  is_developer() OR user_id::text = auth.uid()::text
);

DROP POLICY IF EXISTS "estate_agents_delete" ON estate_agents;
CREATE POLICY "estate_agents_delete" ON estate_agents
FOR DELETE USING (
  is_developer() OR user_id::text = auth.uid()::text
);

-- company_agent_fees
DROP POLICY IF EXISTS "company_agent_fees_select" ON company_agent_fees;
CREATE POLICY "company_agent_fees_select" ON company_agent_fees
FOR SELECT USING (
  is_developer() OR has_company_access(company_id)
);

DROP POLICY IF EXISTS "company_agent_fees_insert" ON company_agent_fees;
CREATE POLICY "company_agent_fees_insert" ON company_agent_fees
FOR INSERT WITH CHECK (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
  OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text AND is_admin = true)
);

DROP POLICY IF EXISTS "company_agent_fees_update" ON company_agent_fees;
CREATE POLICY "company_agent_fees_update" ON company_agent_fees
FOR UPDATE USING (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
  OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text AND is_admin = true)
);

DROP POLICY IF EXISTS "company_agent_fees_delete" ON company_agent_fees;
CREATE POLICY "company_agent_fees_delete" ON company_agent_fees
FOR DELETE USING (
  is_developer()
  OR company_id IN (SELECT id FROM companies WHERE owner_id::text = auth.uid()::text)
  OR company_id IN (SELECT company_id FROM user_company_access WHERE user_id::text = auth.uid()::text AND is_admin = true)
);
