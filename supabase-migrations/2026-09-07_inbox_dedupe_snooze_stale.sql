-- ============================================================================
-- Notifications and Autopilot: one row per fact, snooze, and stale expiry.
--
-- On 6 Sept 2026 the notifications table held 223 rows with 24 distinct
-- titles; "Autopilot: N actions need your review" alone had 37 copies, and
-- the client re-inserted "certificate expired" for the same item every day
-- it was opened on a new browser. autopilot_actions held 393 open rows, 121
-- of which the daily run had not regenerated for three days or more: the
-- generator deletes and re-creates only the keys it still believes, so a
-- fact that stopped being true stayed open forever.
--
-- 1. notifications.dedupe_key, derived on insert from (type, metadata) for
--    the recurring kinds. A second insert with the same key for the same
--    user updates the existing row (title, body, timestamp; re-surfaces it
--    as unread if it was read more than 7 days ago) and inserts nothing. All
--    producers benefit without changing: the client helpers, the Autopilot
--    digest, the backup notice.
-- 2. notifications.snoozed_until and autopilot_actions.snoozed_until, read
--    by the app to hide an item until a date.
-- 3. autopilot_expire_stale(): open actions not touched by the generator for
--    3 days become 'resolved'. Daily at 08:30 UTC, after the 07:30 run.
-- 4. One-off: collapse the duplicates already stored and expire the stale.
-- Idempotent.
-- ============================================================================

alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications add column if not exists snoozed_until timestamptz;
create unique index if not exists uq_notifications_user_dedupe
  on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists idx_notifications_user_snooze on public.notifications(user_id, snoozed_until);

create or replace function public.notification_dedupe_key(p_type text, p_metadata jsonb)
returns text language sql immutable as $$
  select case
    when p_type = 'autopilot' then 'autopilot:digest:' || coalesce(p_metadata->>'company_id', 'all')
    when p_type in ('compliance_expired', 'compliance_expiring') and p_metadata->>'item_id' is not null then 'compliance:' || (p_metadata->>'item_id')
    when p_type = 'mortgage_expiring' and p_metadata->>'property_id' is not null then 'mortgage:' || (p_metadata->>'property_id')
    when p_type = 'trial' then 'trial:' || coalesce(p_metadata->>'company_id', 'all')
    when p_type = 'backup' then 'backup'
    else null
  end
$$;

create or replace function public.notifications_dedupe_guard()
returns trigger language plpgsql as $$
declare k text; existing_id uuid;
begin
  k := coalesce(new.dedupe_key, public.notification_dedupe_key(new.type, new.metadata));
  if k is null then return new; end if;
  new.dedupe_key := k;
  select id into existing_id from public.notifications where user_id = new.user_id and dedupe_key = k limit 1;
  if existing_id is null then return new; end if;
  update public.notifications
     set title = new.title,
         body = new.body,
         link = coalesce(new.link, link),
         metadata = coalesce(new.metadata, metadata),
         created_at = now(),
         read_at = case when read_at is not null and read_at < now() - interval '7 days' then null else read_at end,
         snoozed_until = case when snoozed_until is not null and snoozed_until < now() then null else snoozed_until end
   where id = existing_id;
  return null;   -- collapsed into the existing row; nothing inserted
end
$$;
drop trigger if exists notifications_dedupe_guard on public.notifications;
create trigger notifications_dedupe_guard before insert on public.notifications
  for each row execute function public.notifications_dedupe_guard();

-- One-off collapse of what is already there: keep the newest per key.
with keyed as (
  select id, row_number() over (partition by user_id, public.notification_dedupe_key(type, metadata) order by created_at desc) as rn
    from public.notifications
   where public.notification_dedupe_key(type, metadata) is not null
)
delete from public.notifications n using keyed where n.id = keyed.id and keyed.rn > 1;
update public.notifications set dedupe_key = public.notification_dedupe_key(type, metadata)
 where dedupe_key is null and public.notification_dedupe_key(type, metadata) is not null;

-- Autopilot
alter table public.autopilot_actions add column if not exists snoozed_until timestamptz;
create index if not exists idx_autopilot_actions_open_updated on public.autopilot_actions(status, updated_at);

create or replace function public.autopilot_expire_stale()
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare n integer;
begin
  update public.autopilot_actions
     set status = 'resolved',
         updated_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resolved_reason', 'not regenerated by Autopilot for 3 days')
   where status = 'open'
     and updated_at < now() - interval '3 days';
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.autopilot_expire_stale() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'autopilot-expire-stale') then
    perform cron.unschedule('autopilot-expire-stale');
  end if;
  perform cron.schedule('autopilot-expire-stale', '30 8 * * *', $cron$select public.autopilot_expire_stale()$cron$);
end $$;

select public.autopilot_expire_stale();

notify pgrst, 'reload schema';
