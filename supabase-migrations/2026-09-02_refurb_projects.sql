-- ─────────────────────────────────────────────────────────────────────────
-- Refurbs module (Sprint 1): refurb_projects + refurb_lines + refurb_milestones
-- ─────────────────────────────────────────────────────────────────────────
-- Replaces the per-property "log" (properties.refurb_cost as a single budget,
-- refurb_costs trade lines, refurb_phases) with a first-class refurb project:
--
--   refurb_projects   one row per refurbishment of a property. Carries the
--                     AGREED price with the builder, the stage, dates and the
--                     expected rent / value once done.
--   refurb_lines      the ledger. kind = 'extra' raises the agreed total,
--                     'payment' raises paid-so-far, 'credit' reduces it.
--   refurb_milestones a short checklist per project (same shape as
--                     deal_milestones, seeded from a default list).
--
-- properties.refurb_cost becomes a MIRROR written by trigger: the sum of
-- payments (less credits) across the property's live projects. Ruling from
-- Justin 2 Sep 2026: an unspent agreed price is NOT money invested, so yield
-- on cost / total invested / unrealised gain (which all read refurb_cost)
-- now reflect cash actually paid. properties.refurb_status is mirrored from
-- the project stages so the dashboard "In Refurbishment" card keeps working.
-- Properties with no project keep whatever refurb_cost they already carry.
--
-- Legacy tables refurb_costs / refurb_phases are left in place (Sprint 2
-- drops them once the Xero push has moved to refurb_lines). Their rows are
-- folded into the new tables below.
--
-- Security follows the maintenance_jobs pattern: select on property access,
-- insert/update on the property write permission with a live company,
-- delete on the property delete permission. (The legacy tables had no
-- DELETE policy at all, so deletes silently affected zero rows.)
-- ─────────────────────────────────────────────────────────────────────────

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists public.refurb_projects (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties(id) on delete cascade,
  company_id           uuid references public.companies(id) on delete set null,
  user_id              uuid not null references auth.users(id) on delete cascade,
  title                text,
  stage                text not null default 'planned'
                       check (stage in ('planned','in_progress','snagging','on_hold','complete')),
  agreed_price         numeric not null default 0 check (agreed_price >= 0),
  contractor_name      text,
  start_date           date,
  target_end_date      date,
  completed_date       date,
  funding              text check (funding is null or funding in ('cash','bridge','mortgage')),
  expected_rent_after  numeric,
  expected_value_after numeric,
  treatment            text not null default 'capital' check (treatment in ('capital','revenue')),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  deleted_by           uuid
);

create table if not exists public.refurb_lines (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.refurb_projects(id) on delete cascade,
  kind         text not null check (kind in ('extra','payment','credit')),
  amount       numeric not null check (amount >= 0),
  date         date not null default current_date,
  payee        text,
  description  text,
  document_id  uuid,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid
);

create table if not exists public.refurb_milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.refurb_projects(id) on delete cascade,
  milestone_key  text not null,
  label          text not null,
  sort_order     integer not null default 0,
  is_enabled     boolean not null default true,
  completed      boolean not null default false,
  completed_date date,
  notes          text,
  unique (project_id, milestone_key)
);

create index if not exists idx_refurb_projects_property on public.refurb_projects(property_id) where deleted_at is null;
create index if not exists idx_refurb_projects_user     on public.refurb_projects(user_id);
create index if not exists idx_refurb_projects_company  on public.refurb_projects(company_id);
create index if not exists idx_refurb_lines_project     on public.refurb_lines(project_id) where deleted_at is null;
create index if not exists idx_refurb_milestones_project on public.refurb_milestones(project_id);

drop trigger if exists refurb_projects_updated_at on public.refurb_projects;
create trigger refurb_projects_updated_at before update on public.refurb_projects
  for each row execute function public.update_updated_at();
drop trigger if exists refurb_lines_updated_at on public.refurb_lines;
create trigger refurb_lines_updated_at before update on public.refurb_lines
  for each row execute function public.update_updated_at();

