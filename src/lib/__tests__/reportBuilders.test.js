import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase stub for the reports fetches ───────────────────────────────────
// Records every builder call and answers each ranged request from a queue.
const calls = []
const pages = {}
function chain(table) {
  const q = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order']) {
    q[m] = vi.fn((...args) => { calls.push({ table, m, args }); return q })
  }
  q.range = vi.fn((from, to) => {
    calls.push({ table, m: 'range', args: [from, to] })
    return Promise.resolve((pages[table] || []).shift() || { data: [], error: null })
  })
  return q
}
vi.mock('../supabase', () => ({ supabase: { from: vi.fn(table => chain(table)) } }))

import {
  yearPeriod, currentTaxYear, reportYearOptions, rentRowMonth,
  yearMonths, yearBasis, indexRentReceiptDates, rentRowDate, rentRowColumn, expenseColumn,
  buildPnlReport, buildIncomeSchedule, buildCashFlow, buildMortgagePortfolio,
  buildComplianceReport, buildTenancySchedule, buildArrearsReport,
  maintenanceCost, maintenancePriorityRank,
  pnlExports, incomeScheduleExports, cashFlowExports, mortgagePortfolioExports, complianceExports,
} from '../reportBuilders'
import {
  fetchAllRentPayments, fetchAllExpenses, fetchAllMaintenanceJobs, fetchAllTenancies, fetchAllComplianceItems,
} from '../api/reports'

const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n || 0)
const fmtPct = (n, d = 1) => (n || 0).toFixed(d) + '%'

// Tax-year month columns Apr (year) → Mar (year + 1), as the page builds them.
const taxMonths = year => [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2].map(m => ({ m, y: m >= 3 ? year : year + 1 }))
// The page's period filter for rent rows: the row's effective date inside the
// period (ISO strings compare as dates).
const rentDate = r => r.period_start || (r.year && r.month ? `${r.year}-${String(r.month).padStart(2, '0')}-01` : null)
const inPeriod = (d, p) => !!d && d >= p.start && d <= p.end

const rent = (id, pid, start, status, amount) => ({ id, property_id: pid, period_start: start, year: +start.slice(0, 4), month: +start.slice(5, 7), status, amount })

// Fixture: a late-paying tenant, rows on 1 April at both ends of the tax
// year, a vacant property, an interest-only mortgage and a zero value.
const properties = [
  { id: 'p1', name: 'Flat 1', status: 'rented', rent_pcm: 1000, est_value: 200000, mortgage_amount: 150000, mortgage_rate: 0.05, mortgage_type: 'interest_only', mortgage_term: 25 },
  { id: 'p2', name: 'Flat 2', status: 'vacant', rent_pcm: 900, est_value: 180000 },
  { id: 'p3', name: 'House 3', status: 'rented', rent_pcm: 1200, est_value: 300000, mortgage_amount: 100000, mortgage_rate: 0.04, mortgage_monthly_payment: 750 },
]
const payments = [
  rent('r1', 'p1', '2025-04-01', 'paid', 1000),      // first month of 2025/26
  rent('r2', 'p1', '2025-05-01', 'late', 1000),      // paid late: still received
  rent('r3', 'p1', '2025-06-01', 'partial', 400),    // part payment
  rent('r4', 'p1', '2025-07-01', 'overdue', null),   // nothing received
  rent('r5', 'p3', '2026-03-01', 'paid', 1200),      // last month of 2025/26
  rent('r6', 'p3', '2026-04-01', 'paid', 1200),      // first month of 2026/27
  rent('r7', 'p3', '2025-03-01', 'paid', 1200),      // last month of 2024/25
  rent('r8', 'p2', '2025-08-01', 'paid', 0),         // a zero
]
const expenses = [
  { id: 'e1', property_id: 'p1', amount: 200, date: '2025-04-03' },
  { id: 'e2', property_id: 'p3', amount: 0, date: '2025-09-10' },
  { id: 'e3', property_id: 'p3', amount: 350, date: '2026-03-31' },
  { id: 'e4', property_id: 'p3', amount: 999, date: '2026-04-02' },   // next tax year
]

