-- ----------------------------------------------------------------------------
-- refurb_files: forbid forged file_path values (security hotfix, 14 Oct 2026)
--
-- HOLE: 2026-10-01_refurb_workspace.sql added the storage policy
--   "Refurb files readable with project access" (SELECT on storage.objects
--   in property-documents when EXISTS a non-deleted refurb_files row with
--   file_path = objects.name). refurb_files rows are writable by anyone with
--   'write' on ANY refurb project, and refurb_files is NOT covered by
--   enforce_document_path_ownership() (2026-06-10_security_02 only wires
--   property_documents / company_documents / deal_documents). So a user could
--   insert a refurb_files row in their own project whose file_path is another
--   tenant's object (e.g. '<victim-uid>/statements/x.pdf'), then read that
--   object through the refurb policy: cross-tenant document read.
--
-- FIX: a BEFORE INSERT/UPDATE trigger on refurb_files, same shape as
--   enforce_document_path_ownership(), but following the refurb upload
--   convention in src/lib/api/refurbWorkspace.js (uploadRefurbFile):
--     <caller uid>/refurbs/<project_id>/<file>
--   Uploads into that folder are only possible for the caller themself
--   (storage WITH CHECK anchors writes to the caller's uid folder), so a row
--   can only ever point at an object its creator uploaded for that project.
--   Updates that do not touch file_path or project_id (crop, title, soft
--   delete) pass untouched, so legacy rows keep working. '..' is refused.
--   Service role / edge functions (auth.uid() IS NULL) are trusted.
--
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_refurb_file_path_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.file_path IS NOT DISTINCT FROM OLD.file_path
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;

  IF NEW.file_path IS NOT NULL
     AND NEW.project_id IS NOT NULL
     AND position('..' IN NEW.file_path) = 0
     AND left(NEW.file_path, length(auth.uid()::text || '/refurbs/' || NEW.project_id::text || '/'))
         = auth.uid()::text || '/refurbs/' || NEW.project_id::text || '/'
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'refurb file_path must live under your own refurbs/<project> folder (got: %)', NEW.file_path
    USING ERRCODE = 'check_violation';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_refurb_file_path_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refurb_files_path_ownership ON public.refurb_files;
CREATE TRIGGER trg_refurb_files_path_ownership
  BEFORE INSERT OR UPDATE ON public.refurb_files
  FOR EACH ROW EXECUTE FUNCTION public.enforce_refurb_file_path_ownership();
