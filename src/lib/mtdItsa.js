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
// payments: [{ id, amount, period_start, period_end, status, year?, month?,
//              rent_allocations? }]
//            (rows carrying money received — status paid, partial or late
//             with an amount, see RECEIVED_STATUSES — count as income;
//             legacy rows with NULL period_start fall back to year/month,
//             treated as the 1st of that month)
// receipts: optional rent_receipts rows ({ received_date, rent_allocations:
//           [{ rent_payment_id, target, amount }] }). When given, income
//           follows the rent engine (rentEngine.js evaluatePeriod): a period
//           that has current-rent allocations is income from those
//           allocations, recognised on the receipt's received_date (cash
//           basis; a bounce or refund is a negative receipt on its own date).
//           Only a period with no allocations at all falls back to the legacy
//           row amount on its period start. Pass every receipt received in
//           the window, and give each payment row its own `rent_allocations`
//           (or include its receipts) so the summary can tell which rows are
//           allocated even when the money arrived outside the window.
//           Omitted → the legacy row-only behaviour.
// expenses: [{ amount, date, category }]
// mortgageInterest: number — ESTIMATED interest for the period, for the
//                   properties with no 'mortgage_interest' expense recorded
//                   in it (see estimateMortgageInterest). Recorded interest
//                   arrives through `expenses`; never pass both for the
//                   same property.
//
// Returns:
//   {
//     fromDate, toDate,
//     income: { periodAmount, taxDeducted },
//     expenses: { premisesRunningCosts, repairsAndMaintenance, ... },
//     totals: { income, expenses, residentialFinancialCost, net }
//   }
// totals.expenses and totals.net leave out residentialFinancialCost: under
// Section 24 an individual cannot deduct mortgage interest from rental
// profit; it is relieved as a 20% basic-rate tax credit instead, so it is
// reported on its own line (it is still sent to HMRC in `expenses`).
//
// HMRC accepts a partial/zero body — empty quarters are fine and required
// (you can't skip a quarter once you're in the regime).
// rent_payments statuses that carry money received. Mirrors the rent
// engine's legacy receipt bridge (rentEngine.js evaluatePeriod / hasMoney):
// a 'late' or 'partial' row with an amount is money in, not arrears.
export const RECEIVED_STATUSES = ['paid', 'partial', 'late']

export const FINANCE_COST_NOTE = 'relieved as a 20% basic-rate tax credit'

