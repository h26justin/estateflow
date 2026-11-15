-- ============================================================================
-- !!! HIGH IMPACT — REVIEW TABLE BY TABLE AGAINST LIVE BEFORE APPLYING !!!
-- ============================================================================
-- Deleting a user must not delete company records (integrity fix,
-- 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- This changes foreign keys on ~21 production tables holding rent, expenses,
-- tenancies, compliance, refurb, loan and STL money records. The repo does NOT
-- reliably reflect production. Before applying, a human must run every query
-- in "PRE-APPLY CHECKS" below on hqrhqbkqxzllmzhcofrh and confirm, for EACH
-- table in the list, that (a) the constraint really is <table>_user_id_fkey
-- on (user_id) -> auth.users(id) ON DELETE CASCADE, (b) the table's live
-- SELECT policy lets company / property members see a row whose user_id is
-- NULL, and (c) no live trigger, unique index, CHECK or edge-function code
-- requires user_id to be non-null. Remove any table that fails from the
-- array before running. The DO block also skips (with a NOTICE) any table
-- whose constraint is missing / different or which has no member-visible
-- SELECT policy, but it is a backstop, not a substitute for the review.
--
-- WHAT: for each listed table, user_id -> auth.users(id) changes from
--   ON DELETE CASCADE to ON DELETE SET NULL, dropping NOT NULL on user_id
--   where present. The FK is re-added NOT VALID and then VALIDATEd (all
--   existing rows are already valid). Column defaults (auth.uid()) and data
--   are untouched. RAISE NOTICE output lists every table changed and whether
--   NOT NULL was dropped — SAVE THAT OUTPUT, the rollback needs it.
--
-- WHY (exploit / integrity): rows carry user_id = whoever created them, and
--   every such FK cascades. When an admin deletes a team member's account
--   (delete-user edge function -> auth.admin.deleteUser), every property,
--   rent payment, expense, tenancy, receipt, refurb invoice, loan etc. that
--   person ever created is silently hard-deleted from the COMPANY's books
--   (and a deleted property cascades its whole child tree).
--
-- CLIENT BEHAVIOUR CHANGE: after a user is deleted, their rows stay, with
--   user_id NULL, visible to company members through the property / company
--   helpers. Consequences to be aware of:
--   * properties_delete is creator-only (user_id = caller): a property whose
--     creator was deleted can then only be deleted by a developer. Follow-up:
--     let company owners / admins delete company properties.
--   * Code that scopes by user_id (e.g. src/components/TenantInbox.jsx loads
--     properties .eq('user_id', user.id)) will not show NULL-user rows. That
--     is the same pre-existing limitation as for rows created by teammates.
--   * Rows with NO company (personal properties / personal statement
--     imports) of a deleted user become orphans visible to nobody but
--     developers (previously they were deleted). A separate, reviewed
--     clean-up is needed for UK GDPR erasure of such personal data.
--   * stl_bookings rows are STILL deleted when the user's hostaway / lodgify
--     connection is deleted, because those connections cascade on user
--     deletion and stl_bookings.connection_id / hostaway_connection_id
--     cascade on connection deletion. Only the direct user_id cascade is
--     removed here.
--   * BEFORE UPDATE triggers on these tables fire for the SET NULL updates
--     (they run with auth.uid() NULL, so the ownership / approval guards let
--     them through); updated_at triggers will bump updated_at and
--     audit_trigger_fn will log '<table>.updated' rows.
--
-- EXCLUDED (and why) — do NOT add without a policy change first:
--   * deals             — repo's only SELECT rule is creator-only (archive
--                          deals_all). Live deals_select reportedly includes
--                          company access (2026-07-29 note); if confirmed live,
--                          add 'deals' to the array.
--   * property_inspections — SELECT is own-row only (inspections_select_own);
--                          NULL-user rows would be invisible to everyone.
--   * import_batches    — SELECT is own-row only (import_batches_own); batch
--                          revert would also break.
--   * refurb_costs, refurb_phases — no definition or policy anywhere in the
--                          repo; cannot be verified from here.
--
-- Not transaction-unsafe, but it takes ACCESS EXCLUSIVE locks on every listed
-- table (and SHARE ROW EXCLUSIVE on auth.users) until commit: apply in a
-- quiet window.
--
-- Idempotent: tables whose FK is already ON DELETE SET NULL are skipped.
--
-- ROLLBACK (back to ON DELETE CASCADE; NOT NULL restored only where the saved
-- NOTICE output says it was dropped AND no NULL user_id rows exist yet — rows
-- orphaned by a user deletion in the meantime must be dealt with first):
--   DO $rb$
--   DECLARE
--     t text;
--     -- fill from the saved NOTICE output: tables where NOT NULL was dropped
--     had_not_null text[] := ARRAY[]::text[];
--     tables text[] := ARRAY['properties','rent_payments','property_expenses',
--       'compliance_items','maintenance_jobs','tenancies','tenancy_details',
--       'non_chargeable_periods','rent_receipts','rent_overrides','payment_plans',
--       'refurb_projects','refurb_invoices','external_loans','external_loan_payments',
--       'stl_bookings','stl_adjustments','stl_managers','stl_manager_payouts',
--       'property_documents','statement_imports'];
--   BEGIN
--     FOREACH t IN ARRAY tables LOOP
--       IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
--       EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_user_id_fkey');
--       EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id)
--                       REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID', t, t || '_user_id_fkey');
--       EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_user_id_fkey');
--       IF t = ANY (had_not_null) THEN
--         EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET NOT NULL', t);
--       END IF;
--     END LOOP;
--   END $rb$;
--
-- PRE-APPLY CHECKS (read-only, run on live, review every row):
--   -- 1. The FKs as they are now (expect confdeltype 'c', one row per table):
--   SELECT c.conrelid::regclass AS tbl, c.conname, c.confdeltype,
--          pg_get_constraintdef(c.oid) AS def
--     FROM pg_constraint c
--    WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
--      AND c.conrelid::regclass::text IN ('properties','rent_payments','property_expenses',
--        'compliance_items','maintenance_jobs','tenancies','tenancy_details',
--        'non_chargeable_periods','rent_receipts','rent_overrides','payment_plans',
--        'refurb_projects','refurb_invoices','external_loans','external_loan_payments',
--        'stl_bookings','stl_adjustments','stl_managers','stl_manager_payouts',
--        'property_documents','statement_imports','deals','property_inspections',
--        'import_batches','refurb_costs','refurb_phases')
--    ORDER BY 1;
--   -- 2. Nullability of user_id (save this for the rollback):
--   SELECT table_name, is_nullable, column_default FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'user_id'
--      AND table_name IN (<same list>) ORDER BY 1;
--   -- 3. SELECT policies: each must have a has_property_access /
--   --    has_company_access branch that does not depend on user_id:
--   SELECT tablename, policyname, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')
--      AND tablename IN (<same list>) ORDER BY 1, 2;
--   -- 4. Indexes / constraints mentioning user_id (unique ones need a look):
--   SELECT tablename, indexname, indexdef FROM pg_indexes
--    WHERE schemaname = 'public' AND indexdef ILIKE '%user_id%'
--      AND tablename IN (<same list>) ORDER BY 1;
--   SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%user_id%'
--      AND conrelid::regclass::text IN (<same list>);
--   -- 5. User triggers that will fire on the SET NULL update:
--   SELECT tgrelid::regclass, tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE NOT tgisinternal AND tgrelid::regclass::text IN (<same list>) ORDER BY 1, 2;
--   -- 6. Does deleting a company OWNER still cascade the company (and thus
--   --    everything) anyway? (this migration does not change that):
--   SELECT conname, confdeltype, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.companies'::regclass AND contype = 'f';
-- ============================================================================

