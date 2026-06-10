-- ===========================================================================
-- Tenant portal access — RLS path for verified tenants + invite-token-bound
-- registration (audit findings 57 + 58)
-- ===========================================================================
-- 57: no RLS policy anywhere grants a tenant read access to their own
--     property's data (has_property_access only resolves landlord/collaborator
--     membership), so the entire tenant portal returns empty/errors at the DB
--     layer for legitimate tenants.
-- 58: any authenticated user could self-register as a tenant of ANY property
--     (tenant_profiles tenant_own is FOR ALL with NULL WITH CHECK, and the
--     "invite" was just an unsigned property UUID in a shareable link).
--
-- FIX:
--   * tenant_invites table — landlord-issued, single-use, expiring tokens.
--   * redeem_tenant_invite(token) SECURITY DEFINER RPC — the ONLY way a user
--     can become a tenant of a property (validates + burns the token, then
--     inserts tenant_profiles). Direct client INSERT/UPDATE on tenant_profiles
--     is blocked for non-landlords by the new split policies.
--   * is_tenant_of_property(property_id) helper + additive tenant SELECT
--     policies on rent_payments / tenancy_details / property_documents
--     (shared_with_tenant only) / maintenance_jobs (tenant-reported only),
--     tenant INSERT/UPDATE on maintenance_jobs (own reported jobs), rewritten
--     tenant_messages policies, and a storage.objects SELECT policy for
--     shared documents.
--   * get_tenant_portal_context() SECURITY DEFINER RPC — curated property /
--     company / bank-details / feature-flags JSON for the portal header, so
--     tenants are deliberately NOT granted row-level SELECT on properties or
--     companies (full rows leak landlord financials and the statement email
--     token).
--
-- DEPENDS ON (apply first):
--   2026-06-10_security_01_helpers.sql        (has_property_permission,
--                                              company_is_live)
--   2026-06-10_perf_rls_initplan.sql          (recreates tenant_own /
--                                              tenant_messages_tenant, which
--                                              this file replaces — running
--                                              the perf file AFTER this one
--                                              would resurrect the insecure
--                                              FOR ALL policies)
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Tables (live DB already has tenant_profiles / tenant_messages — these
--    CREATEs document them in the repo and make fresh environments work).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  invited_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_id)
);
ALTER TABLE public.tenant_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  tenant_user_id uuid,
  message        text NOT NULL,
  sender_type    text NOT NULL DEFAULT 'tenant',
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_messages ENABLE ROW LEVEL SECURITY;

-- Columns the tenant portal relies on (no-ops where they already exist).
ALTER TABLE public.property_documents
  ADD COLUMN IF NOT EXISTS shared_with_tenant boolean DEFAULT false;
ALTER TABLE public.maintenance_jobs
  ADD COLUMN IF NOT EXISTS reported_by_tenant boolean DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. tenant_invites — landlord-issued, single-use, expiring registration tokens
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  email       text,
  invited_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  redeemed_at timestamptz,
  redeemed_by uuid
);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_property_id ON public.tenant_invites (property_id);
ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;

-- Landlord-side management only. Tokens are redeemed exclusively through the
-- SECURITY DEFINER RPC below, so tenants never need (or get) any access here.
DROP POLICY IF EXISTS tenant_invites_select ON public.tenant_invites;
CREATE POLICY tenant_invites_select ON public.tenant_invites
  FOR SELECT USING (
    is_developer() OR is_platform_admin()
    -- write-level access only: read-only viewer collaborators must not see
    -- live tokens (a viewer could otherwise redeem one themselves)
    OR has_property_permission(property_id, 'write')
  );

