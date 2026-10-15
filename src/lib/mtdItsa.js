// MTD ITSA helpers — UK tax year quarters, HMRC expense-category mapping,
// and aggregation of rent_payments + property_expenses into the shape HMRC
// expects on the periodic property submission endpoint.
//
// All amounts are GBP. HMRC uses pence in some endpoints and pounds in
// others — here we return pounds-with-2dp; the edge function converts to
// the wire format on submission.
//
// HMRC docs:
//   https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/property-business-api
//
// UK tax year: 6 Apr (YYYY) → 5 Apr (YYYY+1). Conventionally written
// "2026-27" for the year ending 5 Apr 2027.

import { isoToday, daysBetween } from './rentEngine'

// ── TAX YEAR HELPERS ────────────────────────────────────────────────

// Returns the tax year string ('2026-27') for any given date.
export function taxYearForDate(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const day = d.getDate()
  // Before 6 Apr → previous tax year
  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1
  const endShort = String((startYear + 1) % 100).padStart(2, '0')
  return `${startYear}-${endShort}`
}

// Current tax year (today)
export function currentTaxYear() { return taxYearForDate(new Date()) }

// Parse '2026-27' → { startYear: 2026, endYear: 2027 }
export function parseTaxYear(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const startYear = parseInt(m[1], 10)
  return { startYear, endYear: startYear + 1 }
}

// Returns the 4 quarter ranges for a given tax year. HMRC's quarterly
// update deadline is the 7th of the month following the quarter end
// (7 Aug / 7 Nov / 7 Feb / 7 May — same convention as VAT's "1 month
// and 7 days").
export function quartersForTaxYear(taxYear) {
  const py = parseTaxYear(taxYear)
  if (!py) return []
  const sy = py.startYear
  return [
    { quarter: 1, from: `${sy}-04-06`,     to: `${sy}-07-05`,     deadline: `${sy}-08-07` },
    { quarter: 2, from: `${sy}-07-06`,     to: `${sy}-10-05`,     deadline: `${sy}-11-07` },
    { quarter: 3, from: `${sy}-10-06`,     to: `${sy+1}-01-05`,   deadline: `${sy+1}-02-07` },
    { quarter: 4, from: `${sy+1}-01-06`,   to: `${sy+1}-04-05`,   deadline: `${sy+1}-05-07` },
  ]
}

// Which quarter is "current" for a date? Returns quarter number 1-4 or
// null if the date is outside the tax year.
export function currentQuarter(date = new Date()) {
  const ty = taxYearForDate(date)
  const qs = quartersForTaxYear(ty)
  // Local calendar date, not UTC: at 00:30 BST on 6 July the UK is already
  // in Q2, while toISOString() still says 5 July.
  const ds = isoToday(date)
  for (const q of qs) if (ds >= q.from && ds <= q.to) return q
  return null
}

// ── EXPENSE CATEGORY MAPPING ────────────────────────────────────────

// Our internal expense categories → HMRC MTD ITSA property expense buckets.
// HMRC's UK Property periodic submission accepts (cash basis):
//   premisesRunningCosts, repairsAndMaintenance, financialCosts,
//   professionalFees, costOfServices, travelCosts, other,
//   residentialFinancialCost (mortgage interest, restricted).
//
// Mortgage interest goes into residentialFinancialCost — HMRC restricts
// landlord mortgage interest relief to basic rate, so it's a separate
// bucket from financialCosts.
export const HMRC_EXPENSE_CATEGORIES = [
  'premisesRunningCosts',
  'repairsAndMaintenance',
  'financialCosts',
  'professionalFees',
  'costOfServices',
  'travelCosts',
  'other',
  'residentialFinancialCost',
]

