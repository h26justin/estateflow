-- Storage bucket limits for public-assets and property-documents (15 Oct 2026).
--
-- public-assets is a PUBLIC bucket (anyone with the URL can read) and any
-- signed-in user can upload into their own folder. It had no size limit and
-- no MIME allow-list, so it could host arbitrary files — HTML, SVG with
-- script, executables, multi-GB blobs — on our storage domain.
--
-- The app's only writer is the company-logo upload
-- (src/lib/api/companySettings.js → uploadCompanyLogo; client cap 2 MB,
-- BrandingSettingsPanel). Logos are embedded in generated PDFs and in the
-- weekly agent report email (rendered via the image-transform endpoint), so
-- raster formats are what is needed:
--   * file_size_limit 5 MB   (headroom above the 2 MB client cap)
--   * allowed_mime_types     png, jpeg, webp, gif
-- SVG is deliberately NOT allowed: an SVG served from a public bucket can
-- carry script, and nothing in the app needs vector logos.
--
-- Live state checked before writing this (read-only): public-assets holds 5
-- objects, all image/png, largest ~218 KB — every existing file already fits
-- the new rules. (Bucket limits apply to new uploads only in any case.)
--
-- property-documents (private) had no size limit. The app's document upload
-- caps files at 25 MB (src/lib/api/documents.js MAX_FILE_BYTES; images
-- 10 MB) and ingest-statement-email caps attachments at 10 MB, so the bucket
-- limit is set to 25 MB to match — never below what the app allows. Live:
-- 35 objects, largest ~4.4 MB. No MIME list here: the bucket legitimately
-- holds PDFs, images, office documents and CSVs.
--
-- Idempotent. ROLLBACK:
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--    where id = 'public-assets';
--   update storage.buckets set file_size_limit = null where id = 'property-documents';

update storage.buckets
   set file_size_limit    = 5 * 1024 * 1024,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
 where id = 'public-assets';

update storage.buckets
   set file_size_limit = 25 * 1024 * 1024
 where id = 'property-documents';

-- Verification:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets
--    where id in ('public-assets', 'property-documents');
--   -- public-assets      | t | 5242880  | {image/png,image/jpeg,image/webp,image/gif}
--   -- property-documents | f | 26214400 | null
