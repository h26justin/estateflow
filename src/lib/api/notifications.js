// In-app notification centre.
//
// Server-side writers (edge functions, cron) use the service role and
// bypass RLS; client-side reads and updates are gated by per-user RLS
// policies defined in 2026-05-19_notifications.sql.

import { supabase } from '../supabase'

export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, metadata, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function fetchUnreadNotificationCount() {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count || 0
}

export async function markNotificationRead(id) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)  // no-op if already read; avoids needless writes
  if (error) throw error
}

export async function markAllNotificationsRead() {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw error
}

export async function deleteNotification(id) {
  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) throw error
}

// Walks the user's companies and inserts a "trial expiring" notification
// when one is within `days` of expiry. Deduped per company per day via
// localStorage so opening the dashboard repeatedly doesn't spam the bell.
//
// Pure client-side because:
//   - companies are already loaded
//   - the trial date lives on company rows which clients already read
//   - we don't need cron-level reliability for a UX notification
//
// Returns the number of notifications inserted.
export async function maybeWarnTrialsExpiring(companies, days = 3) {
  if (!Array.isArray(companies) || companies.length === 0) return 0
  const STAMP_PREFIX = 'notif_trial_'
  const now = Date.now()
  const dayMs = 86_400_000
  let inserted = 0

  for (const co of companies) {
    if (!co?.trial_ends_at || co.is_free_tier) continue
    const endsAt = new Date(co.trial_ends_at).getTime()
    if (Number.isNaN(endsAt)) continue
    const daysLeft = Math.ceil((endsAt - now) / dayMs)
    // Only warn if 0 < daysLeft <= window. Expired trials are billing's job.
    if (daysLeft <= 0 || daysLeft > days) continue

    // Dedup: don't insert if we already warned for this company today.
    let lastWarn = 0
    try {
      const raw = localStorage.getItem(STAMP_PREFIX + co.id)
      if (raw) lastWarn = parseInt(raw, 10) || 0
    } catch (_) {}
    if (now - lastWarn < dayMs) continue

    try {
      await createNotification({
        type: 'trial',
        title: `${co.name || 'Your company'}: trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        body: 'Add a payment method to keep your data accessible after the trial ends.',
        link: '#/settings/billing',
        metadata: { company_id: co.id, days_left: daysLeft },
      })
      inserted++
      try { localStorage.setItem(STAMP_PREFIX + co.id, String(now)) } catch (_) {}
    } catch (_) { /* non-fatal */ }
  }
  return inserted
}

// Create a notification for the current user. Used for client-side events
// (e.g. "backup created", "tenant invited"). Server-side events should write
// directly with the service role from the edge function.
export async function createNotification({ type, title, body = null, link = null, metadata = {} }) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('notifications')
    .insert({ user_id: userId, type, title, body, link, metadata })
    .select()
    .single()
  if (error) throw error
  return data
}