// Keys are the property_expenses.category values the ExpensesTab picker
// (FeatureComponents.jsx) and the CSV importer write, plus a few older keys.
// Returns null for a category that is NOT an allowable revenue expense:
// 'mortgage' is the full "Mortgage Payment" (capital + interest). Capital is
// never deductible, and the interest element is claimed separately through
// residentialFinancialCost (recorded 'mortgage_interest' rows, otherwise the
// estimate from the mortgage record), so the payment itself is left out.
export function mapExpenseCategoryToHmrc(internal) {
  switch (String(internal || '').toLowerCase()) {
    // Rent, rates, insurance, ground rents and service charges
    case 'insurance':      return 'premisesRunningCosts'
    case 'ground_rent':    return 'premisesRunningCosts'
    case 'service_charge': return 'premisesRunningCosts'
    case 'utilities':      return 'premisesRunningCosts'
    // Property repairs and maintenance
    case 'repairs':        return 'repairsAndMaintenance'
    case 'maintenance':    return 'repairsAndMaintenance'
    // Legal, management and other professional fees
    case 'agent_fees':     return 'professionalFees'
    case 'legal':          return 'professionalFees'
    case 'accountancy':    return 'professionalFees'
    case 'professional':   return 'professionalFees'
    case 'compliance':     return 'professionalFees'
    // Costs of services provided
    case 'cleaning':       return 'costOfServices'
    case 'garden':         return 'costOfServices'
    case 'travel':         return 'travelCosts'
    case 'mortgage_interest': return 'residentialFinancialCost'
    case 'mortgage':       return null
    default:               return 'other'
  }
}

// Estimated mortgage interest for a period, from the mortgage record on each
// property (balance x annual rate x days / 365). A property that has actual
// 'mortgage_interest' expenses recorded in the period is skipped: the
// recorded figure is used instead, so the interest is never counted twice.
//
// mortgageProps: [{ id, mortgage_amount, mortgage_rate }] (rate as a decimal)
// expenses:      property_expenses rows ({ property_id, category, amount, date })
export function estimateMortgageInterest({ mortgageProps = [], expenses = [], periodFrom, periodTo } = {}) {
  if (!periodFrom || !periodTo) return 0
  const recorded = new Set(
    expenses
      .filter(e => String(e?.category || '').toLowerCase() === 'mortgage_interest'
        && Number(e?.amount) > 0 && e?.date >= periodFrom && e?.date <= periodTo)
      .map(e => e.property_id)
  )
  const periodDays = Math.max(0, daysBetween(periodFrom, periodTo))
  const annual = mortgageProps
    .filter(p => Number(p?.mortgage_amount) > 0 && Number(p?.mortgage_rate) > 0 && !recorded.has(p.id))
    .reduce((s, p) => s + Number(p.mortgage_amount) * Number(p.mortgage_rate), 0)
  return Math.round((annual * periodDays / 365) * 100) / 100
}

// ── AGGREGATOR ──────────────────────────────────────────────────────

// Build the HMRC-shape periodic submission body from raw payments+expenses.
//
// payments: [{ amount, period_start, period_end, status, year?, month? }]
//            (rows carrying money received — status paid, partial or late
//             with an amount, see RECEIVED_STATUSES — count as income;
//             legacy rows with NULL period_start fall back to year/month,
//             treated as the 1st of that month)
// expenses: [{ amount, date, category }]
// mortgageInterest: number — ESTIMATED interest for the period, for the
//                   properties with no 'mortgage_interest' expense recorded
//                   in it (see estimateMortgageInterest). Recorded interest
//                   arrives through `expenses`; never pass both for the
//                   same property.
//
// Returns:
//   {
//     periodIncome: { premiumsOfLeaseGrant?, reversePremiums?, periodAmount, taxDeducted, otherIncome },
//     periodExpenses: { premisesRunningCosts, repairsAndMaintenance, ... }
//   }
//
// HMRC accepts a partial/zero body — empty quarters are fine and required
// (you can't skip a quarter once you're in the regime).
// rent_payments statuses that carry money received. Mirrors the rent
// engine's legacy receipt bridge (rentEngine.js evaluatePeriod / hasMoney):
// a 'late' or 'partial' row with an amount is money in, not arrears.
export const RECEIVED_STATUSES = ['paid', 'partial', 'late']

