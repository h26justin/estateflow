// Lodgify short-term-let (STL) integration.
//
// Lodgify is the channel manager for STL properties (Piers View et al) —
// it aggregates Airbnb, Booking.com and direct-site bookings behind one
// API. The lodgify-sync edge function pulls those bookings and writes each
// confirmed one as a dated rent_payments segment, so STL revenue shows in
// the Rent Tracker / Day Tracker / reports like any other rent.
//
// Flow (Settings → Portfolio Setup → Integrations → Short-term lets):
//   1. connectLodgify(apiKey)  — key from Lodgify → Settings → Public API.
//      Validated server-side, stored encrypted, returns the Lodgify
//      properties so the mapping UI can render immediately.
//   2. saveLodgifyMappings([{lodgify_property_id, lodgify_property_name,
//      property_id}]) — which OwnProperly property each Lodgify listing is.
//   3. runLodgifySync() — manual pull; a daily 05:30 UTC cron also runs it.
//
// The connection row is one-per-user (a Lodgify account covers all its
// properties). API key columns are never selected client-side.

import { supabase } from '../supabase'

const FUNCTION = 'lodgify-sync'

async function invoke(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase.functions.invoke(FUNCTION, {
    body: { action, ...payload },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) {
    let msg = error.message || 'Lodgify request failed'
    try {
      const ctxBody = await error.context?.json?.()
      if (ctxBody?.error) msg = ctxBody.error
    } catch { /* ignore */ }
    const e = new Error(msg)
    e.cause = error
    throw e
  }
  return data
}

// ── Connection ──────────────────────────────────────────────────────────
export async function fetchLodgifyConnection() {
  const { data, error } = await supabase
    .from('lodgify_connections')
    .select('id, status, last_synced_at, last_sync_status, last_sync_error, created_at')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function connectLodgify(apiKey) {
  return invoke('connect', { api_key: apiKey })
}

export async function disconnectLodgify() {
  return invoke('disconnect')
}

// ── Property mapping ────────────────────────────────────────────────────
export async function fetchLodgifyMappings() {
  const { data, error } = await supabase
    .from('lodgify_property_mappings')
    .select('id, lodgify_property_id, lodgify_property_name, property_id')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Live list from the Lodgify API (for the mapping editor).
export async function fetchLodgifyProperties() {
  return invoke('list_properties')
}

export async function saveLodgifyMappings(mappings) {
  return invoke('save_mappings', { mappings })
}

// ── Sync ────────────────────────────────────────────────────────────────
// Returns { bookings, created, updated, removed, skippedUnmapped }.
export async function runLodgifySync() {
  return invoke('sync')
}

// ── Bookings (read-only view of what synced) ────────────────────────────
export async function fetchStlBookings({ propertyId = null, limit = 100 } = {}) {
  let q = supabase
    .from('stl_bookings')
    .select('id, property_id, lodgify_booking_id, source, status, guest_name, arrival, departure, currency, total_amount, amount_paid, amount_due, rent_payment_id, synced_at')
    .order('arrival', { ascending: false })
    .limit(limit)
  if (propertyId) q = q.eq('property_id', propertyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}
