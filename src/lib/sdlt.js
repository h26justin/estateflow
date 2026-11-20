// Stamp Duty Land Tax (England and Northern Ireland, residential), by the
// date of the transaction. SDLT is charged at the rates in force on the
// effective date, which for a normal purchase is completion. Pure, no I/O.
//
// Rate history modelled (from 1 Oct 2021, after the Covid holiday ended):
//   1 Oct 2021      nil band £125k, 2% to £250k, 5% to £925k, 10% to £1.5m,
//                   12% above. First-time buyers: 0% to £300k, 5% to £500k,
//                   no relief above £500k. Higher rates: +3%.
//   23 Sep 2022     nil band £250k (2% band gone). FTB: 0% to £425k, 5% to
//                   £625k, no relief above £625k. Higher rates: +3%.
//   31 Oct 2024     higher rates surcharge rises to +5%.
//   1 Apr 2025      back to the Oct 2021 bands and FTB limits; surcharge +5%.
//
// Higher rates (additional dwellings) do not apply when the price is under
// £40,000. Not modelled: non-resident surcharge, the 17% rate for companies
// buying dwellings over £500k, multiple-dwellings relief (abolished 1 Jun
// 2024) and mixed-use rates. The calculator's manual override covers these.

export const HIGHER_RATES_MIN_PRICE = 40000

const BANDS_125K = [[125000, 0], [250000, 0.02], [925000, 0.05], [1500000, 0.10], [Infinity, 0.12]]
const BANDS_250K = [[250000, 0], [925000, 0.05], [1500000, 0.10], [Infinity, 0.12]]

// Newest first. `from` is the first effective date the regime applies to.
export const SDLT_REGIMES = Object.freeze([
  { from: '2025-04-01', label: 'from 1 Apr 2025', bands: BANDS_125K, surcharge: 0.05, ftb: { nil: 300000, cap: 500000 } },
  { from: '2024-10-31', label: '31 Oct 2024 to 31 Mar 2025', bands: BANDS_250K, surcharge: 0.05, ftb: { nil: 425000, cap: 625000 } },
  { from: '2022-09-23', label: '23 Sep 2022 to 30 Oct 2024', bands: BANDS_250K, surcharge: 0.03, ftb: { nil: 425000, cap: 625000 } },
  { from: '2021-10-01', label: '1 Oct 2021 to 22 Sep 2022', bands: BANDS_125K, surcharge: 0.03, ftb: { nil: 300000, cap: 500000 } },
])
const EARLIEST = SDLT_REGIMES[SDLT_REGIMES.length - 1].from

const isoDay = v => {
  const s = typeof v === 'string' ? v.slice(0, 10) : (v instanceof Date && !isNaN(v) ? v.toISOString().slice(0, 10) : '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
const todayIso = () => new Date().toISOString().slice(0, 10)

/** The regime in force on `date` (ISO 'YYYY-MM-DD'; default today). */
export function sdltRegime(date) {
  const d = isoDay(date) || todayIso()
  const r = SDLT_REGIMES.find(x => d >= x.from) || SDLT_REGIMES[SDLT_REGIMES.length - 1]
  return { ...r, date: d, beforeModelled: d < EARLIEST }
}

/**
 * SDLT on a residential purchase, rounded to the pound.
 * @param {number}  price
 * @param {object}  opts
 * @param {boolean} [opts.additional=true]  higher rates (additional dwelling)
 * @param {boolean} [opts.firstTimeBuyer=false]
 * @param {string}  [opts.date]  effective date, ISO; default today
 */
export function sdltFor(price, { additional = true, firstTimeBuyer = false, date } = {}) {
  const p = Number(price) || 0
  if (p <= 0) return 0
  const r = sdltRegime(date)
  if (firstTimeBuyer && !additional && p <= r.ftb.cap) {
    return Math.round(Math.max(0, p - r.ftb.nil) * 0.05)
  }
  let duty = 0
  let lower = 0
  for (const [upper, rate] of r.bands) {
    if (p > lower) duty += (Math.min(p, upper) - lower) * rate
    lower = upper
  }
  if (additional && p >= HIGHER_RATES_MIN_PRICE) duty += p * r.surcharge
  return Math.round(duty)
}

/** The date a deal's SDLT is worked out at: completion, else the expected or target completion, else today. */
export function dealSdltDate(d) {
  return isoDay(d?.actual_completion_date) || isoDay(d?.expected_completion_date) || isoDay(d?.target_completion_date) || null
}

/** One line describing the basis, for the calculator. */
export function sdltBasisLabel(price, { additional = true, firstTimeBuyer = false, date } = {}) {
  const r = sdltRegime(date)
  const when = isoDay(date) ? `rates ${r.label}` : `today's rates (${r.label}); set a completion date to change`
  const pct = n => `${Math.round(n * 100)}%`
  let what
  if (firstTimeBuyer && !additional) {
    what = Number(price) > r.ftb.cap
      ? `no first-time buyer relief over £${(r.ftb.cap / 1000)}k`
      : `first-time buyer relief: 0% to £${r.ftb.nil / 1000}k, 5% to £${r.ftb.cap / 1000}k`
  } else if (additional) {
    what = Number(price) > 0 && Number(price) < HIGHER_RATES_MIN_PRICE
      ? 'under £40,000: higher rates do not apply'
      : `standard bands + ${pct(r.surcharge)} surcharge`
  } else {
    what = 'standard bands'
  }
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} · ${when}${r.beforeModelled ? ' (earlier dates use the oldest modelled rates)' : ''}`
}
