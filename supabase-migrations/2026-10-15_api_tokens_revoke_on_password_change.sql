-- ----------------------------------------------------------------------------
-- Revoke personal API tokens on password change or ban (security, 15 Oct 2026)
--
-- api_access_tokens (opat_ tokens, read by the api-access edge function) live
-- up to a year and are independent of the GoTrue session, so they survived a
-- password reset and "sign out everywhere": an attacker who minted one from a
-- stolen session kept read access after the owner recovered the account.
--
-- Fix: an AFTER UPDATE trigger on auth.users that sets revoked_at on every
-- live token of the user when encrypted_password changes (password change or
-- reset) or when the user is banned (banned_until moves into the future).
-- Revoking (not deleting) matches the app's own revoke path and keeps the
-- rows for the Settings → API Access history.
--
-- Live facts checked 15 Oct 2026: public.api_access_tokens has
-- (id, user_id uuid, ..., revoked_at timestamptz null); no triggers existed on
-- auth.users; 0 live tokens, so nothing is revoked by applying this.
--
-- SECURITY DEFINER because the trigger fires as the auth admin role, which
-- has no rights on public tables; search_path is pinned empty and every name
-- is schema-qualified. EXECUTE is revoked from client roles (trigger
-- functions can't be called through PostgREST anyway; this keeps the
-- advisors quiet).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_api_tokens_on_credential_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
     OR (NEW.banned_until IS NOT NULL
         AND NEW.banned_until > now()
         AND NEW.banned_until IS DISTINCT FROM OLD.banned_until) THEN
    UPDATE public.api_access_tokens
       SET revoked_at = now()
     WHERE user_id = NEW.id
       AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_api_tokens_on_credential_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_api_tokens_on_credential_change() FROM anon, authenticated;

DROP TRIGGER IF EXISTS revoke_api_tokens_on_credential_change ON auth.users;
CREATE TRIGGER revoke_api_tokens_on_credential_change
  AFTER UPDATE OF encrypted_password, banned_until ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.revoke_api_tokens_on_credential_change();

-- Verify after applying (read-only):
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
--   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'revoke_api_tokens_on_credential_change';
