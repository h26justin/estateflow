// Company P&L with shareholder profit split — pure calculation module
// (no Supabase, no React) in the style of mtdItsa.js so it can be unit
// tested in isolation.
//
// Pipeline:
//   rent collected (paid rent_payments; falls back to expected rent when a
//   portfolio has no payment records at all)
//   − operating expenses by category (logged property_expenses)
//   − management fees, taken from each company↔agent fee % EXCEPT on any
//     property that carries a real logged 'agent_fees' cost, where the actual
//     invoiced figure is used instead (a flat fee_percent cannot represent a
//     rate that changed part-way through the history, and a percentage should
//     never override a known invoice). Suppressing the calculation per
//     property is what stops the two double-counting.
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

// ── Full portfolio P&L (per company → per property) ───────────────────────
// Xero-style long-list P&L: every company, then every property under it,
// each with income − expenses − management fee = pre-tax profit. The
// company's corporation tax estimate is apportioned back to properties
// pro-rata on their share of POSITIVE pre-tax profit (loss-makers carry no
// tax), giving a per-unit post-tax figure. Properties with no company_id
// group under a "personally held" bucket with no CT (personal income tax
// is not modelled).
//
// Attribution is by property_id membership (not the payment/expense's own
// company join) so property rows always sum exactly to their company block.
//
// monthKeys — optional ordered [{m,y}] calendar buckets (0-based month).
// When given, every property/company/grand row also carries a `monthly`
// array of pre-tax net per bucket, and `months` should equal
// monthKeys.length so the expected-rent fallback stays consistent.
//
// Same income posture as buildCompanyPnl: actually-collected rent, with the
// expected-rent fallback applied PER COMPANY when that company has no paid
// payment rows at all. Logged 'agent_fees' expenses are excluded wherever a
// calculated fee config exists for the company (excludedAgentFeeExpenses
// reports what was dropped).
//
// include — assumption switches, all default true:
//   managementFees — calculated agent fees AND logged 'agent_fees' expenses
//   expenses       — all logged property expenses
//   mortgage       — the 'mortgage' expense category (subset of expenses)
//   corporationTax — the per-company CT estimate (off → post-tax = pre-tax)
//
// rentEstimates — optional { propertyId: rent } map (see
// estimateMissingRents). Used ONLY where a property's own rent_pcm is
// missing/0, as the effective contract rent for the expected-rent
// fallback, forecast months, and the full-occupancy floor. Rows built on
// an estimate carry rentEstimated: true so the UI can badge them.
// Actually-collected rent is never altered.
//
// fullOccupancy — assume no voids. Requires monthKeys (silently ignored
// without). Every property's rent for every month bucket is raised to at
// least its expected rent (rent_pcm) — vacant properties, void months,
// and under-collected months are all filled to contract level, answering
// "what would a full rental year bring in". Status is ignored on purpose
// (a vacant property's missing rent is exactly the void being modelled);
// months already collected above contract keep the higher actual.
// Composes with forecast: forecast fills future months first, then the
// occupancy floor applies to every bucket.
//
// forecast — { now: Date }, requires monthKeys (silently ignored without).
// Projects the position to the end of the period: month buckets before
// `now`'s month keep actuals, buckets after it use each earning property's
// expected rent (rent_pcm), and `now`'s own month takes whichever is
// higher (rent may simply not have landed yet — but an above-contract
// collection is never discarded). Management fees follow the forecast rent;
// expenses stay as logged (future costs aren't invented). Result rows sum
// their monthly buckets so totals and cells always reconcile, and the root
// carries monthFlags marking which buckets contain forecast figures.
export function buildPortfolioPnl({
  companies = [], properties = [], payments = [], expenses = [], agents = [],
  months = 12, monthKeys = null, associatedCompanies = 1,
  isEarningRent = (p) => p?.status === 'rented',
  forecast = null,
  include = {},
  fullOccupancy = false,
  rentEstimates = null,
} = {}) {
  const round2 = n => Math.round(n * 100) / 100
  const agentById = new Map(agents.map(a => [a.id, a]))
  const nMonths = monthKeys ? monthKeys.length : months
  const forecastOn = !!(forecast?.now && monthKeys)
  const fullOccOn = !!(fullOccupancy && monthKeys)
  const nowKey = forecastOn ? forecast.now.getFullYear() * 12 + forecast.now.getMonth() : 0
  const inc = { managementFees: true, expenses: true, mortgage: true, corporationTax: true, ...include }

  const entries = companies.map(c => ({ id: c.id, name: c.name || 'Company', personal: false }))
  if (properties.some(p => !p.company_id)) {
    entries.push({ id: null, name: 'Personally held (no company)', personal: true })
  }

  const blocks = []
  for (const entry of entries) {
    const cProps = properties.filter(p => (p.company_id || null) === entry.id)
    if (!cProps.length) continue
    const propIds = new Set(cProps.map(p => p.id))
    const cPays = payments.filter(r => propIds.has(r.property_id))
    const cExps = expenses.filter(e => propIds.has(e.property_id))

    const hasPaid = cPays.some(r => r?.status === 'paid')

    // Properties carrying a real logged agent-fee cost. An actual invoiced fee
    // beats a percentage estimate, so for these the calculated line is
    // suppressed and the logged expense is used instead — per property, not
    // portfolio-wide.
    //
    // A flat fee_percent per agent cannot represent a rate that moved: one
    // managed block ran at 5% through 2024 and 10% from March 2025, so
    // calculating backwards over a multi-year history is wrong wherever the
    // real figures are known. This also makes an import of historic fees
    // meaningful — previously any logged fee was discarded outright the moment
    // a single property in the company had a fee percentage set.
    // Only suppress a calculated rate when the actual fee is genuinely being
    // counted. With expenses switched off the logged fee is not in the numbers
    // at all, so the calculated line has to stand in for it — otherwise
    // turning expenses off would silently delete the fee entirely.
    const countingActualFees = inc.expenses && inc.managementFees
    const propsWithActualFees = new Set()
    if (countingActualFees) {
      for (const e of cExps) {
        if ((e?.category || 'other') === 'agent_fees' && (Number(e?.amount) || 0) > 0) {
          propsWithActualFees.add(e.property_id)
        }
      }
    }
    const feeRateFor = (p) => {
      if (!inc.managementFees) return 0
      if (propsWithActualFees.has(p.id)) return 0
      const a = p.managed_by_agent_id && agentById.get(p.managed_by_agent_id)
      if (!a || !(Number(a.fee_percent) > 0)) return 0
      return (Number(a.fee_percent) / 100) * ((a.vat_treatment || 'ex_vat') === 'ex_vat' ? 1.2 : 1)
    }

    // Pre-bucket paid rent and included expenses by property (and month).
    // Month comes from the year/month columns, falling back to
    // period_start for legacy rows that predate them.
    const paidByProp = new Map(), paidByPropMonth = new Map()
    for (const r of cPays) {
      if (r?.status !== 'paid') continue
      const amt = Number(r.amount) || 0
      paidByProp.set(r.property_id, (paidByProp.get(r.property_id) || 0) + amt)
      if (monthKeys) {
        let y = r.year, m0 = r.month ? r.month - 1 : null
        if ((y == null || m0 == null) && r.period_start) {
          const d = new Date(r.period_start)
          if (!isNaN(d)) { y = d.getFullYear(); m0 = d.getMonth() }
        }
        if (y != null && m0 != null) {
          const k = `${r.property_id}|${y}-${m0}`
          paidByPropMonth.set(k, (paidByPropMonth.get(k) || 0) + amt)
        }
      }
    }
    let excludedAgentFeeExpenses = 0
    let actualAgentFeeExpenses = 0
    const expByProp = new Map(), expByPropMonth = new Map()
    for (const e of cExps) {
      const amt = Number(e?.amount) || 0
      if (!amt || !inc.expenses) continue
      const cat = e?.category || 'other'
      if (!inc.mortgage && cat === 'mortgage') continue
      if (cat === 'agent_fees') {
        // Fees toggled off drops logged agent-fee costs too. With fees on, a
        // logged fee is now kept and its property's calculated rate is
        // suppressed instead (see propsWithActualFees), so nothing is
        // double-counted and nothing is silently discarded.
        if (!inc.managementFees) continue
        actualAgentFeeExpenses += amt
      }
      expByProp.set(e.property_id, (expByProp.get(e.property_id) || 0) + amt)
      if (monthKeys && e.date) {
        const d = new Date(e.date)
        if (!isNaN(d)) {
          const k = `${e.property_id}|${d.getFullYear()}-${d.getMonth()}`
          expByPropMonth.set(k, (expByPropMonth.get(k) || 0) + amt)
        }
      }
    }

    const rows = cProps.map(p => {
      const ownRent = Number(p.rent_pcm) || 0
      const estRent = !ownRent && rentEstimates ? (Number(rentEstimates[p.id]) || 0) : 0
      // Effective contract rent: the property's own figure, else the
      // sibling-building estimate (display-only assumption).
      const rentPcm = ownRent || estRent
      const fallbackRent = isEarningRent(p) ? rentPcm : 0
      const exp = expByProp.get(p.id) || 0
      const feeRate = feeRateFor(p)
      let income, monthly = null
      if (monthKeys) {
        const rents = monthKeys.map(({ m, y }) => {
          const actual = hasPaid ? (paidByPropMonth.get(`${p.id}|${y}-${m}`) || 0) : fallbackRent
          let rent = actual
          if (forecastOn) {
            const k = y * 12 + m
            if (k > nowKey) rent = fallbackRent
            else if (k === nowKey) rent = Math.max(actual, fallbackRent)
          }
          // No-voids floor: every bucket earns at least the contract rent,
          // regardless of status — see fullOccupancy doc above.
          if (fullOccOn) rent = Math.max(rent, rentPcm)
          return rent
        })
        monthly = rents.map((rent, i) => {
          const { m, y } = monthKeys[i]
          const mExp = expByPropMonth.get(`${p.id}|${y}-${m}`) || 0
          return round2(rent - mExp - rent * feeRate)
        })
        // Projected totals MUST be the sum of the buckets (that's the whole
        // point of forecast / full-occupancy); actuals keep the raw period
        // total so legacy payment rows that can't be month-bucketed still
        // count.
        income = (forecastOn || fullOccOn)
          ? rents.reduce((s, v) => s + v, 0)
          : (hasPaid ? (paidByProp.get(p.id) || 0) : fallbackRent * nMonths)
      } else {
        income = hasPaid ? (paidByProp.get(p.id) || 0) : fallbackRent * nMonths
      }
      const fees = income * feeRate
      const pretax = income - exp - fees
      return { id: p.id, name: p.name, income, expenses: exp, fees, pretax, monthly, rentEstimated: estRent > 0 }
    })

    const tIncome = rows.reduce((s, r) => s + r.income, 0)
    const tExp = rows.reduce((s, r) => s + r.expenses, 0)
    const tFees = rows.reduce((s, r) => s + r.fees, 0)
    const tPretax = tIncome - tExp - tFees
    const ct = (entry.personal || !inc.corporationTax) ? null : ukCorporationTax(Math.max(0, tPretax), { associatedCompanies })
    const ctTax = ct ? ct.tax : 0

    // Apportion CT to properties pro-rata on positive pre-tax profit.
    const sumPositive = rows.reduce((s, r) => s + Math.max(0, r.pretax), 0)
    for (const r of rows) {
      r.ctShare = round2(sumPositive > 0 ? ctTax * (Math.max(0, r.pretax) / sumPositive) : 0)
      r.posttax = round2(r.pretax - r.ctShare)
      r.income = round2(r.income); r.expenses = round2(r.expenses)
      r.fees = round2(r.fees); r.pretax = round2(r.pretax)
    }

    blocks.push({
      id: entry.id, name: entry.name, personal: entry.personal,
      usedFallback: !hasPaid, excludedAgentFeeExpenses: round2(excludedAgentFeeExpenses),
      // How much of the fee total came from real invoices rather than a
      // percentage, so the report can say which basis it used.
      actualAgentFeeExpenses: round2(actualAgentFeeExpenses),
      actualFeePropertyCount: propsWithActualFees.size,
      rows,
      totals: {
        income: round2(tIncome), expenses: round2(tExp), fees: round2(tFees),
        pretax: round2(tPretax), ct: round2(ctTax), posttax: round2(tPretax - ctTax),
        monthly: monthKeys ? monthKeys.map((_, i) => round2(rows.reduce((s, r) => s + r.monthly[i], 0))) : null,
      },
      corporationTax: ct,
    })
  }

  const grand = {
    income: round2(blocks.reduce((s, b) => s + b.totals.income, 0)),
    expenses: round2(blocks.reduce((s, b) => s + b.totals.expenses, 0)),
    fees: round2(blocks.reduce((s, b) => s + b.totals.fees, 0)),
    pretax: round2(blocks.reduce((s, b) => s + b.totals.pretax, 0)),
    ct: round2(blocks.reduce((s, b) => s + b.totals.ct, 0)),
    posttax: round2(blocks.reduce((s, b) => s + b.totals.posttax, 0)),
    monthly: monthKeys
      ? monthKeys.map((_, i) => round2(blocks.reduce((s, b) => s + (b.totals.monthly?.[i] || 0), 0)))
      : null,
  }

  return {
    months: nMonths, companies: blocks, grand,
    forecast: forecastOn,
    fullOccupancy: fullOccOn,
    // Which month buckets contain forecast (not purely actual) figures —
    // the current month and everything after it.
    monthFlags: monthKeys ? monthKeys.map(({ m, y }) => forecastOn && (y * 12 + m) >= nowKey) : null,
  }
}

