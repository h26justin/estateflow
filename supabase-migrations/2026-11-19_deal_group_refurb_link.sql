-- APPLIED 19 Nov 2026 to hqrhqbkqxzllmzhcofrh (Justin approved: "do all 1-6") via MCP apply_migration;
-- verified live: tables/columns present, RLS on, policies as below.
-- Deals step 4: group purchases and the refurb link (DEALS_TRANSFORMATION_PLAN.md items 5 and 7).
-- Additive. A child deal (one unit of a group purchase) points at its parent;
-- the parent carries the cash commitment, so company cashflow counts it once.
-- refurb_project_id links a completed deal to its existing Refurbs project, so
-- the app never creates a duplicate.
alter table public.deals
  add column if not exists parent_deal_id uuid references public.deals(id) on delete set null,
  add column if not exists refurb_project_id uuid references public.refurb_projects(id) on delete set null;
alter table public.deals drop constraint if exists deals_parent_not_self;
alter table public.deals add constraint deals_parent_not_self check (parent_deal_id is null or parent_deal_id <> id);
create index if not exists deals_parent_idx on public.deals (parent_deal_id) where parent_deal_id is not null;
create index if not exists deals_refurb_project_idx on public.deals (refurb_project_id) where refurb_project_id is not null;
-- Rollback:
-- alter table public.deals drop constraint if exists deals_parent_not_self,
--   drop column if exists parent_deal_id, drop column if exists refurb_project_id;
