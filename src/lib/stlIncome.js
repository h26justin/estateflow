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
const DAY = 86400000
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
    case 'this_fortnight': return fortnightRange(today, 0)
    case 'last_fortnight': return fortnightRange(today, -1)
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

// ── Platform fees ───────────────────────────────────────────────────────────
// Airbnb (and Vrbo) deduct their host fee before paying out, so the payout is
// gross minus the fee. Booking.com and Expedia invoice their commission
// separately: the payout is the gross and the fee leaves later as a bill.
const FEE_DEDUCTED_AT_SOURCE = Object.freeze({ Airbnb: true, Vrbo: true, 'Booking.com': false, Expedia: false, Direct: false, Other: false })
export function feeDeductedAtSource(channel) {
  const c = channelLabel(channel)
  return FEE_DEDUCTED_AT_SOURCE[c] ?? false
}
// Fees on one booking. `known` is false when the sync has not yet stored a
// commission figure for it (older rows before the fee fields existed).
export function bookingFees(b) {
  const channel = b?.channel_commission == null ? null : num(b.channel_commission)
  const hostaway = b?.hostaway_commission == null ? null : num(b.hostaway_commission)
  const known = channel != null || hostaway != null
  const total = round2((channel || 0) + (hostaway || 0))
  return { channel: channel || 0, hostaway: hostaway || 0, total, known }
}
export function bookingNetAfterFees(b, rates = null) {
  return round2(num(b?.total_amount) - effectiveFees(b, rates).total)
}

// Observed fee rate per channel from bookings that carry a fee, so bookings
// whose commission has not been reported yet (Booking.com reports after the
// stay) can be estimated rather than counted as fee-free.
export const DEFAULT_CHANNEL_RATES = Object.freeze({ 'Booking.com': 15, Expedia: 15, Airbnb: 15.5, Vrbo: 8 })
export function observedChannelRates(bookings = []) {
  const acc = new Map()
  for (const b of bookings) {
    if (!isRevenueBooking(b)) continue
    const f = bookingFees(b)
    if (!f.known || !f.channel) continue
    const c = channelLabel(b.source)
    const row = acc.get(c) || { gross: 0, fees: 0 }
    row.gross += num(b.total_amount); row.fees += f.channel
    acc.set(c, row)
  }
  const out = {}
  for (const [c, r] of acc) if (r.gross > 0) out[c] = round2((r.fees / r.gross) * 100)
  return out
}
// Fees for a booking, estimating when the channel has not reported yet.
// `rates` = { channel: percent }. Estimation applies only to channels that
// invoice separately (their fee is not known until the invoice) and only
// when the booking carries no fee at all.
export function effectiveFees(b, rates = null) {
  const f = bookingFees(b)
  if (f.known || !rates) return { ...f, estimated: false }
  const c = channelLabel(b?.source)
  if (feeDeductedAtSource(c) || c === 'Direct' || c === 'Other') return { ...f, estimated: false }
  const pct = rates[c] ?? DEFAULT_CHANNEL_RATES[c]
  if (!pct) return { ...f, estimated: false }
  const est = round2(num(b.total_amount) * pct / 100)
  return { channel: est, hostaway: 0, total: est, known: false, estimated: true, rate: pct }
}

