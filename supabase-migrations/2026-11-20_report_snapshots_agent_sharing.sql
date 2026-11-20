-- APPLIED 20 Nov 2026 to hqrhqbkqxzllmzhcofrh (Justin approved) via MCP
-- apply_migration `report_snapshots_agent_sharing`; verified live.
--
-- Month-end snapshots of an agent's rent report cover several companies, so
-- company_id is null and the original select policy showed them only to the
-- person who froze them. This lets anyone with access to at least one live
-- property that agent manages see that agent's snapshots, so Tiffany and
-- Justin see the same frozen figures. Read-only: inserts are unchanged.
create policy report_snapshots_select_agent on public.report_snapshots for select to authenticated using (
  agent_id is not null and exists (
    select 1 from public.properties p
    where p.managed_by_agent_id = report_snapshots.agent_id
      and p.deleted_at is null
      and public.has_property_access(p.id)));
-- Rollback: drop policy if exists report_snapshots_select_agent on public.report_snapshots;
