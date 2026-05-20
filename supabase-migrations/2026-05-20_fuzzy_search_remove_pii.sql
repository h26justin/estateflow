-- find_companies_by_name_fuzzy used to return (id, name, owner_email)
-- and was granted to `authenticated`. Any signed-in user could fish for
-- owner emails by guessing company names via the new-company wizard's
-- similar-name prompt. Drop owner_email from the return so the API
-- can't leak PII even if the UI ever forgot to.
--
-- Function signature changes (returned columns), so DROP + CREATE
-- rather than CREATE OR REPLACE.
--
-- Also added `pg_temp` to search_path to address the audit's separate
-- defence-in-depth note about SECURITY DEFINER functions.
--
-- Applied via Supabase MCP on 2026-05-20.

drop function if exists public.find_companies_by_name_fuzzy(text);

create function public.find_companies_by_name_fuzzy(p_query text)
returns table(id uuid, name text)
language sql
stable security definer
set search_path to 'public', pg_temp
as $function$
  with normalised as (
    select
      regexp_replace(
        regexp_replace(
          lower(trim(p_query)),
          '\b(ltd|limited|llc|inc|llp|plc)\b', '', 'g'
        ),
        '[^a-z0-9]', '', 'g'
      ) as q
  )
  select c.id, c.name
  from companies c, normalised n
  where c.deleted_at is null
    and length(n.q) >= 3
    and regexp_replace(
          regexp_replace(
            lower(trim(c.name)),
            '\b(ltd|limited|llc|inc|llp|plc)\b', '', 'g'
          ),
          '[^a-z0-9]', '', 'g'
        ) = n.q
  limit 5;
$function$;

grant execute on function public.find_companies_by_name_fuzzy(text) to authenticated;
