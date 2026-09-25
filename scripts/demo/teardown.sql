-- Remove everything the demo seed created for the demo user. Order matters
-- only where there is no ON DELETE CASCADE; deleting by user_id / company_id
-- covers every table the seed touches. Run before re-running seed.sql.
-- Demo user: fb1e99c8-ef2f-4903-9bbf-588ead787a6d
begin;
delete from public.portfolio_insights     where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.notifications          where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.autopilot_actions      where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.property_expenses      where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.maintenance_jobs       where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.contractors            where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.deal_milestones        where deal_id in (select id from public.deals where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d');
delete from public.deals                  where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.refurb_milestones      where project_id in (select id from public.refurb_projects where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d');
delete from public.refurb_lines           where project_id in (select id from public.refurb_projects where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d');
delete from public.refurb_projects        where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.insurance_policy_properties where policy_id in (select id from public.insurance_policies where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d');
delete from public.insurance_policies     where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.compliance_items       where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.stl_adjustments        where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.stl_bookings           where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.stl_managers           where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.hostaway_property_mappings where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.hostaway_connections   where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.rent_history           where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.rent_payments          where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.hmo_licences           where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.hmo_rooms              where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.right_to_rent          where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.deposit_protection     where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.tenancy_details        where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.tenancies              where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.epc_certificates       where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.properties             where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.rra_compliance         where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.company_settings       where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.subscriptions          where owner_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.user_company_access    where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
delete from public.companies              where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
-- Keep user_profiles and the auth user; drop them too only when retiring the demo account:
-- delete from public.user_profiles where user_id = 'fb1e99c8-ef2f-4903-9bbf-588ead787a6d';
commit;
