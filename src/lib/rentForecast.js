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
//
// Occupancy (units / unitsLet) rides on the same evaluation: a unit is LET in
// a month when rent was due on it for any part of that month (a chargeable
// period, including one marked paid with no amount yet; before go-live, money
// received). A void, an approved non-chargeable period or no tenancy reads as
// vacant. Units are the properties in the set owned during the month
// (purchase_date on or before its last day, no sale_date before its first),
// short-term lets excluded on both sides like the money figures. A property
// with no rent rows for the month counts as let when a tenancy covers it.

import { evaluateProperty, monthBounds, isoToday, STATE, rateContribution } from './rentEngine'

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
    stlReceived: 0, needsBackfill: 0, backfillRent: 0, excess: 0, otherReceived: 0, periods: 0, propertiesWithRows: 0,
    units: 0, unitsLet: 0,
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
    const isStl = p.status === 'short_term_let'
    // Which months this property is a unit in, and in which of those it was
    // let. Filled from the evaluation below; months with no rent rows fall
    // back to the tenancy records.
    const letKeys = new Set()
    const unitMonths = isStl ? [] : months.filter(mo => ownedDuring(p, mo))
    const rows = (p.rent_payments || []).filter(r => byKey.has(`${r.year}-${r.month}`))
    const rowKeys = new Set(rows.map(r => `${r.year}-${r.month}`))
    for (const mo of unitMonths) {
      if (!rowKeys.has(mo.key) && tenancyCovers(p, mo)) letKeys.add(mo.key)
    }
    const countUnits = () => {
      for (const mo of unitMonths) {
        const cs = (mo.byCompany[p.company_id || 'none'] ||= { expected: 0, received: 0, needsBackfill: 0 })
        const isLet = letKeys.has(mo.key) ? 1 : 0
        mo.units++; mo.unitsLet += isLet
        cs.units = (cs.units || 0) + 1; cs.unitsLet = (cs.unitsLet || 0) + isLet
      }
    }
    if (!rows.length) { countUnits(); continue }
    // Evaluate each month as at its own last day: the engine short-circuits
    // periods that have not started yet (FUTURE) before it works out an
    // expectation, which would hide a mid-month move-in from the forecast.
    const rowsByKey = new Map()
    for (const r of rows) { const k = `${r.year}-${r.month}`; if (!rowsByKey.has(k)) rowsByKey.set(k, []); rowsByKey.get(k).push(r) }
    for (const [k, monthRows] of rowsByKey) {
      const mo = byKey.get(k)
      mo.propertiesWithRows++
      const evals = evaluateProperty({ ...p, rent_payments: monthRows }, { today: monthBounds(mo.year, mo.month).end, siblings: p.rent_payments })
      const co = p.company_id || 'none'
      const cs = (mo.byCompany[co] ||= { expected: 0, received: 0, needsBackfill: 0 })
      for (const e of evals) {
        mo.periods++
        const rec = e.received == null ? 0 : e.received
        if (e.state === STATE.STL) { mo.stlReceived = round2(mo.stlReceived + rec); continue }
        if (e.needsBackfill || rateContribution(e) || (e.state === STATE.LEGACY && rec > 0)) letKeys.add(k)
        // Paid with no amount: excluded from BOTH due and collected (decision
        // 2, 2 Sep 2026), the same as the Rent Tracker. Counting its rent as
        // due with GBP 0 collected is what dragged Jan 2026 to ~57%.
        if (e.needsBackfill) {
          mo.needsBackfill++; cs.needsBackfill++
          mo.backfillRent = round2(mo.backfillRent + (Number(e.expected) || 0))
          continue
        }
        const c = rateContribution(e)
        if (c) {
          // Collected is capped at each period's own due, so one tenant's
          // overpayment never hides another tenant's arrears. The surplus is
          // reported separately.
          mo.expected = round2(mo.expected + c.due); mo.received = round2(mo.received + c.received); mo.excess = round2(mo.excess + c.excess)
          cs.expected = round2(cs.expected + c.due); cs.received = round2(cs.received + c.received)
        } else if (e.state === STATE.LEGACY) {
          // Pre go-live months carry no expectation; what came in still shows.
          mo.received = round2(mo.received + rec); cs.received = round2(cs.received + rec)
        } else if (rec > 0) {
          // Money recorded against a period that is not collectible (an
          // approved non-chargeable period, or overridden). Kept visible but
          // out of the collection rate.
          mo.otherReceived = round2(mo.otherReceived + rec)
        }
      }
    }
    countUnits()
  }
  for (const mo of months) mo.outstanding = round2(Math.max(0, mo.expected - mo.received))
  return months
}

const dateOnly = d => (d ? String(d).slice(0, 10) : '')

// Owned at some point in the month: bought by its last day, not sold before
// its first. Missing dates mean "always owned".
function ownedDuring(p, mo) {
  const { start, end } = monthBounds(mo.year, mo.month)
  const bought = dateOnly(p.purchase_date), sold = dateOnly(p.sale_date)
  if (bought && bought > end) return false
  if (sold && sold < start) return false
  return true
}

// A tenancy record overlaps the month (used only when there are no rent rows).
function tenancyCovers(p, mo) {
  const { start, end } = monthBounds(mo.year, mo.month)
  return (p.tenancies || []).some(t => {
    const from = dateOnly(t.tenancy_start)
    if (!from || from > end) return false
    const to = dateOnly(t.expected_move_out) || dateOnly(t.tenancy_end)
    return !to || to >= start
  })
}

// Share of units let, 0-100. Null when there are no units.
export function occupancyRate(mo) {
  if (!mo || !(mo.units > 0)) return null
  return Math.round((mo.unitsLet / mo.units) * 100)
}

// Collection percentage for a month, capped at 100. Null when nothing was expected.
export function monthRate(mo) {
  if (!mo || !(mo.expected > 0)) return null
  return Math.min(100, Math.round((mo.received / mo.expected) * 100))
}
