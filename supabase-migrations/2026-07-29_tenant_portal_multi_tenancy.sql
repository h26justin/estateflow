-- ── TENANT PORTAL: MULTI-TENANCY SUPPORT ────────────────────────────────────
-- 2026-07-29 site-audit item: a tenant with two tenancies (e.g. moved flats
-- within the same landlord's portfolio, or rents from two Properly landlords)
-- had no way to see the second property — get_tenant_portal_context() picked
-- an arbitrary tenant_profiles row with LIMIT 1 and the portal had no
-- switcher.
--
-- Changes:
--   1. get_tenant_portal_context gains an optional p_property_id argument.
--      NULL (the default — existing callers pass no args and keep working)
--      returns the earliest-linked tenancy, exactly as before.
--   2. The payload gains a curated `properties` array (id, name, address,
--      company name/colour) listing every tenancy for the caller, so the
--      portal renders its switcher without a second round trip.
--
-- The zero-arg function is DROPPED (not left as an overload): PostgREST
-- cannot disambiguate rpc('get_tenant_portal_context') between a 0-arg
-- function and a 1-arg-with-default function.
--
-- ACL is replicated exactly from production (authenticated + service_role;
-- no anon, no public) — including the explicit REVOKEs, because function
-- default privileges would otherwise grant EXECUTE to public.

DROP FUNCTION IF EXISTS public.get_tenant_portal_context();

CREATE FUNCTION public.get_tenant_portal_context(p_property_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_tp    jsonb;
  v_p     jsonb;
  v_c     jsonb;
  v_cs    jsonb;
  v_props jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Every tenancy this user is linked to — curated fields only (never full
  -- property rows: those carry landlord financials).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',            p.id,
           'name',          p.name,
           'address',       p.address,
           'company_name',  c.name,
           'company_color', c.color
         ) ORDER BY tp.created_at), '[]'::jsonb)
    INTO v_props
  FROM public.tenant_profiles tp
  JOIN public.properties p ON p.id = tp.property_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE tp.user_id = v_uid;

  -- The active tenancy: the requested property when given (and owned by the
  -- caller — the tp.user_id predicate enforces that), else the earliest link.
  SELECT to_jsonb(tp), to_jsonb(p), to_jsonb(c)
    INTO v_tp, v_p, v_c
  FROM public.tenant_profiles tp
  JOIN public.properties p ON p.id = tp.property_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE tp.user_id = v_uid
    AND (p_property_id IS NULL OR tp.property_id = p_property_id)
  ORDER BY tp.created_at
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
    'properties',  v_props,
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
$function$;

REVOKE ALL ON FUNCTION public.get_tenant_portal_context(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_tenant_portal_context(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_portal_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_portal_context(uuid) TO service_role;
