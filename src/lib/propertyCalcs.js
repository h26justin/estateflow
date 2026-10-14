// Pure per-property calculations (moved verbatim from App.jsx).
import { propValue } from './propertyValue'

// Allow only http(s) destinations into href/location sinks. Relative URLs
// resolve against the app origin and pass; javascript:/data:/etc. are blocked.
export function isSafeUrl(url) {
  try {
    const proto = new URL(String(url), window.location.origin).protocol
    return proto === 'http:' || proto === 'https:'
  } catch (e) { return false }
}

export function calcMonthlyMortgage(p) {
  // Priority 1: user-entered actual monthly payment (any positive number).
  // Real mortgages have fees, part-and-part splits, product transitions
  // etc that the textbook formula can't model. When the user knows their
  // actual direct debit, store it and trust it.
  if (p.mortgage_monthly_payment && Number(p.mortgage_monthly_payment) > 0) {
    return Number(p.mortgage_monthly_payment)
  }
  if (!p.mortgage_rate || !p.mortgage_amount) return 0
  const amount = Number(p.mortgage_amount), rate = Number(p.mortgage_rate)
  // Priority 2: honour mortgage_type when set. Interest-only is much
  // simpler than the repayment annuity formula.
  if (p.mortgage_type === 'interest_only') {
    return amount * rate / 12
  }
  // Priority 3 (default): repayment annuity. Same as before this rewrite.
  const r = rate / 12, n = (p.mortgage_term || 25) * 12
  return amount * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1)
}
export function calcGrossYield(p, basis='cost') {
  const base = basis==='value'
    ? propValue(p)
    : (p.purchase_price||0)+(p.refurb_cost||0)
  return base&&p.rent_pcm?((p.rent_pcm*12)/base)*100:0
}
export function calcMonthlyProfit(p) {
  return (p.rent_pcm||0)-calcMonthlyMortgage(p)-(p.insurance||0)/12
}

// Derive a hairline icon + bedroom count from the free-text prop_type
// ("1-Bed Flat", "House", "HMO Room", "Studio", …). `beds` is null when the
// type doesn't state one (e.g. plain "House"); `studio` flags studios.
export function propTypeMeta(propType) {
  const t = String(propType || '').toLowerCase()
  const bedM = t.match(/(\d+)\s*-?\s*bed/)
  const beds = bedM ? parseInt(bedM[1], 10) : null
  const studio = /studio|bedsit/.test(t)
  let icon = 'home'
  if (/hmo|room/.test(t)) icon = 'bed'
  else if (/flat|apartment|maisonette|studio|bedsit/.test(t)) icon = 'building'
  else if (/commercial|office|shop|retail|unit/.test(t)) icon = 'landmark'
  // house / bungalow / detached / terraced / semi / (unknown) → home
  return { icon, beds, studio }
}
