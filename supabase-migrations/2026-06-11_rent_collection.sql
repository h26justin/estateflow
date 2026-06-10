-- ===========================================================================
-- Open-banking rent collection — SCAFFOLD ONLY (INERT, flag: rent_collection)
-- ===========================================================================
-- Records the INTENT to collect rent via a future open-banking VRP (Variable
-- Recurring Payment) mandate. This migration creates the storage + audit
-- tables and the RLS surface ONLY. It deliberately performs NO money movement
-- and no payment-initiation: the actual payment call lives in the edge
-- function as a stub that throws until FCA authorisation + a TrueLayer VRP
-- agreement are in place and the required secrets are configured.
--
--   rent_collection_mandates  — one record per tenancy describing the desired
--                               recurring collection (amount, day-of-month,
--                               provider, status). status starts at 'draft'.
--   rent_collection_attempts  — append-only audit of mandate lifecycle events
--                               and any (currently blocked) initiation calls.
--
-- DEPENDS ON (apply first):
--   2026-06-10_security_01_helpers.sql   (has_property_permission,
--                                          company_is_live, is_developer)
--   2026-06-10_tenant_portal_access.sql  (is_tenant_of_property)
--
-- Idempotent. Safe to re-run.
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. rent_collection_mandates — the per-tenancy collection record
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rent_collection_mandates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  tenant_user_id uuid,
  company_id     uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'pending_consent', 'active', 'cancelled', 'failed')),
  provider       text,
  mandate_ref    text,
  amount_pcm     numeric,
  day_of_month   int CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 28)),
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rent_collection_mandates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS rent_collection_mandates_property_idx
  ON public.rent_collection_mandates (property_id);
CREATE INDEX IF NOT EXISTS rent_collection_mandates_tenant_idx
  ON public.rent_collection_mandates (tenant_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. rent_collection_attempts — append-only audit (NO execution happens here)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rent_collection_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id   uuid NOT NULL REFERENCES public.rent_collection_mandates(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  event        text NOT NULL,
  detail       text,
  amount       numeric,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rent_collection_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS rent_collection_attempts_mandate_idx
  ON public.rent_collection_attempts (mandate_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — landlords/collaborators manage; tenant reads own mandate(s)
-- ─────────────────────────────────────────────────────────────────────────────

-- mandates: SELECT (developer, landlord/collaborator, or the tenant on it)
DROP POLICY IF EXISTS rent_collection_mandates_select ON public.rent_collection_mandates;
CREATE POLICY rent_collection_mandates_select ON public.rent_collection_mandates
  FOR SELECT USING (
    public.is_developer()
    OR public.has_property_access(property_id)
    OR public.is_tenant_of_property(property_id)
  );

-- mandates: INSERT (landlord with write permission, company live)
DROP POLICY IF EXISTS rent_collection_mandates_insert ON public.rent_collection_mandates;
CREATE POLICY rent_collection_mandates_insert ON public.rent_collection_mandates
  FOR INSERT WITH CHECK (
    public.has_property_permission(property_id, 'write')
    AND public.company_is_live(company_id)
  );

-- mandates: UPDATE (landlord with write permission, company live)
DROP POLICY IF EXISTS rent_collection_mandates_update ON public.rent_collection_mandates;
CREATE POLICY rent_collection_mandates_update ON public.rent_collection_mandates
  FOR UPDATE USING (
    public.has_property_permission(property_id, 'write')
  ) WITH CHECK (
    public.has_property_permission(property_id, 'write')
    AND public.company_is_live(company_id)
  );

-- mandates: DELETE (landlord with write permission)
DROP POLICY IF EXISTS rent_collection_mandates_delete ON public.rent_collection_mandates;
CREATE POLICY rent_collection_mandates_delete ON public.rent_collection_mandates
  FOR DELETE USING (
    public.has_property_permission(property_id, 'write')
  );

-- attempts: SELECT (landlord/collaborator + tenant of the property)
DROP POLICY IF EXISTS rent_collection_attempts_select ON public.rent_collection_attempts;
CREATE POLICY rent_collection_attempts_select ON public.rent_collection_attempts
  FOR SELECT USING (
    public.is_developer()
    OR public.has_property_access(property_id)
    OR public.is_tenant_of_property(property_id)
  );

-- attempts: INSERT (landlord with write permission). Service-role bypasses RLS,
-- so the edge function can also append audit rows; this policy covers any
-- client-side landlord-initiated audit entry.
DROP POLICY IF EXISTS rent_collection_attempts_insert ON public.rent_collection_attempts;
CREATE POLICY rent_collection_attempts_insert ON public.rent_collection_attempts
  FOR INSERT WITH CHECK (
    public.has_property_permission(property_id, 'write')
  );

-- attempts are append-only: no UPDATE/DELETE policy (denied by default).

NOTIFY pgrst, 'reload schema';
