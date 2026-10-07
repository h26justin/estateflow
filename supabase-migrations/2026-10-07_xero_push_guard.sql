-- ----------------------------------------------------------------------------
-- Xero push guard (7 Oct 2026).
--
-- On a freshly reconnected ExH Property Group connection, one click of
-- "Sync now" posted 219 historic rent receipts (GBP 99,976.68, Dec 2024 to
-- Oct 2026) into ExH's Xero as AUTHORISED bank transactions: the settings
-- row was created with sync_rent / sync_expenses on by default, and blank
-- bank / account choices fell back to the first bank account and the first
-- revenue code.
--
-- xero-sync now refuses to post until a bank account, income and expense
-- accounts and a "post from" date are all chosen, and never posts anything
-- dated before that date. This migration adds the date column and makes new
-- connections start with nothing switched on.
-- ----------------------------------------------------------------------------

ALTER TABLE public.xero_sync_settings
  ADD COLUMN IF NOT EXISTS push_from_date date;

COMMENT ON COLUMN public.xero_sync_settings.push_from_date IS
  'Nothing dated before this is ever posted to Xero. Required (with bank + income + expense accounts) before xero-sync posts anything.';

ALTER TABLE public.xero_sync_settings ALTER COLUMN sync_rent SET DEFAULT false;
ALTER TABLE public.xero_sync_settings ALTER COLUMN sync_expenses SET DEFAULT false;
