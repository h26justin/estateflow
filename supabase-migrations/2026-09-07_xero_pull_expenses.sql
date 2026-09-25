-- Xero → property_expenses pull (opt-in per company).
-- Properly's P&L reads property_expenses; on 6 Sept 2026 that table held
-- £8,252 of 2026 spend against £59,914 a month of rent, because the real
-- ledger is Xero. xero-sync gains a PULL of SPEND bank transactions that carry
-- the company's Property tracking option, mapped by Xero id so nothing is
-- pulled twice or pushed back. Off by default; switch on under Settings →
-- Integrations → Xero once the connection is live. Idempotent.
alter table public.xero_sync_settings add column if not exists pull_expenses boolean not null default false;
alter table public.xero_sync_settings add column if not exists pull_expenses_since date;
comment on column public.xero_sync_settings.pull_expenses is 'Mirror Xero SPEND bank transactions (with a Property tracking option) into property_expenses on each sync.';
comment on column public.xero_sync_settings.pull_expenses_since is 'Earliest transaction date to pull; defaults to 1 Jan of the current year when null.';
notify pgrst, 'reload schema';
