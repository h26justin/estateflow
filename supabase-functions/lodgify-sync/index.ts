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
//   • one booking can never abort the run (same rules as hostaway-sync):
//     same-night clashes are reported as conflicts, per-booking errors are
//     collected and retried, live bookings left without a segment are
//     repaired at the end of each run
//   • only GBP bookings become rent (amount is pounds; no conversion) —
//     others are recorded in stl_bookings and counted as skippedNonGbp
//   • a booking whose Lodgify property is no longer mapped loses its
//     segment; mappings are re-checked against the connection's company and
//     user before anything is written for them
//
// Env vars:
//   OWNPROPERLY_TOKEN_KEY  (shared AES-GCM key — api keys stored encrypted)
//   CRON_SECRET            (shared cron auth secret)
//
// Lodgify docs: https://docs.lodgify.com/reference/getallasync

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encryptToken, resolveToken } from './encryption.ts'
import { secretMatches } from './secrets.ts'

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
// Same behaviour as hostaway-sync (15 Sept 2026 fix), with Lodgify's field
// mapping:
// partial = the page cap was reached, so not every changed booking was
// fetched; last_synced_at is then left where it was.
// skippedNonGbp = live bookings in another currency: recorded in
// stl_bookings (with their currency) but never written as rent, because
// rent_payments.amount is pounds and we do not convert.
// rejectedMappings = mappings whose property is outside this connection's
// company, or that the connection's user can no longer write to.
type SyncResult = { bookings: number; created: number; updated: number; removed: number; skippedUnmapped: number; skippedNonGbp: number; repaired: number; partial: boolean; rejectedMappings: string[]; conflicts: string[]; errors: string[] }
type SegmentOutcome = 'created' | 'updated' | 'removed' | 'conflict' | 'none' | 'non_gbp'

// A missing currency has always been stored as GBP (see the upsert below),
// so it is treated as GBP here too.
const isGbp = (currency: any) => !currency || String(currency).trim().toUpperCase() === 'GBP'

// Lodgify list page size and cap (40 x 50 bookings per run).
const PAGE_SIZE = 50
const MAX_PAGES = 40

const isUniqueViolation = (e: any) => e?.code === '23505' || /duplicate key value/i.test(String(e?.message || ''))

// Statuses stl_bookings rows carry for a live booking (Lodgify + Hostaway).
const ROW_ACTIVE = new Set(['Booked', 'new', 'modified', 'confirmed'])

// The mapping rows are re-checked here before anything is written for them:
// save_mappings validates ownership, but a mapping row could also have been
// written directly by a client. A mapping is used only when its property is
// in the same company as the connection and the connection's user can still
// write to it (the company owner, an owner / admin / editor member, or the
// property's own user — the same tiers as has_company_write /
// has_property_permission, evaluated with the service role because the cron
// run has no user session).
async function checkedMappings(admin: any, conn: any, mappings: any[]): Promise<{ propMap: Map<number, string>; rejected: string[]; rejectedListings: Set<number> }> {
  const propMap = new Map<number, string>()
  const rejected: string[] = []
  const rejectedListings = new Set<number>()
  const propIds = [...new Set(mappings.map((m: any) => m.property_id).filter(Boolean))]
  if (!propIds.length) return { propMap, rejected, rejectedListings }

  const [{ data: props, error: pErr }, { data: company, error: cErr }, { data: access, error: aErr }] = await Promise.all([
    admin.from('properties').select('id, user_id, company_id').in('id', propIds),
    admin.from('companies').select('*').eq('id', conn.company_id).maybeSingle(),
    admin.from('user_company_access').select('*').eq('company_id', conn.company_id).eq('user_id', String(conn.user_id)).limit(1),
  ])
  if (pErr) throw pErr
  if (cErr) throw cErr
  if (aErr) throw aErr

  const member = (access || [])[0]
  const memberRole = member ? (member.role || (member.is_admin ? 'admin' : 'editor')) : null
  const companyWrite = !!company && !company.deleted_at && (
    company.owner_id === conn.user_id || company.user_id === conn.user_id
    || (!!member && (member.is_owner === true || ['owner', 'admin', 'editor'].includes(memberRole))))

  const byId = new Map<string, any>((props || []).map((p: any) => [p.id, p]))
  for (const m of mappings) {
    const lodgifyPropId = Number(m.lodgify_property_id)
    const prop = byId.get(m.property_id)
    const ok = !!prop && !!conn.company_id && prop.company_id === conn.company_id
      && (companyWrite || (!!company && !company.deleted_at && prop.user_id === conn.user_id))
    if (ok) propMap.set(lodgifyPropId, m.property_id)
    else { rejectedListings.add(lodgifyPropId); rejected.push(`Lodgify property ${lodgifyPropId}`) }
  }
  return { propMap, rejected, rejectedListings }
}