describe('period rule', () => {
  it('a financial year is the twelve months 1 April to 31 March; a tax year is 6 April to 5 April', () => {
    expect(yearPeriod(2025, 'fy')).toMatchObject({ start: '2025-04-01', end: '2026-03-31' })
    expect(yearPeriod(2025, 'fy').label).toMatch(/Financial Year \(1 Apr – 31 Mar\)/)
    expect(yearPeriod(2025, 'tax')).toMatchObject({ start: '2025-04-06', end: '2026-04-05' })
    expect(yearPeriod(2025, 'tax').label).toMatch(/Tax Year \(6 Apr – 5 Apr\)/)
    // Stored forms: an old 'tax' / 'tax_year' value is the 6 April tax year.
    expect(yearPeriod(2025, 'tax_year').start).toBe('2025-04-06')
    expect(yearPeriod(2025, 'financial_year').start).toBe('2025-04-01')
    expect(yearBasis('tax_year')).toBe('tax')
    expect(yearPeriod(2025, 'calendar')).toMatchObject({ start: '2025-01-01', end: '2025-12-31' })
  })
  it('a rent row belongs to the month of its period (legacy rows: year/month)', () => {
    expect(rentRowMonth({ period_start: '2025-04-01' })).toEqual({ y: 2025, m: 3 })
    expect(rentRowMonth({ year: 2024, month: 12 })).toEqual({ y: 2024, m: 11 })
    expect(rentRowMonth({})).toBeNull()
  })
  it('the current tax year starts on 6 April', () => {
    expect(currentTaxYear(new Date(2026, 3, 5))).toBe(2025)
    expect(currentTaxYear(new Date(2026, 3, 6))).toBe(2026)
    expect(currentTaxYear(new Date(2026, 0, 15))).toBe(2025)
  })
  it('year pickers run from the earliest data year to the current tax year + 1', () => {
    const now = new Date(2026, 10, 15)
    expect(reportYearOptions([], { now })).toEqual([2022, 2023, 2024, 2025, 2026, 2027])
    expect(reportYearOptions(['2019-05-01', null, '2024-01-01'], { now })).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027])
    expect(reportYearOptions(['2025-01-01'], { now, selected: 2023 })).toEqual([2023, 2024, 2025, 2026, 2027])
  })
})

