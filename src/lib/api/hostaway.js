// Hostaway short-term-let (STL) integration.
//
// Hostaway is the channel manager we now use for STL properties (Lodgify
// stays supported alongside it) — it aggregates Airbnb, Booking.com, Vrbo
// and direct bookings behind one API. The hostaway-sync edge function pulls
// those reservations and writes each confirmed one as a dated rent_payments
// segment, so STL revenue shows in the Rent Tracker / Day Tracker / reports
// like any other rent. Synced bookings land in the shared stl_bookings
// table (provider = 'hostaway'), so the purple STL rendering just works.
//
// Flow (Settings → Portfolio Setup → Integrations → Short-term lets):
//   1. connectHostaway(companyId, accountId, apiSecret) — credentials from
//      Hostaway → Settings → Hostaway API (the Account ID is the numeric
//      client id; create an API key there for the secret). Validated
//      server-side, stored encrypted against the company, returns the
//      Hostaway listings so the mapping UI can render immediately.
//   2. saveHostawayMappings(companyId, [{hostaway_listing_id,
//      hostaway_listing_name, property_id}]) — which Properly property each
//      Hostaway listing is (must belong to the same company).
//   3. runHostawaySync(companyId) — manual pull; the server cron also runs
//      every connection three times a day.
//
// Connections are one-per-(user, company), same model as Xero/Lodgify —
// each company can hold its own Hostaway account. Secret/token columns are
// never selected client-side.

import { supabase } from '../supabase'

const FUNCTION = 'hostaway-sync'

async function invoke(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase.functions.invoke(FUNCTION, {
    body: { action, ...payload },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) {
    let msg = error.message || 'Hostaway request failed'
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
export async function fetchHostawayConnections() {
  const { data, error } = await supabase
    .from('hostaway_connections')
    .select('id, company_id, status, last_synced_at, last_sync_status, last_sync_error, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function connectHostaway(companyId, accountId, apiSecret) {
  return invoke('connect', { company_id: companyId, account_id: accountId, client_secret: apiSecret })
}

export async function disconnectHostaway(companyId) {
  return invoke('disconnect', { company_id: companyId })
}

// ── Property mapping ────────────────────────────────────────────────────
export async function fetchHostawayMappings() {
  const { data, error } = await supabase
    .from('hostaway_property_mappings')
    .select('id, connection_id, hostaway_listing_id, hostaway_listing_name, property_id')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Live list from the Hostaway API (for the mapping editor).
export async function fetchHostawayProperties(companyId) {
  return invoke('list_properties', { company_id: companyId })
}

export async function saveHostawayMappings(companyId, mappings) {
  return invoke('save_mappings', { company_id: companyId, mappings })
}

// ── Sync ────────────────────────────────────────────────────────────────
// Returns { bookings, created, updated, removed, skippedUnmapped }.
export async function runHostawaySync(companyId) {
  return invoke('sync', { company_id: companyId })
}
