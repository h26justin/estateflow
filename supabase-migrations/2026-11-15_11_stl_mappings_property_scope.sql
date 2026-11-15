-- ----------------------------------------------------------------------------
-- Hostaway / Lodgify: a listing may only be mapped to a property the caller
-- can write, in the same company as the connection (security fix,
-- 15 Nov 2026). NOT YET APPLIED — gated production change.
--
-- WHAT:
--   * hostaway_property_mappings / lodgify_property_mappings: the _insert_own
--     and _update_own policies are recreated. A row must be the caller's own
--     (user_id = caller), the caller must hold
--     has_property_permission(property_id, 'write'), and the row's
--     connection_id must be one of the caller's own connections whose
--     company_id equals the property's company_id. (The mapping tables have
--     no company_id column; the company comes from the connection.)
--     _select_own and _delete_own are unchanged.
--   * hostaway_connections / lodgify_connections (both have a NOT NULL
--     company_id): _insert_own and _update_own keep the own-row rule and add
--     has_company_write(company_id) to WITH CHECK. _select_own / _delete_own
--     unchanged.
--
-- WHY (exploit): the own-row policies only checked user_id, so a signed-in
--   user could INSERT a mapping row through PostgREST pointing their listing
--   at somebody else's properties.id; hostaway-sync / lodgify-sync run as the
--   service role and would then write booking income (rent_payments
--   segments, stl_bookings) into that other landlord's property.
--
-- CLIENT BEHAVIOUR CHANGE: none expected. The app never writes these tables
--   directly: mappings and connections are written by the hostaway-sync /
--   lodgify-sync edge functions with the service role, which bypasses RLS
--   (and already checks property ownership in save_mappings). Only direct
--   REST writes are affected.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ROLLBACK (restores the live policy text verified 15 Nov 2026):
--   DO $rb$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY['hostaway_connections','hostaway_property_mappings',
--                              'lodgify_connections','lodgify_property_mappings'] LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I_insert_own ON public.%I', t, t);
--       EXECUTE format('DROP POLICY IF EXISTS %I_update_own ON public.%I', t, t);
--       EXECUTE format('CREATE POLICY %I_insert_own ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id)', t, t);
--       EXECUTE format('CREATE POLICY %I_update_own ON public.%I FOR UPDATE USING (auth.uid() = user_id)', t, t);
--     END LOOP;
--   END $rb$;
--   NOTIFY pgrst, 'reload schema';
-- ----------------------------------------------------------------------------

-- ── Connections: own row AND write access to the connection's company ──────
DROP POLICY IF EXISTS hostaway_connections_insert_own ON public.hostaway_connections;
CREATE POLICY hostaway_connections_insert_own ON public.hostaway_connections
  FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.has_company_write(company_id)
  );

DROP POLICY IF EXISTS hostaway_connections_update_own ON public.hostaway_connections;
CREATE POLICY hostaway_connections_update_own ON public.hostaway_connections
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.has_company_write(company_id)
  );

DROP POLICY IF EXISTS lodgify_connections_insert_own ON public.lodgify_connections;
CREATE POLICY lodgify_connections_insert_own ON public.lodgify_connections
  FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.has_company_write(company_id)
  );

DROP POLICY IF EXISTS lodgify_connections_update_own ON public.lodgify_connections;
CREATE POLICY lodgify_connections_update_own ON public.lodgify_connections
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.has_company_write(company_id)
  );

-- ── Mappings: writable property, same company as the caller's connection ───
DROP POLICY IF EXISTS hostaway_property_mappings_insert_own ON public.hostaway_property_mappings;
CREATE POLICY hostaway_property_mappings_insert_own ON public.hostaway_property_mappings
  FOR INSERT
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_property_permission(property_id, 'write')
    AND EXISTS (
      SELECT 1
      FROM public.hostaway_connections c
      JOIN public.properties p ON p.id = hostaway_property_mappings.property_id
      WHERE c.id = hostaway_property_mappings.connection_id
        AND c.user_id = (SELECT auth.uid())
        AND p.company_id = c.company_id
    )
  );

DROP POLICY IF EXISTS hostaway_property_mappings_update_own ON public.hostaway_property_mappings;
CREATE POLICY hostaway_property_mappings_update_own ON public.hostaway_property_mappings
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_property_permission(property_id, 'write')
    AND EXISTS (
      SELECT 1
      FROM public.hostaway_connections c
      JOIN public.properties p ON p.id = hostaway_property_mappings.property_id
      WHERE c.id = hostaway_property_mappings.connection_id
        AND c.user_id = (SELECT auth.uid())
        AND p.company_id = c.company_id
    )
  );

DROP POLICY IF EXISTS lodgify_property_mappings_insert_own ON public.lodgify_property_mappings;
CREATE POLICY lodgify_property_mappings_insert_own ON public.lodgify_property_mappings
  FOR INSERT
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_property_permission(property_id, 'write')
    AND EXISTS (
      SELECT 1
      FROM public.lodgify_connections c
      JOIN public.properties p ON p.id = lodgify_property_mappings.property_id
      WHERE c.id = lodgify_property_mappings.connection_id
        AND c.user_id = (SELECT auth.uid())
        AND p.company_id = c.company_id
    )
  );

DROP POLICY IF EXISTS lodgify_property_mappings_update_own ON public.lodgify_property_mappings;
CREATE POLICY lodgify_property_mappings_update_own ON public.lodgify_property_mappings
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_property_permission(property_id, 'write')
    AND EXISTS (
      SELECT 1
      FROM public.lodgify_connections c
      JOIN public.properties p ON p.id = lodgify_property_mappings.property_id
      WHERE c.id = lodgify_property_mappings.connection_id
        AND c.user_id = (SELECT auth.uid())
        AND p.company_id = c.company_id
    )
  );

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only, after apply):
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('hostaway_connections','hostaway_property_mappings',
--                        'lodgify_connections','lodgify_property_mappings')
--    ORDER BY tablename, policyname;
--   -- expect 16 rows; *_insert_own / *_update_own carry the new WITH CHECK.
--   -- Existing rows that the new rule would reject (should be 0; the edge
--   -- functions only ever wrote own-company properties):
--   SELECT 'hostaway' AS src, m.id FROM public.hostaway_property_mappings m
--     JOIN public.hostaway_connections c ON c.id = m.connection_id
--     JOIN public.properties p ON p.id = m.property_id
--    WHERE p.company_id IS DISTINCT FROM c.company_id OR m.user_id <> c.user_id
--   UNION ALL
--   SELECT 'lodgify', m.id FROM public.lodgify_property_mappings m
--     JOIN public.lodgify_connections c ON c.id = m.connection_id
--     JOIN public.properties p ON p.id = m.property_id
--    WHERE p.company_id IS DISTINCT FROM c.company_id OR m.user_id <> c.user_id;