// Same removal path as a cancellation: hard-delete the segment and unlink it
// (same as deleteRentSegment in the app).
async function removeSegment(admin: any, row: any) {
  const { error } = await admin.from('rent_payments').delete().eq('id', row.rent_payment_id)
  if (error) throw error
  await admin.from('stl_bookings').update({ rent_payment_id: null }).eq('id', row.id)
}

function buildSegment(o: { propertyId: string; userId: string; arrival: string; departure: string; total: number | null; source: string; guest: string | null; ref: string }) {
  // Last night of the stay, so a same-day changeover's next arrival
  // doesn't overlap this segment in the Day Tracker.
  const periodEnd = o.departure > o.arrival ? minusOneDay(o.departure) : o.arrival
  return {
    property_id: o.propertyId,
    user_id: o.userId,
    ...monthParts(o.arrival),
    // STL bookings are paid upfront (Airbnb/Booking.com collect before the
    // stay), so every confirmed booking counts as income — no
    // pending/partial split. The UI shows STL segments in their own colour
    // via the stl_bookings link, not via status.
    status: 'paid',
    amount: o.total,
    notes: `STL · ${o.source} · ${o.guest || 'Guest'} · ${o.arrival} → ${o.departure} · ${o.ref}`,
    period_start: o.arrival,
    period_end: periodEnd,
  }
}

// Write (or refresh) the rent segment for a live booking row without ever
// throwing on the (property, period_start, period_end) unique index — the
// throw used to abort the whole connection's run, so last_synced_at never
// advanced and every later booking stopped being written. If the existing
// segment belongs to a booking that is still live we record a conflict and
// count only the earlier booking; if it is orphaned or its booking has
// since cancelled we take the segment over.
async function writeSegment(admin: any, row: any, segment: any, label: string, conflicts: string[]): Promise<SegmentOutcome> {
  if (row.rent_payment_id) {
    const { data: seg, error } = await admin.from('rent_payments')
      .update(segment).eq('id', row.rent_payment_id).select('id').maybeSingle()
    if (error) {
      if (!isUniqueViolation(error)) throw error
      conflicts.push(`${label} has moved onto nights another booking already holds; its segment was left as it was`)
      return 'conflict'
    }
    if (seg) return 'updated'
    // Segment was deleted manually — fall through and recreate it.
  }

  const { data: existing } = await admin.from('rent_payments').select('id')
    .eq('property_id', segment.property_id).eq('period_start', segment.period_start).eq('period_end', segment.period_end)
    .maybeSingle()
  if (existing) {
    const { data: owner } = await admin.from('stl_bookings')
      .select('id, hostaway_reservation_id, lodgify_booking_id, guest_name, status')
      .eq('rent_payment_id', existing.id).neq('id', row.id).maybeSingle()
    if (owner && ROW_ACTIVE.has(String(owner.status))) {
      conflicts.push(`${label} and #${owner.lodgify_booking_id ?? owner.hostaway_reservation_id} ${owner.guest_name || 'Guest'} are both booked for the same nights; only the earlier booking is counted as income until one of them is cancelled`)
      return 'conflict'
    }
    const { error: adoptErr } = await admin.from('rent_payments').update(segment).eq('id', existing.id)
    if (adoptErr) throw adoptErr
    if (owner) await admin.from('stl_bookings').update({ rent_payment_id: null }).eq('id', owner.id)
    await admin.from('stl_bookings').update({ rent_payment_id: existing.id }).eq('id', row.id)
    return 'updated'
  }

  const { data: seg, error: segErr } = await admin.from('rent_payments').insert(segment).select('id').single()
  if (segErr) {
    if (isUniqueViolation(segErr)) { conflicts.push(`${label}: another segment already covers these nights`); return 'conflict' }
    throw segErr
  }
  await admin.from('stl_bookings').update({ rent_payment_id: seg.id }).eq('id', row.id)
  return 'created'
}

