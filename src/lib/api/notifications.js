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
// Returns the number of notifications inserted. Default window widened
// from 3 → 7 days (was too short — most trials slipped past the window
// before a user happened to log in within the 3-day band).
export async function maybeWarnTrialsExpiring(companies, days = 7) {
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

// Walks the user's compliance items and inserts a bell notification for
// anything that's already expired or expires within `days`. Deduped per
// compliance item per day via localStorage so re-opening the dashboard
// doesn't spam.
//
// This is the biggest user-value notification we've got: it nudges
// landlords to renew Gas Safety / EICR / EPC certificates BEFORE they
// expire — which is the entire reason they're paying for OwnProperly.
//
// Returns the number of notifications inserted.
export async function maybeWarnComplianceExpiring(complianceItems, days = 60) {
  if (!Array.isArray(complianceItems) || complianceItems.length === 0) return 0
  const STAMP_PREFIX = 'notif_comp_'
  const now = Date.now()
  const dayMs = 86_400_000
  let inserted = 0

  for (const item of complianceItems) {
    if (!item?.expiry_date) continue
    const expiry = new Date(item.expiry_date).getTime()
    if (Number.isNaN(expiry)) continue
    const daysLeft = Math.ceil((expiry - now) / dayMs)
    // Notify on expired (daysLeft < 0) OR expiring within window.
    if (daysLeft > days) continue

    // Dedup per item per day
    let lastWarn = 0
    try {
      const raw = localStorage.getItem(STAMP_PREFIX + item.id)
      if (raw) lastWarn = parseInt(raw, 10) || 0
    } catch (_) {}
    if (now - lastWarn < dayMs) continue

    const propName = item.property?.name || item.property?.address || 'a property'
    const certType = item.item_type || item.type || 'Certificate'
    const isExpired = daysLeft < 0
    const title = isExpired
      ? `${certType} expired — ${propName}`
      : `${certType} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${propName}`
    const body = isExpired
      ? `It's been ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} since this certificate expired. Renew now to stay compliant.`
      : 'Book renewal early to avoid a coverage gap.'

    try {
      await createNotification({
        type: isExpired ? 'compliance_expired' : 'compliance_expiring',
        title,
        body,
        link: `#/detail/${item.property_id}/compliance`,
        metadata: { item_id: item.id, property_id: item.property_id, days_left: daysLeft },
      })
      inserted++
      try { localStorage.setItem(STAMP_PREFIX + item.id, String(now)) } catch (_) {}
    } catch (_) { /* non-fatal */ }
  }
  return inserted
}

// Walks the user's properties and inserts a "mortgage product expiring"
// notification when any has a fixed/tracker product ending within the
// window. Three-tier reminder: 90/60/30 days. Deduped per property per
// 7 days via localStorage so users get reminded at each tier but not
// daily.
//
// This is the Lendlord-style remortgage prompt — biggest revenue lever
// once paired with a broker referral partnership (£200-500/deal).
//
// Returns the number of notifications inserted.
export async function maybeWarnMortgageExpiring(properties) {
  if (!Array.isArray(properties) || properties.length === 0) return 0
  const STAMP_PREFIX = 'notif_mortgage_'
  const TIERS = [90, 60, 30]
  const WEEK_MS = 7 * 86_400_000
  const now = Date.now()
  let inserted = 0

  for (const p of properties) {
    if (!p?.mortgage_product_end_date || p.deleted_at) continue
    const ends = new Date(p.mortgage_product_end_date).getTime()
    if (Number.isNaN(ends)) continue
    const daysLeft = Math.ceil((ends - now) / 86_400_000)
    if (daysLeft <= 0) continue   // already expired — separate "reverted to SVR" alert
    // Find the smallest tier window we're inside
    const tier = TIERS.find(t => daysLeft <= t)
    if (!tier) continue

    // Dedup per property per week
    const key = `${STAMP_PREFIX}${p.id}_${tier}`
    let lastWarn = 0
    try {
      const raw = localStorage.getItem(key)
      if (raw) lastWarn = parseInt(raw, 10) || 0
    } catch (_) {}
    if (now - lastWarn < WEEK_MS) continue

    try {
      await createNotification({
        type: 'mortgage_expiring',
        title: `🏦 Mortgage product on ${p.name || 'a property'} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        body: `Time to compare remortgage rates — falling onto your lender's SVR usually costs an extra 1-3%/yr. Tap to view details.`,
        link: `#/detail/${p.id}/financials`,
        metadata: { property_id: p.id, days_left: daysLeft, tier },
      })
      inserted++
      try { localStorage.setItem(key, String(now)) } catch (_) {}
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