// Fortnights are anchored to Monday 5 January 2026 so "this fortnight" is
// stable regardless of when the page is opened. offset 0 = the fortnight
// containing `today`, -1 = the previous one.
export const FORTNIGHT_ANCHOR = '2026-01-05'
export function fortnightRange(today = new Date(), offset = 0) {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const a = Date.UTC(2026, 0, 5)
  const idx = Math.floor((t - a) / (14 * 86400000)) + offset
  const from = new Date(a + idx * 14 * 86400000)
  const to = new Date(from.getTime() + 13 * 86400000)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export function bookingNights(b) {
  if (!b?.arrival || !b?.departure) return 0
  const n = daysBetween(b.arrival, b.departure)
  return n > 0 ? n : 1
}

// Nights of a stay that actually fall INSIDE [from, to] (both ends inclusive
// days). A stay occupies the nights arrival..departure-1, so this is the
// overlap of [arrival, departure) with [from, to+1).
//
// Revenue is attributed by check-in month, which is the right call for money:
// a stay is one booking, billed once. Occupancy is a different question. A
// stay arriving 28 Sept for five nights puts three of them in October, and a
// stay arriving 30 Aug puts nights into September, so counting a booking's
// whole length against its arrival month both misses inbound spill and
// double-counts the same night in two months.
export function nightsInRange(b, from = null, to = null) {
  if (!b?.arrival || !b?.departure) return 0
  const a = parseISO(b.arrival), d = parseISO(b.departure)
  if (a == null || d == null) return 0
  let start = a
  let end = d > a ? d : a + DAY   // a zero-length stay counts 1 night, as bookingNights does
  if (from) { const f = parseISO(from); if (f != null && f > start) start = f }
  if (to) { const t = parseISO(to); if (t != null && t + DAY < end) end = t + DAY }
  const n = Math.round((end - start) / DAY)
  return n > 0 ? n : 0
}

// The ISO day n days after (or before) an ISO day. Stays in UTC throughout:
// parseISO builds a UTC instant, so reading it back with the local getters
// (as toISO does) would slip a day west of Greenwich.
export function addDaysISO(iso, n) {
  const t = parseISO(iso)
  if (t == null) return null
  const d = new Date(t + n * DAY)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
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
// on its bookings. Occupancy needs this.
//
// A property with no listing AND no bookings at all is not unknown, it is not
// open for bookings yet (a room still in refurb, or one never listed), so it
// counts 0 units and drops out of the occupancy denominator rather than
// blanking occupancy for the whole selection. It rejoins automatically the
// moment it is mapped or takes its first booking.
//
// null is reserved for the genuine unknown: a property that HAS bookings but
// whose bookings carry no listing id, where the unit count is unknowable.
export function unitCount(property, bookings = [], mappings = []) {
  if (!property) return null
  const mapped = mappings.filter(m => m.property_id === property.id).length
  if (mapped > 0) return mapped
  const seen = new Set()
  let any = false
  for (const b of bookings) {
    if (b.property_id !== property.id) continue
    any = true
    const id = b.hostaway_listing_id ?? b.lodgify_property_id
    if (id != null) seen.add(String(id))
  }
  if (seen.size > 0) return seen.size
  return any ? null : 0
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
 * Bookings are selected by ARRIVAL within [from, to] for every money figure;
 * adjustments by adjustment_date. Either bound may be null (open). roomCount
 * is the number of bookable units in the selection; when it is null occupancy
 * is null.
 *
 * Occupancy alone works off the FULL bookings list, counting nights that fall
 * inside the period whoever they arrived with. See nightsInRange.
 *
 * When the period runs past `today` the headline occupancy is "how full is it
 * currently booked", which reads low for a month barely begun, so
 * occupancyToDate gives the same measure over the nights already slept.
 */
export function summariseStl(bookings = [], adjustments = [], { from = null, to = null, roomCount = null, rates = null, today = new Date() } = {}) {
  const inPeriod = bookings.filter(b => inRange(b.arrival, from, to))
  const revenue = inPeriod.filter(isRevenueBooking)
  const nonRevenue = inPeriod.filter(b => !isRevenueBooking(b))
  const adj = adjustments.filter(a => inRange(a.adjustment_date, from, to))

  const gross = round2(revenue.reduce((s, b) => s + num(b.total_amount), 0))
  const nights = revenue.reduce((s, b) => s + bookingNights(b), 0)
  const adjustmentsTotal = round2(adj.reduce((s, a) => s + num(a.amount), 0))
  // Platform fees: channel (Airbnb, Booking.com…) and Hostaway. Split by
  // whether the channel deducts at source or invoices separately, so the
  // page can show cash received as well as true net.
  let channelFees = 0, hostawayFees = 0, feesDeducted = 0, feesInvoiced = 0, feesKnown = 0, feesEstimated = 0, feesEstimatedAmount = 0
  for (const b of revenue) {
    const f = effectiveFees(b, rates)
    if (f.known) feesKnown++
    if (f.estimated) { feesEstimated++; feesEstimatedAmount += f.total }
    channelFees += f.channel; hostawayFees += f.hostaway
    if (feeDeductedAtSource(b.source)) feesDeducted += f.total; else feesInvoiced += f.total
  }
  channelFees = round2(channelFees); hostawayFees = round2(hostawayFees)
  const platformFees = round2(channelFees + hostawayFees)
  feesDeducted = round2(feesDeducted); feesInvoiced = round2(feesInvoiced); feesEstimatedAmount = round2(feesEstimatedAmount)
  const netAfterFees = round2(gross - platformFees + adjustmentsTotal)
  const payoutReceived = round2(gross - feesDeducted + adjustmentsTotal)
  const net = netAfterFees

  // Channel breakdown, largest first.
  const chan = new Map()
  for (const b of revenue) {
    const c = channelLabel(b.source)
    const row = chan.get(c) || { channel: c, gross: 0, fees: 0, bookings: 0, nights: 0, deductedAtSource: feeDeductedAtSource(c) }
    row.gross += num(b.total_amount); row.fees += effectiveFees(b, rates).total; row.bookings += 1; row.nights += bookingNights(b)
    chan.set(c, row)
  }
  const byChannel = [...chan.values()]
    .map(r => ({ ...r, gross: round2(r.gross), fees: round2(r.fees), net: round2(r.gross - r.fees),
      feeRate: r.gross > 0 ? round2((r.fees / r.gross) * 100) : 0, share: gross > 0 ? r.gross / gross : 0 }))
    .sort((a, b) => b.gross - a.gross)

  // Month series. Explicit bounds win; otherwise span the data.
  let mFrom = from, mTo = to
  if (!mFrom || !mTo) {
    const dates = [...revenue.map(b => b.arrival), ...adj.map(a => a.adjustment_date)].filter(Boolean).sort()
    if (dates.length) { mFrom = mFrom || dates[0]; mTo = mTo || dates[dates.length - 1] }
  }
  const months = monthKeysBetween(mFrom, mTo).map(key => ({
    key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)),
    gross: 0, fees: 0, adjustments: 0, net: 0, bookings: 0, nights: 0,
  }))
  const byKey = new Map(months.map(m => [m.key, m]))
  for (const b of revenue) {
    const m = byKey.get(monthKey(b.arrival)); if (!m) continue
    m.gross += num(b.total_amount); m.fees += effectiveFees(b, rates).total; m.bookings += 1; m.nights += bookingNights(b)
  }
  for (const a of adj) {
    const m = byKey.get(monthKey(a.adjustment_date)); if (!m) continue
    m.adjustments += num(a.amount)
  }
  for (const m of months) { m.gross = round2(m.gross); m.fees = round2(m.fees); m.adjustments = round2(m.adjustments); m.net = round2(m.gross - m.fees + m.adjustments) }

  const days = periodDays(from, to)

  // Occupancy: nights that actually fall in the period, from every booking of
  // the selected properties, not just the ones that checked in during it.
  const allRevenue = bookings.filter(isRevenueBooking)
  const occupiedNights = allRevenue.reduce((s2, b) => s2 + nightsInRange(b, from, to), 0)
  const occupancy = roomCount > 0 && days > 0 ? round2((occupiedNights / (roomCount * days)) * 100) : null

  // ADR (average daily rate) is gross per night sold, both on the check-in
  // basis so they pair. RevPAR (revenue per available room-night) spreads the
  // period's gross over every room-night the rooms could have sold, so it is
  // the one number that moves with both price and occupancy.
  const adr = nights > 0 ? round2(gross / nights) : null
  const revpar = roomCount > 0 && days > 0 ? round2(gross / (roomCount * days)) : null

  // Same measure over the nights already slept, when the period runs ahead of
  // today. Tonight is still in progress, so the last completed night is the
  // one starting yesterday.
  const todayISO = today ? toISO(today) : null
  const lastNight = todayISO ? addDaysISO(todayISO, -1) : null
  const elapsedTo = lastNight && to && from && lastNight < to && lastNight >= from ? lastNight : null
  const elapsedDays = elapsedTo ? periodDays(from, elapsedTo) : 0
  const nightsToDate = elapsedTo ? allRevenue.reduce((s2, b) => s2 + nightsInRange(b, from, elapsedTo), 0) : 0
  const occupancyToDate = elapsedTo && roomCount > 0 && elapsedDays > 0
    ? round2((nightsToDate / (roomCount * elapsedDays)) * 100) : null

  // Per-month occupancy, on the same in-period basis: nights slept in that
  // calendar month over the month's room-nights. m.nights stays as it was
  // (whole stays, by check-in) because it pairs with that month's money.
  // The row total is occupancy ACHIEVED: nights already slept over the nights
  // that have already run. A month row can read low simply because it is in
  // the future and still filling, and averaging those in would make a healthy
  // year look like a failing one. Months before trading started are skipped
  // for the same reason: an empty January is not a vacancy.
  let achievedDays = 0, achievedNights = 0
  for (const m of months) {
    const mStart = `${m.key}-01`
    const mEnd = `${m.key}-${String(lastDayOfMonth(m.year, m.month)).padStart(2, '0')}`
    m.days = periodDays(mStart, mEnd)
    m.occupiedNights = allRevenue.reduce((s2, b) => s2 + nightsInRange(b, mStart, mEnd), 0)
    m.occupancy = roomCount > 0 && m.days > 0 ? round2((m.occupiedNights / (roomCount * m.days)) * 100) : null
    m.adr = m.nights > 0 ? round2(m.gross / m.nights) : null
    m.revpar = roomCount > 0 && m.days > 0 ? round2(m.gross / (roomCount * m.days)) : null

    const traded = m.occupiedNights > 0 || m.bookings > 0
    const ran = lastNight && lastNight >= mStart ? (lastNight < mEnd ? lastNight : mEnd) : null
    if (traded && ran) {
      achievedDays += periodDays(mStart, ran)
      achievedNights += allRevenue.reduce((s2, b) => s2 + nightsInRange(b, mStart, ran), 0)
    }
  }
  const occupancyAchieved = roomCount > 0 && achievedDays > 0
    ? round2((achievedNights / (roomCount * achievedDays)) * 100) : null

  return {
    gross, adjustmentsTotal, net, nights,
    platformFees, channelFees, hostawayFees, feesDeducted, feesInvoiced, feesKnown, feesEstimated, feesEstimatedAmount, netAfterFees, payoutReceived,
    bookings: revenue.length, nonRevenueCount: nonRevenue.length,
    byChannel, months, occupancy, periodDays: days, roomCount: roomCount ?? null,
    occupiedNights, occupancyToDate, nightsToDate, elapsedDays, occupancyAchieved, achievedDays, adr, revpar,
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

// ── Property manager payouts ────────────────────────────────────────────────
// A manager (e.g. someone taking 15% for management and cleaning) is paid a
// percentage of each assigned property's income in the period: by default
// income after platform fees and adjustments, or gross if the agreement says so.
// Bookings are counted by check-in date, the same convention as the month
// table. Returns one row per manager with a per-property breakdown.
export function managerPayouts(bookings = [], adjustments = [], properties = [], managers = [], { from = null, to = null, rates = null } = {}) {
  const byManager = new Map()
  for (const p of properties) {
    if (!p.stl_manager_id) continue
    const m = managers.find(x => x.id === p.stl_manager_id)
    if (!m || m.active === false) continue
    const own = bookings.filter(b => b.property_id === p.id)
    const ownAdj = adjustments.filter(a => a.property_id === p.id)
    const sum = summariseStl(own, ownAdj, { from, to, rates })
    const base = m.basis === 'gross' ? sum.gross : sum.netAfterFees
    const amount = round2(Math.max(0, base) * (num(m.percentage) / 100))
    const row = byManager.get(m.id) || { manager: m, properties: [], gross: 0, platformFees: 0, adjustments: 0, netAfterFees: 0, base: 0, amount: 0, bookings: 0, nights: 0, feesKnown: 0, feesUnknown: 0 }
    row.properties.push({ property: p, gross: sum.gross, platformFees: sum.platformFees, adjustments: sum.adjustmentsTotal, netAfterFees: sum.netAfterFees, base: round2(base), amount, bookings: sum.bookings, nights: sum.nights })
    row.gross = round2(row.gross + sum.gross); row.platformFees = round2(row.platformFees + sum.platformFees)
    row.adjustments = round2(row.adjustments + sum.adjustmentsTotal); row.netAfterFees = round2(row.netAfterFees + sum.netAfterFees)
    row.base = round2(row.base + base); row.amount = round2(row.amount + amount)
    row.bookings += sum.bookings; row.nights += sum.nights
    row.feesKnown += sum.feesKnown; row.feesUnknown += sum.bookings - sum.feesKnown - sum.feesEstimated; row.feesEstimated = (row.feesEstimated || 0) + sum.feesEstimated
    byManager.set(m.id, row)
  }
  return [...byManager.values()].sort((a, b) => a.manager.name.localeCompare(b.manager.name))
}

// ── Per-room breakdown ──────────────────────────────────────────────────────
// One row per property in the selection, each summarised over its own
// bookings so occupancy, ADR and RevPAR are the room's own. `units` is the
// room's listing count (unitCount): 0 means not open yet, null means the
// count is unknowable, and either way occupancy / RevPAR are null for it.
// Sorted by gross, largest first.
export function roomBreakdown(bookings = [], adjustments = [], properties = [], { from = null, to = null, rates = null, mappings = [], today = new Date() } = {}) {
  const rows = []
  for (const p of properties) {
    const units = unitCount(p, bookings, mappings)
    const own = bookings.filter(b => b.property_id === p.id)
    const ownAdj = adjustments.filter(a => a.property_id === p.id)
    const s = summariseStl(own, ownAdj, { from, to, roomCount: units || null, rates, today })
    rows.push({
      property: p, units, open: units > 0,
      bookings: s.bookings, nights: s.nights, occupiedNights: s.occupiedNights, occupancy: s.occupancy,
      gross: s.gross, platformFees: s.platformFees, adjustments: s.adjustmentsTotal, netAfterFees: s.netAfterFees,
      adr: s.adr, revpar: s.revpar,
      byChannel: s.byChannel.map(c => ({ channel: c.channel, share: c.share, gross: c.gross, bookings: c.bookings })),
    })
  }
  return rows.sort((a, b) => b.gross - a.gross || String(a.property.name || '').localeCompare(String(b.property.name || '')))
}

// ── Forward look ────────────────────────────────────────────────────────────
// What is already on the books from today: who is in house tonight, who
// arrives in the next seven days, and how full the next `horizon` nights are.
// Works off confirmed bookings only; enquiries and cancellations never count.
export function forwardLook(bookings = [], roomCount = null, { today = new Date(), horizon = 30 } = {}) {
  const t = toISO(today)
  const day = d => String(d || '').slice(0, 10)
  const rev = bookings.filter(isRevenueBooking)
  const inHouse = rev.filter(b => day(b.arrival) <= t && day(b.departure) > t)
  const departingToday = rev.filter(b => day(b.departure) === t)
  const end7 = addDaysISO(t, 6)
  const arrivalsNext7 = rev.filter(b => day(b.arrival) >= t && day(b.arrival) <= end7)
    .sort((a, b) => day(a.arrival).localeCompare(day(b.arrival)) || String(a.property_id).localeCompare(String(b.property_id)))
  const endH = addDaysISO(t, horizon - 1)
  const nightsAhead = rev.reduce((s, b) => s + nightsInRange(b, t, endH), 0)
  const availableNights = roomCount > 0 ? roomCount * horizon : null
  const forwardOccupancy = availableNights ? round2((nightsAhead / availableNights) * 100) : null
  const grossAhead = round2(rev.filter(b => day(b.arrival) >= t && day(b.arrival) <= endH).reduce((s, b) => s + num(b.total_amount), 0))
  return { today: t, horizon, inHouse, departingToday, arrivalsNext7, nightsAhead, availableNights, forwardOccupancy, grossAhead }
}

// ── Payout ledger helpers ───────────────────────────────────────────────────
// A ledger row records one manager paid for one exact period. The UI matches
// a computed payout row to its ledger entry by manager and period bounds.
export function findPaidPayout(ledger = [], managerId, from, to) {
  if (!managerId || !from || !to) return null
  return ledger.find(l => l.manager_id === managerId && String(l.period_from).slice(0, 10) === from && String(l.period_to).slice(0, 10) === to) || null
}
// The snapshot stored with a ledger row, so a later rate change or a
// late-arriving Booking.com invoice cannot restate what was actually paid.
export function payoutSnapshot(row) {
  return row.properties.map(pp => ({
    property_id: pp.property.id, name: pp.property.name || pp.property.address || '',
    gross: pp.gross, platform_fees: pp.platformFees, adjustments: pp.adjustments, net_after_fees: pp.netAfterFees,
    base: pp.base, amount: pp.amount, bookings: pp.bookings, nights: pp.nights,
  }))
}