describe('screen, PDF and CSV agree for the 2025/26 financial year (1 April basis)', () => {
  const period = yearPeriod(2025, 'fy')
  const months = taxMonths(2025)
  const pRent = payments.filter(r => inPeriod(rentDate(r), period))
  const pExp = expenses.filter(e => inPeriod(e.date, period))
  const pnl = buildPnlReport({ properties, payments: pRent, expenses: pExp })
  const inc = buildIncomeSchedule({ properties, payments: pRent, months })
  const cash = buildCashFlow({ properties, payments: pRent, expenses: pExp, months })

  it('includes the April at the start, excludes the April after, counts late and part payments', () => {
    // 1000 (Apr) + 1000 (late) + 400 (partial) + 1200 (Mar) + 0 = 3600
    expect(pnl.totals.rent).toBe(3600)
    expect(inc.months.length).toBe(12)
    expect(inc.monthTotals[0]).toBe(1000)     // April 2025 column
    expect(inc.monthTotals[11]).toBe(1200)    // March 2026 column
    expect(inc.unplaced).toBe(0)
    expect(pnl.totals.exp).toBe(550)
  })

  it('P&L, income schedule and cash flow totals match', () => {
    expect(inc.total).toBe(pnl.totals.rent)
    expect(cash.totals.rent).toBe(pnl.totals.rent)
    expect(cash.totals.exp).toBe(pnl.totals.exp)
    expect(cash.totals.net).toBe(pnl.totals.net)
  })

  it('a vacant property shows only what was received (no contracted rent)', () => {
    const p2 = pnl.rows.find(r => r.p.id === 'p2')
    expect(p2.rent).toBe(0)
    expect(inc.rows.find(r => r.p.id === 'p2').total).toBe(0)
  })

  it('the PDF and CSV carry the builder totals', () => {
    const P = pnlExports(pnl, { fmt, fmtPct })
    expect(P.pdf.totals.slice(0, 4)).toEqual(['Total', fmt(3600), fmt(550), fmt(3050)])
    expect(P.csv.at(-1).slice(2, 5)).toEqual([3600, 550, 3050])

    const I = incomeScheduleExports(inc, { fmt })
    expect(I.pdf.totals).toEqual(['Total', fmt(3600)])
    expect(I.pdf.sections[1].totals).toEqual(['Total', fmt(3600)])
    expect(I.csv.at(-1).at(-1)).toBe(3600)
    expect(I.csv[0][1]).toBe('Apr 2025')

    const C = cashFlowExports(cash, { fmt })
    expect(C.pdf.totals).toEqual(['Total', fmt(3600), fmt(550), fmt(3050)])
    expect(C.csv.at(-1)).toEqual(['Total', 3600, 550, 3050])
    expect(C.pdf.rows[0][0]).toBe('Apr')
  })

  it('zeros stay numeric 0 in the CSV, not empty cells', () => {
    const I = incomeScheduleExports(inc, { fmt })
    const p2 = I.csv.find(r => r[0] === 'Flat 2')
    expect(p2.slice(1).every(v => v === 0)).toBe(true)
    const P = pnlExports(pnl, { fmt, fmtPct })
    expect(P.csv.find(r => r[0] === 'Flat 2')[2]).toBe(0)
  })

  it('no received rent at all is an explicit state, not rent_pcm × 12', () => {
    const none = buildPnlReport({ properties, payments: [rent('x', 'p1', '2025-05-01', 'overdue', null)], expenses: [] })
    expect(none.totals.rent).toBe(0)
    expect(none.noRentRecorded).toBe(true)
    expect(pnlExports(none, { fmt, fmtPct }).pdf.note).toMatch(/No rent received/)
    expect(pnl.noRentRecorded).toBe(false)
  })

  it('counts receipt allocations the way the Company P&L does, in every report', () => {
    const receipts = [{ id: 'rc1', rent_allocations: [
      { rent_payment_id: 'r4', target: 'current_rent', amount: 300 },   // overdue row, part received
      { rent_payment_id: 'r1', target: 'current_rent', amount: 900 },   // paid row, allocations win
      { rent_payment_id: 'r1', target: 'historic_arrears', amount: 50 }, // not current rent
    ] }]
    const a = buildPnlReport({ properties, payments: pRent, expenses: pExp, receipts })
    const b = buildIncomeSchedule({ properties, payments: pRent, months, receipts })
    const c = buildCashFlow({ properties, payments: pRent, expenses: pExp, months, receipts })
    expect(a.totals.rent).toBe(3600 - 100 + 300)
    expect(b.total).toBe(a.totals.rent)
    expect(c.totals.rent).toBe(a.totals.rent)
  })

  it('a row outside the selected properties is not counted anywhere', () => {
    const extra = [...pRent, rent('o1', 'other', '2025-05-01', 'paid', 5000)]
    expect(buildPnlReport({ properties, payments: extra, expenses: pExp }).totals.rent).toBe(3600)
    expect(buildIncomeSchedule({ properties, payments: extra, months }).total).toBe(3600)
    expect(buildCashFlow({ properties, payments: extra, expenses: pExp, months }).totals.rent).toBe(3600)
  })
})

