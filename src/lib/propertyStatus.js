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
//   notice_given  — tenant has given notice, still paying rent for now
//   vacant        — empty, no tenant lined up
//   sold          — disposed of, not in the active portfolio

// All recognised statuses. Used for select dropdowns and validation.
// Order matches the typical lifecycle of a property.
export const PROPERTY_STATUSES = [
  'purchased',
  'refurb',
  'let_agreed',
  'rented',
  'notice_given',
  'vacant',
  'sold',
]

// Human-readable label for each status. Used wherever the raw value
// would be ugly (e.g. "let_agreed" → "Let agreed").
export const PROPERTY_STATUS_LABELS = {
  purchased:    'Purchased',
  refurb:       'Refurb',
  let_agreed:   'Let agreed',
  rented:       'Rented',
  notice_given: 'Notice given',
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
  let_agreed:   'caution',   // imminent rent — heads-up signal, not yet positive
  rented:       'positive',
  notice_given: 'caution',   // still rented but vacancy looming
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
 * Used by: monthly/annual rent income calculations, rent roll, arrears.
 */
export function isPropertyEarningRent(status) {
  return status === 'rented' || status === 'notice_given'
}

/**
 * Is this property currently occupied?
 *
 * Same answer as isPropertyEarningRent today, but kept as a separate
 * function because the concepts could diverge — e.g. if we ever add a
 * "squatter" or "uncontracted occupier" status, that's occupied but
 * not earning. For now they're identical; callers should pick the one
 * whose intent matches their use case.
 *
 * Used by: occupancy %, "rented count" pills, dashboard widgets.
 */
export function isPropertyOccupied(status) {
  return status === 'rented' || status === 'notice_given'
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
