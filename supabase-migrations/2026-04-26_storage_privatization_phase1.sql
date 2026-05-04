-- ===========================================================================
-- Phase 1 of the storage privatization refactor
-- 
-- Creates a public-assets bucket for genuinely public files (company logos)
-- and adds RLS policies to property-documents that admit BOTH new strict
-- layouts and legacy paths. This means existing files keep working while
-- new uploads use the secure layout.
--
-- The bucket itself stays public until Phase 3 (manual flip in the Dashboard,
-- AFTER the new code has been deployed and verified).
--
-- Safe to run multiple times.
-- ===========================================================================

-- ── Step 1: Create the public-assets bucket ──────────────────────────────────
-- Public bucket — for non-sensitive files like logos that need to be
-- accessible without authentication (PDFs, embedded images, etc).
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-assets', 'public-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ── Step 2: RLS for public-assets ────────────────────────────────────────────
-- Anyone can read (it's public). Authenticated users write to their own
-- user-id folder only. Logos go to {user_id}/company_logos/...

DROP POLICY IF EXISTS "Public assets are readable by anyone" ON storage.objects;
CREATE POLICY "Public assets are readable by anyone" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'public-assets');

DROP POLICY IF EXISTS "Authenticated users can upload to public-assets" ON storage.objects;
CREATE POLICY "Authenticated users can upload to public-assets" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'public-assets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Authenticated users update own files in public-assets" ON storage.objects;
CREATE POLICY "Authenticated users update own files in public-assets" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'public-assets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Authenticated users delete own files in public-assets" ON storage.objects;
CREATE POLICY "Authenticated users delete own files in public-assets" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'public-assets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Step 3: RLS for property-documents (private after Phase 3) ───────────────
-- This policy admits BOTH the new strict layout (user-id folder root) AND
-- existing legacy paths (any path that the user owns according to a DB row
-- in property_documents / company_documents / deal_documents). The legacy
-- compatibility lets existing uploads keep working without a risky storage
-- migration.
--
-- New uploads always use the strict layout (enforced by the API helpers).

DROP POLICY IF EXISTS "Users access own files in property-documents" ON storage.objects;
DROP POLICY IF EXISTS "Users access own files in property-documents (strict)" ON storage.objects;
DROP POLICY IF EXISTS "Users manage own files in property-documents" ON storage.objects;

CREATE POLICY "Users access own files in property-documents" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'property-documents'
    AND auth.uid() IS NOT NULL
    AND (
      -- Strict layout: file lives under the user's own folder
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      -- Legacy compatibility: allow access to files referenced by a row in
      -- property_documents / company_documents / deal_documents that this
      -- user owns. This keeps old paths like "{propertyId}/{ts}.pdf" working.
      EXISTS (SELECT 1 FROM property_documents
              WHERE file_path = storage.objects.name
              AND user_id = auth.uid())
      OR
      EXISTS (SELECT 1 FROM company_documents
              WHERE file_path = storage.objects.name
              AND user_id = auth.uid())
      OR
      EXISTS (SELECT 1 FROM deal_documents
              WHERE file_path = storage.objects.name
              AND user_id = auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'property-documents'
    AND auth.uid() IS NOT NULL
    -- New writes MUST use the strict layout (top-level folder = user id).
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Done. Next steps:
--   Phase 2 (deploy code via GitHub):
--     New uploads use the strict {user_id}/... path layout.
--   Phase 3 (manual, in Supabase Dashboard, AFTER Phase 2 is verified):
--     Storage → property-documents → Edit → toggle "Public bucket" OFF.
--
-- IMPORTANT NOTE ON OLD LOGOS:
-- After Phase 3, existing public logo URLs (in property-documents/company_logos/)
-- will STOP working. New logos uploaded via the new code go to public-assets
-- and remain accessible. To restore old logos: just open Settings and re-upload
-- each company's logo. The new upload will go to public-assets automatically.