describe('year basis: tax year (6 Apr – 5 Apr) and financial year (1 Apr – 31 Mar)', () => {
  // The page's filter and columns for a basis (ReportsPage filtRent/filtExp,
  // periodMonths): a rent row is dated by rentRowDate, an expense by its date.
  const view = (basis, year, { payments: pays, expenses: exps, receipts = null }) => {
    const period = yearPeriod(year, basis)
    const dates = indexRentReceiptDates(receipts)
    const pRent = pays.filter(r => inPeriod(rentRowDate(r, basis, dates), period))
    const pExp = exps.filter(e => inPeriod(e.date, period))
    const months = yearMonths(year, basis)
    return {
      pRent, pExp,
      pnl: buildPnlReport({ properties, payments: pRent, expenses: pExp, receipts }),
      inc: buildIncomeSchedule({ properties, payments: pRent, months, receipts, basis }),
      cash: buildCashFlow({ properties, payments: pRent, expenses: pExp, months, receipts, basis }),
    }
  }
  const legacy = (id, pid, y, m, amount) => ({ id, property_id: pid, year: y, month: m, status: 'paid', amount })
  const pays = [
    ...payments,
    legacy('L1', 'p1', 2025, 4, 1000),                      // legacy 1 April 2025
    rent('R1', 'p3', '2026-03-01', 'overdue', null),        // received 4 Apr 2026 by receipt
    rent('R2', 'p3', '2025-03-01', 'overdue', null),        // received 7 Apr 2025 by receipt
  ]
  const exps = [...expenses, { id: 'e5', property_id: 'p1', amount: 75, date: '2026-04-03' }, { id: 'e6', property_id: 'p1', amount: 40, date: '2025-04-05' }]
  const receipts = [
    { id: 'x1', received_date: '2026-04-04', rent_allocations: [{ rent_payment_id: 'R1', target: 'current_rent', amount: 1200 }] },
    { id: 'x2', received_date: '2025-04-07', rent_allocations: [{ rent_payment_id: 'R2', target: 'current_rent', amount: 1200 }] },
  ]

  it.each(['tax', 'fy'])('%s basis: P&L = Income Schedule = Cash Flow totals, and every row lands in one column', (basis) => {
    for (const year of [2024, 2025, 2026]) {
      const { pnl, inc, cash } = view(basis, year, { payments: pays, expenses: exps, receipts })
      expect(inc.total).toBe(pnl.totals.rent)
      expect(inc.unplaced).toBe(0)
      expect(cash.totals.rent).toBe(pnl.totals.rent)
      expect(cash.totals.exp).toBe(pnl.totals.exp)
      expect(cash.totals.net).toBe(pnl.totals.net)
    }
  })

  it('an expense dated 3 April Y+1 is inside tax year Y and outside financial year Y', () => {
    const tax = view('tax', 2025, { payments: pays, expenses: exps, receipts })
    expect(tax.pExp.map(e => e.id)).toContain('e5')
    expect(tax.cash.rows[11].exp).toBe(350 + 999 + 75)     // the "Mar" tax month, 6 Mar – 5 Apr 2026
    expect(expenseColumn({ date: '2026-04-03' }, 'tax')).toEqual({ y: 2026, m: 2 })
    const fy = view('fy', 2025, { payments: pays, expenses: exps, receipts })
    expect(fy.pExp.map(e => e.id)).not.toContain('e5')
    expect(view('fy', 2026, { payments: pays, expenses: exps, receipts }).pExp.map(e => e.id)).toContain('e5')
    // 5 April 2025 closes tax year 2024; it is in financial year 2025.
    expect(view('tax', 2024, { payments: pays, expenses: exps, receipts }).pExp.map(e => e.id)).toContain('e6')
    expect(fy.pExp.map(e => e.id)).toContain('e6')
  })

  it('a legacy rent row dated 1 April Y belongs to Y−1 on the tax-year basis and Y on the financial-year basis', () => {
    const L1 = pays.find(r => r.id === 'L1')
    expect(view('tax', 2024, { payments: pays, expenses: exps, receipts }).pRent).toContain(L1)
    expect(view('tax', 2025, { payments: pays, expenses: exps, receipts }).pRent).not.toContain(L1)
    expect(rentRowColumn(L1, 'tax')).toEqual({ y: 2025, m: 2 })    // the last ("Mar") tax month of 2024/25
    expect(view('fy', 2025, { payments: pays, expenses: exps, receipts }).pRent).toContain(L1)
    expect(view('fy', 2024, { payments: pays, expenses: exps, receipts }).pRent).not.toContain(L1)
    expect(rentRowColumn(L1, 'fy')).toEqual({ y: 2025, m: 3 })
  })

  it('on the tax-year basis a rent row with receipts is dated by its receipt', () => {
    const R1 = pays.find(r => r.id === 'R1'), R2 = pays.find(r => r.id === 'R2')
    const dates = indexRentReceiptDates(receipts)
    expect(rentRowDate(R1, 'tax', dates)).toBe('2026-04-04')
    expect(rentRowDate(R1, 'fy', dates)).toBe('2026-03-01')
    const t25 = view('tax', 2025, { payments: pays, expenses: exps, receipts })
    expect(t25.pRent).toContain(R1)                         // 4 Apr 2026 is in 2025/26
    expect(t25.pRent).toContain(R2)                         // 7 Apr 2025 is in 2025/26
    // "Apr" tax month (6 Apr – 5 May 2025): r2 (1 May) and R2 (received 7 Apr);
    // r1 (1 Apr 2025) belongs to 2024/25.
    expect(t25.inc.monthTotals[0]).toBe(1000 + 1200)
    expect(t25.pRent.map(r => r.id)).not.toContain('r1')
    expect(t25.inc.monthTotals[11]).toBe(1200 + 1200)       // "Mar": r5 (1 Mar 2026) and R1 (received 4 Apr 2026)
  })
})

