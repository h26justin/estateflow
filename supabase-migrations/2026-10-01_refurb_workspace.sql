-- ============================================================================
-- Refurb workspace, phase 1 (refurb project management brief, 1 Oct 2026):
-- residential / commercial projects, customisable journey (stages,
-- substages, dependencies), tasks and milestones, notes, an append-only
-- history log, saved journey templates and refurb files (cover photo now,
-- site media and plans in phase 2).
--
-- Rulings (Justin, 1 Oct 2026):
--   • Residential / Commercial is per PROJECT. Every existing project is
--     Residential. Planned and in-progress projects get the residential
--     journey with nothing ticked; complete projects get no journey.
--   • refurb_projects.stage stays the OVERALL status. It still drives the
--     properties.refurb_cost / refurb_status mirror, untouched here. The
--     "current stage" comes from refurb_stages.
--   • target_end_date is the CURRENT FORECAST completion (every existing
--     reader keeps its meaning); original_end_date is the baseline and is
--     backfilled from it. completed_date stays the actual.
--   • Forecast final cost = max(agreed + approved variations, invoiced +
--     committed), with a PM override + reason. The override lives here; the
--     maths is in src/lib/refurbWorkspace.js.
--
-- Additive and backwards compatible: new nullable / defaulted columns on
-- refurb_projects and seven new tables. No existing row changes except
-- project_type (defaulted) and original_end_date (backfilled).
--
-- Files: rows in refurb_files point at objects in the private
-- property-documents bucket under <uid>/refurbs/<project>/…, which the
-- existing own-folder policy already allows on upload. One ADDITIVE storage
-- SELECT policy lets anyone who can see the refurb_files row read the
-- object (refurb_files RLS = property access), so a teammate can open a
-- photo another member uploaded. The existing storage policies are not
-- touched.
-- ============================================================================

-- ── Project columns ──────────────────────────────────────────────────────
alter table public.refurb_projects
  add column if not exists project_type            text not null default 'residential',
  add column if not exists project_manager_name    text,
  add column if not exists project_manager_user_id uuid references auth.users(id) on delete set null,
  add column if not exists original_end_date       date,
  add column if not exists next_action             text,
  add column if not exists next_action_due         date,
  add column if not exists forecast_cost_override  numeric,
  add column if not exists forecast_cost_reason    text,
  add column if not exists custom_statuses         jsonb not null default '[]'::jsonb,
  add column if not exists template_name           text,
  add column if not exists deal_id                 uuid references public.deals(id) on delete set null,
  add column if not exists archived_at             timestamptz;

