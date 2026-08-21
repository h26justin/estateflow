-- Purchase (completion) date on properties
-- ============================================================================
-- Until now a property recorded what it cost but never *when* it was bought.
-- That left the portfolio with no ownership start date: no holding period, no
-- basis for a disposal calculation, and the portfolio growth chart openly
-- faked its year buckets ("we don't have exact purchase dates").
--
-- `purchase_date` is the legal completion date — the day ownership transferred
-- — not the exchange date and not the date the record was created. Nullable,
-- because the whole existing portfolio predates the column and back-filling is
-- a per-property research job against completion statements / Land Registry.
--
-- Safe to re-run.

alter table properties
  add column if not exists purchase_date date;

comment on column properties.purchase_date is
  'Legal completion date — the day ownership transferred. Not the exchange date. Null where not yet established.';

-- Sorting and filtering the portfolio by acquisition date; partial because
-- most rows are null until back-filled.
create index if not exists idx_properties_purchase_date
  on properties (purchase_date)
  where purchase_date is not null;
