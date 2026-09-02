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
}
export const STATE_LABEL = {
  paid: 'Paid', due: 'Due', part_paid: 'Part paid', missed: 'Missed',
  not_collectible: 'Not collectible', stl: 'Short-term let', legacy: 'Legacy', future: 'Future',
}
// Problems first, then attention, then good news, then the quiet states.
const COLLAPSE_PRIORITY = ['missed', 'part_paid', 'due', 'paid', 'stl', 'not_collectible', 'legacy', 'future']

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
  let d = tenancy.benefit_next_payment_date
  const step = { weekly: 7, fortnightly: 14, four_weekly: 28 }[tenancy.benefit_frequency]
  const back = iso => step ? addDays(iso, -step) : addMonths(iso, -1)
  const fwd = iso => step ? addDays(iso, step) : addMonths(iso, 1)
  let guard = 0
  while (d > from && back(d) >= from && guard++ < 120) d = back(d)
  guard = 0
  while (d < from && guard++ < 120) d = fwd(d)
  return d
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
    else base.received = amt
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

  let tenancy = tenancyForPeriod(tenancies, start, end)
  // Fall back to the property's own fields ONLY when nothing has been
  // recorded yet. Once the property has tenancy records, a gap between them
  // is a real gap (void between tenants), not missing data.
  if (!tenancy && !(tenancies || []).length) {
    tenancy = fallbackTenancyFromProperty(property)
    if (tenancy) base.fallback = true
  }
  base.tenancy = tenancy

  if (!tenancy) {
    const recorded = (tenancies || []).filter(t => t.tenancy_start)
    const allEndedBefore = recorded.length && recorded.every(t => t.tenancy_end && t.tenancy_end < start)
    const allStartAfter = recorded.length && recorded.every(t => t.tenancy_start > end)
    const why = allEndedBefore ? 'After tenancy end' : allStartAfter ? 'Before tenancy start' : recorded.length ? 'Between tenancies'
      : property?.status === 'vacant' ? 'Property vacant' : property?.status === 'refurb' ? 'Property under refurbishment'
      : property?.status === 'let_agreed' ? 'Let agreed, tenancy not started' : 'No tenancy covers this period'
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
    const why = start < tenancy.tenancy_start ? 'Before tenancy start' : (tenancy.tenancy_end && start > tenancy.tenancy_end) ? 'After tenancy end' : 'Approved non-chargeable period'
    return finish({ ...base, state: STATE.NOT_COLLECTIBLE, reasons: [why] }, activeOverride)
  }

  // Expected rent for the collectible days. A whole-month row fully covered is
  // exactly the monthly rent; anything else is prorated by days in that month.
  const [sy, sm] = start.split('-').map(Number)
  const mRent = monthlyRent(tenancy)
  const wholeMonth = start === monthBounds(sy, sm).start && end === monthBounds(sy, sm).end
  let expected = row.expected_amount != null ? Number(row.expected_amount)
    : (wholeMonth && cDays === base.totalDays) ? mRent : mRent * cDays / daysInMonth(sy, sm)
  expected = round2(expected)
  if (activeOverride?.expected_amount != null) expected = round2(activeOverride.expected_amount)
  base.expected = expected
  if (cDays < base.totalDays) base.reasons.push(`${cDays} of ${base.totalDays} days collectible`)
  if (base.fallback) base.reasons.push('No tenancy record: using the property\'s rent and due day')

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
  return { ...ev, state: override.state, override, reasons: [...ev.reasons, `Override: ${override.reason}`] }
}

