-- ----------------------------------------------------------------------------
-- 14 Oct 2026 security hotfixes: READ-ONLY verification queries.
--
-- Run each block in the SQL editor (or execute_sql) AFTER applying the
-- 2026-10-14_* migrations to confirm they are live. Nothing here writes.
-- Every query returns rows with a boolean `ok` column (or an empty result
-- where stated). Anything false / non-empty needs a look.
-- ----------------------------------------------------------------------------

-- 0. user_profiles privilege guard (2026-10-14_user_profiles_privilege_guard.sql)
SELECT 'user_profiles_privilege_guard trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_profiles_privilege_guard'
                 AND tgrelid = 'public.user_profiles'::regclass AND NOT tgisinternal) AS ok;

-- 1. invitations: insert needs company admin; update has WITH CHECK + guard trigger
SELECT policyname, cmd, roles, qual, with_check,
       CASE policyname
         WHEN 'invitations_insert' THEN with_check ILIKE '%user_is_company_admin%' AND with_check ILIKE '%invited_by%'
         WHEN 'invitations_update' THEN with_check IS NOT NULL AND qual ILIKE '%user_is_company_admin%'
       END AS ok
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'invitations'
   AND policyname IN ('invitations_insert', 'invitations_update');

SELECT 'invitations_update_guard trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invitations_update_guard'
                 AND tgrelid = 'public.invitations'::regclass AND NOT tgisinternal) AS ok;

-- 2. accept_company_invitation: exists, SECURITY DEFINER, authenticated only
SELECT p.proname,
       p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS ok
  FROM pg_proc p
 WHERE p.oid = to_regprocedure('public.accept_company_invitation(text)');

-- 2/3. user_company_access: no self branch in insert/update; identity trigger
SELECT policyname, cmd, qual, with_check,
       CASE cmd
         WHEN 'INSERT' THEN with_check NOT ILIKE '%user_id = (auth.uid())::text%' AND with_check NOT ILIKE '%invitations%'
         WHEN 'UPDATE' THEN qual NOT ILIKE '%user_id = (auth.uid())::text%'
                        AND with_check NOT ILIKE '%user_id = (auth.uid())::text%'
         ELSE true
       END AS ok
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'user_company_access'
 ORDER BY cmd;

SELECT 'uca_identity_guard trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'uca_identity_guard'
                 AND tgrelid = 'public.user_company_access'::regclass AND NOT tgisinternal) AS ok;

-- 4. properties: role-aware update/insert + ownership trigger
SELECT policyname, cmd, qual, with_check,
       CASE policyname
         WHEN 'properties_update' THEN qual ILIKE '%has_property_permission%' AND qual NOT ILIKE '%has_company_access%'
                                   AND with_check ILIKE '%company_is_live%'
         WHEN 'properties_insert' THEN with_check ILIKE '%has_company_write%' AND with_check NOT ILIKE '%has_company_access%'
                                   AND with_check ILIKE '%company_is_live%'
       END AS ok
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'properties'
   AND policyname IN ('properties_update', 'properties_insert');

SELECT 'properties_ownership_guard trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'properties_ownership_guard'
                 AND tgrelid = 'public.properties'::regclass AND NOT tgisinternal) AS ok;

-- 5. refurb_files path ownership trigger
SELECT 'trg_refurb_files_path_ownership trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refurb_files_path_ownership'
                 AND tgrelid = 'public.refurb_files'::regclass AND NOT tgisinternal) AS ok;

-- 5b. Existing refurb_files rows that do NOT follow <created_by>/refurbs/<project>/
--     (expected: empty; any row here may be a forged path and needs review)
SELECT id, project_id, created_by, file_path
  FROM public.refurb_files
 WHERE created_by IS NULL
    OR left(file_path, length(created_by::text || '/refurbs/' || project_id::text || '/'))
       <> created_by::text || '/refurbs/' || project_id::text || '/';

-- 6. financial guards
SELECT t.tgrelid::regclass AS table_name, t.tgname,
       true AS ok
  FROM pg_trigger t
 WHERE NOT t.tgisinternal
   AND t.tgname IN ('bank_transactions_client_guard', 'bank_accounts_client_guard', 'mtd_submissions_client_guard')
 ORDER BY 1;
-- (expect exactly 3 rows)

SELECT policyname, cmd, with_check, with_check IS NOT NULL AS ok
  FROM pg_policies
 WHERE schemaname = 'public'
   AND policyname IN ('bank_transactions_update_own', 'bank_accounts_update_own');

SELECT 'xero_sync_map: authenticated cannot write' AS check,
       NOT has_table_privilege('authenticated', 'public.xero_sync_map', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.xero_sync_map', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'public.xero_sync_map', 'DELETE')
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                        AND tablename = 'xero_sync_map' AND cmd <> 'SELECT') AS ok;

