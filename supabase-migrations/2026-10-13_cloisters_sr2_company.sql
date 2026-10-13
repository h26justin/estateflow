-- The Cloisters SR2 Ltd becomes its own company (2026-10-13).
--
-- The nine flats at 6-7 The Cloisters, Sunderland SR2 7BD sat under ExH
-- Property Group. This creates The Cloisters SR2 Ltd as a peer of the other
-- group companies and moves the flats, and every company-stamped record that
-- belongs to them, across. Records keyed only by property (rent periods,
-- compliance items, refurb stages/milestones/files/events, insurance links)
-- follow the property automatically and are not touched.
--
-- Rulings (Justin, 13 Oct 2026): short code CSR2; same team as ExH (copied
-- access rows, incl. Rob Evans and PNE's rent permissions); shareholders as
-- ExH (Justin Hammond 50% / Rob Evans 50%).
--
-- Only company_id changes. No amount, status or date is written. Safe to
-- re-run: the company is matched by name, and every move is ExH -> Cloisters.

begin;

do $$
declare
  v_exh   uuid := 'edec39f7-d274-4d08-a51a-d241f1708481';
  v_owner uuid;
  v_co    uuid;
  v_units int;
begin
  select owner_id into v_owner from public.companies where id = v_exh;

  select id into v_co from public.companies
   where name ilike 'The Cloisters SR2%' and deleted_at is null;

  if v_co is null then
    insert into public.companies
      (name, abbr, color, owner_id, user_id, company_type, ct_passive, contact_mode,
       subdomain, is_free_tier, free_tier_reason, free_tier_granted_by)
    values
      ('The Cloisters SR2 Ltd', 'CSR2', '#4a3f55', v_owner, v_owner, 'operating', true, 'landlord',
       'cloisters', true, 'Platform owner', v_owner)
    returning id into v_co;
  end if;

  -- Team: mirror ExH so everyone who sees the flats today still does.
  insert into public.user_company_access (user_id, company_id, email, is_admin, is_owner, role, permissions)
  select u.user_id, v_co, u.email, u.is_admin, u.is_owner, u.role, u.permissions
    from public.user_company_access u
   where u.company_id = v_exh
  on conflict (user_id, company_id) do nothing;

  -- Settings: ExH's feature toggles, calendar year like the other companies.
  insert into public.company_settings
    (company_id, user_id, feature_compliance, feature_tenancy, feature_maintenance,
     feature_documents, feature_expenses, feature_reports, feature_statements,
     feature_tenant_portal, feature_tenant_messaging, feature_tenant_repairs,
     feature_tenant_documents, year_type, bank_reference_prefix)
  select v_co, s.user_id, s.feature_compliance, s.feature_tenancy, s.feature_maintenance,
         s.feature_documents, s.feature_expenses, s.feature_reports, s.feature_statements,
         s.feature_tenant_portal, s.feature_tenant_messaging, s.feature_tenant_repairs,
         s.feature_tenant_documents, 'calendar_year', s.bank_reference_prefix
    from public.company_settings s
   where s.company_id = v_exh
     and not exists (select 1 from public.company_settings x where x.company_id = v_co);

  -- Shareholders: as ExH.
  insert into public.company_shareholders
    (company_id, name, email, user_id, percentage, tax_band, notes, created_by,
     shareholder_type, shareholder_company_id)
  select v_co, s.name, s.email, s.user_id, s.percentage, s.tax_band, s.notes, s.created_by,
         s.shareholder_type, s.shareholder_company_id
    from public.company_shareholders s
   where s.company_id = v_exh
     and not exists (select 1 from public.company_shareholders x where x.company_id = v_co);

  -- The nine flats.
  create temp table _cloisters_units on commit drop as
    select id from public.properties
     where address ilike 'Flat _, The Cloisters, 6-7 The Cloisters, Sunderland, SR2 7BD'
       and company_id in (v_exh, v_co);

  select count(*) into v_units from _cloisters_units;
  if v_units <> 9 then
    raise exception 'Expected 9 Cloisters units, found %', v_units;
  end if;

  update public.properties set company_id = v_co
   where id in (select id from _cloisters_units) and company_id = v_exh;

  update public.refurb_projects set company_id = v_co
   where property_id in (select id from _cloisters_units) and company_id = v_exh;

  update public.epc_certificates set company_id = v_co
   where property_id in (select id from _cloisters_units) and company_id = v_exh;

  update public.autopilot_actions set company_id = v_co
   where property_id in (select id from _cloisters_units) and company_id = v_exh;

  -- Company-stamped, property-keyed tables with no Cloisters rows today;
  -- moved anyway so a re-run after new data lands stays consistent.
  update public.tenancies              set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.rent_receipts          set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.payment_plans          set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.external_loans         set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.stl_adjustments        set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.hmo_rooms              set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.hmo_licences           set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.epc_assessments        set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.esign_envelopes        set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.letting_enquiries      set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.lettings_progressions  set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.referencing_checks     set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.rent_collection_mandates set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;
  update public.rra_compliance         set company_id = v_co where property_id in (select id from _cloisters_units) and company_id = v_exh;

  -- "The Cloisters - Property Owners" policy covers exactly these nine flats.
  update public.insurance_policies p set company_id = v_co
   where p.company_id = v_exh
     and exists (select 1 from public.insurance_policy_properties l
                  where l.policy_id = p.id and l.property_id in (select id from _cloisters_units))
     and not exists (select 1 from public.insurance_policy_properties l
                      where l.policy_id = p.id and l.property_id not in (select id from _cloisters_units));
end $$;

commit;
