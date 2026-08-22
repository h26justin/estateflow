// Hostaway short-term-let (STL) revenue sync.
//
// Second STL channel manager alongside Lodgify (lodgify-sync stays as-is).
// Pulls reservations from a user's Hostaway account (which aggregates
// Airbnb, Booking.com, Vrbo, direct bookings) via the Hostaway Public API
// v1 and writes each confirmed reservation as a dated rent_payments
// segment, so STL revenue appears in the Rent Tracker exactly like AST
// rent. Bookings land in the shared stl_bookings table (provider =
// 'hostaway') so the existing Day Tracker purple-STL rendering just works.
//
// Connections are PER COMPANY (unique on user_id + company_id, same model
// as Xero/Lodgify): each Properly company can hold its own Hostaway account.
//
// Auth model (differs from Lodgify's static key): OAuth2 client-credentials.
//   client_id     = the Hostaway ACCOUNT ID (an integer, shown in
//                   Hostaway → Settings → Hostaway API)
//   client_secret = the API secret created there
//   POST /v1/accessTokens (form-encoded, scope=general) → bearer token
//   valid ~24 months. We cache the token (encrypted) on the connection and
//   re-mint from the stored secret when it nears expiry or gets revoked.
//   Docs: the token only becomes valid ~1s after being returned, so we
//   pause before first use.
//
// Actions (POST { action, company_id, ... } with user JWT):
//   connect         { company_id, account_id, client_secret } → mints a
//                                  token, validates it by listing the
//                                  account's listings, stores credentials
//                                  encrypted, returns the listings for
//                                  mapping
//   list_properties { company_id } → live list of Hostaway listings
//   save_mappings   { company_id, mappings } → [{ hostaway_listing_id,
//                                    hostaway_listing_name, property_id }]
//   sync            { company_id } → pull reservations, upsert stl_bookings,
//                                  create/update/remove rent segments
//   disconnect      { company_id } → delete the connection (cascades
//                                  mappings + stl_bookings; rent segments
//                                  already written stay — real revenue)
//
// Cron mode: POST with x-cron-secret header (matched against CRON_SECRET,
// fail-closed) syncs ALL active connections — used by the
// hostaway-daily-sync pg_cron job.
//
// Reservation → rent segment rules (same conventions as lodgify-sync):
//   • revenue statuses: 'new', 'modified' (+ legacy 'confirmed'); everything
//     else — cancelled, declined, expired, pending, awaitingPayment,
//     ownerStay, the inquiry* family — is recorded but writes no segment,
//     and removes a previously written one
//   • period_start = arrivalDate, period_end = last NIGHT (departure - 1)
//     so back-to-back changeover days don't overlap
//   • year/month/month_label derived from arrival — whole booking is
//     attributed to the arrival month, same convention as createRentSegment
//   • status: always 'paid' — STL bookings are collected upfront by the
//     channel, so a confirmed booking is income; the UI renders STL
//     segments in a distinct colour via the stl_bookings link
//   • dedupe on (hostaway_connection_id, hostaway_reservation_id); the
//     created segment id is remembered in stl_bookings.rent_payment_id so
//     re-syncs update in place and cancellations delete the segment
//
// Rate limits: Hostaway allows 15 req/10s per IP and 20 req/10s per
// account — paginated calls are spaced ~750ms apart.
//
// Env vars:
//   OWNPROPERLY_TOKEN_KEY  (shared AES-GCM key — secrets stored encrypted)
//   CRON_SECRET            (shared cron auth secret)
//
// Hostaway docs: https://api.hostaway.com/documentation

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken, resolveToken } from './encryption.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET      = Deno.env.get('CRON_SECRET') || ''

