-- =============================================================================
-- OwnProperly: User Roles & Permissions Migration
-- =============================================================================
-- RUN THIS in Supabase > SQL Editor
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ADD role + permissions TO user_company_access
-- ─────────────────────────────────────────────────────────────────────────────
-- Role values: 'owner', 'admin', 'editor', 'viewer'
-- Permissions is a JSONB object that can override role defaults, e.g.
--   { "view_financial": true, "view_tenant_personal": false }

ALTER TABLE user_company_access ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'editor';
ALTER TABLE user_company_access ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- Migrate existing is_admin → role mapping
UPDATE user_company_access SET role = 'admin' WHERE is_admin = true AND role = 'editor';
UPDATE user_company_access SET role = 'editor' WHERE is_admin = false AND role IS NULL;

-- Add a check constraint for valid role values
DO $check$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'user_company_access_role_check'
  ) THEN
    ALTER TABLE user_company_access
      ADD CONSTRAINT user_company_access_role_check
      CHECK (role IN ('admin','editor','viewer'));
  END IF;
END $check$;

-- Index on role for fast filtering
CREATE INDEX IF NOT EXISTS idx_user_company_access_role ON user_company_access(company_id, role);

-- =============================================================================
-- DONE.
-- Verify:
--   SELECT role, COUNT(*) FROM user_company_access GROUP BY role;
-- =============================================================================
