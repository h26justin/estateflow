-- Saved views on All Deals (Deals brief, "saved views"). APPLIED 20 Nov 2026
-- to hqrhqbkqxzllmzhcofrh (Justin's go-ahead: "merge all six"), via MCP
-- apply_migration `deal_saved_views`. Verified live: column jsonb not null
-- default '[]'; security advisor shows nothing new.
--
-- One JSONB array per user on user_profiles, the same pattern as
-- dashboard_sections / dashboard_widgets: [{ id, name, filters }]. Existing
-- user_profiles RLS (own row) and the privilege guard trigger already cover
-- it; the app cleans every stored view before use (src/lib/dealViews.js).
-- Additive and reversible.

alter table public.user_profiles
  add column if not exists deal_saved_views jsonb not null default '[]'::jsonb;

alter table public.user_profiles drop constraint if exists user_profiles_deal_saved_views_shape;
alter table public.user_profiles add constraint user_profiles_deal_saved_views_shape check (
  jsonb_typeof(deal_saved_views) = 'array'
  and jsonb_array_length(deal_saved_views) <= 20
  and pg_column_size(deal_saved_views) <= 32768
);

-- Rollback:
-- alter table public.user_profiles drop constraint if exists user_profiles_deal_saved_views_shape;
-- alter table public.user_profiles drop column if exists deal_saved_views;
