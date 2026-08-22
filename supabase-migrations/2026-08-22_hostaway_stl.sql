-- Hostaway short-term-let (STL) integration — schema + 3x-daily sync cron.
--
-- Second STL channel manager alongside Lodgify (which stays available):
-- Hostaway aggregates Airbnb / Booking.com / Vrbo / direct bookings behind
-- one API. The hostaway-sync edge function pulls reservations and
-- materialises each confirmed one as a dated rent_payments segment, exactly
-- like lodgify-sync.
--
--   hostaway_connections        one per (user, company); Hostaway auth is
--                               OAuth2 client-credentials — client_id is the
--                               Hostaway ACCOUNT ID (not secret), the API
--                               secret and the minted ~24-month bearer token
--                               are stored AES-GCM encrypted via the shared
--                               OWNPROPERLY_TOKEN_KEY (plaintext columns kept
--                               nullable for the no-key fallback, same model
--                               as lodgify_connections).
--   hostaway_property_mappings  Hostaway listing id → properties.id
--   stl_bookings                REUSED (not duplicated): gains a provider
--                               column + hostaway_* link columns so the
--                               existing stl_bookings(id,rent_payment_id)
--                               join keeps painting STL segments purple in
--                               the Day Tracker with no frontend changes.
--                               Exactly one of connection_id (Lodgify) /
--                               hostaway_connection_id is set per row.

create table if not exists public.hostaway_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Hostaway account ID doubles as the OAuth client_id. Not a secret, but
  -- needed to re-mint tokens.
  account_id text not null,
  client_secret text,
  client_secret_enc text,
  access_token text,
  access_token_enc text,
  token_expires_at timestamptz,
  -- active | error | revoked
  status text not null default 'active',
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create table if not exists public.hostaway_property_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.hostaway_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hostaway_listing_id bigint not null,
  hostaway_listing_name text,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (connection_id, hostaway_listing_id)
);

create index if not exists hostaway_connections_company_idx on public.hostaway_connections (company_id);
create index if not exists hostaway_mappings_connection_idx on public.hostaway_property_mappings (connection_id);

-- ── stl_bookings becomes provider-generic ───────────────────────────────────
-- Existing rows are all Lodgify (connection_id + lodgify_booking_id set);
-- Hostaway rows set hostaway_connection_id + hostaway_reservation_id instead.
alter table public.stl_bookings alter column connection_id drop not null;
alter table public.stl_bookings alter column lodgify_booking_id drop not null;
alter table public.stl_bookings add column if not exists provider text not null default 'lodgify';
alter table public.stl_bookings add column if not exists hostaway_connection_id uuid references public.hostaway_connections(id) on delete cascade;
alter table public.stl_bookings add column if not exists hostaway_reservation_id bigint;
alter table public.stl_bookings add column if not exists hostaway_listing_id bigint;

-- Exactly one provider link per row (existing Lodgify rows already satisfy it).
alter table public.stl_bookings drop constraint if exists stl_bookings_provider_link_check;
alter table public.stl_bookings add constraint stl_bookings_provider_link_check check (
  (connection_id is not null and hostaway_connection_id is null)
  or (connection_id is null and hostaway_connection_id is not null)
);

-- Dedupe key for Hostaway rows (upsert target). NULL pairs on Lodgify rows
-- are distinct under Postgres unique semantics, so this only bites Hostaway.
alter table public.stl_bookings drop constraint if exists stl_bookings_hostaway_reservation_key;
alter table public.stl_bookings
  add constraint stl_bookings_hostaway_reservation_key unique (hostaway_connection_id, hostaway_reservation_id);

create index if not exists stl_bookings_hostaway_conn_idx on public.stl_bookings (hostaway_connection_id);

-- ── RLS (own-rows pattern, same as the Lodgify tables) ──────────────────────
alter table public.hostaway_connections       enable row level security;
alter table public.hostaway_property_mappings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['hostaway_connections','hostaway_property_mappings'] loop
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

-- ── Sync cron (3x daily, offset 10 min from the Lodgify job) ────────────────
-- Calls hostaway-sync in cron mode (x-cron-secret); the function then syncs
-- every active connection. Secret is read out of the proven-good
-- trial-emails-daily job so the literal never appears in this file.
DO $$
DECLARE
  v_secret text;
  v_base   text := 'https://hqrhqbkqxzllmzhcofrh.supabase.co/functions/v1';
BEGIN
  SELECT (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'''))[1]
    INTO v_secret
  FROM cron.job
  WHERE jobname = 'trial-emails-daily';

  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE EXCEPTION 'Could not read CRON_SECRET from trial-emails-daily cron; aborting (no jobs changed)';
  END IF;

  PERFORM cron.schedule(
    'hostaway-daily-sync',
    '10 4,12,18 * * *',
    format($f$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{"action":"sync"}'::jsonb,
        timeout_milliseconds := 120000
      );
    $f$, v_base || '/hostaway-sync', v_secret)
  );
END $$;

-- Verify (run after):
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'hostaway-daily-sync';
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'hostaway%';
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.stl_bookings'::regclass;
