// ── PROPERTY STATUS HELPERS ───────────────────────────────────────────────
// Single source of truth for how each property status is treated in
// calculations and visuals. If you ever want to change which statuses count
// as "earning rent" or "occupied", change it here — every component in the
// app reads from these helpers.
//
// Statuses:
//   purchased     — bought, not yet refurbished or tenanted
//   refurb        — actively undergoing renovation
//   let_agreed    — tenant found, contracts being signed, no rent yet
//   rented        — actively tenanted, rent flowing
//   short_term_let— operated as short-term accommodation (Airbnb/Lodgify);
//                   income arrives as booking payments, not monthly rent
//   notice_given  — tenant has given notice, still paying rent for now
//   on_rental_market — ready to rent and being marketed; no tenant paying,
//                   rent not expected. The non-collectible months are held
//                   as a DATED non_chargeable_periods row (reason on_market)
//                   opened and closed on the status change, so switching
//                   status never rewrites earlier months.
//   vacant        — empty, no tenant lined up
//   sold          — disposed of, not in the active portfolio

// All recognised statuses. Used for select dropdowns and validation.
// Order matches the typical lifecycle of a property.
export const PROPERTY_STATUSES = [
  'purchased',
  'refurb',
  'let_agreed',
  'rented',
  'short_term_let',
  'notice_given',
  'on_rental_market',
  'vacant',
  'sold',
]

// Human-readable label for each status. Used wherever the raw value
// would be ugly (e.g. "let_agreed" → "Let agreed").
export const PROPERTY_STATUS_LABELS = {
  purchased:    'Purchased',
  refurb:       'Refurb',
  let_agreed:     'Let agreed',
  rented:         'Rented',
  short_term_let: 'Short-Term Let',
  notice_given:   'Notice given',
  on_rental_market: 'On rental market',
  vacant:       'Vacant',
  sold:         'Sold',
}

// Visual colour key (theme tokens not imported here — components apply
// their theme tints over these named buckets). 'positive' = good/green,
// 'caution' = amber/heads-up, 'negative' = needs attention/red,
// 'neutral' = informational/blue, 'inactive' = grey/historical.
export const PROPERTY_STATUS_TONE = {
  purchased:    'neutral',
  refurb:       'neutral',
  let_agreed:     'caution',   // imminent rent — heads-up signal, not yet positive
  rented:         'positive',
  short_term_let: 'positive',  // operating and earning via bookings
  notice_given:   'caution',   // still rented but vacancy looming
  on_rental_market: 'caution', // actively being let: a heads-up, not a problem yet
  vacant:       'negative',
  sold:         'inactive',
}

/**
 * Is this property currently earning rent?
 *
 * notice_given still earns: the tenant is contractually obliged to pay
 * through their notice period. let_agreed does NOT earn: no tenant has
 * actually moved in yet.
 *
 * short_term_let does NOT count here on purpose: its income arrives as
 * actual booking payments (Lodgify sync marks months paid), not as a
 * monthly rent_pcm expectation — counting it would project phantom rent
 * and flag unbooked months as overdue.
 *
 * Used by: monthly/annual rent income calculations, rent roll, arrears.
 */
export function isPropertyEarningRent(status) {
  return status === 'rented' || status === 'notice_given'
}

/**
 * Is this property currently occupied?
 *
 * Diverges from isPropertyEarningRent for short_term_let: an STL property
 * is in use (guests, not tenants) so it counts as occupied for occupancy
 * KPIs and never as vacant — but it doesn't earn a monthly rent_pcm, so
 * it stays out of rent-roll projections.
 *
 * Used by: occupancy %, "rented count" pills, dashboard widgets.
 */
export function isPropertyOccupied(status) {
  return status === 'rented' || status === 'notice_given' || status === 'short_term_let'
}

/**
 * Is this property genuinely vacant — empty AND not lined up for tenants?
 *
 * Notably excludes let_agreed. A let-agreed property is technically vacant
 * (no rent flowing) but it's not "available" — you wouldn't advertise it
 * or count it in vacancy KPIs. Use isPropertyAvailable for that.
 *
 * Used by: vacancy count, "you have N vacant" warnings.
 */
export function isPropertyVacant(status) {
  return status === 'vacant'
}

/**
 * Is this property ready to rent and being marketed for a tenant?
 * Kept apart from vacant: it is empty, but it is in hand.
 */
export function isPropertyOnMarket(status) {
  return status === 'on_rental_market'
}

// ── On Rental Market periods ─────────────────────────────────────────────
// Status changes into or out of On Rental Market open or close a dated
// non_chargeable_periods row (reason 'on_market'). Pure planner: returns
// what to write, the caller writes it.
//
//   from, to   previous and new property status (from null = new property)
//   date       ISO date the change takes effect: first day on the market, or
//              the tenancy start / first day off the market
//   periods    the property's existing non_chargeable_periods
//
// Returns { create: row|null, close: [{ id, end_date }], remove: [id] }.
// Closing ends the period the day BEFORE `date`, so rent is expected again
// from the tenancy start. A period that would end before it began (put on
// the market and let on the same day) covered nothing and is removed.
export const ON_MARKET_REASON = 'on_market'
function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) - 86400000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
export function planOnMarketPeriods({ from, to, date, periods = [] }) {
  const out = { create: null, close: [], remove: [] }
  if (!date || from === to) return out
  const open = (periods || []).filter(p => p.reason === ON_MARKET_REASON && !p.end_date)
  if (to === 'on_rental_market') {
    if (!open.length) out.create = { reason: ON_MARKET_REASON, start_date: date, end_date: null, notes: 'Opened automatically: status set to On rental market' }
    return out
  }
  if (from === 'on_rental_market') {
    const end = dayBefore(date)
    for (const p of open) {
      if (end < p.start_date) out.remove.push(p.id)
      else out.close.push({ id: p.id, end_date: end })
    }
  }
  return out
}

/**
 * Is this property part of the active portfolio? (i.e. not sold)
 *
 * Used by: portfolio value, property counts, almost every aggregator
 * that scans the property list and doesn't care about sold ones.
 */
export function isPropertyActive(status) {
  return status !== 'sold'
}

/**
 * Should this property's purchase + refurb costs be counted in
 * "money still owed" calculations? Sold properties don't count.
 */
export function isPropertyInvested(status) {
  return status !== 'sold'
}
