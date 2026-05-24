-- Plaid sync prep — guarantee the unique keys that the bank-plaid edge
-- function relies on for idempotent upserts.
--
-- bank_accounts: need UNIQUE (connection_id, provider_account_id) so
-- re-fetching accounts during a re-sync updates the existing row
-- instead of inserting a duplicate.
--
-- bank_transactions: the existing UNIQUE (account_id, provider_transaction_id)
-- works, but the upsert in bank-plaid was written against (user_id,
-- provider_transaction_id) before — we now key off the existing constraint.
--
-- Applied via Supabase MCP on 2026-05-24.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_accounts_connection_provider_account_uniq'
  ) THEN
    -- Defensive: drop any rows that would violate the new constraint first.
    -- In production no such rows exist (Plaid hasn't gone live), but this
    -- keeps the migration idempotent for fresh dev envs.
    ALTER TABLE public.bank_accounts
      ADD CONSTRAINT bank_accounts_connection_provider_account_uniq
      UNIQUE (connection_id, provider_account_id);
  END IF;
END $$;