export function buildQuarterlySummary({ payments = [], expenses = [], mortgageInterest = 0, periodFrom, periodTo } = {}) {
  const inRange = (d) => d && d >= periodFrom && d <= periodTo

  // Income — sum of `amount` on payments that carry money received (paid,
  // partial or late, the same set the rent engine treats as a receipt) and
  // whose rental period_start falls inside the quarter. We use period_start as
  // the cash-basis recognition date because the schema doesn't track a
  // separate payment_date (rows are flipped status='paid' when received).
  // Legacy rows have NULL period_start but always carry year/month — fall
  // back to the first of that month so they aren't silently excluded.
  const pad2 = (n) => String(n).padStart(2, '0')
  const recognitionDate = (p) =>
    p?.period_start || (p?.year && p?.month ? `${p.year}-${pad2(p.month)}-01` : null)
  let periodAmount = 0
  for (const p of payments) {
    if (!RECEIVED_STATUSES.includes(p?.status)) continue
    const paid = Number(p?.amount || 0)
    if (paid <= 0) continue
    if (!inRange(recognitionDate(p))) continue
    periodAmount += paid
  }

  // Expenses
  const buckets = Object.fromEntries(HMRC_EXPENSE_CATEGORIES.map(c => [c, 0]))
  for (const e of expenses) {
    const amt = Number(e?.amount || 0)
    if (amt <= 0) continue
    if (!inRange(e?.date)) continue
    const bucket = mapExpenseCategoryToHmrc(e?.category)
    if (!bucket) continue   // not an allowable expense (mortgage capital)
    buckets[bucket] = (buckets[bucket] || 0) + amt
  }

  // Layer on the estimated mortgage interest (from the mortgage record) for
  // properties that have no recorded interest in the period.
  if (Number(mortgageInterest) > 0) {
    buckets.residentialFinancialCost = (buckets.residentialFinancialCost || 0) + Number(mortgageInterest)
  }

  // Round everything to 2dp
  const round = (n) => Math.round(n * 100) / 100
  const periodExpenses = {}
  for (const k of HMRC_EXPENSE_CATEGORIES) {
    if (buckets[k] > 0) periodExpenses[k] = round(buckets[k])
  }

  return {
    fromDate: periodFrom,
    toDate: periodTo,
    income: { periodAmount: round(periodAmount), taxDeducted: 0 },
    expenses: periodExpenses,
    totals: {
      income: round(periodAmount),
      expenses: round(Object.values(periodExpenses).reduce((s,v) => s+v, 0)),
      net: round(periodAmount - Object.values(periodExpenses).reduce((s,v) => s+v, 0)),
    },
  }
}

// ── STATUS HELPERS ──────────────────────────────────────────────────

export function quarterStatusLabel(quarter, submission, today = new Date()) {
  if (submission?.status === 'submitted' || submission?.status === 'accepted') return { label: 'Submitted', tone: 'green' }
  if (submission?.status === 'rejected') return { label: 'Rejected', tone: 'red' }
  if (submission?.status === 'error') return { label: 'Error', tone: 'red' }
  const ds = isoToday(today)   // local calendar date, not UTC
  if (ds < quarter.from) return { label: 'Upcoming', tone: 'muted' }
  if (ds <= quarter.to) return { label: 'In progress', tone: 'blue' }
  if (ds <= quarter.deadline) {
    const daysLeft = daysBetween(ds, quarter.deadline) - 1
    if (daysLeft <= 7) return { label: `Due in ${daysLeft}d`, tone: 'amber' }
    return { label: 'Ready to file', tone: 'amber' }
  }
  return { label: 'Overdue', tone: 'red' }
}
