// Rent tracker statistics — pure functions, no React, no Supabase.
//
// Extracted from App.jsx so the collection-rate arithmetic has a home that can
// be unit-tested and shared. Behaviour here is deliberately IDENTICAL to what
// App.jsx did before the extraction: the tests in __tests__/rentStats.test.js
// pin that behaviour so later stages of the Rent Tracker rebuild can change it
// on purpose rather than by accident.
//
// Vocabulary: a "segment" is one rent_payments row (a whole month, or a dated
// slice of one). A "month" is the set of segments sharing year+month.

// Problems surface first (overdue/late), otherwise paid > refurb > void > future.
export const MONTH_STATUS_PRIORITY = ['overdue', 'missed', 'late', 'partial', 'paid', 'pending', 'refurb', 'void', 'future']

// Collapse a month's segments to one "dominant" status for tiles and counts.
export function monthDominantStatus(segs) {
  for (const s of MONTH_STATUS_PRIORITY) {
    if (segs.some(p => p.status === s)) return s
  }
  return segs[0]?.status || 'void'
}

// Default year for rent year-filters: the current year when it has data,
// otherwise the most recent year that does. Never blindly "latest year with
// rows": future months are pre-generated ~6 months ahead
// (ensureFutureRentMonths), so from July onwards the latest year is NEXT
// year, which made the Rent Tracker open on it.
export function defaultRentYear(payments, now = new Date()) {
  const years = [...new Set(payments.map(p => p.year))].sort()
  if (years.length === 0) return null
  const currentYear = now.getFullYear()
  return years.includes(currentYear) ? currentYear : years[years.length - 1]
}

// Month-level stats for a set of rent segments (optionally scoped to a year).
// Counts collapse a month's segments to its dominant status so a month split
// across several segments (tenant changeover, partial payment + balance)
// counts once. Income sums the actual paid amounts; the rent_pcm fallback for
// legacy amount-less paid rows applies once per month, never per segment.
//
// `now` is injectable so tests are not a function of the wall clock.
export function getMonthlyRentStats(payments, year, rentPcm, now = new Date()) {
  const scoped = year ? payments.filter(p => p.year === year) : payments
  const byMonth = {}
  for (const p of scoped) {
    const key = `${p.year}-${p.month}`
    ;(byMonth[key] ||= []).push(p)
  }
  // Time-aware counts: future months are pre-created as voids
  // (ensureFutureRentMonths) and STL bookings create future PAID months, so
  // anything feeding a "how are we collecting" rate must only look at months
  // up to the current one. voidM is past-months-only for the same reason —
  // an empty August that hasn't happened yet isn't a void.
  const curKey = now.getFullYear() * 12 + now.getMonth() + 1
  let paid = 0, missed = 0, late = 0, refurb = 0, voidM = 0, income = 0, paidToDate = 0
  for (const key in byMonth) {
    const segs = byMonth[key]
    const dom = monthDominantStatus(segs)
    const [ky, km] = key.split('-').map(Number)
    const isFuture = (ky * 12 + km) > curKey
    if (dom === 'paid') { paid++; if (!isFuture) paidToDate++ }
    else if (dom === 'overdue' || dom === 'missed') missed++
    else if (dom === 'late' || dom === 'partial') late++   // partial = attention bucket
    else if (dom === 'refurb') refurb++
    else if (dom === 'void') { if (!isFuture) voidM++ }
    // Income credits actual amounts from paid AND partial segments (matching the
    // Reports module); the rent_pcm fallback only covers a legacy amount-less
    // PAID row, never a partial (a partial without an amount contributes £0).
    const fullPaidSegs = segs.filter(p => p.status === 'paid')
    const incomeSegs = segs.filter(p => p.status === 'paid' || p.status === 'partial')
    const monthIncome = incomeSegs.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    income += monthIncome > 0 ? monthIncome : (fullPaidSegs.length ? (rentPcm || 0) : 0)
  }
  return { paid, missed, late, refurb, voidM, income, paidToDate }
}

// The legacy month-count collection rate the Rent Tracker header shows:
// paid past months over all past months that were paid, missed, late or void.
// Returns null when nothing has been tracked. Kept as a named function so the
// tracker, tests and later comparisons all point at the same arithmetic.
export function legacyCollectionRate(agg) {
  const tracked = agg.paidToDate + agg.missed + agg.late + agg.voidM
  return tracked ? Math.round((agg.paidToDate / tracked) * 100) : null
}

// A paid segment is "STL" when a short-term-let booking links to it
// (stl_bookings join on fetchProperties).
export function stlPaymentIds(property) {
  return new Set((property?.stl_bookings || []).map(b => b.rent_payment_id).filter(Boolean))
}

// ── Overlap detection ───────────────────────────────────────────────────────
// Two date ranges (ISO yyyy-mm-dd strings) share at least one day.
export function periodsIntersect(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false
  return aStart <= bEnd && bStart <= aEnd
}

// Among existing rows for ONE property, find a paid row with a real amount
// whose period shares days with [periodStart, periodEnd] and is not the row
// we intend to update. Writing rent over such a row would count the same
// money twice — the class of error that overstated one company's 2026 rent by
// roughly £35,000 before the CSV importer grew this check.
export function findOverlappingPaid(rows, periodStart, periodEnd, excludeId = null) {
  return (rows || []).find(r =>
    r.id !== excludeId
    && r.status === 'paid'
    && r.amount != null
    && periodsIntersect(r.period_start, r.period_end, periodStart, periodEnd)
  ) || null
}
