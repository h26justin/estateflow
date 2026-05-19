-- Tenant referencing orders.
-- Each row tracks a single reference check requested via the landlord
-- before granting a tenancy. Today we only store the request locally —
-- the "submit to partner" step is a stub until we have a Goodlord /
-- RentProfile / OpenRent partner contract. See src/components/TenantReferenceModal.jsx.

create table if not exists public.tenant_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  -- Tenant captured details (no PII pulled from auth — references are
  -- ordered for prospective tenants who haven't necessarily signed up).
  tenant_full_name text not null,
  tenant_email text,
  tenant_phone text,
  tenant_dob date,
  current_address text,
  employer_name text,
  monthly_income numeric,
  -- Status of the reference order:
  --   requested  — landlord has filled in the form but we haven't sent yet
  --                (also the only status while we're in pre-launch mode)
  --   submitted  — sent to partner referencing provider
  --   in_progress— partner is gathering data
  --   complete   — partner has returned a result
  --   failed     — partner rejected or check could not complete
  status text not null default 'requested',
  -- Result data once a partner returns. Shape mirrors typical referencing
  -- output: { score, affordability, credit_check, employer_verified,
  -- previous_landlord_verified, recommendation, raw }.
  result jsonb,
  partner text,
  partner_reference text,
  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_references_user_id_created_idx
  on public.tenant_references (user_id, created_at desc);
create index if not exists tenant_references_property_id_idx
  on public.tenant_references (property_id);

alter table public.tenant_references enable row level security;

drop policy if exists "tenant_references_select_own" on public.tenant_references;
create policy "tenant_references_select_own" on public.tenant_references
  for select using (auth.uid() = user_id);

drop policy if exists "tenant_references_insert_own" on public.tenant_references;
create policy "tenant_references_insert_own" on public.tenant_references
  for insert with check (auth.uid() = user_id);

drop policy if exists "tenant_references_update_own" on public.tenant_references;
create policy "tenant_references_update_own" on public.tenant_references
  for update using (auth.uid() = user_id);

drop policy if exists "tenant_references_delete_own" on public.tenant_references;
create policy "tenant_references_delete_own" on public.tenant_references
  for delete using (auth.uid() = user_id);