describe('mortgage portfolio', () => {
  it('uses calcMonthlyMortgage: recorded payment, interest-only, repayment', () => {
    const d = buildMortgagePortfolio(properties)
    expect(d.rows.map(r => r.monthly)).toEqual([625, 750])   // 150000 × 5% / 12; recorded 750
    expect(d.totals.monthly).toBe(1375)
    const X = mortgagePortfolioExports(d, { fmt, fmtPct })
    expect(X.pdf.totals[5]).toBe(fmt(1375))
    expect(X.csv.at(-1)[6]).toBe(1375)
    expect(X.csv[1][4]).toBe('Interest-only')
  })
})

describe('compliance report', () => {
  const now = Date.parse('2026-11-15T12:00:00Z')
  const items = [
    { id: 'c1', property_id: 'p1', cert_type: 'gas', cert_name: 'Gas cert', expiry_date: '2024-11-01', property: { name: 'Flat 1' } },
    { id: 'c2', property_id: 'p1', cert_type: 'gas_safety', cert_name: 'Gas cert', expiry_date: '2027-10-30', property: { name: 'Flat 1' } },
    { id: 'c3', property_id: 'p1', cert_type: 'eicr', cert_name: 'EICR', expiry_date: '2027-01-14', property: { name: 'Flat 1' } },
    { id: 'c4', property_id: 'p3', cert_type: 'eicr', cert_name: 'EICR', expiry_date: '2026-11-10', property: { name: 'House 3' } },
    { id: 'c5', property_id: 'p3', cert_type: 'other', cert_name: 'Lift inspection', expiry_date: null, property: { name: 'House 3' } },
    { id: 'c6', property_id: 'p3', cert_type: 'gas_safety', expiry_date: '2020-01-01', deleted_at: '2026-01-01', property: { name: 'House 3' } },
  ]
  const d = buildComplianceReport(items, { now })

  it('keeps only the latest certificate per property and canonical type', () => {
    const gas = d.rows.filter(r => r.c.property_id === 'p1' && r.label === 'Gas Safety (CP12)')
    expect(gas).toHaveLength(1)
    expect(gas[0].status).toBe('valid')
    expect(gas[0].superseded).toBe(1)
    expect(d.rows.some(r => r.c.id === 'c6')).toBe(false)   // deleted
    expect(d.counts.total).toBe(4)
  })

  it('labels from the catalogue (cert_type), falling back to cert_name', () => {
    expect(d.rows.map(r => r.label)).toEqual(expect.arrayContaining(['Electrical Safety (EICR)', 'Lift inspection']))
  })

  it('one threshold for screen, PDF and CSV (60 days counts as expiring)', () => {
    const at60 = buildComplianceReport([{ id: 'x', property_id: 'p1', cert_type: 'eicr', expiry_date: '2027-01-14' }], { now })
    expect(at60.rows[0].days).toBe(60)
    expect(at60.rows[0].status).toBe('expiring')
    const X = complianceExports(d)
    d.rows.forEach((r, i) => {
      expect(X.pdf.rows[i][4]).toBe(r.statusLabel)
      expect(X.csv[i + 1][3]).toBe(r.statusLabel)
    })
    expect(d.rows[0].status).toBe('expired')
    expect(d.counts).toMatchObject({ expired: 1, expiring: 1, valid: 1, noDate: 1 })
  })
})

describe('tenancy schedule and maintenance', () => {
  it('reads tenant_names / tenancy_start / tenancy_end', () => {
    const d = buildTenancySchedule([
      { tenant_names: 'A & B Smith', tenancy_start: '2025-01-01', tenancy_end: '2026-12-15', property: { name: 'Flat 1', rent_pcm: 1000 } },
      { tenant_names: 'C Jones', tenancy_start: '2024-06-01', tenancy_end: null, property: { name: 'House 3', rent_pcm: 1200 } },
    ], { now: Date.parse('2026-11-15T12:00:00Z') })
    expect(d.rows[0]).toMatchObject({ tenant: 'A & B Smith', start: '2025-01-01', end: '2026-12-15', days: 30 })
    expect(d.rows[1]).toMatchObject({ tenant: 'C Jones', end: '', days: null })
    expect(d.expiringSoon).toBe(1)
  })

  it('maintenance cost is actual_cost, else quoted_cost', () => {
    expect(maintenanceCost({ actual_cost: 250, quoted_cost: 300 })).toBe(250)
    expect(maintenanceCost({ actual_cost: null, quoted_cost: 300 })).toBe(300)
    expect(maintenanceCost({ cost: 999 })).toBe(0)
  })

  it('urgent jobs sort first', () => {
    const jobs = ['medium', 'urgent', 'low', 'high'].map(p => ({ priority: p }))
    expect(jobs.sort((a, b) => maintenancePriorityRank(a.priority) - maintenancePriorityRank(b.priority)).map(j => j.priority))
      .toEqual(['urgent', 'high', 'medium', 'low'])
  })
})

