-- ── Per-property compliance opt-outs ─────────────────────────────────────────
-- properties.compliance_optout — jsonb {catalogue_key: true} for requirements
-- the landlord has switched off on THIS property (tier 2/3 only; tier 1 legal
-- items can't be opted out in the UI). Opted-out items render dimmed on the
-- Compliance overview instead of as missing, and are excluded from scores.
-- Missing column value / missing key = tracked as normal.

alter table properties add column if not exists compliance_optout jsonb;
