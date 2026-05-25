// ── NUMBER FORMATTING ─────────────────────────────────────────────────────
// Single source of truth for how numbers and money are displayed.
// Imported by every component that renders a money value, so that
// formatting rules are consistent everywhere (and easy to change in one
// place if we ever localise to a different currency).

// NaN sentinel: a sum that ended up NaN (e.g. arithmetic on undefined) is a
// real bug. Previously we coerced NaN → 0 with `n || 0`, which silently
// rendered "£0" and made data corruption invisible. Now we surface it as
// "—" so it stands out for the user (and gets reported as a bug). Null/
// undefined are still treated as legitimate zero values.
const NAN_DISPLAY = '—'
const isRealNumber = (n) => typeof n === 'number' && Number.isFinite(n)

/**
 * Format a number as GBP currency with thousand separators and no decimals.
 * Examples:
 *   fmt(1500)       → "£1,500"
 *   fmt(2500000)    → "£2,500,000"
 *   fmt(null)       → "£0"
 *   fmt(undefined)  → "£0"
 *   fmt(NaN)        → "—"   (NEW: catches arithmetic bugs)
 */
export const fmt = (n) => {
  if (n == null) return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(0)
  if (!isRealNumber(Number(n))) return NAN_DISPLAY
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(Number(n))
}

/**
 * Format a number as GBP currency with two decimal places.
 * Use for cases where pence matter (statement importers, individual
 * transaction amounts, exact reconciliation).
 */
export const fmtMoney2dp = (n) => {
  if (n == null) return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(0)
  if (!isRealNumber(Number(n))) return NAN_DISPLAY
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(n))
}

// Sum money values to pennies safely — rounds each addend to 2dp before
// summing to avoid float drift on long lists. Use this anywhere a total is
// shown to the user or sent to HMRC.
//   sumMoney([0.1, 0.2]) → 0.30  (vs. 0.1+0.2 = 0.30000000000000004)
export function sumMoney(values) {
  let pennies = 0
  for (const v of values) {
    if (v == null) continue
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    pennies += Math.round(n * 100)
  }
  return pennies / 100
}

/**
 * Format a number as a percentage with N decimal places (default 1).
 * Examples:
 *   fmtPct(5)      → "5.0%"
 *   fmtPct(5.25)   → "5.3%"
 *   fmtPct(5.25, 2) → "5.25%"
 */
export const fmtPct = (n, decimals = 1) => (Number(n) || 0).toFixed(decimals) + '%'

/**
 * Format a plain number with thousand separators (no currency symbol).
 * For things like "1,234 properties" or counters.
 *   fmtNum(1234)      → "1,234"
 *   fmtNum(1234567)   → "1,234,567"
 */
export const fmtNum = (n) => new Intl.NumberFormat('en-GB').format(Number(n) || 0)

/**
 * Parse a user-typed money string back to a Number. Strips commas, spaces,
 * currency symbols, but keeps decimal points and minus signs.
 * Returns NaN for empty/non-numeric input — callers should default to 0
 * or null as appropriate.
 *   parseMoney("1,234.56")  → 1234.56
 *   parseMoney("£2,500,000") → 2500000
 *   parseMoney("")           → NaN
 */
export function parseMoney(str) {
  if (str == null || str === '') return NaN
  if (typeof str === 'number') return str
  // Strip £, $, €, spaces, commas; keep digits, dots, minus
  const cleaned = String(str).replace(/[£$€,\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? NaN : n
}
