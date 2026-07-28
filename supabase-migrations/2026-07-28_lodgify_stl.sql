-- Lodgify short-term-let (STL) integration — schema + daily sync cron.
--
-- Pulls bookings (Airbnb / Booking.com / direct) from a user's Lodgify
-- account via their Public API v2 and materialises each confirmed booking
-- as a dated rent_payments segment, so STL revenue shows up in the Rent
-- Tracker / Day Tracker / reports with no UI changes.
--
--   lodgify_connections        one per user; API key stored AES-GCM
--                              encrypted (api_key_enc) via the shared
--                              OWNPROPERLY_TOKEN_KEY, plaintext column
--                              kept nullable for the no-key fallback,
--                              same model as bank_connections/xero.
--   lodgify_property_mappings  Lodgify property id → properties.id
--   stl_bookings               one row per Lodgify booking, deduped on
--                              (connection_id, lodgify_booking_id);
--                              rent_payment_id links the segment the
--                              booking created so re-syncs update in
--                              place and cancellations clean up.
--
-- Rent segments reuse the existing status vocabulary (paid / partial /
-- pending) — no change to the rent_payments status CHECK constraint.

create table if not exists public.lodgify_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key text,
  api_key_enc text,
  -- active | error | revoked
  status text not null default 'active',
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.lodgify_property_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lodgify_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lodgify_property_id bigint not null,
  lodgify_property_name text,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (connection_id, lodgify_property_id)
);

create table if not exists public.stl_bookings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lodgify_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  lodgify_booking_id bigint not null,
  lodgify_property_id bigint,
  -- Lodgify source enum: Manual, OH (own website), Airbnb, AirbnbIntegration,
  -- BookingCom, Expedia, ICal, ...
  source text,
  -- Lodgify booking status: Open | Tentative | Booked | Declined (+ we mark
  -- trashed/canceled ones so the linked rent segment gets removed)
  status text,
  guest_name text,
  arrival date,
  departure date,
  currency text default 'GBP',
  total_amount numeric,
  amount_paid numeric,
  amount_due numeric,
  rent_payment_id uuid references public.rent_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  unique (connection_id, lodgify_booking_id)
);

create index if not exists lodgify_mappings_connection_idx on public.lodgify_property_mappings (connection_id);
create index if not exists stl_bookings_property_arrival_idx on public.stl_bookings (property_id, arrival desc);
create index if not exists stl_bookings_user_idx on public.stl_bookings (user_id, arrival desc);

alter table public.lodgify_connections       enable row level security;
alter table public.lodgify_property_mappings enable row level security;
alter table public.stl_bookings              enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['lodgify_connections','lodgify_property_mappings','stl_bookings'] loop
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

-- ── Daily sync cron (05:30 UTC) ─────────────────────────────────────────────
-- Calls lodgify-sync in cron mode (x-cron-secret); the function then syncs
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
    'lodgify-daily-sync',
    '30 5 * * *',
    format($f$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{"action":"sync"}'::jsonb,
        timeout_milliseconds := 60000
      );
    $f$, v_base || '/lodgify-sync', v_secret)
  );
END $$;

-- Verify (run after):
--   SELECT jobname, active FROM cron.job WHERE jobname = 'lodgify-daily-sync';
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'lodgify%' OR tablename = 'stl_bookings';