-- ── Mirror: properties.refurb_cost / refurb_status from projects ─────────
-- SECURITY DEFINER so a collaborator who may edit refurbs but not the
-- property row can still keep the mirror in step. Every call is
-- schema-qualified because search_path is pinned (see 2026-08 signup fix).
create or replace function public.refurb_mirror_property(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projects int;
  v_paid     numeric;
  v_status   text;
begin
  select count(*) into v_projects
    from public.refurb_projects rp
   where rp.property_id = p_property_id and rp.deleted_at is null;
  if v_projects = 0 then
    return;  -- no projects: leave the legacy value alone
  end if;

  select coalesce(sum(case l.kind when 'payment' then l.amount when 'credit' then -l.amount else 0 end), 0)
    into v_paid
    from public.refurb_lines l
    join public.refurb_projects rp on rp.id = l.project_id
   where rp.property_id = p_property_id
     and rp.deleted_at is null and l.deleted_at is null;

  select case
           when bool_or(rp.stage in ('in_progress','snagging','on_hold')) then 'in-progress'
           when bool_or(rp.stage = 'planned') then 'planned'
           else 'complete'
         end
    into v_status
    from public.refurb_projects rp
   where rp.property_id = p_property_id and rp.deleted_at is null;

  update public.properties
     set refurb_cost = greatest(v_paid, 0),
         refurb_status = v_status,
         refurb_cost_unpaid = false
   where id = p_property_id;
end;
$$;

revoke all on function public.refurb_mirror_property(uuid) from public;
grant execute on function public.refurb_mirror_property(uuid) to authenticated, service_role;

create or replace function public.refurb_projects_mirror_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public.refurb_mirror_property(old.property_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id) then
    perform public.refurb_mirror_property(new.property_id);
  end if;
  return null;
end;
$$;

create or replace function public.refurb_lines_mirror_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property uuid;
begin
  select rp.property_id into v_property
    from public.refurb_projects rp
   where rp.id = coalesce(new.project_id, old.project_id);
  if v_property is not null then
    perform public.refurb_mirror_property(v_property);
  end if;
  return null;
end;
$$;

drop trigger if exists refurb_projects_mirror on public.refurb_projects;
create trigger refurb_projects_mirror after insert or update or delete on public.refurb_projects
  for each row execute function public.refurb_projects_mirror_trg();
drop trigger if exists refurb_lines_mirror on public.refurb_lines;
create trigger refurb_lines_mirror after insert or update or delete on public.refurb_lines
  for each row execute function public.refurb_lines_mirror_trg();

-- ── Row-level security ───────────────────────────────────────────────────
alter table public.refurb_projects   enable row level security;
alter table public.refurb_lines      enable row level security;
alter table public.refurb_milestones enable row level security;

drop policy if exists refurb_projects_select on public.refurb_projects;
create policy refurb_projects_select on public.refurb_projects for select
  using (public.is_developer() or user_id = auth.uid() or public.has_property_access(property_id));

drop policy if exists refurb_projects_insert on public.refurb_projects;
create policy refurb_projects_insert on public.refurb_projects for insert
  with check (
    public.has_property_permission(property_id, 'write')
    and public.company_is_live((select p.company_id from public.properties p where p.id = refurb_projects.property_id))
  );

drop policy if exists refurb_projects_update on public.refurb_projects;
create policy refurb_projects_update on public.refurb_projects for update
  using (public.has_property_permission(property_id, 'write'))
  with check (
    public.has_property_permission(property_id, 'write')
    and public.company_is_live((select p.company_id from public.properties p where p.id = refurb_projects.property_id))
  );

drop policy if exists refurb_projects_delete on public.refurb_projects;
create policy refurb_projects_delete on public.refurb_projects for delete
  using (public.has_property_permission(property_id, 'delete'));

-- Lines and milestones inherit through their project.
drop policy if exists refurb_lines_select on public.refurb_lines;
create policy refurb_lines_select on public.refurb_lines for select
  using (exists (select 1 from public.refurb_projects rp where rp.id = refurb_lines.project_id
                 and (public.is_developer() or rp.user_id = auth.uid() or public.has_property_access(rp.property_id))));

drop policy if exists refurb_lines_write on public.refurb_lines;
create policy refurb_lines_write on public.refurb_lines for insert
  with check (exists (select 1 from public.refurb_projects rp join public.properties p on p.id = rp.property_id
                      where rp.id = refurb_lines.project_id
                        and public.has_property_permission(rp.property_id, 'write')
                        and public.company_is_live(p.company_id)));

drop policy if exists refurb_lines_update on public.refurb_lines;
create policy refurb_lines_update on public.refurb_lines for update
  using (exists (select 1 from public.refurb_projects rp where rp.id = refurb_lines.project_id
                 and public.has_property_permission(rp.property_id, 'write')))
  with check (exists (select 1 from public.refurb_projects rp join public.properties p on p.id = rp.property_id
                      where rp.id = refurb_lines.project_id
                        and public.has_property_permission(rp.property_id, 'write')
                        and public.company_is_live(p.company_id)));

drop policy if exists refurb_lines_delete on public.refurb_lines;
create policy refurb_lines_delete on public.refurb_lines for delete
  using (exists (select 1 from public.refurb_projects rp where rp.id = refurb_lines.project_id
                 and public.has_property_permission(rp.property_id, 'delete')));

drop policy if exists refurb_milestones_select on public.refurb_milestones;
create policy refurb_milestones_select on public.refurb_milestones for select
  using (exists (select 1 from public.refurb_projects rp where rp.id = refurb_milestones.project_id
                 and (public.is_developer() or rp.user_id = auth.uid() or public.has_property_access(rp.property_id))));

drop policy if exists refurb_milestones_write on public.refurb_milestones;
create policy refurb_milestones_write on public.refurb_milestones for insert
  with check (exists (select 1 from public.refurb_projects rp join public.properties p on p.id = rp.property_id
                      where rp.id = refurb_milestones.project_id
                        and public.has_property_permission(rp.property_id, 'write')
                        and public.company_is_live(p.company_id)));

drop policy if exists refurb_milestones_update on public.refurb_milestones;
create policy refurb_milestones_update on public.refurb_milestones for update
  using (exists (select 1 from public.refurb_projects rp where rp.id = refurb_milestones.project_id
                 and public.has_property_permission(rp.property_id, 'write')))
  with check (exists (select 1 from public.refurb_projects rp where rp.id = refurb_milestones.project_id
                      and public.has_property_permission(rp.property_id, 'write')));

drop policy if exists refurb_milestones_delete on public.refurb_milestones;
create policy refurb_milestones_delete on public.refurb_milestones for delete
  using (exists (select 1 from public.refurb_projects rp where rp.id = refurb_milestones.project_id
                 and public.has_property_permission(rp.property_id, 'delete')));

grant select, insert, update, delete on public.refurb_projects, public.refurb_lines, public.refurb_milestones to authenticated;
grant all on public.refurb_projects, public.refurb_lines, public.refurb_milestones to service_role;

-- ── Backfill from the legacy fields ──────────────────────────────────────
-- One project per property that has a budget, is in refurb status, or has a
-- refurb in progress. Stage comes from refurb_status. Completed projects get
-- one historic payment equal to the budget so paid = agreed and the
-- property's invested figure is unchanged for finished work.
do $$
declare
  r record;
  v_project uuid;
begin
  for r in
    select p.*
      from public.properties p
     where p.deleted_at is null
       and (coalesce(p.refurb_cost, 0) > 0
            or p.status = 'refurb'
            or p.refurb_status = 'in-progress')
       and not exists (select 1 from public.refurb_projects rp where rp.property_id = p.id)
  loop
    insert into public.refurb_projects
      (property_id, company_id, user_id, title, stage, agreed_price, treatment, created_at,
       completed_date)
    values
      (r.id, r.company_id, r.user_id, 'Refurbishment',
       case r.refurb_status when 'in-progress' then 'in_progress'
                            when 'complete'    then 'complete'
                            else 'planned' end,
       coalesce(r.refurb_cost, 0), 'capital', coalesce(r.created_at, now()),
       case when r.refurb_status = 'complete' then coalesce(r.purchase_date, r.created_at::date) end)
    returning id into v_project;

    -- Legacy paid trade lines become payments; unpaid ones were the quote
    -- itself in every case in production, so they are kept as notes only.
    insert into public.refurb_lines (project_id, kind, amount, date, payee, description, created_by, created_at)
    select v_project, 'payment', c.cost, coalesce(c.date, c.created_at::date, current_date), null,
           trim(coalesce(c.trade, 'Refurb') || case when c.notes is not null and c.notes <> '' then ' - ' || c.notes else '' end),
           c.user_id, c.created_at
      from public.refurb_costs c
     where c.property_id = r.id and c.paid = true and coalesce(c.cost, 0) > 0;

    -- Completed legacy refurbs with no itemised payments: one historic line.
    if r.refurb_status = 'complete' and coalesce(r.refurb_cost, 0) > 0
       and not exists (select 1 from public.refurb_lines l where l.project_id = v_project) then
      insert into public.refurb_lines (project_id, kind, amount, date, description, created_by)
      values (v_project, 'payment', r.refurb_cost, coalesce(r.purchase_date, r.created_at::date, current_date),
              'Historic refurb spend (migrated from property budget)', r.user_id);
    end if;

    -- Carry legacy free text (unpaid trade lines, phases) into the notes.
    update public.refurb_projects rp
       set notes = nullif(trim(both E'\n' from concat_ws(E'\n',
             (select string_agg('Quote: ' || trim(c.trade) || ' £' || c.cost || coalesce(' (' || c.notes || ')', ''), E'\n')
                from public.refurb_costs c where c.property_id = r.id and c.paid = false),
             (select string_agg('Phase: ' || ph.name || coalesce(' ' || ph.start_date::text, '') || coalesce(' to ' || ph.end_date::text, '') || case when ph.done then ' (done)' else '' end, E'\n')
                from public.refurb_phases ph where ph.property_id = r.id)
           )), '')
     where rp.id = v_project;

    -- Default milestone checklist; all ticked for completed projects.
    insert into public.refurb_milestones (project_id, milestone_key, label, sort_order, completed, completed_date)
    select v_project, m.key, m.label, m.sort, r.refurb_status = 'complete',
           case when r.refurb_status = 'complete' then coalesce(r.purchase_date, r.created_at::date) end
      from (values
        ('keys_received', 'Keys received',                    1),
        ('strip_out',     'Strip out',                        2),
        ('first_fix',     'First fix (electrics and plumbing)', 3),
        ('second_fix',    'Second fix',                       4),
        ('decoration',    'Decoration and flooring',          5),
        ('certificates',  'Gas and electrical certificates',  6),
        ('snagging',      'Snagging signed off',              7),
        ('ready_to_let',  'Ready to let',                     8)
      ) as m(key, label, sort);

    perform public.refurb_mirror_property(r.id);
  end loop;
end $$;