// ── Sibling-rent estimation ────────────────────────────────────────────────
// For properties with no rent recorded, borrow an estimate from the other
// units in the same building — "Flat 5, Park Place East" takes the going
// rate of the Park Place East flats. DISPLAY-ONLY by design: the caller
// feeds the result into buildPortfolioPnl's rentEstimates option; nothing
// is ever written back to the portfolio.
//
// Buildings are matched by stripping the unit designator from the name
// (leading or trailing "Flat 5" / "Room 2A" / "Apt 3" / "Unit 1" /
// "Studio 2", and the letter on a leading house number so 47A and 47B
// Somerset Street pair up), scoped to one company so identically-named
// streets in different companies never mix. The estimate is the MEDIAN of
// the building's known rents — robust to one outlier unit.
function buildingKeyForName(name) {
  const s = String(name || '').toLowerCase().replace(/[.,'']/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  const unit = '(?:flat|apartment|apt|room|unit|studio)\\s+[0-9]+[a-z]?'
  let key = s.replace(new RegExp(`^${unit}\\s+`), '')
  key = key.replace(new RegExp(`\\s+${unit}$`), '')
  key = key.replace(/^(\d+)[a-z]\s+/, '$1 ')
  key = key.trim()
  return key || null
}

// properties → { [propertyId]: estimatedRent } for every property whose
// rent_pcm is missing/0 and whose building has at least one unit with a
// known rent.
export function estimateMissingRents(properties = []) {
  const groups = new Map()
  for (const p of properties) {
    const key = buildingKeyForName(p.name)
    if (!key) continue
    const gk = `${p.company_id || ''}|${key}`
    let g = groups.get(gk)
    if (!g) { g = { rents: [], missing: [] }; groups.set(gk, g) }
    const rent = Number(p.rent_pcm) || 0
    if (rent > 0) g.rents.push(rent)
    else g.missing.push(p.id)
  }
  const estimates = {}
  for (const g of groups.values()) {
    if (!g.rents.length || !g.missing.length) continue
    const sorted = [...g.rents].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    for (const id of g.missing) estimates[id] = Math.round(median * 100) / 100
  }
  return estimates
}

// ── Scale a portfolio P&L to one shareholder's slice ───────────────────────
// Takes a buildPortfolioPnl result and multiplies every figure in each
// company block by that shareholder's percentage — "what's MY position",
// not the whole company's. pctByCompanyId maps company_id → percentage
// points (e.g. { cA: 75 }); companies with no entry (or 0%) are DROPPED,
// the personally-held bucket is kept at personalPercent (default 100).
// The scaled ct is the holder's share of the company's corporation tax.
// Grand totals are recomputed over the surviving blocks. Pure reshape:
// months / forecast / monthFlags pass through untouched.
//
// dividendTaxBands — optional company_id → tax band ('basic' | 'higher' |
// 'additional') for the holder. When given, dividend tax is estimated on
// each company's positive scaled post-tax share (flat band rate, same
// caveats as the Company P&L report), apportioned to properties pro-rata
// on positive post-tax, and subtracted from posttax; the amounts surface
// as row.dividendTax / totals.dividendTax / grand.dividendTax. Companies
// with no band entry (and the personally-held bucket) are left untaxed.
// Without the option, post-tax figures are before personal dividend tax.
export function scalePortfolioPnl(result, pctByCompanyId = {}, { personalPercent = 100, dividendTaxBands = null } = {}) {
  const round2 = n => Math.round(n * 100) / 100
  const companies = []
  for (const b of result.companies) {
    const pct = b.personal ? personalPercent : (Number(pctByCompanyId[b.id]) || 0)
    if (!(pct > 0)) continue
    const f = pct / 100
    const rows = b.rows.map(r => ({
      ...r,
      income: round2(r.income * f), expenses: round2(r.expenses * f),
      fees: round2(r.fees * f), pretax: round2(r.pretax * f),
      ctShare: round2(r.ctShare * f), posttax: round2(r.posttax * f),
      dividendTax: 0,
      monthly: r.monthly ? r.monthly.map(v => round2(v * f)) : null,
    }))
    const totals = {
      income: round2(b.totals.income * f), expenses: round2(b.totals.expenses * f),
      fees: round2(b.totals.fees * f), pretax: round2(b.totals.pretax * f),
      ct: round2(b.totals.ct * f), posttax: round2(b.totals.posttax * f),
      dividendTax: 0,
      monthly: b.totals.monthly ? b.totals.monthly.map(v => round2(v * f)) : null,
    }
    const band = !b.personal && dividendTaxBands ? dividendTaxBands[b.id] : null
    const dt = band ? dividendTax(Math.max(0, totals.posttax), band) : 0
    if (dt > 0) {
      const pos = rows.reduce((s, r) => s + Math.max(0, r.posttax), 0)
      for (const r of rows) {
        const share = pos > 0 ? round2(dt * (Math.max(0, r.posttax) / pos)) : 0
        r.dividendTax = share
        r.posttax = round2(r.posttax - share)
      }
      totals.dividendTax = dt
      totals.posttax = round2(totals.posttax - dt)
    }
    companies.push({ ...b, sharePercent: pct, excludedAgentFeeExpenses: round2(b.excludedAgentFeeExpenses * f), rows, totals })
  }
  const sum = k => round2(companies.reduce((s, b) => s + b.totals[k], 0))
  return {
    ...result,
    scaled: true,
    companies,
    grand: {
      income: sum('income'), expenses: sum('expenses'), fees: sum('fees'),
      pretax: sum('pretax'), ct: sum('ct'), posttax: sum('posttax'),
      dividendTax: sum('dividendTax'),
      monthly: result.grand.monthly
        ? result.grand.monthly.map((_, i) => round2(companies.reduce((s, b) => s + (b.totals.monthly?.[i] || 0), 0)))
        : null,
    },
  }
}

// ── Main aggregator ────────────────────────────────────────────────────────

// Inputs (all pre-filtered to ONE company and the reporting period):
//   properties   — the company's properties (fallback rent + agent links
//                  via managed_by_agent_id)
//   payments     — rent_payments rows in range (property_id attributes rent
//                  to the right managing agent)
//   expenses     — property_expenses rows in range
//   agents       — estate_agents rows (fee_percent + vat_treatment live on
//                  the AGENCY, so one change flows portfolio-wide)
//   shareholders — company_shareholders rows
//   months       — months the period spans (for monthly averages)
//   associatedCompanies — total companies under common control (CT limits)
//   isEarningRent — predicate for the fallback (defaults to status check)
export function buildCompanyPnl({
  properties = [], payments = [], expenses = [], agents = [],
  shareholders = [], months = 12, associatedCompanies = 1,
  isEarningRent = (p) => p?.status === 'rented',
} = {}) {
  // Income — actually-collected rent; expected-rent fallback only when the
  // portfolio has no paid payment rows at all (same posture as ReportPnL).
  const hasPaid = payments.some(r => r?.status === 'paid')
  const rentCollected = hasPaid
    ? payments.filter(r => r?.status === 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0)
    : properties.filter(p => isEarningRent(p)).reduce((s, p) => s + (Number(p.rent_pcm) || 0) * months, 0)

  // Per-property rent, for attributing income to each managing agent.
  const paidByProperty = {}
  if (hasPaid) {
    for (const r of payments) {
      if (r?.status !== 'paid') continue
      paidByProperty[r.property_id] = (paidByProperty[r.property_id] || 0) + (Number(r.amount) || 0)
    }
  }
  const rentForProperty = (p) => hasPaid
    ? (paidByProperty[p.id] || 0)
    : (isEarningRent(p) ? (Number(p.rent_pcm) || 0) * months : 0)

  // Management fees — each agency's fee % applied to the rent of the
  // properties it manages. 'ex_vat' adds 20% VAT on top (fees quoted
  // "X% plus VAT" cost more in cash).
  //
  // A property with a real logged agent-fee cost is skipped here: the actual
  // invoiced figure is used instead of the percentage estimate. See the same
  // rule in buildPortfolioPnl for why (a flat fee_percent cannot represent a
  // rate that changed part-way through the history).
  // Only a fee we can pin to a property in this portfolio can suppress that
  // property's calculated rate. An agent_fees cost with no property_id (or one
  // we don't hold) is unattributable: keeping it alongside a calculated fee
  // would double-count, so those fall back to the old exclusion rule below.
  const knownProps = new Set(properties.map(p => p.id))
  const propsWithActualFees = new Set()
  for (const e of expenses) {
    if ((e?.category || 'other') !== 'agent_fees' || !((Number(e?.amount) || 0) > 0)) continue
    if (knownProps.has(e.property_id)) propsWithActualFees.add(e.property_id)
  }
  const agentById = new Map(agents.map(a => [a.id, a]))
  const byAgent = new Map()
  for (const p of properties) {
    if (propsWithActualFees.has(p.id)) continue
    const a = p.managed_by_agent_id && agentById.get(p.managed_by_agent_id)
    if (!a || !(Number(a.fee_percent) > 0)) continue
    let g = byAgent.get(a.id)
    if (!g) {
      g = { agentName: a.name || 'Agent', feePercent: Number(a.fee_percent), vatTreatment: a.vat_treatment || 'ex_vat', rentBase: 0, propertyCount: 0 }
      byAgent.set(a.id, g)
    }
    g.rentBase += rentForProperty(p)
    g.propertyCount++
  }
  const managementFees = [...byAgent.values()].map(g => ({
    ...g,
    amount: Math.round(g.rentBase * (g.feePercent / 100) * (g.vatTreatment === 'ex_vat' ? 1.2 : 1) * 100) / 100,
  })).sort((a, b) => b.amount - a.amount)
  const totalManagementFees = managementFees.reduce((s, f) => s + f.amount, 0)

  // Operating expenses by category. A logged 'agent_fees' cost tied to one of
  // our properties is KEPT — that property's calculated fee was suppressed
  // above, so the two cannot double-count. One we could not attribute is still
  // excluded whenever calculated fees exist, since there is no matching
  // suppression to protect it.
  const hasCalculatedFees = managementFees.length > 0
  let excludedAgentFeeExpenses = 0
  let actualAgentFeeExpenses = 0
  const byCategory = {}
  for (const e of expenses) {
    const amt = Number(e?.amount) || 0
    if (!amt) continue
    const cat = e?.category || 'other'
    if (cat === 'agent_fees') {
      if (!propsWithActualFees.has(e.property_id) && hasCalculatedFees) {
        excludedAgentFeeExpenses += amt
        continue
      }
      actualAgentFeeExpenses += amt
    }
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
    actualAgentFeeExpenses: Math.round(actualAgentFeeExpenses * 100) / 100,
    actualFeePropertyCount: propsWithActualFees.size,
    totalExpenses,
    operatingProfit,
    corporationTax: ct,
    profitAfterTax,
    shareholders: shareholderRows,
    ownershipTotal,
  }
}
