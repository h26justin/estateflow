-- ===========================================================================
-- Security hardening 06 — function grants, defence-in-depth & advisor hygiene
-- ===========================================================================
-- Bundles the lower-severity / housekeeping findings:
--   * REVOKE EXECUTE on SECURITY DEFINER functions not needed by the app
--   * redeem_company_invite: add pg_temp to search_path + soft-delete guard
--   * audit_trigger_fn: surface (RAISE WARNING) instead of silently swallowing
--   * admin_announcements: codify RLS in a migration (matches live)
--   * marketing_leads / trial_email_log: document the intentional deny-all
--   * pg_net extension-in-public: documented accepted risk
--
-- Idempotent. ROLLBACK notes inline per section.
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SECURITY DEFINER EXECUTE grants
-- ─────────────────────────────────────────────────────────────────────────────
-- Only revoke functions that are (a) not referenced by any RLS policy and
-- (b) not called by the app via /rest/v1/rpc. Functions used inside RLS
-- policies MUST keep authenticated EXECUTE or every query that triggers the
-- policy fails — so has_company_access / has_property_access / is_developer /
-- is_platform_admin / user_has_company_access / user_is_company_admin are left
-- intact. App-RPC functions (create_company_for_owner, find_companies_by_name_fuzzy,
-- list_auth_users (internally guarded by is_developer), redeem_company_invite,
-- prune_old_backups) are also left intact. See notes for the full table.
--
-- company_has_billing_access and user_is_admin are referenced by neither
-- policies nor app code -> safe to revoke from the API roles.
REVOKE EXECUTE ON FUNCTION public.company_has_billing_access(uuid) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.user_is_admin() FROM authenticated, anon;
-- ROLLBACK: GRANT EXECUTE ON FUNCTION public.company_has_billing_access(uuid) TO authenticated;
--           GRANT EXECUTE ON FUNCTION public.user_is_admin() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. redeem_company_invite — harden search_path + reject soft-deleted companies
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_company_invite(p_code text)
RETURNS TABLE(
  company_id uuid,
  is_admin   bool,
  company_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite   company_invites%ROWTYPE;
  v_user_id  uuid;
  v_email    text;
  v_co_name  text;
  v_deleted  timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  SELECT * INTO v_invite
  FROM company_invites
  WHERE upper(code) = upper(p_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked';
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  IF v_invite.max_uses IS NOT NULL AND v_invite.used_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'invite_exhausted';
  END IF;

  -- Don't join people to a soft-deleted (tombstoned) company pending purge.
  SELECT deleted_at INTO v_deleted FROM companies WHERE id = v_invite.company_id;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'company_unavailable';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO user_company_access (user_id, company_id, email, is_admin, is_owner)
  VALUES (v_user_id, v_invite.company_id, v_email, v_invite.is_admin, false)
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET is_admin = EXCLUDED.is_admin OR user_company_access.is_admin,
        email    = COALESCE(user_company_access.email, EXCLUDED.email);

  UPDATE company_invites
  SET used_count = used_count + 1
  WHERE id = v_invite.id;

  SELECT name INTO v_co_name FROM companies WHERE id = v_invite.company_id;

  RETURN QUERY SELECT v_invite.company_id, v_invite.is_admin, v_co_name;
END;
$$;

REVOKE ALL ON FUNCTION redeem_company_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_company_invite(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. audit_trigger_fn — surface logging failures instead of swallowing them
-- ─────────────────────────────────────────────────────────────────────────────
-- Only the EXCEPTION handler changes: RAISE WARNING (visible in postgres logs)
-- instead of NULL, while still NOT aborting the user's operation. The rest of
-- the body is reproduced verbatim from audit-and-soft-delete.sql.
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
  v_user_id := auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_entity_id := (to_jsonb(OLD)->>'id')::UUID;
  ELSE
    v_entity_id := (to_jsonb(NEW)->>'id')::UUID;
  END IF;

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

  IF TG_OP = 'DELETE' THEN
    v_company_id := (to_jsonb(OLD)->>'company_id')::UUID;
  ELSE
    v_company_id := (to_jsonb(NEW)->>'company_id')::UUID;
  END IF;

  IF v_company_id IS NULL AND TG_TABLE_NAME <> 'companies' THEN
    IF TG_OP = 'DELETE' AND (to_jsonb(OLD)->>'property_id') IS NOT NULL THEN
      SELECT company_id INTO v_company_id FROM properties WHERE id = (to_jsonb(OLD)->>'property_id')::UUID;
    ELSIF TG_OP <> 'DELETE' AND (to_jsonb(NEW)->>'property_id') IS NOT NULL THEN
      SELECT company_id INTO v_company_id FROM properties WHERE id = (to_jsonb(NEW)->>'property_id')::UUID;
    END IF;
  END IF;

  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  v_action := CASE
    WHEN TG_OP = 'INSERT' THEN TG_TABLE_NAME || '.created'
    WHEN TG_OP = 'UPDATE' THEN TG_TABLE_NAME || '.updated'
    WHEN TG_OP = 'DELETE' THEN TG_TABLE_NAME || '.deleted'
  END;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD)->>'deleted_at') IS NULL AND (to_jsonb(NEW)->>'deleted_at') IS NOT NULL THEN
      v_action := TG_TABLE_NAME || '.soft_deleted';
    ELSIF (to_jsonb(OLD)->>'deleted_at') IS NOT NULL AND (to_jsonb(NEW)->>'deleted_at') IS NULL THEN
      v_action := TG_TABLE_NAME || '.restored';
    END IF;

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
    -- Surface the failure in the postgres logs but don't abort the user's
    -- operation (the audit trail is best-effort, not transactional).
    RAISE WARNING 'audit_log write failed for %.%: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. admin_announcements — codify RLS in a migration (matches live state)
-- ─────────────────────────────────────────────────────────────────────────────
-- Read by all signed-in users; written only by the platform admin. The
-- href/link_url it serves is rendered in-app, hence write must stay admin-only.
--
-- NOTE: write policies are NOT recreated here. 2026-06-10_perf_rls_consolidate.sql
-- (which sorts BEFORE this file) drops the old announcements_write FOR ALL policy
-- and replaces it with action-specific announcements_insert/update/delete
-- policies to clear the multiple_permissive_policies advisor overlap.
-- Recreating announcements_write here would resurrect the FOR ALL policy on
-- top of the split ones and reintroduce the overlap, so this block only
-- codifies the RLS enablement and the read policy.
DO $aa$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='admin_announcements') THEN
    ALTER TABLE public.admin_announcements ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "announcements_read"  ON public.admin_announcements;
    CREATE POLICY "announcements_read" ON public.admin_announcements
      FOR SELECT TO authenticated USING (true);
  END IF;
