// ── NUMBER FORMATTING ─────────────────────────────────────────────────────
// Single source of truth for how numbers and money are displayed.
// Imported by every component that renders a money value, so that
// formatting rules are consistent everywhere (and easy to change in one
// place if we ever localise to a different currency).

/**
 * Format a number as GBP currency with thousand separators and no decimals.
 * Examples:
 *   fmt(1500)       → "£1,500"
 *   fmt(2500000)    → "£2,500,000"
 *   fmt(null)       → "£0"
 *   fmt(undefined)  → "£0"
 */
export const fmt = (n) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(n || 0)

/**
 * Format a number as GBP currency with two decimal places.
 * Use for cases where pence matter (statement importers, individual
 * transaction amounts, exact reconciliation).
 */
export const fmtMoney2dp = (n) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0)

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
