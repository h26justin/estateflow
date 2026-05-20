-- Audit finding: 13 SECURITY DEFINER functions lacked `SET search_path`.
-- Without it, a user who creates a function in their own schema and
-- manipulates search_path could shadow built-ins used inside these
-- functions. Defence-in-depth — Supabase advisors flag this on every
-- DB lint pass.
--
-- Applied via Supabase MCP on 2026-05-20. Verified: 15/15 SECURITY
-- DEFINER functions in `public` now have proconfig set.

alter function public.audit_trigger_fn()                            set search_path = public, pg_temp;
alter function public.company_has_billing_access(uuid)              set search_path = public, pg_temp;
alter function public.create_company_for_owner(text, text, text)    set search_path = public, pg_temp;
alter function public.has_company_access(uuid)                      set search_path = public, pg_temp;
alter function public.has_property_access(uuid)                     set search_path = public, pg_temp;
alter function public.is_developer()                                set search_path = public, pg_temp;
alter function public.is_platform_admin()                           set search_path = public, pg_temp;
alter function public.list_auth_users()                             set search_path = public, pg_temp;
alter function public.prune_old_backups()                           set search_path = public, pg_temp;
alter function public.purge_soft_deleted_older_than_30_days()       set search_path = public, pg_temp;
alter function public.user_has_company_access(uuid)                 set search_path = public, pg_temp;
alter function public.user_is_admin()                               set search_path = public, pg_temp;
alter function public.user_is_company_admin(uuid)                   set search_path = public, pg_temp;
