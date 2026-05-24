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

// Returns the 4 quarter ranges for a given tax year, with HMRC-style
// deadlines (1 month + 5 days after each quarter end).
export function quartersForTaxYear(taxYear) {
  const py = parseTaxYear(taxYear)
  if (!py) return []
  const sy = py.startYear
  return [
    { quarter: 1, from: `${sy}-04-06`,     to: `${sy}-07-05`,     deadline: `${sy}-08-05` },
    { quarter: 2, from: `${sy}-07-06`,     to: `${sy}-10-05`,     deadline: `${sy}-11-05` },
    { quarter: 3, from: `${sy}-10-06`,     to: `${sy+1}-01-05`,   deadline: `${sy+1}-02-05` },
    { quarter: 4, from: `${sy+1}-01-06`,   to: `${sy+1}-04-05`,   deadline: `${sy+1}-05-05` },
  ]
}

// Which quarter is "current" for a date? Returns quarter number 1-4 or
// null if the date is outside the tax year.
export function currentQuarter(date = new Date()) {
  const ty = taxYearForDate(date)
  const qs = quartersForTaxYear(ty)
  const ds = date.toISOString().slice(0, 10)
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

export function mapExpenseCategoryToHmrc(internal) {
  switch (String(internal || '').toLowerCase()) {
    case 'maintenance':  return 'repairsAndMaintenance'
    case 'utilities':    return 'premisesRunningCosts'
    case 'insurance':    return 'premisesRunningCosts'
    case 'cleaning':     return 'costOfServices'
    case 'garden':       return 'costOfServices'
    case 'professional': return 'professionalFees'
    case 'agent_fees':   return 'professionalFees'
    case 'compliance':   return 'professionalFees'
    case 'mortgage_interest': return 'residentialFinancialCost'
    case 'travel':       return 'travelCosts'
    default:             return 'other'
  }
}

// ── AGGREGATOR ──────────────────────────────────────────────────────

// Build the HMRC-shape periodic submission body from raw payments+expenses.
//
// payments: [{ amount, period_start, period_end, status }]
//            (status='paid' rows count as recognised income for the period)
// expenses: [{ amount, date, category }]
// mortgageInterest: { totalForPeriod }  — sum of interest accrued in period
//                                          (optional; user may track separately)
//
// Returns:
//   {
//     periodIncome: { premiumsOfLeaseGrant?, reversePremiums?, periodAmount, taxDeducted, otherIncome },
//     periodExpenses: { premisesRunningCosts, repairsAndMaintenance, ... }
//   }
//
// HMRC accepts a partial/zero body — empty quarters are fine and required
// (you can't skip a quarter once you're in the regime).
export function buildQuarterlySummary({ payments = [], expenses = [], mortgageInterest = 0, periodFrom, periodTo } = {}) {
  const inRange = (d) => d && d >= periodFrom && d <= periodTo

  // Income — sum of `amount` on payments where status='paid' and the
  // rental period_start falls inside the quarter. We use period_start as
  // the cash-basis recognition date because the schema doesn't track a
  // separate payment_date (rows are flipped status='paid' when received).
  let periodAmount = 0
  for (const p of payments) {
    if (p?.status !== 'paid') continue
    const paid = Number(p?.amount || 0)
    if (paid <= 0) continue
    if (!inRange(p?.period_start)) continue
    periodAmount += paid
  }

  // Expenses
  const buckets = Object.fromEntries(HMRC_EXPENSE_CATEGORIES.map(c => [c, 0]))
  for (const e of expenses) {
    const amt = Number(e?.amount || 0)
    if (amt <= 0) continue
    if (!inRange(e?.date)) continue
    const bucket = mapExpenseCategoryToHmrc(e?.category)
    buckets[bucket] = (buckets[bucket] || 0) + amt
  }

  // Layer on mortgage interest if passed separately (preferred — we track
  // it on the mortgage record, not as expenses)
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
  const ds = today.toISOString().slice(0, 10)
  if (ds < quarter.from) return { label: 'Upcoming', tone: 'muted' }
  if (ds <= quarter.to) return { label: 'In progress', tone: 'blue' }
  if (ds <= quarter.deadline) {
    const daysLeft = Math.ceil((new Date(quarter.deadline) - today) / (1000*60*60*24))
    if (daysLeft <= 7) return { label: `Due in ${daysLeft}d`, tone: 'amber' }
    return { label: 'Ready to file', tone: 'amber' }
  }
  return { label: 'Overdue', tone: 'red' }
}
