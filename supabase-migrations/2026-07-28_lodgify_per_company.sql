-- Lodgify connections become per-company (was one per user).
--
-- Mirrors the Xero model: each OwnProperly company can hold its own
-- Lodgify account (e.g. ExH Property Group's STL block vs a future Vale
-- Property Group account). The existing connection is backfilled to the
-- company of its mapped properties (ExH Property Group — all 12 mapped
-- listings are Piers View rooms in that company), derived rather than
-- hardcoded so the migration carries no environment-specific ids.

alter table public.lodgify_connections
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- Backfill from mapped properties: a connection's company is the company
-- its mapped properties belong to.
update public.lodgify_connections c
set company_id = sub.company_id
from (
  select m.connection_id, (array_agg(distinct p.company_id))[1] as company_id
  from public.lodgify_property_mappings m
  join public.properties p on p.id = m.property_id
  group by m.connection_id
) sub
where sub.connection_id = c.id
  and c.company_id is null;

-- Fails loudly (aborting the whole migration) if any connection could not
-- be attributed — better than silently leaving an orphan.
alter table public.lodgify_connections alter column company_id set not null;

-- One connection per (user, company) instead of one per user.
alter table public.lodgify_connections drop constraint if exists lodgify_connections_user_id_key;
alter table public.lodgify_connections
  add constraint lodgify_connections_user_company_key unique (user_id, company_id);

create index if not exists lodgify_connections_company_idx on public.lodgify_connections (company_id);

-- Verify (run after):
--   SELECT c.id, co.name, c.status FROM lodgify_connections c JOIN companies co ON co.id = c.company_id;