const HOSTAWAY_HOST = 'https://api.hostaway.com/v1'

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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Hostaway HTTP ──────────────────────────────────────────────────────────
async function hostawayGet(token: string, path: string) {
  const res = await fetch(`${HOSTAWAY_HOST}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Cache-control': 'no-cache' },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.status === 'fail') {
    const msg = (json && typeof json.result === 'string' && json.result)
      || (json && json.message) || `Hostaway HTTP ${res.status}`
    const e: any = new Error(res.status === 401 || res.status === 403
      ? 'Hostaway rejected the access token.'
      : (res.status === 429 ? 'Hostaway rate limit hit — try again in a minute.' : msg))
    e.status = res.status
    throw e
  }
  return json
}

async function mintAccessToken(accountId: string, clientSecret: string) {
  const res = await fetch(`${HOSTAWAY_HOST}/accessTokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-control': 'no-cache' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: accountId,
      client_secret: clientSecret,
      scope: 'general',
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.access_token) {
    const e: any = new Error(res.status >= 400 && res.status < 500
      ? 'Hostaway rejected the credentials. Check the Account ID and API secret in Hostaway → Settings → Hostaway API.'
      : `Hostaway token request failed (HTTP ${res.status})`)
    e.status = res.status >= 400 && res.status < 500 ? 400 : 502
    throw e
  }
  // Docs: "The token will be valid 1 second after being returned from the
  // API" — pause before first use.
  await sleep(1200)
  return { token: json.access_token as string, expiresIn: Number(json.expires_in) || 0 }
}

