// Rent engine — Stage 3 (traffic-light periods) and Stage 4 (collection rate).
//
// Pure functions. Given a property with its rent periods (rent_payments rows),
// tenancies, receipts + allocations, non-chargeable periods and overrides,
// decide for every period:
//
//   paid            full collectible rent received (Green)
//   due             window still open, or benefit not yet due; nothing missing yet (Amber)
//   part_paid       some received, balance outstanding, window still open (Amber)
//   missed          window passed and collectible rent still outstanding (Red)
//   not_collectible vacant / refurb / before start / after end / non-chargeable (Grey)
//   stl             short-term-let property: reported in Short-Term Let Income, not here
//   legacy          period before the go-live date: old binary logic applies
//   future          period has not started
//   pending_review  set aside by an override for the owner to decide: the
//                   unpaid amount is kept and reported, but outside the live
//                   outstanding total (a reporting exclusion, never a write-off)
//
// Decisions fixed on 2 Sep 2026: go-live 1 Jan 2026; pre-go-live months stay on
// the old logic and are labelled Legacy Data; a paid month with no amount stays
// Green with a Needs Backfill marker and is excluded from the value-based rate;
// default payment window 5 days; Housing Benefit / Universal Credit judged
// against the recorded benefit schedule; any short_term_let property is
// excluded from the residential rate.
//
// Compatibility bridge: a period's received amount is the sum of its
// rent_allocations when any exist, otherwise the legacy rent_payments.amount.

import { tenancyCoversDate, usesBenefit, parseDueDay, DEFAULT_PAYMENT_WINDOW_DAYS } from './tenancyUtils'

export const GO_LIVE = '2026-01-01'

export const STATE = {
  PAID: 'paid', DUE: 'due', PART_PAID: 'part_paid', MISSED: 'missed',
  NOT_COLLECTIBLE: 'not_collectible', STL: 'stl', LEGACY: 'legacy', FUTURE: 'future',
  PENDING_REVIEW: 'pending_review',
}
export const STATE_LABEL = {
  paid: 'Paid', due: 'Due', part_paid: 'Part paid', missed: 'Missed',
  not_collectible: 'Not collectible', stl: 'Short-term let', legacy: 'Legacy', future: 'Future',
  pending_review: 'Pending review',
}
// Problems first, then attention, then good news, then the quiet states.
// Legacy rows whose amount came from the Vale Xero import (net of fees).
const XERO_NET_NOTE = /^xero rental income/i
// Overrides that confirm or chase a period rather than charge it: a duplicate
// placeholder carrying one of these is still a duplicate.
const SUPERSEDABLE_OVERRIDES = ['paid', 'part_paid', 'due']
const COLLAPSE_PRIORITY = ['missed', 'pending_review', 'part_paid', 'due', 'paid', 'stl', 'not_collectible', 'legacy', 'future']

