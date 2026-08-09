// Company P&L with shareholder profit split — pure calculation module
// (no Supabase, no React) in the style of mtdItsa.js so it can be unit
// tested in isolation.
//
// Pipeline:
//   rent collected (paid rent_payments; falls back to expected rent when a
//   portfolio has no payment records at all)
//   − operating expenses by category (logged property_expenses)
//   − management fees CALCULATED from each company↔agent fee % (to avoid
//     double counting, logged 'agent_fees' expenses are excluded from the
//     expense section whenever calculated fee configs exist)
//   = operating profit
//   − UK corporation tax estimate (19% small profits rate / 25% main rate /
//     marginal relief between, thresholds divided by associated companies)
//   = profit after tax
//   → split by shareholder %; optional dividend tax estimate per
//     shareholder where a tax band is set.
//
// ALL tax figures are estimates for planning, not tax advice: the CT
// calculation ignores capital allowances, disallowables, and group relief;
// the dividend estimate applies the band rate flat, ignoring the £500
// dividend allowance (which spans all of a person's dividends in a year,
// so it can't be attributed to one company).

// ── UK corporation tax (FY2023 onwards) ────────────────────────────────────

export const CT_SMALL_PROFITS_RATE = 0.19
export const CT_MAIN_RATE = 0.25
export const CT_LOWER_LIMIT = 50_000
export const CT_UPPER_LIMIT = 250_000
// Standard marginal relief fraction 3/200.
export const CT_MARGINAL_RELIEF_FRACTION = 3 / 200

// associatedCompanies = TOTAL number of associated companies including this
// one (companies under common control). HMRC divides both limits by it.
export function ukCorporationTax(profit, { associatedCompanies = 1 } = {}) {
  const p = Number(profit) || 0
  const n = Math.max(1, Math.round(associatedCompanies))
  const lower = CT_LOWER_LIMIT / n
  const upper = CT_UPPER_LIMIT / n
  if (p <= 0) return { tax: 0, effectiveRate: 0, band: 'nil', lowerLimit: lower, upperLimit: upper }
  let tax, band
  if (p <= lower) { tax = p * CT_SMALL_PROFITS_RATE; band = 'small' }
  else if (p >= upper) { tax = p * CT_MAIN_RATE; band = 'main' }
  else { tax = p * CT_MAIN_RATE - (upper - p) * CT_MARGINAL_RELIEF_FRACTION; band = 'marginal' }
  tax = Math.round(tax * 100) / 100
  return { tax, effectiveRate: tax / p, band, lowerLimit: lower, upperLimit: upper }
}

// ── Dividend tax (2024/25 onwards rates) ───────────────────────────────────

export const DIVIDEND_TAX_RATES = { basic: 0.0875, higher: 0.3375, additional: 0.3935 }
export const TAX_BAND_LABELS = { basic: 'Basic rate (8.75%)', higher: 'Higher rate (33.75%)', additional: 'Additional rate (39.35%)' }

