-- Allow company collaborators to READ subscription rows.
--
-- Previous policy: only the company owner (or platform admin) could SELECT.
-- Bug: collaborators were caught by the TrialExpiredGate even on companies
--      with active paid subscriptions, because the gate's logic needs to
--      see sub.status='active' to skip the trial-end check. RLS hid the
--      sub row → gate fell through to trial_ends_at (in the past) → gated.
--
-- Reproduce: invite a user to a paid company. The collaborator hits the
-- trial-expired gate on sign-in even though billing is up to date.
--
-- Fix: extend SELECT to anyone with user_company_access on the company.
-- INSERT/UPDATE remain owner-only — collaborators cannot modify billing.
--
-- Found 2026-05-25 by Justin during admin review of alex@valeproperty.co.uk
-- who is a collaborator on EXH (paid + active) and 4 other free-tier
-- companies. Gate was showing despite paid status because she could not
-- see the active sub on EXH.

DROP POLICY IF EXISTS sub_select ON public.subscriptions;

CREATE POLICY sub_select ON public.subscriptions
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR is_platform_admin()
    OR user_has_company_access(company_id)
  );

-- Quick verify — should return three policies with the new SELECT clause:
-- SELECT policyname, cmd, qual FROM pg_policies
--   WHERE schemaname='public' AND tablename='subscriptions' ORDER BY policyname;
