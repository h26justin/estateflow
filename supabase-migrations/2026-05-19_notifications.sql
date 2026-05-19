-- In-app notification centre.
-- Surfaced via the bell icon in the header. Compliance reminders, rent events,
-- maintenance updates, system announcements etc. all write rows here so the
-- user has a single place to see what changed since they last looked.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- type: 'compliance' | 'rent' | 'maintenance' | 'tenant_message' | 'system' | 'backup' | 'trial' | 'deal'
  -- We intentionally store as text rather than an enum so the app can introduce
  -- new categories without a schema migration.
  type text not null,
  title text not null,
  body text,
  -- link: where to navigate when the notification is clicked.
  -- Hash routes (e.g. '#/properties/123/compliance') are preferred so we stay
  -- inside the SPA, but absolute URLs are also valid.
  link text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_id_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

-- Users can only see, mark-read or insert their own notifications.
-- Service role (edge functions, cron) bypasses RLS, so server-side inserts
-- (e.g. from compliance-reminders) work without an additional policy.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id);

-- Allow users to delete their own notifications (dismiss).
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);
