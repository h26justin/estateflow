-- Closes the bulk of Supabase Security Advisor warnings.
--
-- Categorisation (38 warnings → 4 batch fixes here, 2 manual / deferred):
--
-- A. Mutable search_path on 3 trigger functions
--    → ALTER FUNCTION ... SET search_path = pg_catalog, public
--
-- B. SECURITY DEFINER functions exposed via PostgREST RPC
--    Different remediation per category:
--      Trigger-only fns (audit_trigger_fn, set_statement_email_token)
--        → REVOKE from all roles. Triggers don't check EXECUTE perms,
--          so they keep firing. Removes the /rest/v1/rpc surface.
--      Cron-only fns (prune_old_backups, purge_soft_deleted_older_than_30_days)
--        → REVOKE from all roles. pg_cron runs as postgres + bypasses RLS.
--      RLS helper fns (is_*, has_*, user_*)
--        → REVOKE from anon ONLY. authenticated keeps EXECUTE because RLS
--          policies invoke these during query evaluation. anon never queries
--          any table that uses these helpers (RLS already blocks anon).
--      Admin fn (list_auth_users)
--        → REVOKE from anon. Internal is_platform_admin() check protects
--          authenticated callers.
--      Client-called fns (create_company_for_owner, find_companies_by_name_fuzzy,
--                          redeem_company_invite)
--        → REVOKE from anon. All three need a signed-in user.
--
-- C. Public bucket "public-assets" has a broad SELECT policy → drop it.
--    Object URLs still work (public bucket route bypasses RLS); only the
--    storage.from('public-assets').list() API is blocked, which we don't use.
--
-- Not in this migration (require manual / out-of-band action):
--   - pg_net in public schema — Supabase places it there by default and
--     moving it can break cron/webhook plumbing. Leave alone.
--   - HaveIBeenPwned leaked-password check — toggle in Supabase Dashboard
--     → Authentication → Settings → Password Strength.
--
-- Applied via Supabase MCP on 2026-05-24.

-- ── A. Lock search_path on trigger functions ──────────────────────────
ALTER FUNCTION public.update_company_documents_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.update_company_invites_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.update_updated_at()
  SET search_path = pg_catalog, public;

-- ── B1. Trigger-only fns: revoke EXECUTE from everyone ───────────────
-- These fire automatically as part of trigger machinery — never need to
-- be callable via RPC. PostgreSQL triggers don't check EXECUTE on the
-- trigger function (only the table owner needs to own it), so removing
-- EXECUTE from PUBLIC / anon / authenticated doesn't break anything.
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_statement_email_token() FROM PUBLIC, anon, authenticated;

-- ── B2. Cron-only fns: revoke EXECUTE from everyone ──────────────────
-- pg_cron runs jobs as the postgres role with full privileges. These
-- two should never be triggered by an end user.
REVOKE EXECUTE ON FUNCTION public.prune_old_backups()                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_soft_deleted_older_than_30_days() FROM PUBLIC, anon, authenticated;

-- ── B3. RLS helper fns: revoke from anon, keep for authenticated ─────
-- These are called from inside RLS policies during query evaluation.
-- Postgres needs the calling role to have EXECUTE for the policy to
-- evaluate. anon never queries any table that uses these helpers
-- (anon's RLS already blocks before the helper is reached), so anon
-- has no legitimate need.
REVOKE EXECUTE ON FUNCTION public.is_developer()                FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin()           FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_is_admin()               FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_is_company_admin(uuid)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_company_access(uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_property_access(uuid)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_company_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.company_has_billing_access(uuid) FROM anon;

-- ── B4. Admin-only function: revoke from anon ────────────────────────
-- Function internally checks is_platform_admin() — but defence in depth:
-- removing the RPC route from the anon-facing API surface is strictly safer.
REVOKE EXECUTE ON FUNCTION public.list_auth_users() FROM anon;

-- ── B5. Client-called fns that require an authenticated user ─────────
REVOKE EXECUTE ON FUNCTION public.create_company_for_owner(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_companies_by_name_fuzzy(text)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_company_invite(text)                FROM anon;

-- ── C. Drop broad SELECT policy on public-assets bucket ──────────────
-- Public buckets serve files via /storage/v1/object/public/<bucket>/<key>
-- which bypasses RLS. So removing this policy preserves direct-URL access
-- (logos, images embedded in pages) and only blocks the LIST API call
-- (storage.from('public-assets').list()) which we don't use.
DROP POLICY IF EXISTS "Public assets are readable by anyone" ON storage.objects;
