-- =============================================================================
-- OwnProperly: Backup System — Storage + Metadata Table
-- =============================================================================
-- RUN THIS in Supabase > SQL Editor AFTER running audit-and-soft-delete.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BACKUPS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_backups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type           TEXT NOT NULL DEFAULT 'automatic',   -- 'automatic' | 'manual' | 'pre-restore'
  storage_path   TEXT NOT NULL,                       -- path in storage bucket
  size_bytes     BIGINT,
  counts         JSONB DEFAULT '{}',                  -- { companies: 7, properties: 131, ... }
  trigger        TEXT,                                -- what triggered it: 'weekly_cron', 'user_manual', etc.
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_backups_user_created ON user_backups(user_id, created_at DESC);

-- RLS: users see only their own backups
ALTER TABLE user_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own backups" ON user_backups;
CREATE POLICY "Users view own backups" ON user_backups
FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own backups" ON user_backups;
CREATE POLICY "Users insert own backups" ON user_backups
FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own backups" ON user_backups;
CREATE POLICY "Users delete own backups" ON user_backups
FOR DELETE USING (user_id = auth.uid());

-- Service role can do anything (for Edge Function)
DROP POLICY IF EXISTS "Service role manages all backups" ON user_backups;
CREATE POLICY "Service role manages all backups" ON user_backups
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STORAGE BUCKET
-- ─────────────────────────────────────────────────────────────────────────────
-- Create a private storage bucket for backup files
-- (Run manually in Supabase UI if this INSERT fails — Storage > New Bucket > "user-backups" > Private)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-backups', 'user-backups', false, 104857600, ARRAY['application/json'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can only access their own folder (path starts with their user_id)
DROP POLICY IF EXISTS "Users access own backup folder" ON storage.objects;
CREATE POLICY "Users access own backup folder" ON storage.objects
FOR ALL
USING (bucket_id = 'user-backups' AND (auth.uid()::text = (storage.foldername(name))[1]))
WITH CHECK (bucket_id = 'user-backups' AND (auth.uid()::text = (storage.foldername(name))[1]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RETENTION: KEEP ONLY LAST 12 BACKUPS PER USER
-- ─────────────────────────────────────────────────────────────────────────────
-- This function deletes backups beyond the 12 most recent per user (and their storage objects)

CREATE OR REPLACE FUNCTION prune_old_backups() RETURNS void AS $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN (
    SELECT id, storage_path FROM user_backups b1
    WHERE id NOT IN (
      SELECT id FROM user_backups b2
      WHERE b2.user_id = b1.user_id
      ORDER BY created_at DESC
      LIMIT 12
    )
  ) LOOP
    -- Remove from storage (will no-op if file doesn't exist)
    PERFORM storage.delete_object('user-backups', v_rec.storage_path);
    -- Remove metadata row
    DELETE FROM user_backups WHERE id = v_rec.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SCHEDULE WEEKLY BACKUP (requires pg_cron + pg_net extensions)
-- ─────────────────────────────────────────────────────────────────────────────
-- Uncomment once pg_cron and pg_net are enabled in Supabase dashboard:
--
-- SELECT cron.schedule(
--   'weekly-user-backups',
--   '0 3 * * 1',  -- Mondays 03:00 UTC
--   $$SELECT net.http_post(
--       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-user-backups',
--       headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY')
--     );$$
-- );
--
-- SELECT cron.schedule('prune-old-backups', '0 4 * * 1', 'SELECT prune_old_backups();');

-- =============================================================================
-- DONE.
-- Verify bucket exists:   SELECT * FROM storage.buckets WHERE id = 'user-backups';
-- Verify RLS:             SELECT polname FROM pg_policy WHERE polrelid = 'user_backups'::regclass;
-- =============================================================================