DROP POLICY IF EXISTS tenant_invites_insert ON public.tenant_invites;
CREATE POLICY tenant_invites_insert ON public.tenant_invites
  FOR INSERT WITH CHECK (
    is_developer()
    OR is_platform_admin()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

DROP POLICY IF EXISTS tenant_invites_delete ON public.tenant_invites;
CREATE POLICY tenant_invites_delete ON public.tenant_invites
  FOR DELETE USING (
    is_developer() OR is_platform_admin() OR has_property_permission(property_id, 'write')
  );
-- No UPDATE policy: redeemed_at/redeemed_by are only ever written by the RPC.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper — is the caller a registered tenant of this property?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_tenant_of_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_profiles tp
    WHERE tp.property_id = p_property_id
      AND tp.user_id = (SELECT auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.is_tenant_of_property(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tenant_of_property(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. redeem_tenant_invite — the only registration path
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_tenant_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.tenant_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept a tenant invite';
  END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'This invite link is invalid';
  END IF;

  -- One-time burn: claim the invite atomically.
  UPDATE public.tenant_invites
     SET redeemed_at = now(), redeemed_by = v_uid
   WHERE token = p_token
     AND redeemed_at IS NULL
     AND expires_at > now()
  RETURNING * INTO v_invite;

  IF v_invite.id IS NULL THEN
    -- Idempotent retry: the same user reloading a link they already redeemed.
    -- Returns the EXISTING profile only — it never re-inserts, so a tenant the
    -- landlord has since removed cannot re-add themselves with an old link.
    SELECT * INTO v_invite FROM public.tenant_invites i
     WHERE i.token = p_token AND i.redeemed_by = v_uid
       AND EXISTS (
         SELECT 1 FROM public.tenant_profiles tp
         WHERE tp.user_id = v_uid AND tp.property_id = i.property_id
       );
    IF v_invite.id IS NULL THEN
      RAISE EXCEPTION 'This invite link is invalid, has expired or was already used';
    END IF;
  ELSE
    INSERT INTO public.tenant_profiles (user_id, property_id, invited_by)
    SELECT v_uid, v_invite.property_id, v_invite.invited_by
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tenant_profiles
      WHERE user_id = v_uid AND property_id = v_invite.property_id
    );
  END IF;

  RETURN (
    SELECT to_jsonb(tp) FROM public.tenant_profiles tp
    WHERE tp.user_id = v_uid AND tp.property_id = v_invite.property_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_tenant_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_tenant_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_tenant_invite(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. tenant_profiles — replace the FOR ALL/NULL-WITH-CHECK policy (finding 58)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_own ON public.tenant_profiles;
DROP POLICY IF EXISTS tenant_profiles_select ON public.tenant_profiles;
DROP POLICY IF EXISTS tenant_profiles_insert ON public.tenant_profiles;
DROP POLICY IF EXISTS tenant_profiles_update ON public.tenant_profiles;
DROP POLICY IF EXISTS tenant_profiles_delete ON public.tenant_profiles;

-- Tenants read their own links; landlords/collaborators see their property's
-- tenants (tenant list).
CREATE POLICY tenant_profiles_select ON public.tenant_profiles
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR is_platform_admin()
    OR is_developer()
    OR has_property_access(property_id)
  );

-- Self-registration is BLOCKED: rows are created by redeem_tenant_invite
-- (SECURITY DEFINER, bypasses RLS) or by a landlord/editor of the property.
CREATE POLICY tenant_profiles_insert ON public.tenant_profiles
  FOR INSERT WITH CHECK (
    is_platform_admin()
    OR is_developer()
    OR has_property_permission(property_id, 'write')
  );

-- No tenant updates (an UPDATE could re-point property_id — same escalation).
CREATE POLICY tenant_profiles_update ON public.tenant_profiles
  FOR UPDATE
  USING (is_platform_admin() OR is_developer())
  WITH CHECK (is_platform_admin() OR is_developer());

-- Tenants may unlink themselves; landlords may remove tenants.
CREATE POLICY tenant_profiles_delete ON public.tenant_profiles
  FOR DELETE USING (
    user_id = (SELECT auth.uid())
    OR is_platform_admin()
    OR is_developer()
    OR has_property_permission(property_id, 'write')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Tenant read path on property data (finding 57) — additive SELECT policies
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rent_payments_tenant_select ON public.rent_payments;
CREATE POLICY rent_payments_tenant_select ON public.rent_payments
  FOR SELECT USING (public.is_tenant_of_property(property_id));

-- NB: tenancy_details has no deleted_at column in production (rows are
-- hard-deleted), so no soft-delete clause here.
DROP POLICY IF EXISTS tenancy_details_tenant_select ON public.tenancy_details;
CREATE POLICY tenancy_details_tenant_select ON public.tenancy_details
  FOR SELECT USING (public.is_tenant_of_property(property_id));

DROP POLICY IF EXISTS property_documents_tenant_select ON public.property_documents;
CREATE POLICY property_documents_tenant_select ON public.property_documents
  FOR SELECT USING (
    shared_with_tenant = true
    AND deleted_at IS NULL
    AND public.is_tenant_of_property(property_id)
  );

-- Maintenance: tenants see tenant-reported jobs at their property (landlords'
-- internal jobs — contractor costs etc. — stay hidden), can raise new ones,
-- and can update their own (photo attachment after insert).
DROP POLICY IF EXISTS maintenance_jobs_tenant_select ON public.maintenance_jobs;
CREATE POLICY maintenance_jobs_tenant_select ON public.maintenance_jobs
  FOR SELECT USING (
    reported_by_tenant = true AND public.is_tenant_of_property(property_id)
  );

DROP POLICY IF EXISTS maintenance_jobs_tenant_insert ON public.maintenance_jobs;
CREATE POLICY maintenance_jobs_tenant_insert ON public.maintenance_jobs
  FOR INSERT WITH CHECK (
    reported_by_tenant = true
    AND user_id = (SELECT auth.uid())
    AND public.is_tenant_of_property(property_id)
  );

DROP POLICY IF EXISTS maintenance_jobs_tenant_update ON public.maintenance_jobs;
CREATE POLICY maintenance_jobs_tenant_update ON public.maintenance_jobs
  FOR UPDATE
  USING (
    reported_by_tenant = true AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    reported_by_tenant = true
    AND user_id = (SELECT auth.uid())
    AND public.is_tenant_of_property(property_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. tenant_messages — split the FOR ALL policy (its NULL WITH CHECK let any
--    user insert messages against any property; finding 58 impact (b))
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_messages_tenant ON public.tenant_messages;
DROP POLICY IF EXISTS tenant_messages_select ON public.tenant_messages;
DROP POLICY IF EXISTS tenant_messages_insert ON public.tenant_messages;
DROP POLICY IF EXISTS tenant_messages_update ON public.tenant_messages;
DROP POLICY IF EXISTS tenant_messages_delete ON public.tenant_messages;

CREATE POLICY tenant_messages_select ON public.tenant_messages
  FOR SELECT USING (
    is_platform_admin()
    OR is_developer()
    OR public.is_tenant_of_property(property_id)
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY tenant_messages_insert ON public.tenant_messages
  FOR INSERT WITH CHECK (
    (
      sender_type = 'tenant'
      AND tenant_user_id = (SELECT auth.uid())
      AND public.is_tenant_of_property(property_id)
    )
    OR (
      sender_type = 'landlord'
      AND (
        has_property_access(property_id)
        OR EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = tenant_messages.property_id
            AND p.user_id = (SELECT auth.uid())
        )
      )
    )
  );

-- read_at flips: tenant marks landlord messages read, landlord marks tenant
-- messages read.
CREATE POLICY tenant_messages_update ON public.tenant_messages
  FOR UPDATE
  USING (
    is_platform_admin()
    OR is_developer()
    OR public.is_tenant_of_property(property_id)
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR is_developer()
    OR public.is_tenant_of_property(property_id)
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY tenant_messages_delete ON public.tenant_messages
  FOR DELETE USING (
    is_platform_admin()
    OR is_developer()
    OR has_property_access(property_id)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = tenant_messages.property_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- Messages are immutable once sent: the UPDATE policy exists so both sides can
-- mark messages read, and this guard limits UPDATE to exactly that (read_at).
-- Service role (auth.uid() IS NULL) and platform operators bypass.
CREATE OR REPLACE FUNCTION public.tenant_messages_readonly_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() OR is_developer() THEN
    RETURN NEW;
  END IF;
  IF NEW.message        IS DISTINCT FROM OLD.message
     OR NEW.sender_type    IS DISTINCT FROM OLD.sender_type
     OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
     OR NEW.property_id    IS DISTINCT FROM OLD.property_id
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'tenant messages cannot be edited after sending'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_messages_readonly ON public.tenant_messages;
CREATE TRIGGER trg_tenant_messages_readonly
  BEFORE UPDATE ON public.tenant_messages
  FOR EACH ROW EXECUTE FUNCTION public.tenant_messages_readonly_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Storage — tenants can download documents explicitly shared with them
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenants read shared property documents" ON storage.objects;
CREATE POLICY "Tenants read shared property documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'property-documents'
    AND EXISTS (
      SELECT 1
      FROM public.property_documents d
      JOIN public.tenant_profiles tp ON tp.property_id = d.property_id
      WHERE d.file_path = storage.objects.name
        AND d.shared_with_tenant = true
        AND d.deleted_at IS NULL
        AND tp.user_id = (SELECT auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. get_tenant_portal_context — curated portal payload (no row-level grant on
--    properties / companies / company_settings for tenants)
-- ─────────────────────────────────────────────────────────────────────────────
-- Column picks happen on to_jsonb(...) output, so a key that doesn't exist in
-- an environment degrades to NULL instead of erroring.
CREATE OR REPLACE FUNCTION public.get_tenant_portal_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tp  jsonb;
  v_p   jsonb;
  v_c   jsonb;
  v_cs  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(tp), to_jsonb(p), to_jsonb(c)
    INTO v_tp, v_p, v_c
  FROM public.tenant_profiles tp
  JOIN public.properties p ON p.id = tp.property_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE tp.user_id = v_uid
  LIMIT 1;

  IF v_tp IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(cs) INTO v_cs
  FROM public.company_settings cs
  WHERE cs.company_id = (v_p ->> 'company_id')::uuid;
  v_cs := COALESCE(v_cs, '{}'::jsonb);

  RETURN jsonb_build_object(
    'user_id',     v_tp -> 'user_id',
    'property_id', v_tp -> 'property_id',
    'property', jsonb_build_object(
      'id',                    v_p -> 'id',
      'name',                  v_p -> 'name',
      'address',               v_p -> 'address',
      'rent_pcm',              v_p -> 'rent_pcm',
      'company_id',            v_p -> 'company_id',
      'contact_mode_override', v_p -> 'contact_mode_override',
      'company', CASE WHEN v_c IS NULL THEN NULL ELSE jsonb_build_object(
        'id',           v_c -> 'id',
        'name',         v_c -> 'name',
        'abbr',         v_c -> 'abbr',
        'color',        v_c -> 'color',
        'contact_mode', v_c -> 'contact_mode',
        'agent_name',   v_c -> 'agent_name',
        'agent_phone',  v_c -> 'agent_phone',
        'agent_email',  v_c -> 'agent_email'
      ) END
    ),
    'bank_details', jsonb_build_object(
      'bank_name',             v_cs -> 'bank_name',
      'bank_sort_code',        v_cs -> 'bank_sort_code',
      'bank_account_no',       v_cs -> 'bank_account_no',
      'bank_reference_prefix', v_cs -> 'bank_reference_prefix',
      'logo_url',              v_cs -> 'logo_url'
    ),
    'features', jsonb_build_object(
      'feature_tenant_messaging', v_cs -> 'feature_tenant_messaging',
      'feature_tenant_repairs',   v_cs -> 'feature_tenant_repairs',
      'feature_tenant_documents', v_cs -> 'feature_tenant_documents'
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_tenant_portal_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tenant_portal_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_portal_context() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION (run as each persona; do not run blind in production hours)
--
-- -- As a user who is NOT invited:
-- -- INSERT INTO tenant_profiles (user_id, property_id) VALUES (auth.uid(), '<any-prop>');
-- --   -> blocked by RLS (finding 58 closed)
-- -- SELECT redeem_tenant_invite('garbage-token');
-- --   -> ERROR 'This invite link is invalid...'
--
-- -- As a landlord:
-- -- INSERT INTO tenant_invites (property_id) VALUES ('<own-prop>') RETURNING token;
-- --   -> row with 48-char token
--
-- -- As the invited tenant (signed in):
-- -- SELECT redeem_tenant_invite('<token>');         -> tenant_profiles row json
-- -- SELECT redeem_tenant_invite('<token>');         -> same row (idempotent)
-- -- (as a DIFFERENT user) SELECT redeem_tenant_invite('<token>'); -> ERROR (burned)
-- -- SELECT get_tenant_portal_context();             -> curated json, no
-- --                                                    statement_email_token /
-- --                                                    mortgage fields
-- -- SELECT * FROM rent_payments WHERE property_id='<prop>';        -> rows
-- -- SELECT * FROM tenancy_details WHERE property_id='<prop>';      -> row
-- -- SELECT * FROM property_documents WHERE property_id='<prop>';   -> only
-- --                                                    shared_with_tenant rows
-- -- SELECT * FROM properties WHERE id='<prop>';     -> 0 rows (by design)
--
-- -- Lint: SELECT tablename, policyname, cmd FROM pg_policies
-- --       WHERE tablename IN ('tenant_profiles','tenant_messages','tenant_invites');
-- ===========================================================================
