// Short-Term Let income arithmetic (Rent Tracker rebuild, Stage 6).
//
// Pure functions over stl_bookings rows and stl_adjustments rows. No
// Supabase import so the whole file is unit-testable.
//
// Conventions, matching the hostaway-sync edge function:
//   - Figures are GROSS booking values (Hostaway totalPrice). Channel
//     commission is NOT deducted. Refunds, chargebacks, fees and payout
//     differences are entered by hand as stl_adjustments (negative = money
//     back out) and net = gross + adjustments.
//   - A booking is income when its status is new / modified / confirmed
//     (Hostaway) or Booked (Lodgify). Cancelled, expired, declined and all
//     inquiry* statuses are recorded but earn nothing.
//   - A booking belongs to the month its ARRIVAL falls in. That is how the
//     sync stamps the paid rent_payments segment (monthParts(arrival)), so a
//     month here ties to the same month on the Rent Tracker.
//   - Nights = departure - arrival, minimum one (a same-day stay is one
//     night, mirroring the sync's period_end floor).

export const STL_COLOR = '#9B6FDE'
export const STL_STATUS = 'short_term_let'

export const REVENUE_STATUSES = Object.freeze(new Set(['new', 'modified', 'confirmed', 'booked']))

export const ADJUSTMENT_KINDS = Object.freeze([
  { v: 'refund',            l: 'Refund',            negative: true,  hint: 'Money returned to the guest' },
  { v: 'chargeback',        l: 'Chargeback',        negative: true,  hint: 'Card dispute clawed back by the channel' },
  { v: 'fee',               l: 'Fee',               negative: false, hint: 'Cleaning / damage / extra charge collected' },
  { v: 'payout_difference', l: 'Payout difference', negative: false, hint: 'Channel paid out more or less than the booking value' },
  { v: 'adjustment',        l: 'Other adjustment',  negative: false, hint: 'Anything else, either sign' },
])

export const KNOWN_CHANNELS = Object.freeze(['Airbnb', 'Booking.com', 'Vrbo', 'Expedia', 'Direct', 'Other'])

// ── Dates (ISO 'YYYY-MM-DD' strings, UTC arithmetic so DST never bites) ─────
export function parseISO(d) {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d))
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
export function toISO(date) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function daysBetween(fromISO, toISO_) {
  const a = parseISO(fromISO), b = parseISO(toISO_)
  if (a == null || b == null) return 0
  return Math.round((b - a) / 86400000)
}
// Inclusive day count of a period, 0 when either end is missing or reversed.
export function periodDays(from, to) {
  if (!from || !to) return 0
  const d = daysBetween(from, to) + 1
  return d > 0 ? d : 0
}
export function monthKey(d) {
  return d ? String(d).slice(0, 7) : null
}
function inRange(d, from, to) {
  if (!d) return false
  const s = String(d).slice(0, 10)
  if (from && s < from) return false
  if (to && s > to) return false
  return true
}
function lastDayOfMonth(y, m) { // m 1-12
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// Preset period ranges. `today` is injectable for tests.
export function periodRange(kind, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth() + 1
  const pad = n => String(n).padStart(2, '0')
  switch (kind) {
    case 'this_month': return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` }
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDayOfMonth(ly, lm))}` }
    }
    case 'ytd': return { from: `${y}-01-01`, to: toISO(today) }
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` }
    default: return { from: null, to: null }
  }
}

// ── Bookings ────────────────────────────────────────────────────────────────
export function isRevenueBooking(b) {
  if (!b) return false
  const s = String(b.status || '').toLowerCase()
  if (!REVENUE_STATUSES.has(s)) return false
  if (b.cancellation_date || b.cancelled_at || b.canceled_at) return false
  return true
}

export function isCancelled(b) {
  const s = String(b?.status || '').toLowerCase()
  return s.includes('cancel') || s === 'declined' || s === 'expired' || !!b?.cancellation_date
}
export function isInquiry(b) {
  return String(b?.status || '').toLowerCase().startsWith('inquiry')
}

// Normalise the channel text the syncs store ('Direct site', 'bookingcom',
// 'AirbnbIntegration', ...) to one display label.
export function channelLabel(source) {
  const raw = String(source || '').trim()
  if (!raw) return 'Other'
  const k = raw.toLowerCase().replace(/[\s._-]/g, '')
  if (['direct', 'directsite', 'bookingengine', 'manual', 'oh', 'ownwebsite', 'wordpress', 'hostaway'].includes(k)) return 'Direct'
  if (k === 'bookingcom' || k === 'booking') return 'Booking.com'
  if (k.startsWith('airbnb')) return 'Airbnb'
  if (k.startsWith('vrbo') || k === 'homeaway' || k === 'homeawayical') return 'Vrbo'
  if (k.startsWith('expedia')) return 'Expedia'
  if (k.startsWith('tripadvisor')) return 'TripAdvisor'
  return raw
}

export function bookingNights(b) {
  if (!b?.arrival || !b?.departure) return 0
  const n = daysBetween(b.arrival, b.departure)
  return n > 0 ? n : 1
}

export function bookingReference(b) {
  if (!b) return ''
  if (b.hostaway_reservation_id) return `Hostaway #${b.hostaway_reservation_id}`
  if (b.lodgify_booking_id) return `Lodgify #${b.lodgify_booking_id}`
  return b.id ? `#${String(b.id).slice(0, 8)}` : ''
}