// Live bookings that still have no segment (a conflict that has since
// cleared, or a cancellation that arrived after the re-let): give them their
// segment now so a same-night clash heals itself on the next run.
async function repairMissingSegments(admin: any, conn: any, propMap: Map<number, string>, conflicts: string[], errors: string[]): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const { data: rows } = await admin.from('stl_bookings').select('*')
    .eq('connection_id', conn.id).is('rent_payment_id', null)
    .eq('status', 'Booked').gte('arrival', since)
    .order('created_at', { ascending: true })
  let repaired = 0
  for (const row of (rows || [])) {
    if (!row.arrival || !row.departure) continue
    // Never repair a booking in another currency, or one whose Lodgify
    // property is no longer (validly) mapped to the property it was recorded
    // against.
    if (!isGbp(row.currency)) continue
    if (propMap.get(Number(row.lodgify_property_id)) !== row.property_id) continue
    const srcLabel = SOURCE_LABELS[row.source] || row.source || 'Lodgify'
    const label = `#${row.lodgify_booking_id} ${row.guest_name || 'Guest'} (${srcLabel}) ${row.arrival} → ${row.departure}`
    try {
      const segment = buildSegment({ propertyId: row.property_id, userId: row.user_id, arrival: row.arrival, departure: row.departure,
        total: row.total_amount == null ? null : Number(row.total_amount), source: srcLabel, guest: row.guest_name, ref: `Lodgify #${row.lodgify_booking_id}` })
      const outcome = await writeSegment(admin, row, segment, label, conflicts)
      if (outcome === 'created' || outcome === 'updated') repaired++
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`)
    }
  }
  return repaired
}

async function syncConnection(admin: any, conn: any): Promise<SyncResult> {
  const apiKey = await resolveToken({ encrypted: conn.api_key_enc, plaintext: conn.api_key })
  if (!apiKey) throw new Error('No usable API key stored for this connection')

  const { data: mappings, error: mapErr } = await admin.from('lodgify_property_mappings')
    .select('lodgify_property_id, property_id')
    .eq('connection_id', conn.id)
  if (mapErr) throw mapErr
  if (!(mappings || []).length) throw new Error('No property mappings yet — map your Lodgify property to an OwnProperly property first')
  const { propMap, rejected: rejectedMappings, rejectedListings } = await checkedMappings(admin, conn, mappings || [])

  // Incremental after the first sync: anything updated since last sync minus
  // a 48h overlap buffer. trash=All so trashed bookings still come through
  // and we can remove their rent segments.
  let query = `stayFilter=All&trash=All&includeCount=false&size=${PAGE_SIZE}`
  if (conn.last_synced_at) {
    const since = new Date(new Date(conn.last_synced_at).getTime() - 48 * 3600 * 1000)
    query += `&updatedSince=${encodeURIComponent(since.toISOString())}`
  }

  // partial: the page cap was reached while Lodgify still had more to give.
  // The cursor is then not moved, so nothing is silently lost.
  const bookings: any[] = []
  let exhausted = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await lodgifyGet(apiKey, `/v2/reservations/bookings?page=${page}&${query}`)
    const items = listItems(json)
    bookings.push(...items)
    if (items.length < PAGE_SIZE) { exhausted = true; break }
  }
  const partial = !exhausted

  let created = 0, updated = 0, removed = 0, skippedUnmapped = 0, skippedNonGbp = 0
  const conflicts: string[] = []
  const errors: string[] = []

  // Cancellations first, so a night that has been re-let to a new guest is
  // freed before the new booking asks for it.
  const live = (b: any) => b.status === 'Booked' && !b.is_deleted && !b.canceled_at ? 1 : 0
  const ordered = [...bookings].sort((a, b) => live(a) - live(b) || (Number(a.id) || 0) - (Number(b.id) || 0))

  for (const b of ordered) {
    const lodgifyPropId = Number(b.property_id)
    // A mapping that failed the ownership check: write nothing for it.
    if (rejectedListings.has(lodgifyPropId)) continue
    const propertyId = propMap.get(lodgifyPropId)
    if (!propertyId) {
      skippedUnmapped++
      // The booking moved to an unmapped Lodgify property, or its mapping
      // was removed: take its revenue segment out, same as a cancellation.
      if (!b.id) continue
      try {
        const { data: prev, error: prevErr } = await admin.from('stl_bookings').select('id, rent_payment_id')
          .eq('connection_id', conn.id).eq('lodgify_booking_id', b.id).maybeSingle()
        if (prevErr) throw prevErr
        if (prev?.rent_payment_id) { await removeSegment(admin, prev); removed++ }
      } catch (e) {
        errors.push(`#${b.id} ${b.guest?.name || 'Guest'}: ${(e as Error).message}`)
      }
      continue
    }

    const arrival = dateOnly(b.arrival)
    const departure = dateOnly(b.departure)
    if (!arrival || !departure || !b.id) continue

    // One booking must never take the whole run down: problems are
    // collected and reported on the connection row instead.
    try {
      const outcome = await syncBooking(admin, conn, b, propertyId, lodgifyPropId, arrival, departure, conflicts)
      if (outcome === 'created') created++
      else if (outcome === 'updated') updated++
      else if (outcome === 'removed') removed++
      else if (outcome === 'non_gbp') skippedNonGbp++
    } catch (e) {
      errors.push(`#${b.id} ${b.guest?.name || 'Guest'} ${arrival}: ${(e as Error).message}`)
    }
  }

  const repaired = await repairMissingSegments(admin, conn, propMap, conflicts, errors)

  return { bookings: bookings.length, created, updated, removed, skippedUnmapped, skippedNonGbp, repaired, partial, rejectedMappings, conflicts, errors }
}

