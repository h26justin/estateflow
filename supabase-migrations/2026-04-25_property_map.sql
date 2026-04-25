-- Migration: property map — geocoding columns
-- Adds latitude/longitude for pin placement, plus metadata columns:
--   geocoded_at      — when the geocode last ran
--   geocode_status   — 'ok' | 'failed' | null (= never tried)
--   geocode_pinned   — true if user manually dragged the pin (do not overwrite)
-- Run in Supabase SQL Editor. Idempotent.

alter table properties
  add column if not exists latitude        double precision,
  add column if not exists longitude       double precision,
  add column if not exists geocoded_at     timestamptz,
  add column if not exists geocode_status  text,
  add column if not exists geocode_pinned  boolean default false;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
