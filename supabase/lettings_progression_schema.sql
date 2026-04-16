-- Lettings Progression Pipeline
-- Run this in Supabase SQL Editor

create table if not exists lettings_progressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  property_id uuid references properties(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,

  -- Stage
  stage text not null default 'vacant'
    check (stage in ('vacant','advertising','viewings','referencing','contract','movein','let','withdrawn')),

  -- Property / letting details
  available_date date,
  proposed_start_date date,
  agreed_start_date date,
  agreed_rent numeric(10,2),
  listing_url text,
  enquiry_count integer default 0,

  -- Applicant
  applicant_name text,
  applicant_email text,
  applicant_phone text,

  -- Checklist (jsonb — keys match CHECKLISTS constant in component)
  checklist jsonb not null default '{}',

  -- Notes
  notes text,

  -- Archived (let agreed / withdrawn)
  archived_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table lettings_progressions enable row level security;

create policy "Users manage own lettings progressions"
  on lettings_progressions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index
create index if not exists lettings_progressions_user_id_idx on lettings_progressions(user_id);
create index if not exists lettings_progressions_property_id_idx on lettings_progressions(property_id);
