-- ============================================================================
-- 10 Elms West (Vale Property Group): ownership and refurbishment treatment.
--
-- Ruled by Tiffany on 15 September 2026:
--   1 Jan to 26 Apr 2026   not owned, not collectible (all units)
--   27 Apr to 30 Jun 2026  refurbishment, not collectible (all units)
--   after 30 Jun           each unit follows its actual tenancy / vacancy /
--                          refurbishment status, entered by hand
--   Room 2A                vacant, not collectible until its tenancy starts in
--                          October 2026
--
-- Requires 2026-09-15_non_chargeable_not_owned.sql. Matches the units by
-- name (no generated ids), skips anything already recorded, and sets the
-- purchase date where it is blank. Idempotent.
-- ============================================================================

with elms as (
  select p.id, p.user_id, p.name
  from public.properties p
  join public.companies c on c.id = p.company_id
  where p.deleted_at is null
    and c.name ilike 'Vale Property Group%'
    and (p.name ilike '%Elms West%' or p.address ilike '%Elms West%')
),
wanted as (
  select e.id as property_id, e.user_id, d.start_date, d.end_date, d.reason, d.notes
  from elms e
  cross join (values
    (date '2026-01-01', date '2026-04-26', 'not_owned',     'Before completion on 27 April 2026'),
    (date '2026-04-27', date '2026-06-30', 'refurbishment', 'Building refurbishment after completion')
  ) as d(start_date, end_date, reason, notes)
  union all
  select e.id, e.user_id, date '2026-07-01', date '2026-09-30', 'vacant', 'Awaiting tenancy; tenancy starts October 2026'
  from elms e where e.name ilike 'Room 2A%'
)
insert into public.non_chargeable_periods (property_id, user_id, start_date, end_date, reason, notes, approved_by, created_by)
select w.property_id, w.user_id, w.start_date, w.end_date, w.reason, w.notes, w.user_id, w.user_id
from wanted w
where not exists (
  select 1 from public.non_chargeable_periods n
  where n.property_id = w.property_id and n.start_date = w.start_date and n.reason = w.reason
);

update public.properties p
   set purchase_date = date '2026-04-27', updated_at = now()
  from public.companies c
 where c.id = p.company_id and p.deleted_at is null
   and c.name ilike 'Vale Property Group%'
   and (p.name ilike '%Elms West%' or p.address ilike '%Elms West%')
   and p.purchase_date is null;

-- Verification:
-- select p.name, n.start_date, n.end_date, n.reason from non_chargeable_periods n
--   join properties p on p.id = n.property_id where p.name ilike '%Elms West%' order by 1, 2;
