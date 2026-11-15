// In-app notification centre.
//
// Server-side writers (edge functions, cron) use the service role and
// bypass RLS; client-side reads and updates are gated by per-user RLS
// policies defined in 2026-05-19_notifications.sql.

import { supabase } from '../supabase'
import { CATALOGUE_BY_KEY, canonicalCertType } from '../complianceCatalogue'

export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, metadata, read_at, created_at')
    .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)   // snoozed items stay out of sight until their date
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function fetchUnreadNotificationCount() {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)   // snoozed items stay out of sight until their date
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

// ── Staged, cross-device dedupe ──────────────────────────────────────────
// The notifications_dedupe_guard trigger (2026-09-07_inbox_dedupe_snooze_stale
// .sql) collapses an insert into the existing row with the same
// (user_id, dedupe_key) — but it bumps that row to "new" every time, so a
// daily insert re-surfaced an expired certificate every day forever, and the
// per-browser localStorage stamp meant each device did it again. The client
// now sets an explicit dedupe_key per item per STAGE (which the trigger
// honours) and inserts only keys the user does not already have, so each
// certificate notifies once per stage, across devices. The key includes the
// expiry / end date, so a renewal starts its stages afresh.

// Keys the user already has. Throws on error (callers then insert nothing
// rather than risk a flood).
async function existingDedupeKeys(keys) {
  const have = new Set()
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await supabase.from('notifications')
      .select('dedupe_key').in('dedupe_key', keys.slice(i, i + 100))
    if (error) throw error
    for (const r of data || []) have.add(r.dedupe_key)
  }
  return have
}

async function insertOncePerKey(candidates) {
  if (candidates.length === 0) return 0
  const have = await existingDedupeKeys(candidates.map(c => c.dedupe_key))
  let inserted = 0
  for (const c of candidates) {
    if (have.has(c.dedupe_key)) continue
    try { await createNotification(c); inserted++ } catch (_) { /* non-fatal */ }
  }
  return inserted
}

const COMPLIANCE_STAGES = [7, 30, 60]   // days before expiry; plus 'expired'

// The notification for one compliance item, or null when none is due. Pure —
// exported for tests. Title from cert_name / cert_type (the columns that
// exist): it read item_type / type, so every title was "Certificate …".
export function complianceNotificationFor(item, { now = Date.now(), days = 60 } = {}) {
  if (!item?.expiry_date) return null
  const expiry = new Date(item.expiry_date).getTime()
  if (Number.isNaN(expiry)) return null
  const daysLeft = Math.ceil((expiry - now) / 86_400_000)
  if (daysLeft > days) return null
  const isExpired = daysLeft < 0
  const stage = isExpired ? 'expired' : String(COMPLIANCE_STAGES.find(t => daysLeft <= t) ?? days)
  const propName = item.property?.name || item.property?.address || 'a property'
  const certType = item.cert_name || CATALOGUE_BY_KEY[canonicalCertType(item.cert_type)]?.label || item.cert_type || 'Certificate'
  return {
    type: isExpired ? 'compliance_expired' : 'compliance_expiring',
    dedupe_key: `compliance:${item.id}:${stage}:${item.expiry_date}`,
    title: isExpired
      ? `${certType} expired — ${propName}`
      : `${certType} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${propName}`,
    body: isExpired
      ? 'This certificate has expired. Renew now to stay compliant.'
      : 'Book renewal early to avoid a coverage gap.',
    link: `#/detail/${item.property_id}/compliance`,
    metadata: { item_id: item.id, property_id: item.property_id, days_left: daysLeft, stage },
  }
}

// Bell notifications for compliance items that have expired or expire within
// `days` — once per item per stage (60 / 30 / 7 days, expired).
// Returns the number of notifications inserted.
export async function maybeWarnComplianceExpiring(complianceItems, days = 60) {
  if (!Array.isArray(complianceItems) || complianceItems.length === 0) return 0
  const candidates = complianceItems.map(item => complianceNotificationFor(item, { days })).filter(Boolean)
  return insertOncePerKey(candidates)
}

// Walks the user's properties and inserts a "mortgage product expiring"
// notification when any has a fixed/tracker product ending within the
// window. Three-tier reminder: 90/60/30 days, once per tier per property
// (cross-device, see insertOncePerKey).
//
// This is the Lendlord-style remortgage prompt — biggest revenue lever
// once paired with a broker referral partnership (£200-500/deal).
//
// Returns the number of notifications inserted.
export async function maybeWarnMortgageExpiring(properties) {
  if (!Array.isArray(properties) || properties.length === 0) return 0
  const TIERS = [30, 60, 90]
  const now = Date.now()
  const candidates = []

  for (const p of properties) {
    if (!p?.mortgage_product_end_date || p.deleted_at) continue
    const ends = new Date(p.mortgage_product_end_date).getTime()
    if (Number.isNaN(ends)) continue
    const daysLeft = Math.ceil((ends - now) / 86_400_000)
    if (daysLeft <= 0) continue   // already expired — separate "reverted to SVR" alert
    // Find the smallest tier window we're inside
    const tier = TIERS.find(t => daysLeft <= t)
    if (!tier) continue
    candidates.push({
      type: 'mortgage_expiring',
      dedupe_key: `mortgage:${p.id}:${tier}:${p.mortgage_product_end_date}`,
      title: `🏦 Mortgage product on ${p.name || 'a property'} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      body: `Time to compare remortgage rates — falling onto your lender's SVR usually costs an extra 1-3%/yr. Tap to view details.`,
      link: `#/detail/${p.id}/financials`,
      metadata: { property_id: p.id, days_left: daysLeft, tier },
    })
  }
  return insertOncePerKey(candidates)
}

// Create a notification for the current user. Used for client-side events
// (e.g. "backup created", "tenant invited"). Server-side events should write
// directly with the service role from the edge function.
// dedupe_key (optional) is honoured by the notifications_dedupe_guard trigger.
export async function createNotification({ type, title, body = null, link = null, metadata = {}, dedupe_key = null }) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('notifications')
    .insert({ user_id: userId, type, title, body, link, metadata, ...(dedupe_key ? { dedupe_key } : {}) })
    .select()
    .single()
  if (error) throw error
  return data
}

// Hide a notification until a date (default a week). It comes back unread.
export async function snoozeNotification(id, days = 7) {
  const until = new Date(Date.now() + days * 86_400_000).toISOString()
  const { error } = await supabase.from('notifications').update({ snoozed_until: until }).eq('id', id)
  if (error) throw error
  return until
}

// Remove every notification of one type for the current user (the panel's
// "Clear all" on a group). The dedupe trigger means the next occurrence
// creates a single fresh row rather than re-flooding.
export async function clearNotificationsOfType(type) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0
  const { data, error } = await supabase.from('notifications').delete().eq('user_id', user.id).eq('type', type).select('id')
  if (error) throw error
  return data?.length || 0
}
