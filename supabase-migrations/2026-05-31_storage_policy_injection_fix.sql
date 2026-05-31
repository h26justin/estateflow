-- ===========================================================================
-- Storage policy injection fix  (closes OVERNIGHT_AUDIT.md finding #5)
--
-- THE BUG
-- -------
-- The `property-documents` storage RLS policy granted read access to any
-- storage object whose `name` matched a `file_path` in property_documents /
-- company_documents / deal_documents owned by the caller:
--
--     EXISTS (SELECT 1 FROM property_documents
--             WHERE file_path = storage.objects.name AND user_id = auth.uid())
--
-- But the table policy `pd_all` lets a user INSERT a property_documents row
-- with their OWN user_id and an ARBITRARY file_path. So an attacker inserts:
--     { user_id: <self>, file_path: '<victim-uid>/properties/x/secret.pdf' }
-- and the storage EXISTS branch then hands them the victim's file. A classic
-- confused-deputy / forged-row injection.
--
-- THE FIX (two coordinated parts — neither is sufficient alone)
-- ------------------------------------------------------------
--   PART A  Stop the forgery at the source: a BEFORE INSERT/UPDATE trigger on
--           the three *_documents tables rejects any client-set file_path that
--           does not live under the caller's own `auth.uid()/...` folder.
--           Service-role writes (edge functions) bypass it (auth.uid() is NULL).
--   PART B  Rewrite the storage policy so the path-prefix is the primary
--           authority, collaborators read via has_property_access /
--           has_company_access (NOT a forgeable EXISTS on user_id), and the
--           remaining EXISTS lookups are now safe because Part A guarantees a
--           user-created row's file_path belongs to its owner.
--
-- Idempotent. Safe to run multiple times. Safe to run BEFORE the code redeploy
-- (the new WITH CHECK is a strict superset of the old one, so no current
-- upload path is blocked). Apply SQL first, then deploy the code changes.
-- ===========================================================================

-- ── PART A: forbid forged file_paths on user-driven writes ───────────────────
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

-- ── PART B: rewrite the property-documents storage policy ─────────────────────
-- Read/delete (USING) is granted when ANY of the following holds. Every branch
-- is now safe because Part A guarantees a user-created row's file_path is owned
-- by that user.
--
--   1. Path's first segment is the caller's uid          (standard layout)
--   2. inspections/<uid>/...                              (legacy inspection photos)
--   3. companies/<uid>/...                                (legacy FeatureComponents company docs)
--   4. A property_documents row points at this object AND caller owns it OR has
--      property access  (covers collaborators, statements/<companyId>/... written
--      by the service role, and very old `${propertyId}/...` paths)
--   5. ditto for company_documents via has_company_access  (collaborators)
--   6. ditto for deal_documents (owner only — deals aren't shared)
--
-- Write (WITH CHECK) only ever allows uid-anchored paths. This is a strict
-- SUPERSET of the previous WITH CHECK ([1]=uid only): the two extra clauses are
-- still uid-anchored (just at segment 2), so security is not weakened — they
-- only keep legacy inspection/company upload code working until it redeploys.

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
-- APPLY + VERIFY RUNBOOK
-- ===========================================================================
-- 1. Run this whole file in the OwnProperly Supabase SQL editor
--    (project hqrhqbkqxzllmzhcofrh). It is safe to run before the code deploy.
-- 2. Deploy the matching code changes (Vercel auto-build on push to main):
--      - FeatureComponents.jsx company-doc upload path
--          companies/${u.id}/...  ->  ${u.id}/company_documents/...
--      - api/_monolith.js uploadInspectionPhoto path
--          inspections/${userId}/...  ->  ${userId}/inspections/...
--    (Old files at the legacy prefixes keep working via the USING clauses
--     above + their stored signed URLs — no data migration needed.)
-- 3. Complete Phase 3 of STORAGE_PRIVATIZATION_GUIDE.md: in the Dashboard,
--    Storage -> property-documents -> toggle "Public bucket" OFF. The injection
--    fix + private bucket TOGETHER close the hole (a public bucket lets anyone
--    fetch by raw path regardless of RLS).
--
-- VERIFY (as a normal user, not developer):
--   a. Open a property -> Documents -> click a doc -> opens (signed URL).      PASS
--   b. A collaborator on a shared company opens a company/property doc.        PASS
--   c. A forwarded statement file is readable by the company owner.            PASS
--   d. Forgery attempt — in SQL as an authenticated test user, run:
--        INSERT INTO property_documents (property_id, user_id, name, file_path)
--        VALUES (<any>, auth.uid(), 'x', '<other-uid>/properties/x/secret.pdf');
--      -> must RAISE 'file_path must live under your own user folder'.         BLOCKED
-- ===========================================================================