// ── Date helpers (ISO yyyy-mm-dd, UTC arithmetic, no DST surprises) ─────────
export function isoToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
function fromUTC(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }
export function addDays(iso, n) { return fromUTC(toUTC(iso) + n * 86400000) }
export function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000) + 1 } // inclusive
export function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate() }
export function monthBounds(year, month) {
  const mm = String(month).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}` }
}
function clampDay(year, month, day) { return Math.min(day, daysInMonth(year, month)) }
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = total % 12 + 1
  return `${ny}-${String(nm).padStart(2, '0')}-${String(clampDay(ny, nm, d)).padStart(2, '0')}`
}
const maxIso = (...xs) => xs.filter(Boolean).sort().pop() || null
const minIso = (...xs) => xs.filter(Boolean).sort()[0] || null
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Monthly-equivalent rent for a tenancy.
export function monthlyRent(t) {
  const r = Number(t?.rent_amount) || 0
  switch (t?.rent_frequency) {
    case 'weekly': return r * 52 / 12
    case 'fortnightly': return r * 26 / 12
    case 'four_weekly': return r * 13 / 12
    case 'quarterly': return r / 3
    default: return r
  }
}

// When the property has no tenancy record covering a period, fall back to the
// property's own fields so the tracker keeps working before Tiffany's
// backfill lands. Flagged so the UI can say so.
export function fallbackTenancyFromProperty(p) {
  if (!p) return null
  const earning = p.status === 'rented' || p.status === 'notice_given'
  if (!earning) return null
  const rent = Number(p.rent_pcm) || 0
  if (!rent) return null
  return {
    id: null, fallback: true, property_id: p.id,
    tenancy_start: GO_LIVE, tenancy_end: null,
    rent_amount: rent, rent_frequency: 'monthly',
    rent_due_day: parseDueDay(p.rent_due_day) || 1,
    payment_window_days: DEFAULT_PAYMENT_WINDOW_DAYS,
    status: p.status === 'notice_given' ? 'notice_given' : 'rented',
    payment_source: 'tenant',
  }
}

// The tenancy that covers a period: the one live on its first day, else the
// first one starting inside it (a mid-period move-in).
export function tenancyForPeriod(tenancies, start, end) {
  const list = (tenancies || []).filter(t => t.tenancy_start)
  const onStart = list.filter(t => tenancyCoversDate(t, start)).sort((a, b) => (a.tenancy_start < b.tenancy_start ? 1 : -1))[0]
  if (onStart) return onStart
  return list.filter(t => t.tenancy_start > start && t.tenancy_start <= end).sort((a, b) => (a.tenancy_start < b.tenancy_start ? -1 : 1))[0] || null
}

// Days inside [start,end] that are collectible: covered by the tenancy and not
// inside any non-chargeable period.
// Labels for non_chargeable_periods.reason (the DB check constraint lists the
// same keys). 'not_owned' added 15 Sept 2026 for 10 Elms West: months before
// the purchase completed must never read as missed rent.
export const NON_CHARGEABLE_REASONS = Object.freeze([
  { v: 'not_owned',     l: 'Not owned / before ownership' },
  { v: 'on_market',     l: 'On rental market' },
  { v: 'vacant',        l: 'Vacant' },
  { v: 'refurbishment', l: 'Refurbishment' },
  { v: 'rent_free',     l: 'Agreed rent-free' },
  { v: 'other',         l: 'Other' },
])
export const NON_CHARGEABLE_REASON_LABEL = Object.freeze(Object.fromEntries(NON_CHARGEABLE_REASONS.map(r => [r.v, r.l])))
// The first approved period overlapping [start, end], for the explanation.
export function nonChargeablePeriodFor(periods, start, end) {
  return (periods || []).find(p => p.start_date <= end && (!p.end_date || p.end_date >= start)) || null
}
function nonChargeableWhy(periods, start, end) {
  const p = nonChargeablePeriodFor(periods, start, end)
  const l = p && NON_CHARGEABLE_REASON_LABEL[p.reason]
  return l ? `${l} (approved non-chargeable period)` : 'Approved non-chargeable period'
}

export function collectibleDays(start, end, tenancy, nonChargeable) {
  let n = 0
  const total = daysBetween(start, end)
  for (let i = 0; i < total; i++) {
    const d = addDays(start, i)
    if (!tenancyCoversDate(tenancy, d)) continue
    if ((nonChargeable || []).some(p => p.start_date <= d && (!p.end_date || p.end_date >= d))) continue
    n++
  }
  return n
}

// Due date for a period: the tenancy's due day inside the period's month,
// never before the period or the tenancy begins.
export function dueDateFor(tenancy, start) {
  const [y, m] = start.split('-').map(Number)
  const day = tenancy?.rent_due_day ? clampDay(y, m, tenancy.rent_due_day) : 1
  const inMonth = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return maxIso(inMonth, start, tenancy?.tenancy_start)
}

// The recorded benefit schedule date on or after `from`, stepping from the
// tenancy's next-expected date by its frequency. Null when no schedule.
export function benefitDueOnOrAfter(tenancy, from) {
  if (!tenancy?.benefit_next_payment_date) return null
  const anchor = tenancy.benefit_next_payment_date
  const step = { weekly: 7, fortnightly: 14, four_weekly: 28 }[tenancy.benefit_frequency]
  // Every candidate is computed as an offset from the recorded anchor, never
  // by stepping from the previous candidate: a monthly schedule anchored on
  // the 31st clamps to 28 Feb in February but must return to the 31st in
  // March, not drift to the 28th for good.
  const at = k => step ? addDays(anchor, k * step) : addMonths(anchor, k)
  let k = 0, guard = 0
  while (at(k) > from && at(k - 1) >= from && guard++ < 120) k--
  guard = 0
  while (at(k) < from && guard++ < 120) k++
  return at(k)
}

// ── Period evaluation ───────────────────────────────────────────────────────
export function evaluatePeriod(row, ctx) {
  const { property, tenancies = [], receipts = [], nonChargeable = [], overrides = [], stlIds, today = isoToday() } = ctx
  const start = row.period_start || monthBounds(row.year, row.month).start
  const end = row.period_end || monthBounds(row.year, row.month).end
  const base = {
    id: row.id, year: row.year, month: row.month, monthLabel: row.month_label,
    periodStart: start, periodEnd: end, legacyStatus: row.status, legacyAmount: row.amount == null ? null : Number(row.amount),
    expected: null, received: null, outstanding: 0, excess: 0, dueDate: null, windowEnd: null, benefitDue: null,
    tenancy: null, fallback: false, tenantShare: 0, benefitShare: 0, receivedTenant: 0, receivedBenefit: 0,
    allocations: [], needsBackfill: false, override: null, reasons: [], collectibleDays: 0, totalDays: daysBetween(start, end),
  }

  // Allocations to this period (from any receipt; reversals are negative).
  const allocs = []
  for (const r of receipts) for (const a of (r.rent_allocations || [])) {
    if (a.rent_payment_id === row.id && a.target === 'current_rent') allocs.push({ ...a, receipt: r })
  }
  base.allocations = allocs
  const hasAllocations = allocs.length > 0
  if (hasAllocations) {
    base.received = round2(allocs.reduce((s, a) => s + Number(a.amount), 0))
    base.receivedTenant = round2(allocs.filter(a => (a.receipt?.payer || 'tenant') === 'tenant' || a.receipt?.payer === 'other').reduce((s, a) => s + Number(a.amount), 0))
    base.receivedBenefit = round2(base.received - base.receivedTenant)
  } else if (row.status === 'paid' || row.status === 'partial' || row.status === 'late') {
    // Legacy bridge: the month row itself is the receipt. A paid row with no
    // amount OR a stored GBP 0 (the old month toggle saved zeros) is "paid,
    // amount needs entering" (decision 2, 2 Sep 2026), never GBP 0 received.
    const amt = row.amount == null ? null : round2(row.amount)
    if (row.status === 'paid' && (amt == null || amt === 0)) { base.received = null; base.needsBackfill = true }
    else if (amt == null) base.received = null
    else {
      base.received = amt
      // The Vale history was loaded from Xero rental income, which the agent
      // rules book NET of commission (8.4% = 7% + VAT on most lets), so a
      // short month there is a fee, not arrears, until the gross is known.
      base.netOfFees = XERO_NET_NOTE.test(row.notes || '')
    }
  } else {
    base.received = 0
  }

  if (start < GO_LIVE) {
    // Legacy months keep the old logic entirely: they are never flagged for
    // backfill (decision 1, 2 Sep 2026: pre-2026 stays as it is).
    base.legacy = true
    return { ...base, state: STATE.LEGACY, needsBackfill: false, reasons: ['Before 1 Jan 2026: legacy tracking applies'] }
  }
  if (property?.status === 'short_term_let' || (stlIds && stlIds.has(row.id))) {
    return { ...base, state: STATE.STL, reasons: ['Short-term let: reported under Short-Term Let Income'] }
  }
  if (start > today) {
    return { ...base, state: STATE.FUTURE, reasons: ['Period has not started'] }
  }

  // Override wins (latest first). 'clear' means no override in force.
  const ov = (overrides || []).filter(o => o.rent_payment_id === row.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  const activeOverride = ov && ov.state !== 'clear' ? ov : null

  // A calendar-month placeholder with no money on it, whose dates are mostly
  // charged on another recorded rent period (the agent's cycle, e.g. 27 Aug
  // to 26 Sep), is a duplicate of that period, not a second month of rent.
  const sup = ctx.superseded && ctx.superseded.get(row.id)
  if (sup && (!activeOverride || SUPERSEDABLE_OVERRIDES.includes(activeOverride.state))) {
    return {
      ...base, state: STATE.NOT_COLLECTIBLE, needsBackfill: false, superseded: sup, supersededOverride: activeOverride,
      reasons: [`Duplicate placeholder: these dates are charged on the rent period ${sup.start} to ${sup.end}`],
    }
  }

  let tenancy = tenancyForPeriod(tenancies, start, end)
  // Fall back to the property's own fields ONLY when nothing has been
  // recorded yet. Once the property has tenancy records, a gap between them
  // is a real gap (void between tenants), not missing data.
  if (!tenancy && !(tenancies || []).length) {
    tenancy = fallbackTenancyFromProperty(property)
    if (tenancy) base.fallback = true
  }
  // The recorded rent periods say when this tenant's month actually turns
  // over; trust them over the property's due-day field (or a tenancy seeded
  // from it and not yet confirmed) for rent still to come in. A period that
  // already carries money keeps its own date, so a receipt is never pushed
  // into the future.
  const unconfirmed = tenancy && (base.fallback || tenancy.needs_confirmation)
  if (unconfirmed && ctx.cycleDueDay && ctx.cycleDueDay !== Number(tenancy.rent_due_day) && !(base.received > 0)) {
    tenancy = { ...tenancy, rent_due_day: ctx.cycleDueDay }
    base.cycleDueDay = ctx.cycleDueDay
  }
  base.tenancy = tenancy

  // A tenancy with no rent on it cannot be charged: say so rather than
  // showing GBP 0 rent as paid.
  if (tenancy && !(monthlyRent(tenancy) > 0) && row.expected_amount == null && activeOverride?.expected_amount == null) {
    if (base.received && base.received > 0 && !activeOverride) {
      return { ...base, state: STATE.PAID, expected: base.received, reasons: ['No rent amount on the tenancy; amount recorded is treated as the expectation'] }
    }
    return finish({ ...base, state: STATE.NOT_COLLECTIBLE, reasons: ['No rent amount on the tenancy'] }, activeOverride)
  }

  if (!tenancy) {
    const recorded = (tenancies || []).filter(t => t.tenancy_start)
    const allEndedBefore = recorded.length && recorded.every(t => t.tenancy_end && t.tenancy_end < start)
    const allStartAfter = recorded.length && recorded.every(t => t.tenancy_start > end)
    const why = allEndedBefore ? 'After tenancy end' : allStartAfter ? 'Before tenancy start' : recorded.length ? 'Between tenancies'
      : property?.status === 'vacant' ? 'Property vacant' : property?.status === 'refurb' ? 'Property under refurbishment'
      : property?.status === 'let_agreed' ? 'Let agreed, tenancy not started'
      : property?.status === 'on_rental_market' ? 'On rental market, no tenant yet' : 'No tenancy covers this period'
    // Money recorded without a tenancy still counts as received so nothing
    // that was collected disappears.
    if (base.received && base.received > 0 && !activeOverride) {
      return { ...base, state: STATE.PAID, expected: base.received, reasons: [why + '; amount recorded is treated as the expectation'] }
    }
    return finish({ ...base, state: STATE.NOT_COLLECTIBLE, reasons: [why] }, activeOverride)
  }

  const cDays = collectibleDays(start, end, tenancy, nonChargeable)
  base.collectibleDays = cDays
  if (cDays === 0) {
    const why = start < tenancy.tenancy_start ? 'Before tenancy start' : (tenancy.tenancy_end && start > tenancy.tenancy_end) ? 'After tenancy end' : nonChargeableWhy(nonChargeable, start, end)
    return finish({ ...base, state: STATE.NOT_COLLECTIBLE, reasons: [why] }, activeOverride)
  }

  // Expected rent for the collectible days. A whole-month row fully covered is
  // exactly the monthly rent; anything else is prorated by days in that month.
  const [sy, sm] = start.split('-').map(Number)
  const mRent = monthlyRent(tenancy)
  const wholeMonth = start === monthBounds(sy, sm).start && end === monthBounds(sy, sm).end
  // One rent cycle (28 Feb to 27 Mar, 30 Jan to 27 Feb, or the agent's
  // 28 Feb to 29 Mar) is one month's rent, whatever the calendar months it
  // straddles; part cycles prorate by the cycle's own length. A period that
  // starts on the 1st but is not the whole month is a part month instead,
  // and so is one that starts mid-month and stays inside that calendar month
  // (2 Mar to 31 Mar for a 2 Mar move-in): a real cycle always crosses into
  // the next month.
  const oneCycle = !wholeMonth && start.slice(8) !== '01' && start.slice(0, 7) !== end.slice(0, 7)
    && base.totalDays >= 28 && base.totalDays <= 31
  let expected = row.expected_amount != null ? Number(row.expected_amount)
    : ((wholeMonth || oneCycle) && cDays === base.totalDays) ? mRent
    : oneCycle ? mRent * cDays / base.totalDays
    : mRent * cDays / daysInMonth(sy, sm)
  expected = round2(expected)
  if (activeOverride?.expected_amount != null) expected = round2(activeOverride.expected_amount)
  base.expected = expected
  if (cDays < base.totalDays) {
    const ncp = nonChargeablePeriodFor(nonChargeable, start, end)
    const lbl = ncp && NON_CHARGEABLE_REASON_LABEL[ncp.reason]
    base.reasons.push(`${cDays} of ${base.totalDays} days collectible${lbl ? ` (${lbl} ${ncp.start_date} to ${ncp.end_date || 'ongoing'})` : ''}`)
  }
  if (base.fallback) base.reasons.push('No tenancy record: using the property\'s rent and due day')
  if (base.cycleDueDay) base.reasons.push(`Due day ${base.cycleDueDay} taken from the latest recorded rent period`)

  // Shares for mixed funding.
  if (usesBenefit(tenancy.payment_source)) {
    const ratio = mRent ? expected / mRent : 1
    if (tenancy.payment_source === 'mixed') {
      base.tenantShare = round2((Number(tenancy.tenant_contribution) || 0) * ratio)
      base.benefitShare = round2(expected - base.tenantShare)
    } else { base.tenantShare = 0; base.benefitShare = expected }
  } else { base.tenantShare = expected; base.benefitShare = 0 }

  // Windows.
  base.dueDate = dueDateFor(tenancy, start)
  const windowDays = tenancy.payment_window_days == null ? DEFAULT_PAYMENT_WINDOW_DAYS : Number(tenancy.payment_window_days)
  base.windowEnd = addDays(base.dueDate, windowDays)
  base.benefitDue = base.benefitShare > 0 ? (benefitDueOnOrAfter(tenancy, base.dueDate) || base.windowEnd) : null

  const received = base.received == null ? 0 : base.received
  base.outstanding = round2(Math.max(0, expected - received))
  base.excess = round2(Math.max(0, received - expected))
  if (base.netOfFees && base.outstanding > 0.005 && !hasAllocations) {
    base.needsInfo = base.outstanding
    base.infoReason = 'Amount is Xero rental income, booked net of agent fees: the gross receipt is needed'
  }

  let state
  if (base.needsBackfill) { state = STATE.PAID; base.reasons.push('Marked paid with no amount: needs backfill') }
  else if (base.outstanding <= 0.005) state = STATE.PAID
  else {
    // Which windows have passed for the part still owed?
    let overdue = false
    if (hasAllocations && usesBenefit(tenancy.payment_source)) {
      const tenantOwed = round2(Math.max(0, base.tenantShare - base.receivedTenant))
      const benefitOwed = round2(Math.max(0, base.benefitShare - base.receivedBenefit))
      overdue = (tenantOwed > 0.005 && today > base.windowEnd) || (benefitOwed > 0.005 && today > base.benefitDue)
    } else {
      const lastWindow = maxIso(base.windowEnd, base.benefitDue)
      overdue = today > lastWindow
    }
    if (overdue) state = STATE.MISSED
    else state = received > 0 ? STATE.PART_PAID : STATE.DUE
    if (received > 0 && state === STATE.MISSED) base.reasons.push('Part paid, balance overdue')
  }
  return finish({ ...base, state }, activeOverride)
}

function finish(ev, override) {
  if (!override) return ev
  const out = { ...ev, state: override.state, override, reasons: [...ev.reasons, `Override: ${override.reason}`] }
  if (override.state === STATE.PENDING_REVIEW) {
    // Keep the money exactly as evaluated; only the classification moves.
    out.reviewFrom = ev.state
    return out
  }
  // An override can say a period was paid, but it is not a receipt: the
  // money still has to be recorded before it counts as collected, and the
  // gap must not be reported as arrears either (decision 2, 2 Sep 2026).
  const confirmsPaid = override.state === STATE.PAID || override.state === STATE.PART_PAID
  if (confirmsPaid && ev.expected != null && !ev.needsBackfill) {
    if (!(ev.received > 0)) {
      out.needsBackfill = true
      out.reasons.push('Marked paid by override with no amount recorded: needs backfill')
    } else if (override.state === STATE.PAID && ev.outstanding > 0.005 && !ev.needsInfo) {
      out.needsInfo = ev.outstanding
      out.infoReason = `Marked paid by override but only ${ev.received.toFixed(2)} of ${ev.expected.toFixed(2)} is recorded: confirm the rent and the receipt`
    }
  }
  return out
}

// Money recorded on a period: receipts allocated to it, or the legacy amount.
function hasMoney(row, receipts) {
  for (const r of receipts || []) for (const a of (r.rent_allocations || [])) {
    if (a.rent_payment_id === row.id && a.target === 'current_rent' && Number(a.amount) > 0) return true
  }
  return ['paid', 'partial', 'late'].includes(row.status) && Number(row.amount) > 0
}
function rowBounds(r) {
  const b = monthBounds(r.year, r.month)
  return { start: r.period_start || b.start, end: r.period_end || b.end, whole: (r.period_start || b.start) === b.start && (r.period_end || b.end) === b.end }
}

// Duplicate placeholders: a whole calendar month with no money on it whose
// days are at least half covered by other periods that do carry money. The
// statement importer records the agent's cycle (27 Aug to 26 Sep) next to the
// month rows that were pre-created, so the same rent was charged twice.
// Returns Map(rowId -> { id, start, end }) naming the covering period.
export function findSupersededPlaceholders(rows, receipts) {
  const out = new Map()
  const all = (rows || []).map(r => ({ r, ...rowBounds(r), money: hasMoney(r, receipts) }))
  const payers = all.filter(x => x.money)
  for (const x of all) {
    if (!x.whole || x.money || x.start < GO_LIVE) continue
    const total = daysBetween(x.start, x.end)
    let covered = 0, best = null, bestDays = 0
    for (let i = 0; i < total; i++) {
      const d = addDays(x.start, i)
      const hit = payers.find(o => o.r.id !== x.r.id && o.start <= d && o.end >= d)
      if (hit) covered++
    }
    for (const o of payers) {
      if (o.r.id === x.r.id) continue
      const s = maxIso(o.start, x.start), e = minIso(o.end, x.end)
      const n = s <= e ? daysBetween(s, e) : 0
      if (n > bestDays) { bestDays = n; best = o }
    }
    if (best && covered * 2 >= total) out.set(x.r.id, { id: best.r.id, start: best.start, end: best.end })
  }
  return out
}

// The day the tenant's rent month turns over, read from the latest full-cycle
// period that carries money (a cycle that is not a calendar month). Null when
// the property is tracked by calendar month.
export function recordedCycleDueDay(rows, receipts) {
  const cycles = (rows || []).map(r => ({ r, ...rowBounds(r) }))
    .filter(x => !x.whole && x.start >= GO_LIVE && hasMoney(x.r, receipts) && daysBetween(x.start, x.end) >= 28)
    .sort((a, b) => (a.start < b.start ? 1 : -1))
  return cycles.length ? Number(cycles[0].start.slice(8)) : null
}

// Evaluate every period of a property. `ctx` may omit tenancies/receipts/etc.,
// in which case the property's joined arrays are used. `opts.siblings` is the
// property's full set of periods when only some of them are being evaluated
// (duplicates are judged against all of them).
export function evaluateProperty(property, opts = {}) {
  const receipts0 = opts.receipts || property.rent_receipts || []
  const siblings = opts.siblings || property.rent_payments || []
  const ctx = {
    property,
    tenancies: opts.tenancies || property.tenancies || [],
    receipts: opts.receipts || property.rent_receipts || [],
    nonChargeable: opts.nonChargeable || property.non_chargeable_periods || [],
    overrides: opts.overrides || property.rent_overrides || [],
    stlIds: opts.stlIds || new Set((property.stl_bookings || []).map(b => b.rent_payment_id).filter(Boolean)),
    today: opts.today || isoToday(),
    superseded: findSupersededPlaceholders(siblings, receipts0),
    cycleDueDay: recordedCycleDueDay(siblings, receipts0),
  }
  return (property.rent_payments || []).map(row => evaluatePeriod(row, ctx))
}

// Collapse a month's evaluations to one tile state plus totals.
export function collapseMonth(evals) {
  if (!evals?.length) return null
  let state = 'future'
  for (const s of COLLAPSE_PRIORITY) { if (evals.some(e => e.state === s)) { state = s; break } }
  const sum = k => round2(evals.reduce((s, e) => s + (Number(e[k]) || 0), 0))
  return {
    state, year: evals[0].year, month: evals[0].month, monthLabel: evals[0].monthLabel,
    expected: sum('expected'), received: round2(evals.reduce((s, e) => s + (e.received || 0), 0)),
    outstanding: sum('outstanding'), excess: sum('excess'),
    needsBackfill: evals.some(e => e.needsBackfill), legacy: evals.some(e => e.state === STATE.LEGACY),
    override: evals.find(e => e.override)?.override || null, evals,
  }
}

export function groupByMonth(evals) {
  const by = new Map()
  for (const e of evals) { const k = `${e.year}-${e.month}`; if (!by.has(k)) by.set(k, []); by.get(k).push(e) }
  return [...by.values()].map(collapseMonth).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
}

// ── Collection rate ─────────────────────────────────────────────────────────
// Value-based: current rent received ÷ collectible current rent due to date.
//   • only periods whose due date has been reached by `asOf`
//   • only collectible periods (not grey, not STL, not legacy, not future,
//     not pending review)
//   • paid-with-no-amount periods excluded (Needs Backfill)
//   • a shortfall we cannot verify (Xero net-of-fee amounts, a paid override
//     with less recorded) is excluded from both sides and reported as
//     needing information, never as arrears
//   • partial payments count up to the collectible amount; excess reported separately
//   • historic arrears never enter this figure
//
// rateContribution() is the single per-period rule. The Rent Tracker, Reports
// and the dashboard Rental Income section all go through it, so a period can
// never count one way on one screen and another way on the next.
const RATED_STATES = [STATE.PAID, STATE.DUE, STATE.PART_PAID, STATE.MISSED]
export function rateContribution(e) {
  if (!e || e.needsBackfill) return null
  if (!RATED_STATES.includes(e.state)) return null
  if (e.expected == null) return null
  const rec = e.received == null ? 0 : e.received
  const info = round2(Number(e.needsInfo) || 0)
  return { due: round2(e.expected - info), received: round2(Math.min(rec, e.expected)), excess: round2(Math.max(0, rec - e.expected)), needsInfo: info }
}

// Where an unpaid amount sits on `asOf`. Only 'overdue' is arrears.
export function outstandingBucket(e, asOf) {
  if (e.dueDate && e.dueDate > asOf) return 'notYetDue'
  if (e.dueDate === asOf) return 'dueToday'
  const lastWindow = maxIso(e.windowEnd, e.benefitDue)
  if (lastWindow ? asOf > lastWindow : e.state === STATE.MISSED) return 'overdue'
  return 'inWindow'
}

export function collectionStats(evals, { from = null, to = null, asOf = isoToday() } = {}) {
  const out = { due: 0, received: 0, outstanding: 0, excess: 0, rate: null, periods: 0,
    overdue: 0, dueToday: 0, inWindow: 0, notYetDue: 0, pendingReview: 0, needsInfo: 0, combined: 0,
    counts: { paid: 0, due: 0, part_paid: 0, missed: 0, not_collectible: 0, stl: 0, legacy: 0, future: 0, pending_review: 0, scheduled: 0, needsBackfill: 0, needsInfo: 0, duplicates: 0 } }
  for (const e of evals) {
    if (from && e.periodStart < from) continue
    if (to && e.periodStart > to) continue
    if (e.superseded) out.counts.duplicates++
    // Status counts describe rent that has fallen due: a period whose due date
    // is still ahead is scheduled, never "due" or "missed".
    const notDueYet = e.dueDate && e.dueDate > asOf && RATED_STATES.includes(e.state)
    if (notDueYet) out.counts.scheduled++
    else out.counts[e.state] = (out.counts[e.state] || 0) + 1
    if (e.state === STATE.PENDING_REVIEW) { out.pendingReview = round2(out.pendingReview + (Number(e.outstanding) || 0)); continue }
    if (e.needsBackfill) { out.counts.needsBackfill++; continue }
    const c = rateContribution(e)
    if (!c) continue
    const owed = round2(Math.max(0, c.due - c.received))
    if (notDueYet || (e.dueDate && e.dueDate > asOf)) { out.notYetDue = round2(out.notYetDue + owed); continue }
    if (c.needsInfo > 0) { out.counts.needsInfo++; out.needsInfo = round2(out.needsInfo + c.needsInfo) }
    out.periods++
    out.due = round2(out.due + c.due)
    out.received = round2(out.received + c.received)
    out.excess = round2(out.excess + c.excess)
    if (owed > 0) { const b = outstandingBucket(e, asOf); out[b] = round2(out[b] + owed) }
  }
  out.outstanding = round2(Math.max(0, out.due - out.received))
  out.combined = round2(out.outstanding + out.pendingReview)
  out.rate = out.due > 0 ? Math.round((out.received / out.due) * 1000) / 10 : null
  return out
}

// One line per rent period for the outstanding breakdown report: where each
// period's unpaid amount sits on `asOf`, and why. Same rules as
// collectionStats(), so the report always adds back to the tiles.
export const BUCKET_LABEL = {
  overdue: 'Overdue', dueToday: 'Due today', inWindow: 'In payment window', notYetDue: 'Not yet due',
  pendingReview: 'Pending review', needsInfo: 'Needs information', needsBackfill: 'Paid, amount missing',
  duplicate: 'Duplicate placeholder', notCollectible: 'Not collectible', paid: 'Paid',
}
export function periodBreakdown(e, asOf = isoToday()) {
  const owed = e.state === STATE.PENDING_REVIEW ? Number(e.outstanding) || 0 : 0
  if (e.superseded) return { bucket: 'duplicate', owed: 0, needsInfo: 0 }
  if (e.state === STATE.PENDING_REVIEW) return { bucket: 'pendingReview', owed, needsInfo: 0 }
  if (e.needsBackfill) return { bucket: 'needsBackfill', owed: 0, needsInfo: 0 }
  const c = rateContribution(e)
  if (!c) return { bucket: 'notCollectible', owed: 0, needsInfo: 0 }
  const o = round2(Math.max(0, c.due - c.received))
  if (o > 0) return { bucket: outstandingBucket(e, asOf), owed: o, needsInfo: c.needsInfo }
  return { bucket: c.needsInfo > 0 ? 'needsInfo' : 'paid', owed: 0, needsInfo: c.needsInfo }
}

// Historic arrears position for a property: opening balances on tenancies
// minus receipts allocated to historic arrears (reversals are negative).
// Never negative: a payment towards arrears with no opening balance recorded
// (or more than was recorded) is reported as `unmatched`, so it can never
// offset another tenant's arrears in a portfolio total.
// Historic means owed before the tracker starts charging (go-live). An
// opening balance dated after go-live is a snapshot of arrears the tracker
// already charges period by period, so adding it would count the same rent
// twice: it is reported as `overlap` and left out of the balance.
export function arrearsSummary(property, opts = {}) {
  const tenancies = opts.tenancies || property.tenancies || []
  const receipts = opts.receipts || property.rent_receipts || []
  const live = tenancies.filter(t => t.status !== 'ended')
  const isOverlap = t => !!t.opening_arrears_date && t.opening_arrears_date > GO_LIVE
  const overlap = round2(live.filter(isOverlap).reduce((s, t) => s + (Number(t.opening_arrears) || 0), 0))
  const opening = round2(live.filter(t => !isOverlap(t)).reduce((s, t) => s + (Number(t.opening_arrears) || 0), 0))
  const paid = round2(receipts.flatMap(r => r.rent_allocations || []).filter(a => a.target === 'historic_arrears').reduce((s, a) => s + Number(a.amount), 0))
  return { opening, paid, balance: round2(Math.max(0, opening - paid)), unmatched: round2(Math.max(0, paid - opening)), overlap }
}

// Portfolio-level figures for a set of properties.
export function portfolioStats(properties, { year = null, asOf = isoToday(), today = asOf } = {}) {
  const [ay, am] = asOf.split('-').map(Number)
  const mtdFrom = monthBounds(ay, am).start
  const ytdFrom = `${year || ay}-01-01`
  const ytdTo = year && year < ay ? `${year}-12-31` : asOf
  const all = []
  const arrears = { opening: 0, paid: 0, balance: 0, unmatched: 0, overlap: 0 }
  let legacyAgg = null
  for (const p of properties) {
    if (p.status === 'short_term_let') continue
    const evals = evaluateProperty(p, { today })
    for (const e of evals) all.push(e)
    const a = arrearsSummary(p)
    arrears.opening = round2(arrears.opening + a.opening); arrears.paid = round2(arrears.paid + a.paid); arrears.balance = round2(arrears.balance + a.balance); arrears.unmatched = round2(arrears.unmatched + a.unmatched); arrears.overlap = round2(arrears.overlap + a.overlap)
  }
  const scoped = year ? all.filter(e => e.year === year) : all
  return {
    mtd: collectionStats(all, { from: mtdFrom, to: asOf, asOf }),
    ytd: collectionStats(scoped, { from: ytdFrom, to: ytdTo, asOf }),
    all: collectionStats(scoped, { asOf }),
    arrears,
    needsBackfill: scoped.filter(e => e.needsBackfill && e.periodStart <= ytdTo),
    duplicates: scoped.filter(e => e.superseded && e.periodStart <= ytdTo),
    legacyCount: scoped.filter(e => e.state === STATE.LEGACY).length,
    legacyAgg,
  }
}