-- 6b. bank_transactions matched to a rent payment on a property owned by a
--     different user than the transaction (expected: empty)
SELECT bt.id, bt.user_id, rp.id AS rent_payment_id, p.user_id AS property_user, p.company_id
  FROM public.bank_transactions bt
  JOIN public.rent_payments rp ON rp.id = bt.matched_rent_payment_id
  JOIN public.properties p ON p.id = rp.property_id
 WHERE p.user_id IS DISTINCT FROM bt.user_id
   AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p.company_id AND c.owner_id = bt.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.user_company_access a
                    WHERE a.company_id = p.company_id AND a.user_id = bt.user_id::text
                      AND (a.is_admin OR a.is_owner OR COALESCE(a.role, 'editor') IN ('admin', 'editor')));

-- 7. txn_rules writes need has_company_write
SELECT policyname, cmd, qual, with_check,
       COALESCE(with_check, qual) ILIKE '%has_company_write%'
       AND COALESCE(with_check, qual) NOT ILIKE '%has_company_access%' AS ok
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'txn_rules' AND cmd IN ('INSERT', 'UPDATE', 'DELETE');

-- 8. integration secrets: no SELECT for anon/authenticated on the secret columns,
--    SELECT still granted on a safe column (user_id or id)
SELECT c.table_name, c.column_name,
       has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'SELECT') AS authenticated_select,
       has_column_privilege('anon',          format('public.%I', c.table_name), c.column_name, 'SELECT') AS anon_select,
       NOT has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'SELECT')
       AND NOT has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'SELECT') AS ok
  FROM information_schema.columns c
 WHERE c.table_schema = 'public'
   AND (c.table_name, c.column_name) IN (
     ('xero_connections', 'access_token'), ('xero_connections', 'refresh_token'),
     ('xero_connections', 'encrypted_access_token'), ('xero_connections', 'encrypted_refresh_token'),
     ('mtd_settings', 'hmrc_access_token'), ('mtd_settings', 'hmrc_refresh_token'),
     ('mtd_settings', 'encrypted_hmrc_access_token'), ('mtd_settings', 'encrypted_hmrc_refresh_token'),
     ('hostaway_connections', 'client_secret'), ('hostaway_connections', 'client_secret_enc'),
     ('hostaway_connections', 'access_token'), ('hostaway_connections', 'access_token_enc'),
     ('lodgify_connections', 'api_key'), ('lodgify_connections', 'api_key_enc'),
     ('bank_connections', 'partner_data'))
 ORDER BY 1, 2;

SELECT t AS table_name,
       has_column_privilege('authenticated', format('public.%I', t), 'user_id', 'SELECT') AS ok
  FROM unnest(ARRAY['xero_connections', 'mtd_settings', 'hostaway_connections',
                    'lodgify_connections', 'bank_connections']) AS t
 WHERE to_regclass('public.' || t) IS NOT NULL;

-- 9. refurb invoice approval guard
SELECT 'refurb_invoices_approval_guard trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'refurb_invoices_approval_guard'
                 AND tgrelid = 'public.refurb_invoices'::regclass AND NOT tgisinternal) AS ok;

-- 10. trusted-device RPCs: anon has no EXECUTE
SELECT f AS function,
       NOT has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') AS ok
  FROM unnest(ARRAY['public.trust_this_device(text, text)', 'public.is_device_trusted(text)',
                    'public.list_trusted_devices()', 'public.revoke_trusted_device(uuid)',
                    'public.revoke_all_trusted_devices()']) AS f
 WHERE to_regprocedure(f) IS NOT NULL;

-- 11. lookup indexes (each column should lead some index)
SELECT spec.tbl, spec.col,
       EXISTS (
         SELECT 1 FROM pg_index i
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
          WHERE n.nspname = 'public' AND t.relname = spec.tbl AND a.attname = spec.col) AS ok
  FROM (VALUES ('properties', 'company_id'), ('user_company_access', 'user_id'),
               ('user_company_access', 'email'), ('tenant_profiles', 'user_id')) AS spec(tbl, col);

-- 12. All new guard functions are not directly executable by API roles
SELECT p.proname,
       NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS ok
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('enforce_invitation_update_guard', 'enforce_uca_identity_guard',
                     'enforce_property_ownership_guard', 'enforce_refurb_file_path_ownership',
                     'enforce_bank_transaction_client_guard', 'enforce_bank_account_client_guard',
                     'enforce_mtd_submission_client_guard', 'enforce_refurb_invoice_approval',
                     'enforce_user_profile_privilege_guard');