// Upsert one Lodgify booking into stl_bookings and keep its rent segment in
// step with it. Returns what happened to the segment.
async function syncBooking(admin: any, conn: any, b: any, propertyId: string, lodgifyPropId: number, arrival: string, departure: string, conflicts: string[]): Promise<SegmentOutcome> {
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

  if (!isActive) {
    if (!row.rent_payment_id) return 'none'
    // Canceled / declined / trashed after we recorded it — remove the
    // revenue segment.
    await removeSegment(admin, row)
    return 'removed'
  }

  // Booking in another currency: rent_payments.amount is pounds and we do
  // not convert, so it is recorded above (with its currency) but never
  // written as rent. A segment written before this rule is taken out.
  if (!isGbp(row.currency)) {
    if (row.rent_payment_id) await removeSegment(admin, row)
    return 'non_gbp'
  }

  const srcLabel = SOURCE_LABELS[b.source] || b.source || 'Lodgify'
  const segment = buildSegment({ propertyId, userId: conn.user_id, arrival, departure, total, source: srcLabel, guest: b.guest?.name || null, ref: `Lodgify #${b.id}` })
  const label = `#${b.id} ${b.guest?.name || 'Guest'} (${srcLabel}) ${arrival} → ${departure}`
  return await writeSegment(admin, row, segment, label, conflicts)
}

