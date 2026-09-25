-- Rental Statement Audit: agreed fee terms per landlord run, Rook Matthews
-- Sayer layout support (2026-09-09, follow-up to 2026-09-09_statement_audit).
--
-- * Each landlord run records the fee rate and VAT rate agreed with the agent
--   (for example PNE 10% + VAT, Rook Matthews Sayer 7% + VAT). Every fee line
--   is compared against it and flagged when the charged rate differs or the
--   VAT is not itemised. The statement figures themselves are never altered.
-- * Rook Matthews Sayer statements carry no sequential statement number, so
--   the agent's own reference and the statement period are kept and the
--   audit number is assigned on import. They can also make several payments
--   to the owner on one statement, so each transfer is recorded as its own
--   line (line_type 'transfer') for matching against the bank.
-- * A balance carried forward to the next statement reduces the payout in
--   the same way a balance brought forward increases it.

alter table public.statement_audit_series
  add column if not exists expected_fee_pct      numeric(6,2),
  add column if not exists expected_fee_vat_pct  numeric(5,2) not null default 0;

alter table public.statement_audit_statements
  add column if not exists carried_forward         numeric(12,2) not null default 0,
  add column if not exists agent_reference         text,
  add column if not exists statement_period_start  date,
  add column if not exists statement_period_end    date;

alter table public.statement_audit_lines drop constraint if exists statement_audit_lines_line_type_check;
alter table public.statement_audit_lines add constraint statement_audit_lines_line_type_check check (line_type in (
  'rent','arrears','other_income','management_fee','maintenance','other_deduction','credit','transfer'));

comment on column public.statement_audit_series.expected_fee_pct is
  'Agreed management fee as a percentage of rent, excluding VAT. Null = no rate check.';
comment on column public.statement_audit_series.expected_fee_vat_pct is
  'VAT rate the agent should add to its fee (20 for a VAT-registered agent, 0 if none). Used only to check the statement; never applied to the figures.';