END $aa$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Document the intentional deny-all (RLS enabled, no policies) tables
-- ─────────────────────────────────────────────────────────────────────────────
-- These are written only by edge functions (service role) and intentionally
-- have no client policies, so the API roles get deny-all. Documented so future
-- advisor sweeps stop re-flagging rls_enabled_no_policy.
DO $c$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='marketing_leads') THEN
    EXECUTE $q$COMMENT ON TABLE public.marketing_leads IS 'Service-role only: RLS enabled with no client policies by design (deny-all for anon/authenticated). Written by edge functions (lead capture).'$q$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trial_email_log') THEN
    EXECUTE $q$COMMENT ON TABLE public.trial_email_log IS 'Service-role only: RLS enabled with no client policies by design (deny-all for anon/authenticated). Written by the trial-email edge function.'$q$;
  END IF;
END $c$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. pg_net extension-in-public — accepted risk (documented)
-- ─────────────────────────────────────────────────────────────────────────────
-- The advisor flags extension_in_public for pg_net. Its objects actually live
-- in the `net` schema (only the extension registration row reads 'public') and
-- neither anon nor authenticated can reach net.* via PostgREST (only the
-- public/graphql_public schemas are exposed). Moving it can disrupt
-- cron/webhook plumbing, so this is a formally accepted-risk item.
-- To remediate later (low priority), in a window with pg_cron jobs checked:
--   -- ALTER EXTENSION pg_net SET SCHEMA extensions;   -- ROLLBACK: SET SCHEMA public
DO $pg$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    EXECUTE $q$COMMENT ON EXTENSION pg_net IS 'Accepted risk: lives in public schema (Supabase default). Objects are in the net schema and not exposed via PostgREST. Do not move without checking pg_cron/webhook callers.'$q$;
  END IF;
END $pg$;

NOTIFY pgrst, 'reload schema';
