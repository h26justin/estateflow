// Lodgify short-term-let (STL) revenue sync.
//
// Pulls bookings from a user's Lodgify account (which aggregates Airbnb,
// Booking.com, direct-site bookings) via Lodgify Public API v2 and writes
// each confirmed booking as a dated rent_payments segment, so STL revenue
// appears in the Rent Tracker exactly like AST rent.
//
// Connections are PER COMPANY (unique on user_id + company_id, same model
// as Xero): each OwnProperly company can hold its own Lodgify account.
//
// Actions (POST { action, company_id, ... } with user JWT):
//   connect         { company_id, api_key } → validates the key against
//                                  Lodgify, stores it encrypted against the
//                                  company, returns the account's Lodgify
//                                  properties for mapping
//   list_properties { company_id } → live list of Lodgify properties
//   save_mappings   { company_id, mappings } → [{ lodgify_property_id,
//                                     lodgify_property_name, property_id }]
//   sync            { company_id } → pull bookings, upsert stl_bookings,
//                                  create/update/remove rent segments
//   disconnect      { company_id } → delete the connection (cascades
//                                  mappings + stl_bookings; rent segments
//                                  already written stay — real revenue)
//
// Cron mode: POST with x-cron-secret header (matched against CRON_SECRET,
// fail-closed) syncs ALL active connections — used by the lodgify-daily-sync
// pg_cron job.
//
// Booking → rent segment rules:
//   • only status 'Booked', not trashed, not canceled
//   • period_start = arrival, period_end = last NIGHT (departure - 1 day)
//     so back-to-back changeover days don't overlap
//   • year/month/month_label derived from arrival — whole booking is
//     attributed to the arrival month, same convention as createRentSegment
//   • status: always 'paid' — STL bookings are collected upfront by the
//     channel, so a confirmed booking is income; the UI renders STL
//     segments in a distinct colour via the stl_bookings link
//   • dedupe on (connection_id, lodgify_booking_id); the created segment id
//     is remembered in stl_bookings.rent_payment_id so re-syncs update in
//     place and cancellations delete the segment
//
// Env vars:
//   OWNPROPERLY_TOKEN_KEY  (shared AES-GCM key — api keys stored encrypted)
//   CRON_SECRET            (shared cron auth secret)
//
// Lodgify docs: https://docs.lodgify.com/reference/getallasync

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken, resolveToken } from './encryption.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET      = Deno.env.get('CRON_SECRET') || ''

const LODGIFY_HOST = 'https://api.lodgify.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(status: number, message: string) { return jsonResp(status, { error: message }) }

