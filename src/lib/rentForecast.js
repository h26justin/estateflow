// Dashboard rent snapshot: forecast vs received for recent months.
//
// Pure functions, no React, no Supabase. Feeds the "Rent Forecast" and "Rent
// Received" KPI cards on the dashboard. Everything here rides on the rent
// engine (rentEngine.js) so the dashboard never disagrees with the Rent
// Tracker about what a month was worth or what came in:
//
//   forecast  = collectible rent the engine EXPECTS for the month — tenancy
//               aware, so a mid-month move-in, a void between tenants or an
//               approved non-chargeable period prorate it, and a property
//               with no tenancy record falls back to its rent_pcm.
//   received  = what the engine counts as received for the month's periods:
//               receipt allocations when any exist, otherwise the legacy
//               paid/partial amount on the row itself. A month marked paid
//               with no amount is "needs backfill", not GBP 0, and is counted
//               separately so the reader knows the received figure is low.
//
// Months are period months (the month the rent is FOR), which is how the
// Rent Tracker tiles are laid out, not the calendar month the money landed.
//
// Short-term-let income is excluded from both headline figures on purpose: it
// has no monthly expectation to forecast against and is reported on the
// Short-Term Let Income page. It is still returned (stlReceived) so a card can
// show it as a footnote.

import { evaluateProperty, monthBounds, isoToday, STATE } from './rentEngine'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Year/month pairs for `count` months ending at `asOf`'s month (newest first),
// shifted by `offset` months (offset 1 = starting next month).
export function recentMonthKeys(asOf = isoToday(), count = 3, offset = 0) {
  const [y, m] = asOf.split('-').map(Number)
  const out = []
  for (let i = 0; i < count; i++) {
    const total = y * 12 + (m - 1) + offset - i
    out.push({ year: Math.floor(total / 12), month: (total % 12) + 1 })
  }
  return out
}

export function monthLabel(year, month) { return `${MONTH_SHORT[month - 1]} ${year}` }

function emptyMonth(year, month) {
  return {
    year, month, key: `${year}-${month}`, label: monthLabel(year, month),
    expected: 0, received: 0, outstanding: 0,
    stlReceived: 0, needsBackfill: 0, periods: 0, propertiesWithRows: 0,
    byCompany: {},
  }
}

// Snapshot of forecast vs received for a set of months.
//
//   properties  properties with their joined rent_payments / tenancies /
//               rent_receipts / non_chargeable_periods / rent_overrides /
//               stl_bookings arrays (the fetchProperties shape)
//   asOf        ISO date the snapshot is taken on (default today)
//   count       how many months, ending at asOf's month (default 3)
//   offset      shift the window by whole months (1 = next month first)
//
// Returns months newest first. Each month's `expected` is the full-month
// forecast even for the current month: periods are evaluated as at the end of
// their month so a segment that starts later this month is still counted.
export function rentMonthSnapshot(properties, { asOf = isoToday(), count = 3, offset = 0 } = {}) {
  const keys = recentMonthKeys(asOf, count, offset)
  const months = keys.map(k => emptyMonth(k.year, k.month))
  const byKey = new Map(months.map(mo => [mo.key, mo]))

  for (const p of properties || []) {
    const rows = (p.rent_payments || []).filter(r => byKey.has(`${r.year}-${r.month}`))
    if (!rows.length) continue
    // Evaluate each month as at its own last day: the engine short-circuits
    // periods that have not started yet (FUTURE) before it works out an
    // expectation, which would hide a mid-month move-in from the forecast.
    const rowsByKey = new Map()
    for (const r of rows) { const k = `${r.year}-${r.month}`; if (!rowsByKey.has(k)) rowsByKey.set(k, []); rowsByKey.get(k).push(r) }
    for (const [k, monthRows] of rowsByKey) {
      const mo = byKey.get(k)
      mo.propertiesWithRows++
      const evals = evaluateProperty({ ...p, rent_payments: monthRows }, { today: monthBounds(mo.year, mo.month).end })
      const co = p.company_id || 'none'
      const cs = (mo.byCompany[co] ||= { expected: 0, received: 0, needsBackfill: 0 })
      for (const e of evals) {
        mo.periods++
        const rec = e.received == null ? 0 : e.received
        if (e.state === STATE.STL) { mo.stlReceived = round2(mo.stlReceived + rec); continue }
        if (e.needsBackfill) { mo.needsBackfill++; cs.needsBackfill++ }
        // LEGACY (pre go-live) and NOT_COLLECTIBLE periods carry no
        // expectation; money recorded against them still counts as received.
        // A period with recorded money but no tenancy already comes back PAID
        // with expected = received, so it is not double-handled here.
        const exp = e.expected == null ? 0 : e.expected
        mo.expected = round2(mo.expected + exp)
        mo.received = round2(mo.received + rec)
        cs.expected = round2(cs.expected + exp)
        cs.received = round2(cs.received + rec)
      }
    }
  }
  for (const mo of months) mo.outstanding = round2(Math.max(0, mo.expected - mo.received))
  return months
}

// Collection percentage for a month, capped at 100. Null when nothing was expected.
export function monthRate(mo) {
  if (!mo || !(mo.expected > 0)) return null
  return Math.min(100, Math.round((mo.received / mo.expected) * 100))
}
