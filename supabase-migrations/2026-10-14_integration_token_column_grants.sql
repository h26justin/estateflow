-- ----------------------------------------------------------------------------
-- Integration secrets: not readable by anon / authenticated (security
-- hotfix, 14 Oct 2026)
--
-- APPLY ORDER: after the client that selects explicit column lists from
-- bank_connections and mtd_settings is deployed (same PR). Before that, the
-- old client's select('*') / upsert().select() on those two tables would
-- fail with "permission denied".
--
-- HOLE: OAuth / API secrets sit in ordinary columns of tables the owner can
-- SELECT through PostgREST with the anon key + their JWT:
--   xero_connections     access_token, refresh_token,
--                        encrypted_access_token, encrypted_refresh_token
--   mtd_settings         hmrc_access_token, hmrc_refresh_token,
--                        encrypted_hmrc_access_token, encrypted_hmrc_refresh_token
--   hostaway_connections client_secret, client_secret_enc,
--                        access_token, access_token_enc
--   lodgify_connections  api_key, api_key_enc
--   bank_connections     partner_data (Plaid / TrueLayer access + refresh
--                        tokens, written by bank-plaid / bank-truelayer)
-- RLS limits this to the row owner, but any XSS, malicious extension or
-- leaked session then yields long-lived third-party credentials (Xero
-- books, HMRC MTD, bank feeds) that outlive a password reset. The app
-- itself never needs them client-side: only edge functions, using the
-- service role, read them.
--
-- FIX: column privileges. A column-level REVOKE is a no-op while a
-- table-level SELECT grant exists, so for each table:
--   REVOKE SELECT ON <table> FROM anon, authenticated;
--   GRANT  SELECT (<every column except the secrets>) ON <table> TO authenticated;
-- The safe column list is computed from information_schema at apply time,
-- so it matches the LIVE table exactly. INSERT / UPDATE / DELETE grants and
-- RLS are untouched (disconnect still nulls tokens). service_role keeps full
-- access. NOTE: a column added to one of these tables later is NOT readable
-- by authenticated until it is granted explicitly — re-run this file after
-- such a change (it is idempotent).
--
-- Client calls were checked (src/, 14 Oct 2026): xero_connections,
-- mtd_settings, hostaway_connections and lodgify_connections already select
-- explicit safe columns; bank_connections select('*') and the mtd_settings
-- upsert's .select() are changed to explicit lists in the same PR.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  spec  record;
  cols  text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('xero_connections',     ARRAY['access_token', 'refresh_token', 'encrypted_access_token', 'encrypted_refresh_token']),
      ('mtd_settings',         ARRAY['hmrc_access_token', 'hmrc_refresh_token', 'encrypted_hmrc_access_token', 'encrypted_hmrc_refresh_token']),
      ('hostaway_connections', ARRAY['client_secret', 'client_secret_enc', 'access_token', 'access_token_enc']),
      ('lodgify_connections',  ARRAY['api_key', 'api_key_enc']),
      ('bank_connections',     ARRAY['partner_data'])
    ) AS t(tbl, secret_cols)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE NOTICE 'skipping %: table does not exist', spec.tbl;
      CONTINUE;
    END IF;

    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = spec.tbl
       AND c.column_name <> ALL (spec.secret_cols);

    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', spec.tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated', cols, spec.tbl);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