// Evaluate every period of a property. `ctx` may omit tenancies/receipts/etc.,
// in which case the property's joined arrays are used.
export function evaluateProperty(property, opts = {}) {
  const ctx = {
    property,
    tenancies: opts.tenancies || property.tenancies || [],
    receipts: opts.receipts || property.rent_receipts || [],
    nonChargeable: opts.nonChargeable || property.non_chargeable_periods || [],
    overrides: opts.overrides || property.rent_overrides || [],
    stlIds: opts.stlIds || new Set((property.stl_bookings || []).map(b => b.rent_payment_id).filter(Boolean)),
    today: opts.today || isoToday(),
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
//   • only collectible periods (not grey, not STL, not legacy, not future)
//   • paid-with-no-amount periods excluded (Needs Backfill)
//   • partial payments count up to the collectible amount; excess reported separately
//   • historic arrears never enter this figure
export function collectionStats(evals, { from = null, to = null, asOf = isoToday() } = {}) {
  const out = { due: 0, received: 0, outstanding: 0, excess: 0, rate: null, periods: 0,
    counts: { paid: 0, due: 0, part_paid: 0, missed: 0, not_collectible: 0, stl: 0, legacy: 0, future: 0, needsBackfill: 0 } }
  for (const e of evals) {
    if (from && e.periodStart < from) continue
    if (to && e.periodStart > to) continue
    out.counts[e.state] = (out.counts[e.state] || 0) + 1
    if (e.needsBackfill) { out.counts.needsBackfill++; continue }
    if (![STATE.PAID, STATE.DUE, STATE.PART_PAID, STATE.MISSED].includes(e.state)) continue
    if (e.dueDate && e.dueDate > asOf) continue
    if (e.expected == null) continue
    const rec = e.received == null ? 0 : e.received
    out.periods++
    out.due = round2(out.due + e.expected)
    out.received = round2(out.received + Math.min(rec, e.expected))
    out.excess = round2(out.excess + Math.max(0, rec - e.expected))
  }
  out.outstanding = round2(Math.max(0, out.due - out.received))
  out.rate = out.due > 0 ? Math.round((out.received / out.due) * 1000) / 10 : null
  return out
}

// Historic arrears position for a property: opening balances on tenancies
// minus receipts allocated to historic arrears (reversals are negative).
export function arrearsSummary(property, opts = {}) {
  const tenancies = opts.tenancies || property.tenancies || []
  const receipts = opts.receipts || property.rent_receipts || []
  const opening = round2(tenancies.filter(t => t.status !== 'ended').reduce((s, t) => s + (Number(t.opening_arrears) || 0), 0))
  const paid = round2(receipts.flatMap(r => r.rent_allocations || []).filter(a => a.target === 'historic_arrears').reduce((s, a) => s + Number(a.amount), 0))
  return { opening, paid, balance: round2(opening - paid) }
}

// Portfolio-level figures for a set of properties.
export function portfolioStats(properties, { year = null, asOf = isoToday(), today = asOf } = {}) {
  const [ay, am] = asOf.split('-').map(Number)
  const mtdFrom = monthBounds(ay, am).start
  const ytdFrom = `${year || ay}-01-01`
  const ytdTo = year && year < ay ? `${year}-12-31` : asOf
  const all = []
  const arrears = { opening: 0, paid: 0, balance: 0 }
  let legacyAgg = null
  for (const p of properties) {
    if (p.status === 'short_term_let') continue
    const evals = evaluateProperty(p, { today })
    for (const e of evals) all.push(e)
    const a = arrearsSummary(p)
    arrears.opening = round2(arrears.opening + a.opening); arrears.paid = round2(arrears.paid + a.paid); arrears.balance = round2(arrears.balance + a.balance)
  }
  const scoped = year ? all.filter(e => e.year === year) : all
  return {
    mtd: collectionStats(all, { from: mtdFrom, to: asOf, asOf }),
    ytd: collectionStats(scoped, { from: ytdFrom, to: ytdTo, asOf }),
    all: collectionStats(scoped, { asOf }),
    arrears,
    needsBackfill: scoped.filter(e => e.needsBackfill),
    legacyCount: scoped.filter(e => e.state === STATE.LEGACY).length,
    legacyAgg,
  }
}
