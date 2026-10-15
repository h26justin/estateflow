-- Feature flags system
-- Lets the developer enable/disable features per user, per company, or globally

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  enabled_globally BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flag_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(flag_key, user_id)
);

CREATE TABLE IF NOT EXISTS feature_flag_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(flag_key, company_id)
);

CREATE INDEX IF NOT EXISTS idx_ff_users ON feature_flag_users(user_id, flag_key);
CREATE INDEX IF NOT EXISTS idx_ff_companies ON feature_flag_companies(company_id, flag_key);

-- RLS: any authenticated user can read flags (to check their own feature access),
-- but only developers can write
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ff_read" ON feature_flags;
CREATE POLICY "ff_read" ON feature_flags FOR SELECT USING (true);
DROP POLICY IF EXISTS "ff_write" ON feature_flags;
CREATE POLICY "ff_write" ON feature_flags FOR ALL USING (is_developer()) WITH CHECK (is_developer());

ALTER TABLE feature_flag_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ffu_read" ON feature_flag_users;
CREATE POLICY "ffu_read" ON feature_flag_users FOR SELECT USING (
  is_developer() OR user_id::text = auth.uid()::text
);
DROP POLICY IF EXISTS "ffu_write" ON feature_flag_users;
CREATE POLICY "ffu_write" ON feature_flag_users FOR ALL USING (is_developer()) WITH CHECK (is_developer());

ALTER TABLE feature_flag_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ffc_read" ON feature_flag_companies;
CREATE POLICY "ffc_read" ON feature_flag_companies FOR SELECT USING (
  is_developer() OR has_company_access(company_id)
);
DROP POLICY IF EXISTS "ffc_write" ON feature_flag_companies;
CREATE POLICY "ffc_write" ON feature_flag_companies FOR ALL USING (is_developer()) WITH CHECK (is_developer());

-- Seed a few starter flags
INSERT INTO feature_flags (key, name, description, enabled_globally) VALUES
  ('ai_listing_writer', 'AI Listing Writer', 'Use Claude AI to draft property listings', true),
  ('advanced_reports', 'Advanced Reports', 'Unlock the full 20-report library (SA105, stress test, etc.)', false),
  ('ocr_vault', 'Document OCR Vault', 'Upload PDFs, auto-extract fields', false),
  ('tenant_portal_v2', 'Tenant Portal V2', 'Individual tenant logins (beta)', false),
  ('dashboard_widgets', 'Customizable Dashboard', 'Drag-drop widget customization', true)
ON CONFLICT (key) DO NOTHING;