DO $fk$
DECLARE
  t          text;
  v_con      text;
  v_def      record;
  v_attnum   smallint;
  v_notnull  boolean;
  tables text[] := ARRAY[
    'properties', 'rent_payments', 'property_expenses', 'compliance_items',
    'maintenance_jobs', 'tenancies', 'tenancy_details', 'non_chargeable_periods',
    'rent_receipts', 'rent_overrides', 'payment_plans',
    'refurb_projects', 'refurb_invoices',
    'external_loans', 'external_loan_payments',
    'stl_bookings', 'stl_adjustments', 'stl_managers', 'stl_manager_payouts',
    'property_documents', 'statement_imports'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    v_con := t || '_user_id_fkey';

    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'SKIP %: table not found', t;
      CONTINUE;
    END IF;

    SELECT attnum, attnotnull INTO v_attnum, v_notnull
      FROM pg_attribute
     WHERE attrelid = format('public.%I', t)::regclass
       AND attname = 'user_id' AND NOT attisdropped;
    IF v_attnum IS NULL THEN
      RAISE NOTICE 'SKIP %: no user_id column', t;
      CONTINUE;
    END IF;

    SELECT c.confdeltype, c.confrelid, c.conkey INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = format('public.%I', t)::regclass
       AND c.conname = v_con
       AND c.contype = 'f';
    IF NOT FOUND THEN
      RAISE NOTICE 'SKIP %: constraint % not found', t, v_con;
      CONTINUE;
    END IF;
    IF v_def.confrelid <> 'auth.users'::regclass OR v_def.conkey <> ARRAY[v_attnum] THEN
      RAISE NOTICE 'SKIP %: % is not (user_id) -> auth.users', t, v_con;
      CONTINUE;
    END IF;
    IF v_def.confdeltype = 'n' THEN
      RAISE NOTICE 'SKIP %: already ON DELETE SET NULL', t;
      CONTINUE;
    END IF;
    IF v_def.confdeltype <> 'c' THEN
      RAISE NOTICE 'SKIP %: % is not ON DELETE CASCADE (confdeltype %), left alone', t, v_con, v_def.confdeltype;
      CONTINUE;
    END IF;

    -- Backstop: a NULL-user row must stay visible to members. Require a
    -- SELECT / ALL policy that goes through a company / property helper.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies pol
       WHERE pol.schemaname = 'public' AND pol.tablename = t
         AND pol.cmd IN ('SELECT', 'ALL')
         AND (pol.qual ILIKE '%has_property_access%'
              OR pol.qual ILIKE '%has_company_access%'
              OR pol.qual ILIKE '%user_has_company_access%')
    ) THEN
      RAISE NOTICE 'SKIP %: no member-visible SELECT policy found', t;
      CONTINUE;
    END IF;

    IF v_notnull THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP NOT NULL', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, v_con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) '
                   'REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID', t, v_con);
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, v_con);

    RAISE NOTICE 'CHANGED %: % now ON DELETE SET NULL; NOT NULL dropped: %', t, v_con, v_notnull;
  END LOOP;
END $fk$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only, after apply): re-run PRE-APPLY CHECK 1 — every changed
-- table should now show confdeltype 'n' and convalidated true:
--   SELECT conrelid::regclass, conname, confdeltype, convalidated FROM pg_constraint
--    WHERE contype = 'f' AND confrelid = 'auth.users'::regclass AND conname LIKE '%_user_id_fkey'
--    ORDER BY 1;