// "John Alexander Smith" -> "J. Smith". Members may see this page, so full
// guest names never render. A single word is returned as-is.
export function guestDisplayName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Guest'
  if (parts.length === 1) return parts[0]
  return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`
}

export function bookingStatusLabel(b) {
  if (isRevenueBooking(b)) return 'Confirmed'
  if (isCancelled(b)) return 'Cancelled'
  if (isInquiry(b)) return 'Inquiry'
  const s = String(b?.status || 'unknown')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Distinct bookable units a property presents on the channel manager: the
// mapped Hostaway listings if we have them, else the distinct listing ids seen
// on its bookings, else null (unknown). Occupancy needs this.
export function unitCount(property, bookings = [], mappings = []) {
  if (!property) return null
  const mapped = mappings.filter(m => m.property_id === property.id).length
  if (mapped > 0) return mapped
  const seen = new Set()
  for (const b of bookings) {
    if (b.property_id !== property.id) continue
    const id = b.hostaway_listing_id ?? b.lodgify_property_id
    if (id != null) seen.add(String(id))
  }
  if (seen.size > 0) return seen.size
  return null
}

// ── Summary ─────────────────────────────────────────────────────────────────
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const round2 = n => Math.round(n * 100) / 100

function monthKeysBetween(from, to) {
  const keys = []
  if (!from || !to) return keys
  let [y, m] = from.slice(0, 7).split('-').map(Number)
  const [ty, tm] = to.slice(0, 7).split('-').map(Number)
  let guard = 0
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 600) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return keys
}

/**
 * summariseStl(bookings, adjustments, { from, to, roomCount })
 *
 * Bookings are selected by ARRIVAL within [from, to]; adjustments by
 * adjustment_date. Either bound may be null (open). roomCount is the number
 * of bookable units in the selection; when it is null occupancy is null.
 */
export function summariseStl(bookings = [], adjustments = [], { from = null, to = null, roomCount = null } = {}) {
  const inPeriod = bookings.filter(b => inRange(b.arrival, from, to))
  const revenue = inPeriod.filter(isRevenueBooking)
  const nonRevenue = inPeriod.filter(b => !isRevenueBooking(b))
  const adj = adjustments.filter(a => inRange(a.adjustment_date, from, to))

  const gross = round2(revenue.reduce((s, b) => s + num(b.total_amount), 0))
  const nights = revenue.reduce((s, b) => s + bookingNights(b), 0)
  const adjustmentsTotal = round2(adj.reduce((s, a) => s + num(a.amount), 0))
  const net = round2(gross + adjustmentsTotal)

  // Channel breakdown, largest first.
  const chan = new Map()
  for (const b of revenue) {
    const c = channelLabel(b.source)
    const row = chan.get(c) || { channel: c, gross: 0, bookings: 0, nights: 0 }
    row.gross += num(b.total_amount); row.bookings += 1; row.nights += bookingNights(b)
    chan.set(c, row)
  }
  const byChannel = [...chan.values()]
    .map(r => ({ ...r, gross: round2(r.gross), share: gross > 0 ? r.gross / gross : 0 }))
    .sort((a, b) => b.gross - a.gross)

  // Month series. Explicit bounds win; otherwise span the data.
  let mFrom = from, mTo = to
  if (!mFrom || !mTo) {
    const dates = [...revenue.map(b => b.arrival), ...adj.map(a => a.adjustment_date)].filter(Boolean).sort()
    if (dates.length) { mFrom = mFrom || dates[0]; mTo = mTo || dates[dates.length - 1] }
  }
  const months = monthKeysBetween(mFrom, mTo).map(key => ({
    key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)),
    gross: 0, adjustments: 0, net: 0, bookings: 0, nights: 0,
  }))
  const byKey = new Map(months.map(m => [m.key, m]))
  for (const b of revenue) {
    const m = byKey.get(monthKey(b.arrival)); if (!m) continue
    m.gross += num(b.total_amount); m.bookings += 1; m.nights += bookingNights(b)
  }
  for (const a of adj) {
    const m = byKey.get(monthKey(a.adjustment_date)); if (!m) continue
    m.adjustments += num(a.amount)
  }
  for (const m of months) { m.gross = round2(m.gross); m.adjustments = round2(m.adjustments); m.net = round2(m.gross + m.adjustments) }

  const days = periodDays(from, to)
  const occupancy = roomCount > 0 && days > 0 ? round2((nights / (roomCount * days)) * 100) : null

  return {
    gross, adjustmentsTotal, net, nights,
    bookings: revenue.length, nonRevenueCount: nonRevenue.length,
    byChannel, months, occupancy, periodDays: days, roomCount: roomCount ?? null,
    revenueBookings: revenue, nonRevenueBookings: nonRevenue, adjustments: adj,
  }
}

// Year to date: 1 Jan of `year` to today when `year` is the current year,
// otherwise the whole year.
export function ytd(bookings, adjustments, year, { roomCount = null, today = new Date() } = {}) {
  const y = Number(year)
  const from = `${y}-01-01`
  const to = y === today.getFullYear() ? toISO(today) : `${y}-12-31`
  return summariseStl(bookings, adjustments, { from, to, roomCount })
}

// Free-text search over guest, reference, channel, status and property name.
export function bookingMatches(b, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const hay = [
    b.guest_name, bookingReference(b), b.hostaway_reservation_id, b.lodgify_booking_id,
    channelLabel(b.source), b.source, b.status, b.property?.name, b.property?.address, b.arrival, b.departure,
  ].filter(Boolean).join(' ').toLowerCase()
  return q.split(/\s+/).every(tok => hay.includes(tok))
}
