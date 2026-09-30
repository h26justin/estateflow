-- Company logo upload failed with "new row violates row-level security policy".
--
-- 2026-05-24_security_advisor_hardening.sql dropped the broad SELECT policy on
-- the public-assets bucket (anyone could list every file). But Storage's
-- upload(..., { upsert: true }) runs INSERT ... ON CONFLICT DO UPDATE, and
-- remove() looks rows up first, so both need a SELECT policy as well. With none,
-- every logo upload has been rejected since then.
--
-- Restore SELECT scoped to the uploader's own folder only, mirroring the
-- existing INSERT / UPDATE / DELETE policies. Public URL serving is unaffected
-- (the bucket is public), and nobody can list anyone else's files.

DROP POLICY IF EXISTS "Authenticated users read own files in public-assets" ON storage.objects;
CREATE POLICY "Authenticated users read own files in public-assets" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'public-assets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
