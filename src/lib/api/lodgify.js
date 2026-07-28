// Lodgify short-term-let (STL) integration.
//
// Lodgify is the channel manager for STL properties (Piers View et al) —
// it aggregates Airbnb, Booking.com and direct-site bookings behind one
// API. The lodgify-sync edge function pulls those bookings and writes each
// confirmed one as a dated rent_payments segment, so STL revenue shows in
// the Rent Tracker / Day Tracker / reports like any other rent.
//
// Flow (Settings → Portfolio Setup → Integrations → Short-term lets):
//   1. connectLodgify(companyId, apiKey) — key from Lodgify → Settings →
//      Public API. Validated server-side, stored encrypted against the
//      company, returns the Lodgify properties so the mapping UI can
//      render immediately.
//   2. saveLodgifyMappings(companyId, [{lodgify_property_id,
//      lodgify_property_name, property_id}]) — which OwnProperly property
//      each Lodgify listing is (must belong to the same company).
//   3. runLodgifySync(companyId) — manual pull; the server cron also runs
//      every connection three times a day.
//
// Connections are one-per-(user, company), same model as Xero — each
// company can hold its own Lodgify account. API key columns are never
// selected client-side.

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

// ── Connections (one per company) ───────────────────────────────────────
export async function fetchLodgifyConnections() {
  const { data, error } = await supabase
    .from('lodgify_connections')
    .select('id, company_id, status, last_synced_at, last_sync_status, last_sync_error, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function connectLodgify(companyId, apiKey) {
  return invoke('connect', { company_id: companyId, api_key: apiKey })
}

export async function disconnectLodgify(companyId) {
  return invoke('disconnect', { company_id: companyId })
}

// ── Property mapping ────────────────────────────────────────────────────
export async function fetchLodgifyMappings() {
  const { data, error } = await supabase
    .from('lodgify_property_mappings')
    .select('id, connection_id, lodgify_property_id, lodgify_property_name, property_id')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Live list from the Lodgify API (for the mapping editor).
export async function fetchLodgifyProperties(companyId) {
  return invoke('list_properties', { company_id: companyId })
}

export async function saveLodgifyMappings(companyId, mappings) {
  return invoke('save_mappings', { company_id: companyId, mappings })
}

// ── Sync ────────────────────────────────────────────────────────────────
// Returns { bookings, created, updated, removed, skippedUnmapped }.
export async function runLodgifySync(companyId) {
  return invoke('sync', { company_id: companyId })
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
