-- ============================================================================
-- Short-term-let income: a booking is not income until the guest has stayed.
--
-- hostaway-sync and lodgify-sync write every confirmed reservation as a
-- rent_payments segment with status 'paid' ("collected upfront by the
-- channel"). That is true of the guest's card, not of us: Booking.com pays
-- out after the stay, any booking can cancel, and on 6 Sept 2026 the live
-- database held 35 'paid' segments (£3,693) for nights that had not happened.
-- Anything that sums paid segments (reports, the Xero push, the dashboard
-- income tiles) counted them as money received.
--
-- This migration fixes it in the database so the two sync functions do not
-- need redeploying (the deployed lodgify-sync is a single-file build the repo
-- does not reproduce):
--
--   1. A BEFORE INSERT OR UPDATE trigger on rent_payments turns an STL
--      segment whose stay has not finished from 'paid' into 'pending'. STL
--      segments are recognised by the notes prefix both syncs write
--      ('STL · ') plus a dated period. Nothing else is touched.
--   2. stl_settle_completed_bookings() flips 'pending' back to 'paid' once
--      period_end (the last night) is in the past. Scheduled daily at 02:30
--      UTC, before the 04:10 Hostaway run.
--   3. A one-off backfill applies rule 1 to the segments already stored.
--
-- The Rent Tracker renders pending STL segments in a lighter purple (App.jsx
-- STL_PENDING_PAIR); rentStats already excludes non-paid months from income.
-- Idempotent.
-- ============================================================================

create or replace function public.stl_segment_status_guard()
returns trigger
language plpgsql
as $$
begin
  -- Only STL segments (both syncs prefix their notes) with a dated stay.
  if new.notes like 'STL · %' and new.period_end is not null then
    if new.status = 'paid' and new.period_end >= current_date then
      new.status := 'pending';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists stl_segment_status_guard on public.rent_payments;
create trigger stl_segment_status_guard
  before insert or update of status, period_end, notes on public.rent_payments
  for each row execute function public.stl_segment_status_guard();

create or replace function public.stl_settle_completed_bookings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare n integer;
begin
  update public.rent_payments
     set status = 'paid'
   where status = 'pending'
     and notes like 'STL · %'
     and period_end is not null
     and period_end < current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.stl_settle_completed_bookings() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'stl-settle-daily') then
    perform cron.unschedule('stl-settle-daily');
  end if;
  perform cron.schedule('stl-settle-daily', '30 2 * * *', $cron$select public.stl_settle_completed_bookings()$cron$);
end $$;

-- One-off backfill: apply rule 1 to what is already stored. The trigger does
-- the work; this UPDATE just gives it every STL row to look at.
update public.rent_payments
   set status = 'pending'
 where status = 'paid'
   and notes like 'STL · %'
   and period_end is not null
   and period_end >= current_date;

notify pgrst, 'reload schema';

-- Verification:
-- select status, count(*) from rent_payments where notes like 'STL · %' group by 1;
-- select jobname, schedule from cron.job where jobname in ('stl-settle-daily');