export function buildQuarterlySummary({ payments = [], expenses = [], receipts = null, mortgageInterest = 0, periodFrom, periodTo } = {}) {
  const inRange = (d) => d && d >= periodFrom && d <= periodTo

  // Income. With receipts, a period that has current-rent allocations is
  // counted from those allocations on the date the money was received (the
  // same source of truth as the Rent Tracker). Without allocations, the
  // legacy bridge applies: `amount` on a row that carries money received
  // (paid, partial or late), recognised on its period_start because the row
  // itself records no receipt date. Legacy rows have NULL period_start but
  // always carry year/month — fall back to the first of that month so they
  // aren't silently excluded.
  const pad2 = (n) => String(n).padStart(2, '0')
  const recognitionDate = (p) =>
    p?.period_start || (p?.year && p?.month ? `${p.year}-${pad2(p.month)}-01` : null)
  const isCurrentRent = (a) => a?.target === 'current_rent' && a?.rent_payment_id
  const allocatedRows = new Set()
  let periodAmount = 0
  if (Array.isArray(receipts)) {
    for (const p of payments) {
      for (const a of (p?.rent_allocations || [])) {
        if (a?.target === 'current_rent') allocatedRows.add(p.id)
      }
    }
    for (const r of receipts) {
      const allocs = (r?.rent_allocations || []).filter(isCurrentRent)
      for (const a of allocs) allocatedRows.add(a.rent_payment_id)
      if (!inRange(r?.received_date)) continue
      for (const a of allocs) periodAmount += Number(a.amount) || 0
    }
  }
  for (const p of payments) {
    if (p?.id && allocatedRows.has(p.id)) continue
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
  const financeCosts = periodExpenses.residentialFinancialCost || 0
  const deductible = Object.entries(periodExpenses)
    .filter(([k]) => k !== 'residentialFinancialCost')
    .reduce((s, [, v]) => s + v, 0)

  return {
    fromDate: periodFrom,
    toDate: periodTo,
    income: { periodAmount: round(periodAmount), taxDeducted: 0 },
    expenses: periodExpenses,
    totals: {
      income: round(periodAmount),
      expenses: round(deductible),
      residentialFinancialCost: round(financeCosts),
      net: round(periodAmount - deductible),
    },
  }
}

// ── QUARTER + YEAR TO DATE ──────────────────────────────────────────
// MTD quarterly updates are cumulative: each one covers 6 April to the end
// of the quarter. Returns the year-to-date summary (what a submission sends)
// with this quarter's own figures alongside as `quarter`.
//
// Pass raw rows covering at least 6 April → quarter end (see
// fetchMtdRawForPeriod). Estimated mortgage interest is worked out quarter
// by quarter and added up, so a property with interest recorded in one
// quarter is still estimated in the others, exactly as each quarter alone.
export function buildQuarterAndYearToDate({ taxYear, quarter, payments = [], expenses = [], receipts = null, mortgageProps = [] } = {}) {
  const qs = quartersForTaxYear(taxYear)
  const q = qs.find(x => x.quarter === Number(quarter))
  if (!q) return null
  const yearFrom = qs[0].from
  const interestFor = (x) => estimateMortgageInterest({ mortgageProps, expenses, periodFrom: x.from, periodTo: x.to })
  const ytdInterest = Math.round(qs.filter(x => x.quarter <= q.quarter).reduce((s, x) => s + interestFor(x), 0) * 100) / 100
  const quarterSummary = buildQuarterlySummary({ payments, expenses, receipts, mortgageInterest: interestFor(q), periodFrom: q.from, periodTo: q.to })
  const ytd = buildQuarterlySummary({ payments, expenses, receipts, mortgageInterest: ytdInterest, periodFrom: yearFrom, periodTo: q.to })
  return { ...ytd, cumulative: true, quarter: quarterSummary }
}

// Do two summaries carry the same figures for HMRC (period, income and
// every expense bucket)? Used to tell whether a saved draft still matches
// the current data before it is submitted.
export function sameSubmissionFigures(a, b) {
  if (!a || !b) return false
  if (a.fromDate !== b.fromDate || a.toDate !== b.toDate) return false
  const n = (v) => Math.round((Number(v) || 0) * 100)
  if (n(a.income?.periodAmount) !== n(b.income?.periodAmount)) return false
  if (n(a.income?.taxDeducted) !== n(b.income?.taxDeducted)) return false
  for (const k of HMRC_EXPENSE_CATEGORIES) {
    if (n(a.expenses?.[k]) !== n(b.expenses?.[k])) return false
  }
  return true
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

// ── LEGAL OWNERSHIP SCOPE ───────────────────────────────────────────
// Companies double as plain portfolio groups, so a company_id alone can't say
// whether rent is personal (MTD ITSA) or corporation-tax income. The explicit
// companies.legal_owner flag decides: 'limited_company' → left out of MTD;
// 'personal' or NULL (not set yet) → included, so nothing changes until the
// user sets it. Properties with no company are always personal.

export const LEGAL_OWNER_PERSONAL = 'personal'
export const LEGAL_OWNER_LIMITED = 'limited_company'

// True when a PostgREST / Postgres error says companies.legal_owner isn't
// there yet (app deployed before the migration was applied). Only used on a
// query whose sole optional column is legal_owner, so 42703 (undefined
// column) is unambiguous there.
export function isMissingLegalOwnerColumnError(err) {
  if (!err) return false
  if (err.code === '42703') return true
  const msg = [err.message, err.details, err.hint].filter(Boolean).join(' ')
  return /legal_owner/.test(msg) && /does not exist|schema cache|could not find/i.test(msg)
}

// Split properties into those that belong in personal MTD figures and those
// held by a limited company. `companies` rows need { id, name, legal_owner };
// pass legalOwnerSupported=false (column missing) to include everything.
export function splitPropertiesByLegalOwner(properties = [], companies = [], { legalOwnerSupported = true } = {}) {
  const byId = new Map((companies || []).map(c => [c.id, c]))
  const included = []
  const excluded = []
  const excludedByCo = new Map()
  const unsetByCo = new Map()
  const tally = (map, co) => {
    const row = map.get(co.id) || { id: co.id, name: co.name, count: 0 }
    row.count++
    map.set(co.id, row)
  }
  for (const p of properties || []) {
    const co = p.company_id ? byId.get(p.company_id) : null
    const lo = legalOwnerSupported ? co?.legal_owner : null
    if (co && lo === LEGAL_OWNER_LIMITED) {
      excluded.push(p)
      tally(excludedByCo, co)
    } else {
      included.push(p)
      if (legalOwnerSupported && co && lo == null) tally(unsetByCo, co)
    }
  }
  return {
    included,
    excluded,
    excludedCompanies: [...excludedByCo.values()],
    unsetCompanies: [...unsetByCo.values()],
    legalOwnerSupported,
  }
}
