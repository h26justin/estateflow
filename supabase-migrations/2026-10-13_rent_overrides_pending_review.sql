-- Rent Tracker investigation, 13 Oct 2026: a "Pending review" override state.
--
-- A period set to pending_review keeps its charge, receipts and override
-- history. The rent engine leaves its unpaid amount out of the live
-- outstanding total and reports it beside it (and in a combined total), so a
-- disputed or explained entry waits for the owner's decision without being
-- written off or marked paid. Reinstated by a later 'clear' override; the
-- table stays append-only, so the audit trail is the override history.

alter table public.rent_overrides drop constraint if exists rent_overrides_state_check;
alter table public.rent_overrides add constraint rent_overrides_state_check
  check (state = any (array['paid','due','part_paid','missed','not_collectible','pending_review','clear']));
