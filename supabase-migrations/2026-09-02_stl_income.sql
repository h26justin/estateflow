-- ============================================================================
-- Rent Tracker rebuild, Stage 6: Short-Term Let Income.
--
-- Why: short-term-let (STL) properties earn booking revenue, not monthly
-- rent. The Hostaway / Lodgify syncs already land every reservation in
-- stl_bookings and write a paid rent_payments segment for each confirmed
-- stay, but (a) nothing lets a landlord record the refunds, chargebacks and
-- payout differences that turn GROSS booking value into what actually
-- arrived, and (b) stl_bookings is readable ONLY by the user who connected
-- the channel manager (auth.uid() = user_id), so every other member of the
-- company sees no bookings at all.
--
-- This migration:
--   1. adds stl_adjustments - manual refunds / chargebacks / fees /
--      payout differences against an STL property, optionally linked to the
--      booking they relate to. Negative amounts reduce income.
--   2. re-scopes stl_bookings row security to the same shape as the rest of
--      the Rent Tracker: read via has_property_access(property_id), write
--      via has_rent_permission(property_id, ...) plus company_is_live. The
--      old *_own policies are dropped. The sync edge functions use the
--      service role and are unaffected.
--
-- Nothing is dropped, renamed, retyped or deleted from stl_bookings. Historic
-- STL rent_payments segments stay exactly as they are.
--
-- Additive only. Idempotent. Safe to re-run.
-- Depends on: 2026-09-02_rent_tracker_tenancies_receipts.sql
--             (rent_tracker_default_company), 2026-09-02_rent_editor_permission.sql
--             (has_rent_permission), 2026-06-10_security_01_helpers.sql
--             (has_property_access, company_is_live, is_developer).
-- ============================================================================

-- ── stl_adjustments ────────────────────────────────────────────────────────
create table if not exists public.stl_adjustments (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid references public.stl_bookings(id) on delete set null,
  property_id      uuid not null references public.properties(id) on delete cascade,
  company_id       uuid references public.companies(id) on delete set null,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  adjustment_date  date not null,
  amount           numeric(12,2) not null,            -- negative for refunds / chargebacks
  kind             text not null default 'adjustment'
                   check (kind in ('refund','chargeback','fee','adjustment','payout_difference')),
  channel          text,                              -- Airbnb / Booking.com / Direct / ...
  reference        text,                              -- channel payout / case reference
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  constraint stl_adjustments_amount_chk check (amount <> 0),
  constraint stl_adjustments_sign_chk check (
    kind not in ('refund','chargeback') or amount < 0
  )
);
create index if not exists idx_stl_adjustments_property on public.stl_adjustments(property_id, adjustment_date desc);
create index if not exists idx_stl_adjustments_company  on public.stl_adjustments(company_id);
create index if not exists idx_stl_adjustments_booking  on public.stl_adjustments(booking_id) where booking_id is not null;

comment on table public.stl_adjustments is
  'Manual adjustments to short-term-let booking income (refunds, chargebacks, fees, payout differences). Negative amounts reduce the gross booking value held on stl_bookings.';

-- company_id defaults from the property (function created in Stage 2).
drop trigger if exists trg_stl_adjustments_company on public.stl_adjustments;
create trigger trg_stl_adjustments_company before insert or update on public.stl_adjustments
  for each row execute function public.rent_tracker_default_company();

-- Audit trail, same trigger the rest of the app uses.
drop trigger if exists audit_trigger on public.stl_adjustments;
create trigger audit_trigger after insert or update or delete on public.stl_adjustments
  for each row execute function public.audit_trigger_fn();

-- ── Row level security: stl_adjustments ────────────────────────────────────
alter table public.stl_adjustments enable row level security;

drop policy if exists stl_adjustments_select on public.stl_adjustments;
drop policy if exists stl_adjustments_insert on public.stl_adjustments;
drop policy if exists stl_adjustments_update on public.stl_adjustments;
drop policy if exists stl_adjustments_delete on public.stl_adjustments;

create policy stl_adjustments_select on public.stl_adjustments for select
  using (is_developer() or has_property_access(property_id));
create policy stl_adjustments_insert on public.stl_adjustments for insert
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = stl_adjustments.property_id)));
create policy stl_adjustments_update on public.stl_adjustments for update
  using (has_rent_permission(property_id, 'write'))
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = stl_adjustments.property_id)));
create policy stl_adjustments_delete on public.stl_adjustments for delete
  using (has_rent_permission(property_id, 'delete'));

revoke all on public.stl_adjustments from anon;
grant select, insert, update, delete on public.stl_adjustments to authenticated;

-- ── Row level security: stl_bookings re-scope ──────────────────────────────
-- Before: auth.uid() = user_id on every verb (2026-07-28_lodgify_stl.sql,
-- re-asserted by 2026-08-22_hostaway_stl.sql). After: property access, the
-- same gate as rent_payments / tenancies / rent_receipts.
alter table public.stl_bookings enable row level security;

drop policy if exists stl_bookings_select_own on public.stl_bookings;
drop policy if exists stl_bookings_insert_own on public.stl_bookings;
drop policy if exists stl_bookings_update_own on public.stl_bookings;
drop policy if exists stl_bookings_delete_own on public.stl_bookings;

drop policy if exists stl_bookings_select on public.stl_bookings;
drop policy if exists stl_bookings_insert on public.stl_bookings;
drop policy if exists stl_bookings_update on public.stl_bookings;
drop policy if exists stl_bookings_delete on public.stl_bookings;

create policy stl_bookings_select on public.stl_bookings for select
  using (is_developer() or has_property_access(property_id));
create policy stl_bookings_insert on public.stl_bookings for insert
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = stl_bookings.property_id)));
create policy stl_bookings_update on public.stl_bookings for update
  using (has_rent_permission(property_id, 'write'))
  with check (has_rent_permission(property_id, 'write')
    and company_is_live((select company_id from public.properties where id = stl_bookings.property_id)));
create policy stl_bookings_delete on public.stl_bookings for delete
  using (has_rent_permission(property_id, 'delete'));

revoke all on public.stl_bookings from anon;
grant select, insert, update, delete on public.stl_bookings to authenticated;

-- ── Verification (run by hand after applying) ──────────────────────────────
-- 1. Table + columns landed:
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'stl_adjustments' order by ordinal_position;
-- 2. Policies: expect exactly select/insert/update/delete on both tables and
--    NO *_own policy left on stl_bookings:
--   select tablename, policyname from pg_policies
--    where tablename in ('stl_bookings','stl_adjustments') order by 1, 2;
-- 3. Triggers on stl_adjustments (expect audit_trigger + trg_stl_adjustments_company):
--   select tgname from pg_trigger where tgrelid = 'public.stl_adjustments'::regclass and not tgisinternal;
-- 4. As a company member who did NOT connect Hostaway, bookings are now visible:
--   select count(*) from public.stl_bookings;   -- run with that member's JWT
-- 5. Sign constraint holds:
--   insert into public.stl_adjustments (property_id, adjustment_date, amount, kind)
--   values ('<stl property id>', current_date, 50, 'refund');   -- expect: violates stl_adjustments_sign_chk
