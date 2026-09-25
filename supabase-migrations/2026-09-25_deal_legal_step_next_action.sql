-- Deals: conveyancing legal step + next action / blocker (25 Sep 2026).
--
-- Additive and backwards compatible: two nullable columns, no default, no
-- backfill, so every existing deal keeps its data and stage untouched.
-- The two new stages ('conveyancing', 'ready_to_exchange') need no DDL:
-- deals.status has no CHECK constraint in production (verified 25 Sep 2026)
-- and 'dead' keeps its key, only its label changes to "Fallen through".
--
-- legal_step is optional and only offered while status = 'conveyancing';
-- the value is kept (not cleared) when the stage moves on, so history is not
-- lost. Keys mirror LEGAL_STEPS in src/lib/dealStages.js.

alter table public.deals
  add column if not exists legal_step text,
  add column if not exists next_action text;

alter table public.deals drop constraint if exists deals_legal_step_check;
alter table public.deals add constraint deals_legal_step_check check (
  legal_step is null or legal_step in (
    'solicitor_instructed', 'client_care_pack', 'draft_contract', 'searches_underway',
    'enquiries_raised', 'replies_awaited', 'enquiries_resolved', 'contracts_funds_ready'
  )
);

alter table public.deals drop constraint if exists deals_next_action_len;
alter table public.deals add constraint deals_next_action_len check (next_action is null or char_length(next_action) <= 500);

comment on column public.deals.legal_step is 'Optional conveyancing step (see src/lib/dealStages.js LEGAL_STEPS)';
comment on column public.deals.next_action is 'Free text: what is outstanding or holding up the purchase';