// Cached bearer token if it has comfortable life left, else re-mint from the
// stored secret and persist the new one. force=true skips the cache (used
// after a 401 — e.g. the user regenerated the secret's tokens in Hostaway).
async function getAccessToken(admin: any, conn: any, force = false): Promise<string> {
  if (!force) {
    const cached = await resolveToken({ encrypted: conn.access_token_enc, plaintext: conn.access_token })
    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
    if (cached && expiresAt > Date.now() + 24 * 3600 * 1000) return cached
  }
  const secret = await resolveToken({ encrypted: conn.client_secret_enc, plaintext: conn.client_secret })
  if (!secret) throw new Error('No usable API secret stored — reconnect with fresh credentials')
  const { token, expiresIn } = await mintAccessToken(String(conn.account_id), secret)
  const enc = await encryptToken(token)
  await admin.from('hostaway_connections').update({
    access_token: enc ? null : token,
    access_token_enc: enc,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conn.id)
  return token
}

// ── Helpers (same conventions as lodgify-sync) ─────────────────────────────
function toNum(v: any): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string') { const n = parseFloat(v); return isFinite(n) ? n : null }
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

// Hostaway's predefined reservation channels (docs → "Reservation Channels").
const CHANNEL_LABELS: Record<number, string> = {
  2000: 'Direct',
  2002: 'Vrbo',            // homeaway
  2005: 'Booking.com',     // bookingcom
  2007: 'Expedia',
  2009: 'Vrbo iCal',       // homeawayical
  2010: 'Vrbo iCal',       // vrboical
  2013: 'Direct site',     // bookingengine
  2015: 'iCal',            // customIcal
  2016: 'TripAdvisor',     // tripadvisorical
  2017: 'WordPress',
  2018: 'Airbnb',          // airbnbOfficial
  2019: 'Marriott',
  2020: 'Partner',
  2021: 'GDS',
  2022: 'Google',
}
function channelLabel(r: any): string {
  return CHANNEL_LABELS[Number(r.channelId)] || r.channelName || 'Hostaway'
}

// Statuses that count as confirmed revenue. Everything else (cancelled,
// declined, expired, pending, awaitingPayment, ownerStay, inquiry*) is
// recorded but writes no segment. 'confirmed' is deprecated in the API but
// may still appear on old reservations.
const ACTIVE_STATUSES = new Set(['new', 'modified', 'confirmed'])

async function fetchHostawayListings(token: string) {
  const listings: any[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const json = await hostawayGet(token, `/listings?limit=100&offset=${offset}`)
    const items = Array.isArray(json?.result) ? json.result : []
    listings.push(...items)
    if (items.length < 100) break
    await sleep(750)
  }
  return listings.map(l => ({
    id: l.id,
    name: l.internalListingName || l.name || `Listing ${l.id}`,
  }))
}

// Token-refresh wrapper: one retry with a freshly minted token on 401/403
// (covers the user regenerating credentials in Hostaway since our cache).
async function withToken<T>(admin: any, conn: any, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken(admin, conn)
  try {
    return await fn(token)
  } catch (e: any) {
    if (e.status !== 401 && e.status !== 403) throw e
    const fresh = await getAccessToken(admin, conn, true)
    return await fn(fresh)
  }
}

// ── The sync itself ────────────────────────────────────────────────────────
async function syncConnection(admin: any, conn: any): Promise<{ bookings: number; created: number; updated: number; removed: number; skippedUnmapped: number }> {
  const { data: mappings } = await admin.from('hostaway_property_mappings')
    .select('hostaway_listing_id, property_id')
    .eq('connection_id', conn.id)
  const propMap = new Map<number, string>(
    (mappings || []).map((m: any) => [Number(m.hostaway_listing_id), m.property_id]))
  if (propMap.size === 0) throw new Error('No property mappings yet — map your Hostaway listing to a Properly property first')

  // Incremental after the first sync: anything whose latest activity falls
  // on/after (last sync - 48h). latestActivityStart is date-granular, so the
  // buffer also absorbs the truncation. Cancellations bump latestActivity,
  // so cancelled reservations still come through and we can remove their
  // rent segments.
  let query = ''
  if (conn.last_synced_at) {
    const since = new Date(new Date(conn.last_synced_at).getTime() - 48 * 3600 * 1000)
    query = `&latestActivityStart=${since.toISOString().slice(0, 10)}`
  }

  const reservations = await withToken(admin, conn, async (token) => {
    const out: any[] = []
    let afterId: number | null = null
    for (let page = 0; page < 40; page++) {
      let path = `/reservations?limit=100${query}`
      if (afterId) path += `&afterId=${afterId}`
      const json = await hostawayGet(token, path)
      const items = Array.isArray(json?.result) ? json.result : []
      out.push(...items)
      if (items.length < 100) break
      afterId = items[items.length - 1]?.id
      if (!afterId) break
      await sleep(750)
    }
    return out
  })

  let created = 0, updated = 0, removed = 0, skippedUnmapped = 0

  for (const r of reservations) {
    const listingId = Number(r.listingMapId)
    const propertyId = propMap.get(listingId)
    if (!propertyId) { skippedUnmapped++; continue }

    const arrival = dateOnly(r.arrivalDate)
    const departure = dateOnly(r.departureDate)
    if (!arrival || !departure || !r.id) continue

    const total = toNum(r.totalPrice)
    const isActive = ACTIVE_STATUSES.has(r.status) && !r.cancellationDate

    const { data: row, error: upErr } = await admin.from('stl_bookings').upsert({
      provider: 'hostaway',
      hostaway_connection_id: conn.id,
      user_id: conn.user_id,
      property_id: propertyId,
      hostaway_reservation_id: r.id,
      hostaway_listing_id: listingId,
      source: channelLabel(r),
      status: r.status || 'unknown',
      guest_name: r.guestName || null,
      arrival, departure,
      currency: r.currency || 'GBP',
      total_amount: total,
      amount_paid: toNum(r.totalPaid),
      amount_due: toNum(r.remainingBalance),
      synced_at: new Date().toISOString(),
    }, { onConflict: 'hostaway_connection_id,hostaway_reservation_id' }).select().single()
    if (upErr) throw upErr

    if (isActive) {
      // STL bookings are paid upfront (the channel collects before the
      // stay), so every confirmed reservation counts as income immediately —
      // no pending/partial split. The UI shows STL segments in their own
      // colour via the stl_bookings link, not via status.
      const rentStatus = 'paid'

      // Last night of the stay, so a same-day changeover's next arrival
      // doesn't overlap this segment in the Day Tracker.
      const periodEnd = departure > arrival ? minusOneDay(departure) : arrival
      const segment = {
        property_id: propertyId,
        user_id: conn.user_id,
        ...monthParts(arrival),
        status: rentStatus,
        amount: total,
        notes: `STL · ${channelLabel(r)} · ${r.guestName || 'Guest'} · ${arrival} → ${departure} · Hostaway #${r.id}`,
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
      // Cancelled / declined / expired after we recorded it — remove the
      // revenue segment (hard delete, same as deleteRentSegment in the app).
      await admin.from('rent_payments').delete().eq('id', row.rent_payment_id)
      await admin.from('stl_bookings').update({ rent_payment_id: null }).eq('id', row.id)
      removed++
    }
  }

  return { bookings: reservations.length, created, updated, removed, skippedUnmapped }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Cron mode: sync every active connection ─────────────────────────────
  const cronHeader = req.headers.get('x-cron-secret') || ''
  if (cronHeader) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return jsonError(403, 'Bad cron secret')
    const { data: conns } = await admin.from('hostaway_connections')
      .select('*').eq('status', 'active')
    const results: Record<string, unknown> = {}
    for (const conn of (conns || [])) {
      try {
        const r = await syncConnection(admin, conn)
        results[conn.id] = r
        await admin.from('hostaway_connections').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'ok', last_sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('id', conn.id)
      } catch (e) {
        results[conn.id] = { error: (e as Error).message }
        await admin.from('hostaway_connections').update({
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
      const { data } = await admin.from('hostaway_connections')
        .select('*').eq('user_id', caller.id).eq('company_id', companyId).maybeSingle()
      return data
    }

    if (action === 'connect') {
      const accountId = String(body.account_id || '').trim()
      const clientSecret = String(body.client_secret || '').trim()
      if (!/^\d+$/.test(accountId)) return jsonError(400, 'account_id must be your numeric Hostaway Account ID')
      if (!clientSecret) return jsonError(400, 'client_secret required')

      // Validate before storing: mint a token and list the account's
      // listings — credentials that can't do that are no use.
      const { token: accessToken, expiresIn } = await mintAccessToken(accountId, clientSecret)
      const properties = await fetchHostawayListings(accessToken)

      let secretEnc: string | null = null
      let tokenEnc: string | null = null
      try {
        secretEnc = await encryptToken(clientSecret)
        tokenEnc = await encryptToken(accessToken)
      } catch (e) {
        return jsonError(500, 'Credential encryption failed: ' + (e as Error).message +
          ' — check the OWNPROPERLY_TOKEN_KEY supabase secret (must be 64 hex chars).')
      }

      const { error: cErr } = await admin.from('hostaway_connections').upsert({
        user_id: caller.id,
        company_id: companyId,
        account_id: accountId,
        client_secret: secretEnc ? null : clientSecret,
        client_secret_enc: secretEnc,
        access_token: tokenEnc ? null : accessToken,
        access_token_enc: tokenEnc,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        status: 'active',
        last_sync_status: null, last_sync_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,company_id' })
      if (cErr) throw cErr

      return jsonResp(200, { connected: true, properties })
    }

    const conn = await getConnection()

    if (action === 'list_properties') {
      if (!conn) return jsonError(404, 'Not connected to Hostaway yet')
      const properties = await withToken(admin, conn, t => fetchHostawayListings(t))
      return jsonResp(200, { properties })
    }

    if (action === 'save_mappings') {
      if (!conn) return jsonError(404, 'Not connected to Hostaway yet')
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

      await admin.from('hostaway_property_mappings').delete().eq('connection_id', conn.id)
      for (const m of mappings) {
        if (!m.hostaway_listing_id || !m.property_id) continue
        const { error: mErr } = await admin.from('hostaway_property_mappings').insert({
          connection_id: conn.id,
          user_id: caller.id,
          hostaway_listing_id: m.hostaway_listing_id,
          hostaway_listing_name: m.hostaway_listing_name || null,
          property_id: m.property_id,
        })
        if (mErr) throw mErr
      }
      return jsonResp(200, { saved: mappings.length })
    }

    if (action === 'sync') {
      if (!conn) return jsonError(404, 'Not connected to Hostaway yet')
      try {
        const r = await syncConnection(admin, conn)
        await admin.from('hostaway_connections').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'ok', last_sync_error: null,
          updated_at: new Date().toISOString(),
        }).eq('id', conn.id)
        return jsonResp(200, r)
      } catch (e) {
        await admin.from('hostaway_connections').update({
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
      const { error: dErr } = await admin.from('hostaway_connections')
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
