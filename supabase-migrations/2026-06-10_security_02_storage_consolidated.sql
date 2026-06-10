-- ===========================================================================
-- Security hardening 02 — storage.objects (property-documents) consolidated fix
-- ===========================================================================
-- Closes THREE related findings against production (project hqrhqbkqxzllmzhcofrh):
--
--   A. Legacy wide-open policies (CRITICAL): three dashboard-created policies
--      'Allow viewing r9vqgw_0' (SELECT), 'Allow uploads r9vqgw_0' (INSERT),
--      'Allow delete r9vqgw_0' (DELETE) are scoped only to
--      bucket_id = 'property-documents' for the `authenticated` role. Because
--      permissive RLS policies OR together, they grant EVERY signed-in user
--      full read/upload/delete over the entire bucket — cross-tenant document
--      exposure + data loss. They were never dropped by the repo migration.
--
--   B. Forgeable storage policy (CRITICAL): the live
--      "Users access own files in property-documents" policy is the OLD
--      EXISTS-on-user_id shape with no path-prefix anchor and no
--      has_property_access / has_company_access check — a confused-deputy
--      cross-tenant read (insert a property_documents row with your own
--      user_id but a victim's file_path, then read the object).
--
--   C. The 2026-05-31 injection fix (HIGH) was committed but never applied to
--      production: enforce_document_path_ownership() and the
--      trg_*_path_ownership triggers do not exist live.
--
-- This migration is the SELF-SUFFICIENT consolidation: it drops the three
-- legacy r9vqgw_0 policies AND applies the full 2026-05-31 fix content
-- (trigger + has_property_access storage policy). It supersedes
-- 2026-05-31_storage_policy_injection_fix.sql (which is left in the repo for
-- history but must NOT be relied on alone — it omitted the legacy DROPs).
--
-- Idempotent. Apply SQL first, then ensure the property-documents bucket is
-- PRIVATE (Dashboard -> Storage -> property-documents -> Public bucket OFF),
-- which is already the live state.
--
-- ROLLBACK: re-create the legacy policies (NOT recommended — they are the hole)
-- and DROP POLICY "Users access own files in property-documents"; the prior
-- forgeable policy/trigger would have to be restored from git history.
-- ===========================================================================

-- ── A. Drop the legacy wide-open policies ────────────────────────────────────
DROP POLICY IF EXISTS "Allow viewing r9vqgw_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads r9vqgw_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete r9vqgw_0"  ON storage.objects;

-- ── B. Forbid forged file_paths on user-driven writes (2026-05-31 PART A) ─────
CREATE OR REPLACE FUNCTION public.enforce_document_path_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role / edge functions (no JWT) are trusted — they write
  -- statements/<companyId>/... and other server-managed paths.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow updates that don't touch file_path (soft-delete, category change,
  -- extraction status, etc.) — including on legacy rows whose path predates
  -- the strict layout.
  IF TG_OP = 'UPDATE' AND NEW.file_path IS NOT DISTINCT FROM OLD.file_path THEN
    RETURN NEW;
  END IF;

  -- Null path (rare) or a path under the caller's own user folder is fine.
  IF NEW.file_path IS NULL OR NEW.file_path LIKE auth.uid()::text || '/%' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'file_path must live under your own user folder (got: %)', NEW.file_path
    USING ERRCODE = 'check_violation';
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property_documents', 'company_documents', 'deal_documents'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_path_ownership ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_%I_path_ownership
           BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.enforce_document_path_ownership()',
        t, t);
    END IF;
  END LOOP;
END $$;

-- ── C. Rewrite the property-documents storage policy (2026-05-31 PART B) ──────
-- Read/delete (USING): path-prefix is the primary authority; collaborators
-- read via has_property_access / has_company_access (NOT a forgeable EXISTS on
-- user_id). Every EXISTS branch is safe because Part B guarantees a
-- user-created row's file_path is owned by that user.
-- Write (WITH CHECK): only ever uid-anchored paths.
DROP POLICY IF EXISTS "Users access own files in property-documents" ON storage.objects;
DROP POLICY IF EXISTS "Users access own files in property-documents (strict)" ON storage.objects;
DROP POLICY IF EXISTS "Users manage own files in property-documents" ON storage.objects;

CREATE POLICY "Users access own files in property-documents" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'property-documents'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR ((storage.foldername(name))[1] = 'inspections' AND (storage.foldername(name))[2] = auth.uid()::text)
      OR ((storage.foldername(name))[1] = 'companies'   AND (storage.foldername(name))[2] = auth.uid()::text)
      OR EXISTS (
        SELECT 1 FROM public.property_documents d
        WHERE d.file_path = storage.objects.name
          AND (d.user_id = auth.uid() OR public.has_property_access(d.property_id))
      )
      OR EXISTS (
        SELECT 1 FROM public.company_documents d
        WHERE d.file_path = storage.objects.name
          AND (d.user_id = auth.uid() OR public.has_company_access(d.company_id))
      )
      OR EXISTS (
        SELECT 1 FROM public.deal_documents d
        WHERE d.file_path = storage.objects.name
          AND d.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bucket_id = 'property-documents'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR ((storage.foldername(name))[1] = 'inspections' AND (storage.foldername(name))[2] = auth.uid()::text)
      OR ((storage.foldername(name))[1] = 'companies'   AND (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

-- ===========================================================================
-- APPLY + VERIFY RUNBOOK  (as a normal user, NOT developer)
--   1. Run this whole file.
--   2. Confirm the bucket is private (live state: public = false).
--   a. Open a property -> Documents -> click a doc -> opens (signed URL).   PASS
--   b. A collaborator on a shared company opens a company/property doc.      PASS
--   c. A forwarded statement file is readable by the company owner.          PASS
--   d. Wide-open check: SELECT count(*) FROM pg_policies
--        WHERE schemaname='storage' AND tablename='objects'
--          AND policyname LIKE 'Allow % r9vqgw_0';                           -> 0
--   e. Forgery attempt — as an authenticated test user:
--        INSERT INTO property_documents (property_id, user_id, name, file_path)
--        VALUES (<own>, auth.uid(), 'x', '<other-uid>/properties/x/secret.pdf');
--      -> must RAISE 'file_path must live under your own user folder'.       BLOCKED
-- ===========================================================================