export function dividendTax(amount, band) {
  const rate = DIVIDEND_TAX_RATES[band]
  if (rate == null) return null
  const a = Math.max(0, Number(amount) || 0)
  return Math.round(a * rate * 100) / 100
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Whole calendar months a range spans (inclusive), floor 1 — used for
// "per month" averages and the expected-rent fallback.
export function monthsInRange(start, end) {
  const s = new Date(start), e = new Date(end)
  if (isNaN(s) || isNaN(e) || e < s) return 1
  const m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1
  return Math.max(1, m)
}

// Display labels for property_expenses.category (kept aligned with the
// ExpensesTab picker in FeatureComponents.jsx).
export const EXPENSE_CATEGORY_LABELS = {
  insurance: 'Insurance', agent_fees: 'Agent / Management Fees',
  repairs: 'Repairs & Maintenance', ground_rent: 'Ground Rent',
  service_charge: 'Service Charge', utilities: 'Utilities',
  mortgage: 'Mortgage Payment', legal: 'Legal Fees',
  accountancy: 'Accountancy', other: 'Other',
}

export function expenseCategoryLabel(cat) {
  return EXPENSE_CATEGORY_LABELS[cat] || (cat ? String(cat) : 'Other')
}

// The signed-in user's shareholder row, matched by user_id first, then a
// case-insensitive email match.
export function findViewerShareholder(shareholders, user) {
  if (!user) return null
  return shareholders.find(s => s.user_id && s.user_id === user.id)
    || shareholders.find(s => s.email && user.email && s.email.toLowerCase() === user.email.toLowerCase())
    || null
}

// ── Cross-company shareholder aggregation ─────────────────────────────────
// Links the same person's shareholder rows across companies and totals
// their holdings. Rows are considered the same person when they share a
// linked user account, an email (case-insensitive), or failing both an
// exact name (case-insensitive) — identifiers accumulate as rows join a
// group, so a row with user_id+email links a later email-only row.
//
// entries: [{ companyName, shareholders }] where shareholders is the
// buildCompanyPnl output (camelCase: userId, email, name, percentage,
// net, netMonthly).
//
// Returns one row per person, sorted by total net income:
//   { name, userId, email, holdings: [{ company, percentage, net,
//     netMonthly }], companiesCount, totalPercent, totalNet, totalMonthly }
// totalPercent is the SUM of percentage points across companies (e.g.
// 75% + 50% + 100% = 225 points over 3 companies) — a size-of-footprint
// figure, not a weighted average.
export function aggregateShareholdersAcrossCompanies(entries = []) {
  const index = new Map()
  const groups = []
  for (const { companyName, shareholders = [] } of entries) {
    for (const s of shareholders) {
      const ids = [
        s.userId ? `u:${s.userId}` : null,
        s.email ? `e:${String(s.email).toLowerCase().trim()}` : null,
        s.name ? `n:${String(s.name).toLowerCase().trim()}` : null,
      ].filter(Boolean)
      let g = ids.map(i => index.get(i)).find(Boolean)
      if (!g) {
        g = { name: s.name, userId: null, email: null, holdings: [], totalPercent: 0, totalNet: 0, totalMonthly: 0 }
        groups.push(g)
      }
      ids.forEach(i => index.set(i, g))
      if (!g.userId && s.userId) g.userId = s.userId
      if (!g.email && s.email) g.email = s.email
      g.holdings.push({ company: companyName, percentage: s.percentage, net: s.net, netMonthly: s.netMonthly })
      g.totalPercent += Number(s.percentage) || 0
      g.totalNet += Number(s.net) || 0
      g.totalMonthly += Number(s.netMonthly) || 0
    }
  }
  for (const g of groups) {
    g.companiesCount = g.holdings.length
    g.totalPercent = Math.round(g.totalPercent * 100) / 100
    g.totalNet = Math.round(g.totalNet * 100) / 100
    g.totalMonthly = Math.round(g.totalMonthly * 100) / 100
  }
  return groups.sort((a, b) => b.totalNet - a.totalNet)
}

// ── Main aggregator ────────────────────────────────────────────────────────

// Inputs (all pre-filtered to ONE company and the reporting period):
//   properties   — the company's properties (for the expected-rent fallback)
//   payments     — rent_payments rows in range
//   expenses     — property_expenses rows in range
//   feeConfigs   — company_agent_fees rows (joined agent name on .agent.name)
//   shareholders — company_shareholders rows
//   months       — months the period spans (for monthly averages)
//   associatedCompanies — total companies under common control (CT limits)
//   isEarningRent — predicate for the fallback (defaults to status check)
export function buildCompanyPnl({
  properties = [], payments = [], expenses = [], feeConfigs = [],
  shareholders = [], months = 12, associatedCompanies = 1,
  isEarningRent = (p) => p?.status === 'rented',
} = {}) {
  // Income — actually-collected rent; expected-rent fallback only when the
  // portfolio has no paid payment rows at all (same posture as ReportPnL).
  const hasPaid = payments.some(r => r?.status === 'paid')
  const rentCollected = hasPaid
    ? payments.filter(r => r?.status === 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0)
    : properties.filter(p => isEarningRent(p)).reduce((s, p) => s + (Number(p.rent_pcm) || 0) * months, 0)

  // Management fees — calculated from each agent's % of rent collected.
  // 'ex_vat' adds 20% VAT on top (fee %s quoted ex VAT cost more in cash).
  const managementFees = feeConfigs.map(f => {
    const pct = Number(f.fee_percent) || 0
    const gross = rentCollected * (pct / 100) * (f.vat_treatment === 'ex_vat' ? 1.2 : 1)
    return {
      agentName: f.agent?.name || 'Agent',
      feePercent: pct,
      vatTreatment: f.vat_treatment || 'inc_vat',
      amount: Math.round(gross * 100) / 100,
    }
  })
  const totalManagementFees = managementFees.reduce((s, f) => s + f.amount, 0)

  // Operating expenses by category. When calculated fee configs exist,
  // logged 'agent_fees' expenses are excluded (the calculated line replaces
  // them) — surfaced via excludedAgentFeeExpenses so the UI can say so.
  const hasCalculatedFees = feeConfigs.length > 0
  let excludedAgentFeeExpenses = 0
  const byCategory = {}
  for (const e of expenses) {
    const amt = Number(e?.amount) || 0
    if (!amt) continue
    const cat = e?.category || 'other'
    if (hasCalculatedFees && cat === 'agent_fees') { excludedAgentFeeExpenses += amt; continue }
    byCategory[cat] = (byCategory[cat] || 0) + amt
  }
  const expenseCategories = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, label: expenseCategoryLabel(category), amount }))
    .sort((a, b) => b.amount - a.amount)
  const totalOperatingExpenses = expenseCategories.reduce((s, c) => s + c.amount, 0)

  const totalExpenses = totalOperatingExpenses + totalManagementFees
  const operatingProfit = rentCollected - totalExpenses

  // Corporation tax — only on positive profit.
  const ct = ukCorporationTax(Math.max(0, operatingProfit), { associatedCompanies })
  const profitAfterTax = operatingProfit - ct.tax

  // Shareholder split of profit after tax.
  const shareholderRows = shareholders.map(s => {
    const pct = Number(s.percentage) || 0
    const share = profitAfterTax * (pct / 100)
    const divTax = s.tax_band ? dividendTax(share, s.tax_band) : null
    const net = share - (divTax || 0)
    return {
      id: s.id, name: s.name, email: s.email || null, userId: s.user_id || null,
      percentage: pct, taxBand: s.tax_band || null,
      share: Math.round(share * 100) / 100,
      dividendTax: divTax,
      net: Math.round(net * 100) / 100,
      netMonthly: Math.round((net / months) * 100) / 100,
    }
  }).sort((a, b) => b.percentage - a.percentage)
  const ownershipTotal = shareholderRows.reduce((s, r) => s + r.percentage, 0)

  return {
    months,
    income: { rentCollected, usedFallback: !hasPaid },
    managementFees, totalManagementFees,
    expenseCategories, totalOperatingExpenses,
    excludedAgentFeeExpenses,
    totalExpenses,
    operatingProfit,
    corporationTax: ct,
    profitAfterTax,
    shareholders: shareholderRows,
    ownershipTotal,
  }
}
