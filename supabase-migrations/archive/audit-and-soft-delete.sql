-- =============================================================================
-- OwnProperly: Audit Log + Soft Delete + Backup Migration
-- =============================================================================
-- RUN THIS ENTIRE FILE ONCE in Supabase > SQL Editor
-- This enables:
--   1. Automatic audit logging on every INSERT/UPDATE/DELETE via postgres triggers
--      (captures every change made by anyone via any route — UI, API, or SQL)
--   2. Soft-delete columns on all key tables (deleted_at, deleted_by)
--   3. RLS policies to isolate audit logs per user
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SOFT DELETE COLUMNS ON ALL KEY TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- Add deleted_at + deleted_by to every table that holds user data
-- (properties already has this from prior migration, so IF NOT EXISTS is important)

ALTER TABLE companies          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE companies          ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE properties         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE properties         ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE tenancy_details    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenancy_details    ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE compliance_items   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE compliance_items   ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE maintenance_jobs   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE maintenance_jobs   ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE property_expenses  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE property_expenses  ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE deals              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE deals              ADD COLUMN IF NOT EXISTS deleted_by UUID;

ALTER TABLE rent_payments      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE rent_payments      ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- Index for fast filtering of active rows
CREATE INDEX IF NOT EXISTS idx_properties_deleted_at          ON properties(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_companies_deleted_at           ON companies(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenancy_details_deleted_at     ON tenancy_details(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_items_deleted_at    ON compliance_items(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_deleted_at    ON maintenance_jobs(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_property_expenses_deleted_at   ON property_expenses(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_deleted_at               ON deals(deleted_at) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AUDIT LOG TABLE (ensure structure)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID,
  company_id    UUID,
  action        TEXT NOT NULL,       -- e.g. 'property.updated'
  entity_type   TEXT,                -- e.g. 'property'
  entity_id     UUID,
  entity_name   TEXT,
  metadata      JSONB DEFAULT '{}',
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id     ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_company_id  ON audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity      ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at  ON audit_log(created_at DESC);

-- RLS: users see only their own log entries (by user_id OR company_id they have access to)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own audit entries" ON audit_log;
CREATE POLICY "Users can view own audit entries" ON audit_log
FOR SELECT USING (
  user_id = auth.uid()
  OR company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
    UNION
    SELECT company_id FROM user_company_access WHERE user_id = auth.uid()
  )
);

-- No INSERT/UPDATE/DELETE from client — only triggers write to audit_log
DROP POLICY IF EXISTS "Service role manages audit log" ON audit_log;
CREATE POLICY "Service role manages audit log" ON audit_log
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Allow inserts from any authenticated user too (so JS-side logAction() still works as fallback)
DROP POLICY IF EXISTS "Users can insert own audit entries" ON audit_log;
CREATE POLICY "Users can insert own audit entries" ON audit_log
FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. GENERIC AUDIT TRIGGER FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────
-- This function handles any table. It figures out:
--   - who did it (auth.uid())
--   - what entity was affected
--   - which company it belongs to (searches common columns)
--   - what changed (JSON diff for updates)

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_entity_id UUID;
  v_entity_name TEXT;
  v_action TEXT;
  v_changes JSONB := '{}'::JSONB;
  v_old_json JSONB;
  v_new_json JSONB;
  v_key TEXT;
BEGIN
  -- Get current user (may be NULL for service_role operations)
  v_user_id := auth.uid();

  -- Entity ID (assume PK is 'id')
  IF TG_OP = 'DELETE' THEN
    v_entity_id := (to_jsonb(OLD)->>'id')::UUID;
  ELSE
    v_entity_id := (to_jsonb(NEW)->>'id')::UUID;
  END IF;

  -- Entity name — try common name columns
  IF TG_OP = 'DELETE' THEN
    v_entity_name := COALESCE(
      to_jsonb(OLD)->>'name',
      to_jsonb(OLD)->>'title',
      to_jsonb(OLD)->>'description',
      to_jsonb(OLD)->>'item_type',
      to_jsonb(OLD)->>'tenant_name'
    );
  ELSE
    v_entity_name := COALESCE(
      to_jsonb(NEW)->>'name',
      to_jsonb(NEW)->>'title',
      to_jsonb(NEW)->>'description',
      to_jsonb(NEW)->>'item_type',
      to_jsonb(NEW)->>'tenant_name'
    );
  END IF;

  -- Company ID — try to resolve
  IF TG_OP = 'DELETE' THEN
    v_company_id := (to_jsonb(OLD)->>'company_id')::UUID;
  ELSE
    v_company_id := (to_jsonb(NEW)->>'company_id')::UUID;
  END IF;

  -- If table is properties and we have property data, grab company from parent
  IF v_company_id IS NULL AND TG_TABLE_NAME <> 'companies' THEN
    IF TG_OP = 'DELETE' AND (to_jsonb(OLD)->>'property_id') IS NOT NULL THEN
      SELECT company_id INTO v_company_id FROM properties WHERE id = (to_jsonb(OLD)->>'property_id')::UUID;
    ELSIF TG_OP <> 'DELETE' AND (to_jsonb(NEW)->>'property_id') IS NOT NULL THEN
      SELECT company_id INTO v_company_id FROM properties WHERE id = (to_jsonb(NEW)->>'property_id')::UUID;
    END IF;
  END IF;

  -- Build action string
  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  -- Convert DELETE to .deleted, UPDATE to .updated, INSERT to .created
  v_action := CASE
    WHEN TG_OP = 'INSERT' THEN TG_TABLE_NAME || '.created'
    WHEN TG_OP = 'UPDATE' THEN TG_TABLE_NAME || '.updated'
    WHEN TG_OP = 'DELETE' THEN TG_TABLE_NAME || '.deleted'
  END;

  -- For updates, check if this is a soft-delete (deleted_at changed NULL → value)
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD)->>'deleted_at') IS NULL AND (to_jsonb(NEW)->>'deleted_at') IS NOT NULL THEN
      v_action := TG_TABLE_NAME || '.soft_deleted';
    ELSIF (to_jsonb(OLD)->>'deleted_at') IS NOT NULL AND (to_jsonb(NEW)->>'deleted_at') IS NULL THEN
      v_action := TG_TABLE_NAME || '.restored';
    END IF;

    -- Compute changes diff (which columns changed)
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new_json) LOOP
      IF v_old_json->v_key IS DISTINCT FROM v_new_json->v_key
         AND v_key NOT IN ('updated_at','created_at') THEN
        v_changes := v_changes || jsonb_build_object(
          v_key,
          jsonb_build_object('from', v_old_json->v_key, 'to', v_new_json->v_key)
        );
      END IF;
    END LOOP;
  END IF;

  -- Insert audit entry (don't fail the original operation if this fails)
  BEGIN
    INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, entity_name, metadata)
    VALUES (
      v_user_id,
      v_company_id,
      v_action,
      TG_TABLE_NAME,
      v_entity_id,
      v_entity_name,
      CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changes', v_changes)
           ELSE '{}'::JSONB END
    );
  EXCEPTION WHEN OTHERS THEN
    -- Swallow logging errors
    NULL;
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ATTACH TRIGGERS TO ALL KEY TABLES
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS audit_trigger ON companies;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON companies
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON properties;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON properties
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON tenancy_details;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON tenancy_details
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON compliance_items;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON compliance_items
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON maintenance_jobs;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON maintenance_jobs
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON property_expenses;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON property_expenses
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON deals;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON deals
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON rent_payments;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON rent_payments
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON deposit_protection;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON deposit_protection
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON legal_notices;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON legal_notices
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON right_to_rent;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON right_to_rent
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON user_company_access;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON user_company_access
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_trigger ON company_settings;
CREATE TRIGGER audit_trigger AFTER INSERT OR UPDATE OR DELETE ON company_settings
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FUNCTION: PURGE OLD SOFT-DELETED ROWS AFTER 30 DAYS
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this periodically via pg_cron or manually

CREATE OR REPLACE FUNCTION purge_soft_deleted_older_than_30_days() RETURNS void AS $$
BEGIN
  DELETE FROM properties        WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM companies         WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM tenancy_details   WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM compliance_items  WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM maintenance_jobs  WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM property_expenses WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM deals             WHERE deleted_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SCHEDULE WEEKLY BACKUP EMAIL (requires pg_cron extension)
-- ─────────────────────────────────────────────────────────────────────────────
-- Uncomment if pg_cron is enabled in your Supabase project
-- This calls the send-weekly-backup edge function every Monday at 08:00 UTC
--
-- SELECT cron.schedule(
--   'weekly-user-backup',
--   '0 8 * * 1',
--   $$SELECT net.http_post(
--       url := 'https://YOUR_PROJECT.supabase.co/functions/v1/send-weekly-backup',
--       headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY')
--     );$$
-- );
--
-- Also schedule the soft-delete purge daily:
-- SELECT cron.schedule('purge-soft-deleted', '0 3 * * *', 'SELECT purge_soft_deleted_older_than_30_days();');

-- =============================================================================
-- DONE. Verify it worked:
--   SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10;
-- After any CRUD operation, rows should appear here automatically.
-- =============================================================================
