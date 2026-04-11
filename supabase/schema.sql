-- ESTATEFLOW Database Schema
-- Paste this into Supabase SQL Editor and click Run

create extension if not exists "uuid-ossp";

create table companies (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  abbr       text not null,
  color      text not null default '#C8A84B',
  created_at timestamptz default now()
);

create table properties (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  company_id      uuid references companies(id) on delete set null,
  name            text not null,
  address         text not null,
  prop_type       text,
  status          text not null default 'purchased' check (status in ('purchased','refurb','rented','vacant')),
  refurb_status   text not null default 'planned' check (refurb_status in ('planned','in-progress','complete')),
  purchase_price  numeric(12,2) default 0,
  refurb_cost     numeric(12,2) default 0,
  est_value       numeric(12,2) default 0,
  deposit         numeric(12,2) default 0,
  mortgage_amount numeric(12,2) default 0,
  stamp_duty      numeric(12,2) default 0,
  legal_fees      numeric(12,2) default 0,
  insurance       numeric(12,2) default 0,
  mortgage_rate   numeric(6,4) default 0,
  mortgage_term   int default 25,
  rent_pcm        numeric(10,2) default 0,
  rent_due_day    text,
  tenant_name     text,
  tenant_since    date,
  tenancy_end     text,
  arrears         numeric(10,2) default 0,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table refurb_phases (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid references properties(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  start_date  date,
  end_date    date,
  done        boolean default false,
  notes       text,
  created_at  timestamptz default now()
);

create table refurb_costs (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid references properties(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  trade       text not null,
  cost        numeric(10,2) default 0,
  paid        boolean default false,
  date        date,
  notes       text,
  created_at  timestamptz default now()
);

create table rent_payments (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid references properties(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  month_label text not null,
  year        int not null,
  month       int not null,
  status      text not null default 'unpaid' check (status in ('paid','missed','void')),
  amount      numeric(10,2),
  notes       text,
  created_at  timestamptz default now(),
  unique(property_id, year, month)
);

alter table companies     enable row level security;
alter table properties    enable row level security;
alter table refurb_phases enable row level security;
alter table refurb_costs  enable row level security;
alter table rent_payments enable row level security;

create policy "Users manage own companies"     on companies     for all using (auth.uid() = user_id);
create policy "Users manage own properties"    on properties    for all using (auth.uid() = user_id);
create policy "Users manage own refurb phases" on refurb_phases for all using (auth.uid() = user_id);
create policy "Users manage own refurb costs"  on refurb_costs  for all using (auth.uid() = user_id);
create policy "Users manage own rent payments" on rent_payments  for all using (auth.uid() = user_id);

create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger properties_updated_at
  before update on properties
  for each row execute function update_updated_at();
