-- ── Compliance tab: applicability flags + per-company tracking toggles ──────
-- Supports the Compliance overview (renamed from the Insurance tab):
--   properties.has_gas_supply   — false = gas certs shown as n/a, not missing
--   properties.heating_type     — 'gas'|'electric'|'oil'|'solid_fuel'|'heat_pump'|'other'
--   properties.licensing_scheme — ''|'selective'|'mandatory_hmo'|'additional_hmo'
--   company_settings.compliance_tracked — jsonb {cert_key: bool}; missing key
--     or missing column value means "tracked" (defaults all-on in code).
-- All additive and nullable/defaulted: safe on live data, no backfill needed.

alter table properties add column if not exists has_gas_supply boolean not null default true;
alter table properties add column if not exists heating_type text;
alter table properties add column if not exists licensing_scheme text;

alter table company_settings add column if not exists compliance_tracked jsonb;