async function lodgifyGet(apiKey: string, path: string) {
  const res = await fetch(`${LODGIFY_HOST}${path}`, {
    headers: { 'X-ApiKey': apiKey, 'Accept': 'application/json' },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || `Lodgify HTTP ${res.status}`
    const e: any = new Error(res.status === 401 || res.status === 403
      ? 'Lodgify rejected the API key. Check it in Lodgify → Settings → Public API.'
      : msg)
    e.status = res.status
    throw e
  }
  return json
}

// Lodgify list endpoints come back either as a bare array or { count, items }.
function listItems(json: any): any[] {
  if (Array.isArray(json)) return json
  if (Array.isArray(json?.items)) return json.items
  return []
}

// Amount fields are numbers in practice, but the published schema types some
// of them as objects — accept both shapes.
function toNum(v: any): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string') { const n = parseFloat(v); return isFinite(n) ? n : null }
  if (typeof v === 'object') {
    for (const k of ['amount', 'total', 'value', 'gross']) {
      const n = toNum(v[k])
      if (n !== null) return n
    }
  }
  return null
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function dateOnly(s: any): string | null {
  if (typeof s !== 'string' || s.length < 10) return null
  const d = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

// Locale-free "Jul 2026" — must match periodToMonthParts() in the frontend.
function monthParts(periodStart: string) {
  const year = parseInt(periodStart.slice(0, 4), 10)
  const month = parseInt(periodStart.slice(5, 7), 10)
  return { year, month, month_label: `${MONTHS[month - 1]} ${year}` }
}

function minusOneDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const SOURCE_LABELS: Record<string, string> = {
  Manual: 'Direct', OH: 'Direct site', NineFlats: '9flats',
  Airbnb: 'Airbnb', AirbnbIntegration: 'Airbnb',
  HomeAway: 'HomeAway', BookingCom: 'Booking.com', Expedia: 'Expedia',
  ICal: 'iCal', Email: 'Email', FacebookMessenger: 'Messenger',
  PublicApi: 'API', Other: 'Other',
}

async function fetchLodgifyProperties(apiKey: string) {
  const props: any[] = []
  for (let page = 1; page <= 10; page++) {
    const json = await lodgifyGet(apiKey, `/v2/properties?page=${page}&size=50`)
    const items = listItems(json)
    props.push(...items)
    if (items.length < 50) break
  }
  return props.map(p => ({ id: p.id, name: p.name || `Property ${p.id}` }))
}

// ── The sync itself ────────────────────────────────────────────────────────
async function syncConnection(admin: any, conn: any): Promise<{ bookings: number; created: number; updated: number; removed: number; skippedUnmapped: number }> {
  const apiKey = await resolveToken({ encrypted: conn.api_key_enc, plaintext: conn.api_key })
  if (!apiKey) throw new Error('No usable API key stored for this connection')

  const { data: mappings } = await admin.from('lodgify_property_mappings')
    .select('lodgify_property_id, property_id')
    .eq('connection_id', conn.id)
  const propMap = new Map<number, string>(
    (mappings || []).map((m: any) => [Number(m.lodgify_property_id), m.property_id]))
  if (propMap.size === 0) throw new Error('No property mappings yet — map your Lodgify property to an OwnProperly property first')

  // Incremental after the first sync: anything updated since last sync minus
  // a 48h overlap buffer. trash=All so trashed bookings still come through
  // and we can remove their rent segments.
  let query = 'stayFilter=All&trash=All&includeCount=false&size=50'
  if (conn.last_synced_at) {
    const since = new Date(new Date(conn.last_synced_at).getTime() - 48 * 3600 * 1000)
    query += `&updatedSince=${encodeURIComponent(since.toISOString())}`
  }

  const bookings: any[] = []
  for (let page = 1; page <= 40; page++) {
    const json = await lodgifyGet(apiKey, `/v2/reservations/bookings?page=${page}&${query}`)
    const items = listItems(json)
    bookings.push(...items)
    if (items.length < 50) break
  }

  let created = 0, updated = 0, removed = 0, skippedUnmapped = 0

  for (const b of bookings) {
    const lodgifyPropId = Number(b.property_id)
    const propertyId = propMap.get(lodgifyPropId)
    if (!propertyId) { skippedUnmapped++; continue }

    const arrival = dateOnly(b.arrival)
    const departure = dateOnly(b.departure)
    if (!arrival || !departure || !b.id) continue

    const total  = toNum(b.total_amount)
    const paid   = toNum(b.amount_paid)
    const due    = toNum(b.amount_due)
    const isActive = b.status === 'Booked' && !b.is_deleted && !b.canceled_at
    const rowStatus = b.is_deleted ? 'Trashed' : (b.canceled_at ? 'Canceled' : (b.status || 'Unknown'))

    const { data: row, error: upErr } = await admin.from('stl_bookings').upsert({
      connection_id: conn.id,
      user_id: conn.user_id,
      property_id: propertyId,
      lodgify_booking_id: b.id,
      lodgify_property_id: lodgifyPropId,
      source: b.source || null,
      status: rowStatus,
      guest_name: b.guest?.name || null,
      arrival, departure,
      currency: b.currency_code || 'GBP',
      total_amount: total,
      amount_paid: paid,
      amount_due: due,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,lodgify_booking_id' }).select().single()
    if (upErr) throw upErr

    if (isActive) {
      // STL bookings are paid upfront (Airbnb/Booking.com collect before the
      // stay), so every confirmed booking counts as income immediately —
      // no pending/partial split. The UI shows STL segments in their own
      // colour via the stl_bookings link, not via status.
      const rentStatus = 'paid'

      // Last night of the stay, so a same-day changeover's next arrival
      // doesn't overlap this segment in the Day Tracker.
      const periodEnd = departure > arrival ? minusOneDay(departure) : arrival
      const srcLabel = SOURCE_LABELS[b.source] || b.source || 'Lodgify'
      const segment = {
        property_id: propertyId,
        user_id: conn.user_id,
        ...monthParts(arrival),
        status: rentStatus,
        amount: total,
        notes: `STL · ${srcLabel} · ${b.guest?.name || 'Guest'} · ${arrival} → ${departure} · Lodgify #${b.id}`,
        period_start: arrival,
        period_end: periodEnd,
      }

      if (row.rent_payment_id) {
        const { data: seg } = await admin.from('rent_payments')
          .update(segment).eq('id', row.rent_payment_id).select('id').maybeSingle()
        if (seg) { updated++; continue }
        // Segment was deleted manually — fall through and recreate it.
      }
      const { data: seg, error: segErr } = await admin.from('rent_payments')
        .insert(segment).select('id').single()
      if (segErr) throw segErr
      await admin.from('stl_bookings').update({ rent_payment_id: seg.id }).eq('id', row.id)
      created++
    } else if (row.rent_payment_id) {
      // Canceled / declined / trashed after we recorded it — remove the
      // revenue segment (hard delete, same as deleteRentSegment in the app).
      await admin.from('rent_payments').delete().eq('id', row.rent_payment_id)
      await admin.from('stl_bookings').update({ rent_payment_id: null }).eq('id', row.id)
      removed++
    }
  }

  return { bookings: bookings.length, created, updated, removed, skippedUnmapped }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Cron mode: sync every active connection ─────────────────────────────
  const cronHeader = req.headers.get('x-cron-secret') || ''
  if (cronHeader) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return jsonError(403, 'Bad cron secret')
    const { data: conns } = await admin.from('lodgify_connections')
      .select('*').eq('status', 'active')
    const results: Record<string, unknown> = {}
    for (const conn of (conns || [])) {
      try {
        const r = await syncConnection(admin, conn)
        results[conn.id] = r
        await admin.from('lodgify_connections').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'ok', last_sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('id', conn.id)
      } catch (e) {
        results[conn.id] = { error: (e as Error).message }
        await admin.from('lodgify_connections').update({
          last_sync_status: 'error', last_sync_error: (e as Error).message,
          updated_at: new Date().toISOString(),
        }).eq('id', conn.id)
      }
    }
    return jsonResp(200, { synced: Object.keys(results).length, results })
  }

  // ── User mode ────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return jsonError(401, 'Missing Authorization')
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  const caller = userData?.user
  if (userErr || !caller) return jsonError(401, 'Invalid session')

  let action = ''
  try {
    const body = await req.json()
    action = body.action

    // Every user-mode action is company-scoped.
    const companyId = body.company_id
    if (!companyId) return jsonError(400, 'company_id required')
    const { data: company } = await admin.from('companies')
      .select('id').eq('id', companyId).eq('user_id', caller.id)
      .is('deleted_at', null).maybeSingle()
    if (!company) return jsonError(403, 'Company not found')

    const getConnection = async () => {
      const { data } = await admin.from('lodgify_connections')
        .select('*').eq('user_id', caller.id).eq('company_id', companyId).maybeSingle()
      return data
    }

    if (action === 'connect') {
      const apiKey = (body.api_key || '').trim()
      if (!apiKey) return jsonError(400, 'api_key required')

      // Validate before storing: a key that can't list properties is no use.
      const properties = await fetchLodgifyProperties(apiKey)

      let enc: string | null = null
      try { enc = await encryptToken(apiKey) }
      catch (e) {
        return jsonError(500, 'Key encryption failed: ' + (e as Error).message +
          ' — check the OWNPROPERLY_TOKEN_KEY supabase secret (must be 64 hex chars).')
      }

      const { error: cErr } = await admin.from('lodgify_connections').upsert({
        user_id: caller.id,
        company_id: companyId,
        api_key: enc ? null : apiKey,
        api_key_enc: enc,
        status: 'active',
        last_sync_status: null, last_sync_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,company_id' })
      if (cErr) throw cErr

      return jsonResp(200, { connected: true, properties })
    }

    const conn = await getConnection()

    if (action === 'list_properties') {
      if (!conn) return jsonError(404, 'Not connected to Lodgify yet')
      const apiKey = await resolveToken({ encrypted: conn.api_key_enc, plaintext: conn.api_key })
      if (!apiKey) return jsonError(500, 'Stored API key could not be read — reconnect with a fresh key')
      return jsonResp(200, { properties: await fetchLodgifyProperties(apiKey) })
    }

    if (action === 'save_mappings') {
      if (!conn) return jsonError(404, 'Not connected to Lodgify yet')
      const mappings = Array.isArray(body.mappings) ? body.mappings : []

      // Only the caller's own properties IN THIS COMPANY are mappable —
      // a connection's bookings must not write revenue into another
      // company's properties.
      const propIds = mappings.map((m: any) => m.property_id).filter(Boolean)
      if (propIds.length) {
        const { data: owned } = await admin.from('properties')
          .select('id').eq('user_id', caller.id).eq('company_id', companyId).in('id', propIds)
        const ownedSet = new Set((owned || []).map((p: any) => p.id))
        const bad = propIds.find((id: string) => !ownedSet.has(id))
        if (bad) return jsonError(403, 'Property not found in this company: ' + bad)
      }

      await admin.from('lodgify_property_mappings').delete().eq('connection_id', conn.id)
      for (const m of mappings) {
        if (!m.lodgify_property_id || !m.property_id) continue
        const { error: mErr } = await admin.from('lodgify_property_mappings').insert({
          connection_id: conn.id,
          user_id: caller.id,
          lodgify_property_id: m.lodgify_property_id,
          lodgify_property_name: m.lodgify_property_name || null,
          property_id: m.property_id,
        })
        if (mErr) throw mErr
      }
      return jsonResp(200, { saved: mappings.length })
    }

    if (action === 'sync') {
      if (!conn) return jsonError(404, 'Not connected to Lodgify yet')
      try {
        const r = await syncConnection(admin, conn)
        await admin.from('lodgify_connections').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'ok', last_sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('id', conn.id)
        return jsonResp(200, r)
      } catch (e) {
        await admin.from('lodgify_connections').update({
          last_sync_status: 'error', last_sync_error: (e as Error).message,
          updated_at: new Date().toISOString(),
        }).eq('id', conn.id)
        throw e
      }
    }

    if (action === 'disconnect') {
      if (!conn) return jsonResp(200, { disconnected: true })
      // Cascades mappings + stl_bookings. rent_payments segments stay — the
      // revenue really happened; stl_bookings.rent_payment_id is ON DELETE
      // SET NULL from the rent_payments side, and the whole stl_bookings row
      // goes with the connection anyway.
      const { error: dErr } = await admin.from('lodgify_connections')
        .delete().eq('id', conn.id).eq('user_id', caller.id)
      if (dErr) throw dErr
      return jsonResp(200, { disconnected: true })
    }

    return jsonError(400, 'Unknown action: ' + action)
  } catch (e: any) {
    return jsonError(e.status && e.status >= 400 && e.status < 600 ? e.status : 500,
      e.message || 'Unknown error')
  }
})
