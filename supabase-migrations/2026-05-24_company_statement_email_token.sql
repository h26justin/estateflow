-- Per-company inbox token for inbound statement email forwarding.
--
-- Each company gets a unique randomised token. Agents email statements
-- to <token>@inbox.ownproperly.com. The ingest-statement-email edge
-- function looks up the token in this column and routes the attachment
-- to the right company.
--
-- The token acts as a shared secret — anyone with the address can post
-- to that company. We don't whitelist sender emails (would be too much
-- setup friction). The randomised 16-hex-char token is unguessable;
-- compromise would require leaking the address itself.
--
-- Applied via Supabase MCP on 2026-05-24.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS statement_email_token TEXT;

-- Seed every existing company with a unique random token. 16 hex chars
-- = 64 bits of entropy → 2^64 guesses to brute-force, well beyond
-- reasonable spam concerns.
UPDATE public.companies
SET statement_email_token = encode(gen_random_bytes(8), 'hex')
WHERE statement_email_token IS NULL;

-- Now enforce uniqueness + not-null going forward
ALTER TABLE public.companies
  ALTER COLUMN statement_email_token SET NOT NULL,
  ADD CONSTRAINT companies_statement_email_token_key UNIQUE (statement_email_token);

-- Auto-generate on insert for new companies
CREATE OR REPLACE FUNCTION public.set_statement_email_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.statement_email_token IS NULL THEN
    NEW.statement_email_token := encode(gen_random_bytes(8), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_set_statement_email_token ON public.companies;
CREATE TRIGGER companies_set_statement_email_token
  BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_statement_email_token();

COMMENT ON COLUMN public.companies.statement_email_token IS
  'Random unguessable token used in inbox.ownproperly.com forwarding addresses. Routes inbound statements to this company.';
