-- 2026-06-10 perf: index remediation
-- 1) Covering indexes for all 55 foreign keys flagged by advisor lint 0001
--    (unindexed_foreign_keys), cross-checked against live pg_indexes on
--    2026-06-10 to avoid duplicates. Hot-path tables queried as
--    .eq('user_id', ...).order(...) in src/lib/api/_monolith.js fetchAll*
--    get a composite whose leading column still covers the FK.
-- 2) rent_payments (property_id, year, month): created NON-unique. Live data
--    has genuine duplicates (4 groups, up to 8 rows for one property-month)
--    because the per-period rent rework made multiple segments per month
--    legal, so the old unique index from the previous audit closeout cannot
--    be restored. See verification query at the bottom.
-- 3) Drops of indexes that are exact or prefix duplicates of unique
--    constraints (safe regardless of usage stats). The remaining 'unused_index'
--    advisor hits are listed in a comment at the bottom for later review —
--    usage stats are only ~3 weeks old, so nothing else is dropped.
--
-- DASHBOARD ACTION (advisor: auth_db_connections_absolute, no SQL possible):
-- the Auth (GoTrue) server is pinned to an absolute pool of 10 DB connections.
-- In Supabase Dashboard > Authentication > Advanced (GOTRUE_DB_MAX_POOL_SIZE),
-- switch to a percentage-based allocation so Auth scales with instance size.

-- FK covering indexes ---------------------------------------------------------
create index if not exists idx_address_book_user_id on public.address_book (user_id);
create index if not exists idx_admin_announcements_created_by on public.admin_announcements (created_by);
create index if not exists idx_admin_notes_admin_id on public.admin_notes (admin_id);
create index if not exists idx_admin_notes_company_id on public.admin_notes (company_id);
create index if not exists idx_bank_accounts_company_id on public.bank_accounts (company_id);
create index if not exists idx_bank_transactions_matched_rent_payment_id on public.bank_transactions (matched_rent_payment_id);
create index if not exists idx_companies_free_tier_granted_by on public.companies (free_tier_granted_by);
create index if not exists idx_companies_owner_id on public.companies (owner_id);
create index if not exists idx_companies_user_id on public.companies (user_id);
create index if not exists idx_company_settings_user_id on public.company_settings (user_id);
create index if not exists idx_compliance_items_user_expiry on public.compliance_items (user_id, expiry_date);
create index if not exists idx_contractors_company_id on public.contractors (company_id);
create index if not exists idx_contractors_user_id on public.contractors (user_id);
create index if not exists idx_deal_contacts_deal_id on public.deal_contacts (deal_id);
create index if not exists idx_deal_documents_deal_id on public.deal_documents (deal_id);
create index if not exists idx_deal_documents_user_id on public.deal_documents (user_id);
create index if not exists idx_deal_milestones_deal_id on public.deal_milestones (deal_id);
create index if not exists idx_deals_company_id on public.deals (company_id);
create index if not exists idx_deals_user_id on public.deals (user_id);
create index if not exists idx_deposit_protection_property_id on public.deposit_protection (property_id);
create index if not exists idx_deposit_protection_user_id on public.deposit_protection (user_id);
create index if not exists idx_invitations_company_id on public.invitations (company_id);
create index if not exists idx_invitations_invited_by on public.invitations (invited_by);
create index if not exists idx_legal_notices_property_id on public.legal_notices (property_id);
create index if not exists idx_legal_notices_user_id on public.legal_notices (user_id);
create index if not exists idx_lettings_progressions_company_id on public.lettings_progressions (company_id);
create index if not exists idx_maintenance_jobs_user_created on public.maintenance_jobs (user_id, created_at desc);
create index if not exists idx_marketing_leads_converted_user_id on public.marketing_leads (converted_user_id);
create index if not exists idx_portfolio_insights_company_id on public.portfolio_insights (company_id);
create index if not exists idx_properties_deleted_by on public.properties (deleted_by);
create index if not exists idx_property_documents_property_id on public.property_documents (property_id);
create index if not exists idx_property_documents_user_id on public.property_documents (user_id);
create index if not exists idx_property_expenses_user_date on public.property_expenses (user_id, date desc);
create index if not exists idx_property_notes_property_id on public.property_notes (property_id);
create index if not exists idx_property_notes_user_id on public.property_notes (user_id);
create index if not exists idx_referrals_referred_id on public.referrals (referred_id);
create index if not exists idx_referrals_referrer_id on public.referrals (referrer_id);
create index if not exists idx_refurb_costs_property_id on public.refurb_costs (property_id);
create index if not exists idx_refurb_costs_user_id on public.refurb_costs (user_id);
create index if not exists idx_refurb_phases_property_id on public.refurb_phases (property_id);
create index if not exists idx_refurb_phases_user_id on public.refurb_phases (user_id);
create index if not exists idx_rent_history_property_id on public.rent_history (property_id);
create index if not exists idx_rent_history_user_id on public.rent_history (user_id);
-- fetchAllRentPayments orders by period_start (nulls last), then created_at.
-- NB: rent_payments has no payment_date column in production.
create index if not exists idx_rent_payments_user_period_start on public.rent_payments (user_id, period_start desc nulls last, created_at desc);
create index if not exists idx_right_to_rent_property_id on public.right_to_rent (property_id);
create index if not exists idx_right_to_rent_user_id on public.right_to_rent (user_id);
create index if not exists idx_subscriptions_owner_id on public.subscriptions (owner_id);
create index if not exists idx_tenancy_details_user_id on public.tenancy_details (user_id);
create index if not exists idx_tenant_messages_property_id on public.tenant_messages (property_id);
create index if not exists idx_tenant_messages_tenant_user_id on public.tenant_messages (tenant_user_id);
create index if not exists idx_tenant_profiles_invited_by on public.tenant_profiles (invited_by);
create index if not exists idx_tenant_profiles_property_id on public.tenant_profiles (property_id);
create index if not exists idx_xero_connections_company_id on public.xero_connections (company_id);
create index if not exists idx_xero_sync_log_company_id on public.xero_sync_log (company_id);
create index if not exists idx_xero_sync_map_company_id on public.xero_sync_map (company_id);