do $$ begin
  alter table public.refurb_projects add constraint refurb_projects_type_chk
    check (project_type in ('residential', 'commercial'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.refurb_projects add constraint refurb_projects_override_chk
    check (forecast_cost_override is null or forecast_cost_override >= 0);
exception when duplicate_object then null; end $$;

-- ── Files (cover photo now; site media + plans in phase 2) ───────────────
create table if not exists public.refurb_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.refurb_projects(id) on delete cascade,
  kind         text not null default 'media' check (kind in ('cover', 'media', 'plan', 'document', 'evidence')),
  file_path    text not null,
  name         text,
  mime         text,
  size         bigint,
  title        text,
  description  text,
  stage_id     uuid,
  area         text,
  phase_tag    text check (phase_tag is null or phase_tag in ('before', 'during', 'after')),
  captured_at  date,
  width        integer,
  height       integer,
  crop         jsonb,
  uploaded_by  text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid
);

alter table public.refurb_projects
  add column if not exists cover_file_id uuid references public.refurb_files(id) on delete set null;

-- ── Journey stages (top level + substages via parent_id) ─────────────────
-- status is a fixed CATEGORY so progress maths never depends on wording;
-- status_label carries a custom name ("Waiting on BC", …) chosen from the
-- project's custom_statuses list.
create table if not exists public.refurb_stages (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.refurb_projects(id) on delete cascade,
  parent_id           uuid references public.refurb_stages(id) on delete cascade,
  stage_key           text,
  name                text not null check (char_length(trim(name)) > 0),
  sort_order          integer not null default 0,
  status              text not null default 'not_started'
                      check (status in ('not_started', 'in_progress', 'blocked', 'on_hold', 'complete', 'skipped')),
  status_label        text,
  weight              numeric not null default 1 check (weight >= 0),
  progress_pct        integer check (progress_pct is null or (progress_pct between 0 and 100)),
  scope               text,
  planned_start       date,
  planned_end         date,
  forecast_start      date,
  forecast_end        date,
  actual_start        date,
  actual_end          date,
  responsible_name    text,
  responsible_user_id uuid references auth.users(id) on delete set null,
  contractor_name     text,
  contractor_id       uuid references public.contractors(id) on delete set null,
  next_action         text,
  blockers            text,
  decisions           text,
  notes               text,
  signed_off_by       text,
  signed_off_at       timestamptz,
  archived_at         timestamptz,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  deleted_by          uuid,
  constraint refurb_stages_planned_order check (planned_start is null or planned_end is null or planned_end >= planned_start),
  constraint refurb_stages_forecast_order check (forecast_start is null or forecast_end is null or forecast_end >= forecast_start),
  constraint refurb_stages_actual_order check (actual_start is null or actual_end is null or actual_end >= actual_start)
);

do $$ begin
  alter table public.refurb_files add constraint refurb_files_stage_fk
    foreign key (stage_id) references public.refurb_stages(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Finish-to-start: stage_id cannot start until depends_on_id has finished
-- (+ lag_days).
create table if not exists public.refurb_stage_dependencies (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.refurb_projects(id) on delete cascade,
  stage_id      uuid not null references public.refurb_stages(id) on delete cascade,
  depends_on_id uuid not null references public.refurb_stages(id) on delete cascade,
  lag_days      integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (stage_id, depends_on_id),
  check (stage_id <> depends_on_id)
);

-- ── Tasks, milestones and checklist items ────────────────────────────────
create table if not exists public.refurb_tasks (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.refurb_projects(id) on delete cascade,
  stage_id        uuid references public.refurb_stages(id) on delete set null,
  kind            text not null default 'task' check (kind in ('task', 'milestone', 'checklist')),
  title           text not null check (char_length(trim(title)) > 0),
  description     text,
  owner_name      text,
  owner_user_id   uuid references auth.users(id) on delete set null,
  contractor_name text,
  priority        text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date        date,
  status          text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  completed_at    timestamptz,
  completed_by    text,
  sort_order      integer not null default 0,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid
);

-- ── Notes, updates and sign-offs (stage or project level) ────────────────
create table if not exists public.refurb_updates (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.refurb_projects(id) on delete cascade,
  stage_id     uuid references public.refurb_stages(id) on delete set null,
  kind         text not null default 'note' check (kind in ('note', 'site_visit', 'meeting', 'contractor', 'sign_off')),
  update_date  date not null default current_date,
  body         text not null check (char_length(trim(body)) > 0),
  next_action  text,
  author_name  text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid
);

-- ── History (append only: no update or delete for anyone) ────────────────
create table if not exists public.refurb_events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.refurb_projects(id) on delete cascade,
  stage_id    uuid references public.refurb_stages(id) on delete set null,
  entity      text not null,
  entity_id   uuid,
  action      text not null,
  field       text,
  old_value   text,
  new_value   text,
  reason      text,
  actor_name  text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- ── Saved journey templates (per company) ────────────────────────────────
-- The built-in Residential / Commercial templates live in code
-- (src/lib/refurbWorkspace.js); these are the user's own.
create table if not exists public.refurb_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (char_length(trim(name)) > 0),
  project_type text not null default 'residential' check (project_type in ('residential', 'commercial')),
  stages       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ── Indexes + updated_at triggers ────────────────────────────────────────
create index if not exists idx_refurb_files_project   on public.refurb_files(project_id) where deleted_at is null;
create index if not exists idx_refurb_files_path      on public.refurb_files(file_path);
create index if not exists idx_refurb_files_stage     on public.refurb_files(stage_id) where stage_id is not null;
create index if not exists idx_refurb_stages_project  on public.refurb_stages(project_id) where deleted_at is null;
create index if not exists idx_refurb_stages_parent   on public.refurb_stages(parent_id) where parent_id is not null;
create index if not exists idx_refurb_deps_project    on public.refurb_stage_dependencies(project_id);
create index if not exists idx_refurb_deps_depends    on public.refurb_stage_dependencies(depends_on_id);
create index if not exists idx_refurb_tasks_project   on public.refurb_tasks(project_id) where deleted_at is null;
create index if not exists idx_refurb_tasks_stage     on public.refurb_tasks(stage_id) where stage_id is not null;
create index if not exists idx_refurb_updates_project on public.refurb_updates(project_id) where deleted_at is null;
create index if not exists idx_refurb_events_project  on public.refurb_events(project_id, created_at desc);
create index if not exists idx_refurb_templates_co    on public.refurb_templates(company_id) where deleted_at is null;
create index if not exists idx_refurb_projects_deal   on public.refurb_projects(deal_id) where deal_id is not null;

do $$
declare t text;
begin
  foreach t in array array['refurb_files', 'refurb_stages', 'refurb_tasks', 'refurb_updates', 'refurb_templates'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.update_updated_at()', t, t);
  end loop;
end $$;

-- ── Row-level security ───────────────────────────────────────────────────
-- Child tables follow refurb_milestones: read = can see the property,
-- write = property 'write' permission on a live company, delete =
-- property 'delete' permission. Soft delete (deleted_at) is the normal
-- route; the DELETE policy exists so a hard delete is never a silent no-op.
do $$
declare t text;
begin
  foreach t in array array['refurb_files', 'refurb_stages', 'refurb_stage_dependencies', 'refurb_tasks', 'refurb_updates'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select using (exists (
        select 1 from public.refurb_projects rp
         where rp.id = %I.project_id
           and (public.is_developer() or rp.user_id = auth.uid() or public.has_property_access(rp.property_id))))$p$,
      t || '_select', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert with check (exists (
        select 1 from public.refurb_projects rp join public.properties p on p.id = rp.property_id
         where rp.id = %I.project_id
           and public.has_property_permission(rp.property_id, 'write') and public.company_is_live(p.company_id)))$p$,
      t || '_insert', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update
        using (exists (select 1 from public.refurb_projects rp
                        where rp.id = %I.project_id and public.has_property_permission(rp.property_id, 'write')))
        with check (exists (select 1 from public.refurb_projects rp join public.properties p on p.id = rp.property_id
                        where rp.id = %I.project_id
                          and public.has_property_permission(rp.property_id, 'write') and public.company_is_live(p.company_id)))$p$,
      t || '_update', t, t, t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for delete using (exists (
        select 1 from public.refurb_projects rp
         where rp.id = %I.project_id and public.has_property_permission(rp.property_id, 'delete')))$p$,
      t || '_delete', t, t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;

-- History: read like the project, insert with write permission, never
-- updated or deleted (no policy + no grant).
alter table public.refurb_events enable row level security;
drop policy if exists refurb_events_select on public.refurb_events;
create policy refurb_events_select on public.refurb_events for select using (exists (
  select 1 from public.refurb_projects rp
   where rp.id = refurb_events.project_id
     and (public.is_developer() or rp.user_id = auth.uid() or public.has_property_access(rp.property_id))));
drop policy if exists refurb_events_insert on public.refurb_events;
create policy refurb_events_insert on public.refurb_events for insert with check (
  created_by = auth.uid() and exists (
  select 1 from public.refurb_projects rp
   where rp.id = refurb_events.project_id and public.has_property_permission(rp.property_id, 'write')));
revoke all on public.refurb_events from anon;
grant select, insert on public.refurb_events to authenticated;
revoke update, delete, truncate, references, trigger on public.refurb_events from authenticated;

-- Templates: company members read, company writers write; a template with
-- no company belongs to its creator alone.
alter table public.refurb_templates enable row level security;
drop policy if exists refurb_templates_select on public.refurb_templates;
create policy refurb_templates_select on public.refurb_templates for select using (
  user_id = auth.uid() or (company_id is not null and public.user_has_company_access(company_id)));
drop policy if exists refurb_templates_insert on public.refurb_templates;
create policy refurb_templates_insert on public.refurb_templates for insert with check (
  user_id = auth.uid() and (company_id is null or public.has_company_write(company_id)));
drop policy if exists refurb_templates_update on public.refurb_templates;
create policy refurb_templates_update on public.refurb_templates for update
  using (user_id = auth.uid() or (company_id is not null and public.has_company_write(company_id)))
  with check (user_id = auth.uid() or (company_id is not null and public.has_company_write(company_id)));
revoke all on public.refurb_templates from anon;
grant select, insert, update on public.refurb_templates to authenticated;
revoke delete, truncate, references, trigger on public.refurb_templates from authenticated;

-- ── Storage: read a refurb file you can see the row for (additive) ───────
drop policy if exists "Refurb files readable with project access" on storage.objects;
create policy "Refurb files readable with project access" on storage.objects for select
  using (
    bucket_id = 'property-documents'
    and auth.uid() is not null
    and exists (select 1 from public.refurb_files f where f.file_path = objects.name and f.deleted_at is null)
  );

-- ── Backfill ─────────────────────────────────────────────────────────────
-- Baseline completion = the target date as it stands today.
update public.refurb_projects
   set original_end_date = target_end_date
 where original_end_date is null and target_end_date is not null;

-- Residential journey (nothing ticked) on every live planned / in-progress /
-- snagging / on-hold project that has no stages yet. Complete projects are
-- left without a journey (ruling 2).
with tpl(stage_key, name, sort_order) as (
  values
    ('scope_survey',  'Scope & Survey',          1),
    ('design_plans',  'Design & Plans',          2),
    ('approvals',     'Approvals',               3),
    ('strip_out',     'Strip Out',               4),
    ('structural',    'Structural Works',        5),
    ('first_fix',     'First Fix',               6),
    ('plastering',    'Plastering',              7),
    ('second_fix',    'Second Fix',              8),
    ('kitchen_bath',  'Kitchen & Bathroom',      9),
    ('floor_decor',   'Flooring & Decoration',  10),
    ('snagging',      'Snagging',               11),
    ('handover',      'Handover',               12)
)
insert into public.refurb_stages (project_id, stage_key, name, sort_order, created_by)
select rp.id, tpl.stage_key, tpl.name, tpl.sort_order, rp.user_id
  from public.refurb_projects rp
  cross join tpl
 where rp.deleted_at is null
   and rp.stage <> 'complete'
   and not exists (select 1 from public.refurb_stages s where s.project_id = rp.id);

update public.refurb_projects rp
   set template_name = 'Residential'
 where rp.template_name is null
   and exists (select 1 from public.refurb_stages s where s.project_id = rp.id);

-- Verify (read only):
-- select project_type, stage, count(*), count(*) filter (where template_name is not null) as with_journey
--   from refurb_projects where deleted_at is null group by 1, 2 order by 1, 2;
-- select count(*) from refurb_stages;   -- expect 12 x (planned + in_progress + snagging + on_hold)
-- select tablename, policyname, cmd from pg_policies where tablename like 'refurb_%' order by 1, 3;