// What the run did, written to the connection so the Integrations panel can
// show it. 'partial' = the run completed but some bookings could not be
// written as income.
async function recordSyncOutcome(admin: any, conn: any, r: SyncResult) {
  const now = new Date().toISOString()
  const notes: string[] = []
  if (r.errors.length) notes.push(`${r.errors.length} booking(s) could not be updated and will be retried: ${r.errors.slice(0, 5).join(' · ')}${r.errors.length > 5 ? ' …' : ''}`)
  if (r.partial) notes.push(`Not every changed booking could be fetched in this run (limit ${MAX_PAGES * PAGE_SIZE}); the next sync starts from the same point`)
  if (r.rejectedMappings.length) notes.push(`${r.rejectedMappings.length} mapping(s) skipped because the property is not in this company or can no longer be edited by the connected user: ${r.rejectedMappings.slice(0, 5).join(', ')}`)
  if (r.conflicts.length) notes.push(`${r.conflicts.length} same-night booking clash(es): ${r.conflicts.slice(0, 5).join(' · ')}${r.conflicts.length > 5 ? ' …' : ''}`)
  if (r.skippedNonGbp) notes.push(`${r.skippedNonGbp} booking(s) in a currency other than GBP were not recorded as rent`)
  const patch: Record<string, unknown> = { updated_at: now }
  // Errors or a capped fetch: keep the cursor where it was so the missed
  // bookings come through again on the next run. (Skipped mappings do
  // advance it: fixing a mapping via save_mappings resets the cursor.)
  if (r.errors.length || r.partial) { patch.last_sync_status = 'partial'; patch.last_sync_error = notes.join(' | ') }
  else if (r.conflicts.length || r.skippedNonGbp || r.rejectedMappings.length) { patch.last_synced_at = now; patch.last_sync_status = 'partial'; patch.last_sync_error = notes.join(' | ') }
  else { patch.last_synced_at = now; patch.last_sync_status = 'ok'; patch.last_sync_error = null }
  await admin.from('lodgify_connections').update(patch).eq('id', conn.id)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Cron mode: sync every active connection ─────────────────────────────
  const cronHeader = req.headers.get('x-cron-secret') || ''
  if (cronHeader) {
    if (!secretMatches(cronHeader, CRON_SECRET)) return jsonError(403, 'Bad cron secret')
    const { data: conns } = await admin.from('lodgify_connections')
      .select('*').eq('status', 'active')
    const results: Record<string, unknown> = {}
    for (const conn of (conns || [])) {
      try {
        const r = await syncConnection(admin, conn)
        results[conn.id] = r
        await recordSyncOutcome(admin, conn, r)
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
        console.error('Lodgify key encryption failed (check OWNPROPERLY_TOKEN_KEY):', (e as Error).message)
        return jsonError(500, 'The connection could not be stored securely. Please contact support.')
      }

      // Reconnecting, possibly to a different Lodgify account (Lodgify keys
      // carry no account id): drop mappings for Lodgify properties this key
      // cannot see, since they belong to another account.
      const existing = await getConnection()
      // (Skipped if the property list may have been truncated at its 500 cap.)
      if (existing && properties.length < 500) {
        const visible = properties.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n))
        let del = admin.from('lodgify_property_mappings').delete().eq('connection_id', existing.id)
        if (visible.length) del = del.not('lodgify_property_id', 'in', `(${visible.join(',')})`)
        const { error: mdErr } = await del
        if (mdErr) throw mdErr
      }

      const { error: cErr } = await admin.from('lodgify_connections').upsert({
        user_id: caller.id,
        company_id: companyId,
        api_key: enc ? null : apiKey,
        api_key_enc: enc,
        // Fresh cursor: the next sync pulls the account's full history rather
        // than only activity since the previous key's last sync.
        last_synced_at: null,
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
      // Mappings changed: reset the cursor so the next sync re-reads every
      // booking — newly mapped properties get their history, and bookings on
      // properties that are no longer mapped have their segments removed.
      await admin.from('lodgify_connections').update({ last_synced_at: null, updated_at: new Date().toISOString() }).eq('id', conn.id)
      return jsonResp(200, { saved: mappings.length })
    }

    if (action === 'sync') {
      if (!conn) return jsonError(404, 'Not connected to Lodgify yet')
      try {
        const r = await syncConnection(admin, conn)
        await recordSyncOutcome(admin, conn, r)
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
