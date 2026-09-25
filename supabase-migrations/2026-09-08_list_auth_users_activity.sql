-- Admin > Users: add "Last active" alongside "Signed up".
--
-- last_active_at = the later of the user's last real sign-in and the most
-- recent refresh of any of their sessions. Supabase keeps a session alive for
-- weeks by silently refreshing it, so auth.users.last_sign_in_at on its own
-- lags real usage badly (checked live 2026-09-08: one user last signed in on
-- 2 Sep but their session was refreshed the same evening this shipped).
--
-- The return type changes, and CREATE OR REPLACE cannot change RETURNS TABLE,
-- so DROP + CREATE. Grants re-applied to match 2026-05-24 hardening v2
-- (revoke from PUBLIC/anon, grant to authenticated; is_developer() guards the
-- body). search_path pinned as per 2026-05-20 hardening.
--
-- auth.sessions.refreshed_at is timestamp WITHOUT time zone (stored UTC), so
-- it is re-tagged as UTC before GREATEST(). GREATEST ignores NULLs.

DROP FUNCTION IF EXISTS public.list_auth_users();

CREATE FUNCTION public.list_auth_users()
 RETURNS TABLE(
   id uuid,
   email text,
   created_at timestamptz,
   last_sign_in_at timestamptz,
   last_active_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $func$
BEGIN
  IF NOT is_developer() THEN
    RAISE EXCEPTION 'Permission denied: developers only';
  END IF;
  RETURN QUERY
    SELECT au.id,
           au.email::text,
           au.created_at,
           au.last_sign_in_at,
           GREATEST(au.last_sign_in_at, s.last_refreshed) AS last_active_at
    FROM auth.users au
    LEFT JOIN LATERAL (
      SELECT MAX(se.refreshed_at AT TIME ZONE 'utc') AS last_refreshed
      FROM auth.sessions se
      WHERE se.user_id = au.id
    ) s ON true
    ORDER BY au.created_at DESC;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.list_auth_users() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_auth_users() TO authenticated;