-- rent_payments (property_id, year, month): non-unique — live duplicates are
-- legitimate per-period segments, so the pre-rework unique index is NOT
-- restored. Supports the year/month fallback read path for rows where
-- period_start is null.
create index if not exists idx_rent_payments_property_year_month on public.rent_payments (property_id, year, month);

-- Drop indexes that duplicate unique constraints (flagged unused and/or
-- structurally redundant; the unique index serves the same scans) ------------
drop index if exists public.marketing_leads_email_idx;        -- duplicate of marketing_leads_email_key (unique, same column)
drop index if exists public.mtd_submissions_user_year_idx;    -- duplicate of mtd_submissions_user_id_tax_year_quarter_number_key (unique, same columns)
drop index if exists public.trial_email_log_user_idx;         -- prefix of trial_email_log_user_id_day_offset_key (unique)
drop index if exists public.bank_accounts_connection_idx;     -- prefix of bank_accounts_connection_provider_account_uniq (unique)

-- Remaining 'unused_index' advisor hits — NOT dropped (stats window is only
-- ~3 weeks; several serve low-traffic features or predicates that may simply
-- not have run yet). Review with pg_stat_user_indexes over a longer window:
--   compliance_items: idx_compliance_items_property_active,
--     idx_compliance_items_expiry_active, idx_compliance_document
--   maintenance_jobs: idx_maintenance_jobs_property_active
--   property_documents: idx_prop_docs_deleted_at, idx_prop_docs_ext_status
--   company_documents: idx_company_documents_deleted_at
--   properties: idx_properties_archived, properties_mortgage_product_end_idx
--   companies: idx_companies_deletion_batch
--   deals: idx_deals_completion
--   insurance_policies: idx_insurance_policies_previous
--   tenant_references: tenant_references_property_id_idx, tenant_references_user_id_created_idx
--   bank_connections: bank_connections_user_idx
--   bank_accounts: bank_accounts_user_idx
--   bank_transactions: bank_transactions_account_posted_idx, bank_transactions_unmatched_idx
--   portfolio_insights: portfolio_insights_user_company_generated_idx
--   property_inspections: property_inspections_property_idx, property_inspections_scheduled_idx
--   subscriptions: subscriptions_tier_idx
--   mtd_submissions: mtd_submissions_deadline_idx
--   xero_sync_log: xero_sync_log_company_idx
--   marketing_leads: marketing_leads_ip_idx, marketing_leads_source_idx

-- Verification (run manually after applying):
-- Confirm no FK without covering index remains:
--   select con.conrelid::regclass, con.conname from pg_constraint con
--   where con.contype = 'f' and con.connamespace = 'public'::regnamespace
--     and not exists (
--       select 1 from pg_index i
--       where i.indrelid = con.conrelid
--         and (i.indkey::int2[])[0:cardinality(con.conkey)-1] @> con.conkey
--         and con.conkey <@ (i.indkey::int2[])[0:cardinality(con.conkey)-1]);
-- Duplicate check that blocked the unique rent_payments index (ran 2026-06-10,
-- returned 4 duplicate groups):
--   select property_id, year, month, count(*) from rent_payments
--   group by 1, 2, 3 having count(*) > 1;
