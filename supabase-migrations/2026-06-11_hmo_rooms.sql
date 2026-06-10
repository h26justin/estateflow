-- ===========================================================================
-- HMO room-level management (feature flag: hmo_rooms)
-- ===========================================================================
-- Lets a property be flagged as a House in Multiple Occupation (HMO) and broken
-- into individually-let rooms, plus a per-property HMO licence tracker.
--
--   properties.is_hmo  — boolean flag (default false) to surface the Rooms tab
--   hmo_rooms          — one row per lettable room (own tenancy/rent/occupancy)
--   hmo_licences       — HMO licence register with expiry tracking
--
-- RLS mirrors the per-property child-table pattern (see
-- 2026-06-10_tenant_portal_access.sql / 2026-06-10_security_01_helpers.sql):
--   SELECT  = is_developer() OR has_property_access(property_id)
--   WRITE   = has_property_permission(property_id,'write')
--             AND company_is_live(<the row's company>)
--   DELETE  = has_property_permission(property_id,'delete')
--
-- DEPENDS ON (apply first):
--   2026-06-10_security_01_helpers.sql   (has_property_permission, company_is_live)
--   row-level-security.sql               (is_developer, has_property_access)
--
-- Idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS). Safe to re-run.
--
-- ROLLBACK:
--   DROP TABLE public.hmo_rooms;
--   DROP TABLE public.hmo_licences;
--   ALTER TABLE public.properties DROP COLUMN is_hmo;
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. properties.is_hmo flag
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS is_hmo boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. hmo_rooms — one lettable room per row
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hmo_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  company_id    uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id       uuid,
  room_name     text NOT NULL,
  rent_pcm      numeric,
  tenant_name   text,
  tenancy_start date,
  tenancy_end   date,
  -- vacant | occupied | notice | maintenance
  status        text NOT NULL DEFAULT 'vacant',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_hmo_rooms_property_id ON public.hmo_rooms (property_id);
ALTER TABLE public.hmo_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hmo_rooms_select ON public.hmo_rooms;
CREATE POLICY hmo_rooms_select ON public.hmo_rooms
  FOR SELECT USING (
    is_developer()
    OR user_id = (SELECT auth.uid())
    OR has_property_access(property_id)
  );

DROP POLICY IF EXISTS hmo_rooms_insert ON public.hmo_rooms;
CREATE POLICY hmo_rooms_insert ON public.hmo_rooms
  FOR INSERT WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

DROP POLICY IF EXISTS hmo_rooms_update ON public.hmo_rooms;
CREATE POLICY hmo_rooms_update ON public.hmo_rooms
  FOR UPDATE
  USING (
    is_developer() OR has_property_permission(property_id, 'write')
  )
  WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

DROP POLICY IF EXISTS hmo_rooms_delete ON public.hmo_rooms;
CREATE POLICY hmo_rooms_delete ON public.hmo_rooms
  FOR DELETE USING (
    is_developer() OR has_property_permission(property_id, 'delete')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. hmo_licences — licence register with expiry tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hmo_licences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  company_id     uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id        uuid,
  -- mandatory | additional | selective | other
  licence_type   text NOT NULL DEFAULT 'mandatory',
  authority      text,
  licence_number text,
  issued_date    date,
  expiry_date    date,
  -- active | pending | expired | lapsed
  status         text NOT NULL DEFAULT 'active',
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_hmo_licences_property_id ON public.hmo_licences (property_id);
ALTER TABLE public.hmo_licences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hmo_licences_select ON public.hmo_licences;
CREATE POLICY hmo_licences_select ON public.hmo_licences
  FOR SELECT USING (
    is_developer()
    OR user_id = (SELECT auth.uid())
    OR has_property_access(property_id)
  );

DROP POLICY IF EXISTS hmo_licences_insert ON public.hmo_licences;
CREATE POLICY hmo_licences_insert ON public.hmo_licences
  FOR INSERT WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

DROP POLICY IF EXISTS hmo_licences_update ON public.hmo_licences;
CREATE POLICY hmo_licences_update ON public.hmo_licences
  FOR UPDATE
  USING (
    is_developer() OR has_property_permission(property_id, 'write')
  )
  WITH CHECK (
    is_developer()
    OR (
      has_property_permission(property_id, 'write')
      AND company_is_live((SELECT company_id FROM public.properties WHERE id = property_id))
    )
  );

DROP POLICY IF EXISTS hmo_licences_delete ON public.hmo_licences;
CREATE POLICY hmo_licences_delete ON public.hmo_licences
  FOR DELETE USING (
    is_developer() OR has_property_permission(property_id, 'delete')
  );

NOTIFY pgrst, 'reload schema';

-- ===========================================================================
-- VERIFICATION (run as a normal collaborator, not developer):
--   ALTER TABLE properties ... -> is_hmo present, default false
--   -- As property owner/editor:
--   INSERT INTO hmo_rooms (property_id, company_id, room_name, rent_pcm, status)
--     VALUES ('<own-prop>', '<company>', 'Room 1', 550, 'occupied');  -> ok
--   INSERT INTO hmo_licences (property_id, licence_type, authority, expiry_date)
--     VALUES ('<own-prop>', 'mandatory', 'Local Council', '2027-01-01'); -> ok
--   -- As a viewer collaborator:
--   INSERT ... -> blocked by RLS (has_property_permission write = false)
--   SELECT * FROM hmo_rooms WHERE property_id='<accessible-prop>';      -> rows
-- ===========================================================================
