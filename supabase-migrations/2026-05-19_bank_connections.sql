-- Open Banking integration — schema only, pre-partnership.
--
-- A user can connect one or more bank accounts. Transactions are pulled
-- via a partner provider (TrueLayer / Plaid / GoCardless Bank Account
-- Data) and matched against rent_payments rows.
--
-- This migration creates the SHAPE; the actual OAuth handoff, scheduled
-- transaction pulls, and rent-matching logic come in a follow-up once
-- we have a partner contract. Schema is shaped to fit any of those three
-- providers without a future breaking change.

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_consent_id text,
  institution_id text,
  institution_name text,
  -- requested | pending | active | expired | revoked
  status text not null default 'requested',
  last_synced_at timestamptz,
  partner_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id text not null,
  display_name text,
  account_number_last4 text,
  sort_code text,
  iban text,
  currency text default 'GBP',
  balance numeric,
  balance_at timestamptz,
  company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_transaction_id text not null,
  posted_at timestamptz not null,
  amount numeric not null,
  currency text default 'GBP',
  description text,
  counterparty text,
  matched_rent_payment_id uuid references public.rent_payments(id) on delete set null,
  matched_at timestamptz,
  match_confidence numeric,
  created_at timestamptz not null default now(),
  unique (account_id, provider_transaction_id)
);

create index if not exists bank_connections_user_idx on public.bank_connections (user_id, created_at desc);
create index if not exists bank_accounts_user_idx on public.bank_accounts (user_id);
create index if not exists bank_accounts_connection_idx on public.bank_accounts (connection_id);
create index if not exists bank_transactions_account_posted_idx on public.bank_transactions (account_id, posted_at desc);
create index if not exists bank_transactions_unmatched_idx on public.bank_transactions (user_id, posted_at desc)
  where matched_rent_payment_id is null;

alter table public.bank_connections enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.bank_transactions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['bank_connections','bank_accounts','bank_transactions'] loop
    execute format('drop policy if exists %I_select_own on public.%I', t, t);
    execute format('drop policy if exists %I_insert_own on public.%I', t, t);
    execute format('drop policy if exists %I_update_own on public.%I', t, t);
    execute format('drop policy if exists %I_delete_own on public.%I', t, t);
    execute format('create policy %I_select_own on public.%I for select using (auth.uid() = user_id)', t, t);
    execute format('create policy %I_insert_own on public.%I for insert with check (auth.uid() = user_id)', t, t);
    execute format('create policy %I_update_own on public.%I for update using (auth.uid() = user_id)', t, t);
    execute format('create policy %I_delete_own on public.%I for delete using (auth.uid() = user_id)', t, t);
  end loop;
end $$;