describe('arrears report', () => {
  const T = { id: 't1', tenancy_start: '2026-01-01', tenancy_end: null, rent_amount: 500, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant', opening_arrears: 0 }
  const base = { status: 'rented', rent_pcm: 500, tenancies: [T], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [] }
  const aug = { id: 'm8', year: 2026, month: 8, period_start: '2026-08-01', period_end: '2026-08-31', status: 'void', amount: null }

  it('derives arrears from the rent tracker and keeps a differing typed figure as a note', () => {
    const d = buildArrearsReport([
      { ...base, id: 'a1', name: 'Owing', arrears: 0, rent_payments: [aug] },
      { ...base, id: 'a2', name: 'Typed only', arrears: 750, rent_payments: [] },
    ], { asOf: '2026-10-13' })
    const owing = d.rows.find(r => r.name === 'Owing')
    expect(owing.overdue).toBe(500)
    expect(owing.total).toBe(500)
    expect(owing.manualDiffers).toBe(false)
    const typed = d.rows.find(r => r.name === 'Typed only')
    expect(typed.total).toBe(0)
    expect(typed.manualDiffers).toBe(true)
    expect(d.inArrears).toBe(1)
    expect(d.totals.total).toBe(500)
  })
})

describe('reports fetches', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(pages)) delete pages[k] })

  it('do not filter by creator, scope to property ids and drop soft-deleted rows', async () => {
    pages.property_expenses = [{ data: [{ id: 'e1' }], error: null }]
    await fetchAllExpenses('u1', { propertyIds: ['p1', 'p2'] })
    const exp = calls.filter(c => c.table === 'property_expenses')
    expect(exp.some(c => c.m === 'eq' && c.args[0] === 'user_id')).toBe(false)
    expect(exp).toContainEqual({ table: 'property_expenses', m: 'in', args: ['property_id', ['p1', 'p2']] })
    expect(exp).toContainEqual({ table: 'property_expenses', m: 'is', args: ['deleted_at', null] })
    expect(exp).toContainEqual({ table: 'property_expenses', m: 'order', args: ['id'] })

    for (const [fn, table] of [[fetchAllMaintenanceJobs, 'maintenance_jobs'], [fetchAllComplianceItems, 'compliance_items']]) {
      calls.length = 0
      await fn('u1', { propertyIds: ['p1'] })
      expect(calls).toContainEqual({ table, m: 'is', args: ['deleted_at', null] })
      expect(calls.some(c => c.m === 'eq' && c.args[0] === 'user_id')).toBe(false)
    }
  })

  it('tenancy_details has no deleted_at column, so the tenancy query never filters on it', async () => {
    calls.length = 0
    await fetchAllTenancies('u1', { propertyIds: ['p1'] })
    const ten = calls.filter(c => c.table === 'tenancy_details')
    expect(ten).toContainEqual({ table: 'tenancy_details', m: 'in', args: ['property_id', ['p1']] })
    expect(ten.some(c => c.args?.[0] === 'deleted_at')).toBe(false)
    expect(ten.some(c => c.m === 'eq' && c.args[0] === 'user_id')).toBe(false)
  })

  it('page past the 1,000-row cap and filter deleted rent rows client-side', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }))
    pages.rent_payments = [{ data: full, error: null }, { data: [{ id: 'last' }, { id: 'gone', deleted_at: '2026-01-01' }], error: null }]
    const rows = await fetchAllRentPayments('u1', { propertyIds: ['p1'] })
    expect(rows).toHaveLength(1001)
    expect(rows.some(r => r.id === 'gone')).toBe(false)
    expect(calls.filter(c => c.table === 'rent_payments' && c.m === 'range').map(c => c.args)).toEqual([[0, 999], [1000, 1999]])
  })

  it('an empty property scope asks for nothing', async () => {
    expect(await fetchAllRentPayments('u1', { propertyIds: [] })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('chunk long property-id lists', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `p${i}`)
    await fetchAllExpenses('u1', { propertyIds: ids })
    const ins = calls.filter(c => c.m === 'in').map(c => c.args[1].length)
    expect(ins).toEqual([200, 200, 50])
  })
})
