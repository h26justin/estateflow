import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  taxYearForDate, parseTaxYear, quartersForTaxYear,
  mapExpenseCategoryToHmrc, buildQuarterlySummary, quarterStatusLabel,
  currentQuarter, estimateMortgageInterest,
  splitPropertiesByLegalOwner, isMissingLegalOwnerColumnError,
  buildQuarterAndYearToDate, sameSubmissionFigures, FINANCE_COST_NOTE,
} from '../mtdItsa'

describe('taxYearForDate — 5/6 April boundary', () => {
  it('5 April belongs to the previous tax year', () => {
    expect(taxYearForDate('2026-04-05')).toBe('2025-26')
  })

  it('6 April starts the new tax year', () => {
    expect(taxYearForDate('2026-04-06')).toBe('2026-27')
  })

  it('mid-year dates resolve to the year they started in', () => {
    expect(taxYearForDate('2026-12-31')).toBe('2026-27')
    expect(taxYearForDate('2027-01-01')).toBe('2026-27')
  })
})

describe('parseTaxYear', () => {
  it('parses the YYYY-YY convention', () => {
    expect(parseTaxYear('2026-27')).toEqual({ startYear: 2026, endYear: 2027 })
  })

  it('returns null for garbage', () => {
    expect(parseTaxYear('')).toBeNull()
    expect(parseTaxYear('2026')).toBeNull()
    expect(parseTaxYear(null)).toBeNull()
  })
})

describe('quartersForTaxYear — HMRC quarter ranges and deadlines', () => {
  const qs = quartersForTaxYear('2026-27')

  it('returns the four standard 6th-to-5th quarters', () => {
    expect(qs).toHaveLength(4)
    expect(qs[0]).toMatchObject({ from: '2026-04-06', to: '2026-07-05' })
    expect(qs[1]).toMatchObject({ from: '2026-07-06', to: '2026-10-05' })
    expect(qs[2]).toMatchObject({ from: '2026-10-06', to: '2027-01-05' })
    expect(qs[3]).toMatchObject({ from: '2027-01-06', to: '2027-04-05' })
  })

  it('deadlines are the 7th of the month following each quarter end', () => {
    expect(qs.map(q => q.deadline)).toEqual([
      '2026-08-07', '2026-11-07', '2027-02-07', '2027-05-07',
    ])
  })

  it('returns [] for an unparseable tax year', () => {
    expect(quartersForTaxYear('nope')).toEqual([])
  })
})

describe('mapExpenseCategoryToHmrc', () => {
  it('routes mortgage interest to the restricted bucket', () => {
    expect(mapExpenseCategoryToHmrc('mortgage_interest')).toBe('residentialFinancialCost')
  })

  it('unknown categories land in other', () => {
    expect(mapExpenseCategoryToHmrc('mystery')).toBe('other')
  })

  it('maps every ExpensesTab picker key to the right HMRC bucket', () => {
    expect(mapExpenseCategoryToHmrc('repairs')).toBe('repairsAndMaintenance')
    expect(mapExpenseCategoryToHmrc('insurance')).toBe('premisesRunningCosts')
    expect(mapExpenseCategoryToHmrc('ground_rent')).toBe('premisesRunningCosts')
    expect(mapExpenseCategoryToHmrc('service_charge')).toBe('premisesRunningCosts')
    expect(mapExpenseCategoryToHmrc('utilities')).toBe('premisesRunningCosts')
    expect(mapExpenseCategoryToHmrc('agent_fees')).toBe('professionalFees')
    expect(mapExpenseCategoryToHmrc('legal')).toBe('professionalFees')
    expect(mapExpenseCategoryToHmrc('accountancy')).toBe('professionalFees')
    expect(mapExpenseCategoryToHmrc('other')).toBe('other')
  })

  it('a full mortgage payment is not an allowable expense', () => {
    expect(mapExpenseCategoryToHmrc('mortgage')).toBeNull()
  })
})

describe('estimateMortgageInterest', () => {
  const periodFrom = '2026-07-06'
  const periodTo = '2026-10-05'   // 92 days
  const mortgageProps = [
    { id: 'a', mortgage_amount: 100000, mortgage_rate: 0.05 },
    { id: 'b', mortgage_amount: 200000, mortgage_rate: 0.04 },
  ]

  it('estimates balance x rate x days / 365 across mortgaged properties', () => {
    expect(estimateMortgageInterest({ mortgageProps, periodFrom, periodTo }))
      .toBe(Math.round(13000 * 92 / 365 * 100) / 100)
  })

  it('skips the estimate for a property with recorded interest in the period', () => {
    const expenses = [{ property_id: 'a', category: 'mortgage_interest', amount: 410, date: '2026-08-01' }]
    expect(estimateMortgageInterest({ mortgageProps, expenses, periodFrom, periodTo }))
      .toBe(Math.round(8000 * 92 / 365 * 100) / 100)
  })

  it('recorded interest outside the period does not suppress the estimate', () => {
    const expenses = [{ property_id: 'a', category: 'mortgage_interest', amount: 410, date: '2026-06-01' }]
    expect(estimateMortgageInterest({ mortgageProps, expenses, periodFrom, periodTo }))
      .toBe(Math.round(13000 * 92 / 365 * 100) / 100)
  })
})

describe('buildQuarterlySummary — income aggregation', () => {
  const periodFrom = '2026-04-06'
  const periodTo = '2026-07-05'

  it('counts paid rows whose period_start falls in the quarter', () => {
    const s = buildQuarterlySummary({
      payments: [
        { status: 'paid', amount: 800, period_start: '2026-05-01' },
        { status: 'paid', amount: 800, period_start: '2026-08-01' }, // outside
        { status: 'overdue', amount: 800, period_start: '2026-05-01' }, // not paid
      ],
      periodFrom, periodTo,
    })
    expect(s.income.periodAmount).toBe(800)
  })

  it('counts late and partial rows that carry money received', () => {
    const s = buildQuarterlySummary({
      payments: [
        { status: 'paid', amount: 1000, period_start: '2026-04-06' },
        { status: 'late', amount: 1000, period_start: '2026-05-06' },
        { status: 'partial', amount: 400, period_start: '2026-06-06' },
        { status: 'late', amount: null, period_start: '2026-06-06' },   // nothing received
        { status: 'void', amount: 1000, period_start: '2026-06-06' },
      ],
      periodFrom, periodTo,
    })
    expect(s.income.periodAmount).toBe(2400)
  })

  it('falls back to year/month for legacy rows with NULL period_start', () => {
    const s = buildQuarterlySummary({
      payments: [
        { status: 'paid', amount: 950, period_start: null, year: 2026, month: 5 },
        { status: 'paid', amount: 950, period_start: null, year: 2026, month: 6 },
        { status: 'paid', amount: 950, period_start: null, year: 2026, month: 8 }, // outside quarter
        { status: 'paid', amount: 950, period_start: null, year: 2026, month: 3 }, // previous tax year
      ],
      periodFrom, periodTo,
    })
    expect(s.income.periodAmount).toBe(1900)
  })

  it('mixes dated segments and legacy month rows', () => {
    const s = buildQuarterlySummary({
      payments: [
        { status: 'paid', amount: 500, period_start: '2026-04-10', period_end: '2026-04-30' },
        { status: 'paid', amount: 750, period_start: null, year: 2026, month: 6 },
      ],
      periodFrom, periodTo,
    })
    expect(s.income.periodAmount).toBe(1250)
  })

  it('ignores rows with no usable date at all', () => {
    const s = buildQuarterlySummary({
      payments: [{ status: 'paid', amount: 500, period_start: null }],
      periodFrom, periodTo,
    })
    expect(s.income.periodAmount).toBe(0)
  })

  it('buckets expenses and layers mortgage interest separately', () => {
    const s = buildQuarterlySummary({
      expenses: [
        { amount: 120, date: '2026-05-02', category: 'maintenance' },
        { amount: 80, date: '2026-09-01', category: 'maintenance' }, // outside
      ],
      mortgageInterest: 300.456,
      periodFrom, periodTo,
    })
    expect(s.expenses.repairsAndMaintenance).toBe(120)
    expect(s.expenses.residentialFinancialCost).toBe(300.46)
  })

  it('maps repairs, leaves out the full mortgage payment and adds estimated interest once', () => {
    const s = buildQuarterlySummary({
      expenses: [
        { amount: 800, date: '2026-05-01', category: 'mortgage' },
        { amount: 200, date: '2026-05-03', category: 'repairs' },
        { amount: 90, date: '2026-05-03', category: 'legal' },
        { amount: 50, date: '2026-05-04', category: 'ground_rent' },
      ],
      mortgageInterest: 300,
      periodFrom, periodTo,
    })
    expect(s.expenses).toEqual({
      repairsAndMaintenance: 200, professionalFees: 90,
      premisesRunningCosts: 50, residentialFinancialCost: 300,
    })
    // Section 24: finance costs are sent to HMRC but not deducted from net.
    expect(s.totals.expenses).toBe(340)
    expect(s.totals.residentialFinancialCost).toBe(300)
  })

  it('leaves mortgage interest out of net (Section 24 tax credit, not a deduction)', () => {
    const s = buildQuarterlySummary({
      payments: [{ status: 'paid', amount: 3000, period_start: '2026-05-01' }],
      expenses: [
        { amount: 500, date: '2026-05-02', category: 'repairs' },
        { amount: 900, date: '2026-05-02', category: 'mortgage_interest' },
      ],
      mortgageInterest: 100,
      periodFrom, periodTo,
    })
    expect(s.totals).toEqual({ income: 3000, expenses: 500, residentialFinancialCost: 1000, net: 2500 })
    expect(s.expenses.residentialFinancialCost).toBe(1000)
    expect(FINANCE_COST_NOTE).toMatch(/20% basic-rate tax credit/)
  })
})

// Income follows the Rent Tracker: receipt allocations where a period has
// them (on the date received), the legacy row amount otherwise.
describe('buildQuarterlySummary — receipts and allocations', () => {
  // September row still 'pending' with a £1,000 manual receipt allocated;
  // October row 'paid' £1,000 from a statement import, receipt later bounced.
  const sep = { id: 'sep', status: 'pending', amount: null, period_start: '2026-09-01', rent_allocations: [{ target: 'current_rent', amount: 1000 }] }
  const oct = { id: 'oct', status: 'paid', amount: 1000, period_start: '2026-10-01', rent_allocations: [{ target: 'current_rent', amount: 1000 }, { target: 'current_rent', amount: -1000 }] }
  const receipts = [
    { id: 'r1', received_date: '2026-09-03', amount: 1000, rent_allocations: [{ rent_payment_id: 'sep', target: 'current_rent', amount: 1000 }] },
    { id: 'r2', received_date: '2026-10-07', amount: 1000, rent_allocations: [{ rent_payment_id: 'oct', target: 'current_rent', amount: 1000 }] },
    { id: 'r3', received_date: '2026-10-20', amount: -1000, kind: 'bounce', rent_allocations: [{ rent_payment_id: 'oct', target: 'current_rent', amount: -1000 }] },
  ]

  const Q2 = { periodFrom: '2026-07-06', periodTo: '2026-10-05' }
  const Q3 = { periodFrom: '2026-10-06', periodTo: '2027-01-05' }

  it('counts the allocated September receipt and not the bounced October row', () => {
    expect(buildQuarterlySummary({ payments: [sep, oct], receipts, ...Q2 }).income.periodAmount).toBe(1000)
    expect(buildQuarterlySummary({ payments: [sep, oct], receipts, ...Q3 }).income.periodAmount).toBe(0)
  })

  it('without receipts keeps the legacy row-only figures (the old mismatch)', () => {
    // October's row (period start 1 Oct) lands in Q2; September's is missed.
    expect(buildQuarterlySummary({ payments: [sep, oct], ...Q2 }).income.periodAmount).toBe(1000)
    expect(buildQuarterlySummary({ payments: [sep], ...Q2 }).income.periodAmount).toBe(0)
  })

  it('recognises income on the date received, not the period start', () => {
    // April 2026 rent (period from 1 April) paid on 15 April: 2026-27 Q1.
    const apr = { id: 'apr', status: 'paid', amount: 1000, period_start: '2026-04-01', rent_allocations: [{ target: 'current_rent', amount: 1000 }] }
    const rec = [{ id: 'ra', received_date: '2026-04-15', amount: 1000, rent_allocations: [{ rent_payment_id: 'apr', target: 'current_rent', amount: 1000 }] }]
    const q1 = buildQuarterlySummary({ payments: [], receipts: rec, periodFrom: '2026-04-06', periodTo: '2026-07-05' })
    expect(q1.income.periodAmount).toBe(1000)
    // The 2025-26 Q4 window sees the row (period start 1 April) but its
    // receipt is outside the window, so nothing is counted there.
    const q4 = buildQuarterlySummary({ payments: [apr], receipts: [], periodFrom: '2026-01-06', periodTo: '2026-04-05' })
    expect(q4.income.periodAmount).toBe(0)
  })

  it('a legacy row with no allocations still counts on its period start', () => {
    const legacy = { id: 'jun', status: 'paid', amount: 950, period_start: '2026-06-01' }
    const s = buildQuarterlySummary({ payments: [legacy], receipts: [], periodFrom: '2026-04-06', periodTo: '2026-07-05' })
    expect(s.income.periodAmount).toBe(950)
  })

  it('ignores allocations to arrears, deposits and unallocated money', () => {
    const rec = [{ id: 'x', received_date: '2026-05-01', amount: 600, rent_allocations: [
      { rent_payment_id: null, target: 'deposit', amount: 500 },
      { rent_payment_id: null, target: 'unallocated', amount: 100 },
    ] }]
    const s = buildQuarterlySummary({ receipts: rec, periodFrom: '2026-04-06', periodTo: '2026-07-05' })
    expect(s.income.periodAmount).toBe(0)
  })
})

describe('buildQuarterAndYearToDate — cumulative updates', () => {
  const payments = [
    { id: 'a', status: 'paid', amount: 1000, period_start: '2026-05-01' },
    { id: 'b', status: 'paid', amount: 1000, period_start: '2026-08-01' },
  ]
  const expenses = [
    { property_id: 'p1', amount: 200, date: '2026-05-10', category: 'repairs' },
    { property_id: 'p1', amount: 300, date: '2026-08-10', category: 'repairs' },
    { property_id: 'p1', amount: 50, date: '2026-05-10', category: 'mortgage_interest' },
  ]
  const mortgageProps = [{ id: 'p1', mortgage_amount: 100000, mortgage_rate: 0.05 }]

  it('returns year-to-date figures with this quarter alongside', () => {
    const s = buildQuarterAndYearToDate({ taxYear: '2026-27', quarter: 2, payments, expenses, receipts: [], mortgageProps })
    expect(s.cumulative).toBe(true)
    expect(s.fromDate).toBe('2026-04-06')
    expect(s.toDate).toBe('2026-10-05')
    expect(s.income.periodAmount).toBe(2000)
    expect(s.expenses.repairsAndMaintenance).toBe(500)
    expect(s.quarter.fromDate).toBe('2026-07-06')
    expect(s.quarter.income.periodAmount).toBe(1000)
    expect(s.quarter.expenses.repairsAndMaintenance).toBe(300)
    // Interest: Q1 recorded 50 (no estimate), Q2 estimated for 92 days.
    const q2Est = Math.round(5000 * 92 / 365 * 100) / 100
    expect(s.quarter.expenses.residentialFinancialCost).toBe(q2Est)
    expect(s.expenses.residentialFinancialCost).toBe(Math.round((50 + q2Est) * 100) / 100)
  })

  it('Q1 year to date equals the quarter', () => {
    const s = buildQuarterAndYearToDate({ taxYear: '2026-27', quarter: 1, payments, expenses, mortgageProps })
    expect(s.income).toEqual(s.quarter.income)
    expect(s.expenses).toEqual(s.quarter.expenses)
  })

  it('returns null for an unknown quarter', () => {
    expect(buildQuarterAndYearToDate({ taxYear: '2026-27', quarter: 5 })).toBeNull()
  })
})

describe('sameSubmissionFigures', () => {
  const a = { fromDate: '2026-04-06', toDate: '2026-10-05', income: { periodAmount: 2000, taxDeducted: 0 }, expenses: { repairsAndMaintenance: 500 } }
  it('matches identical figures and ignores display-only fields', () => {
    expect(sameSubmissionFigures(a, { ...a, totals: { net: 1 }, quarter: {} })).toBe(true)
  })
  it('spots a changed amount, bucket or period', () => {
    expect(sameSubmissionFigures(a, { ...a, income: { periodAmount: 2000.01, taxDeducted: 0 } })).toBe(false)
    expect(sameSubmissionFigures(a, { ...a, expenses: { repairsAndMaintenance: 500, other: 1 } })).toBe(false)
    expect(sameSubmissionFigures(a, { ...a, fromDate: '2026-07-06' })).toBe(false)
    expect(sameSubmissionFigures(a, null)).toBe(false)
  })
})

// Run the date tests on UK time so the local-vs-UTC difference is real
// whatever zone the machine (or CI) is in.
const ukTime = () => {
  let prev
  beforeAll(() => { prev = process.env.TZ; process.env.TZ = 'Europe/London' })
  afterAll(() => { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev })
}

describe('quarterStatusLabel', () => {
  ukTime()
  const q = { from: '2026-04-06', to: '2026-07-05', deadline: '2026-08-07' }

  it('is not overdue between quarter end and the 7th deadline', () => {
    expect(quarterStatusLabel(q, null, new Date('2026-08-06T12:00:00Z')).label).toMatch(/Due in/)
  })

  it('is overdue only after the 7th', () => {
    expect(quarterStatusLabel(q, null, new Date('2026-08-08T12:00:00Z')).label).toBe('Overdue')
  })

  it('uses the local (UK) date, not UTC, just after midnight BST', () => {
    // 00:30 BST on 8 Aug is still 7 Aug in UTC: the quarter is now overdue.
    const d = new Date(2026, 7, 8, 0, 30)
    expect(quarterStatusLabel(q, null, d).label).toBe('Overdue')
  })

  it('reports submitted status regardless of dates', () => {
    expect(quarterStatusLabel(q, { status: 'submitted' }, new Date('2026-09-01')).label).toBe('Submitted')
  })
})

describe('currentQuarter', () => {
  ukTime()
  it('uses the local calendar date', () => {
    expect(currentQuarter(new Date(2026, 6, 6, 0, 30)).quarter).toBe(2)
    expect(currentQuarter(new Date(2026, 6, 5, 23, 30)).quarter).toBe(1)
  })
})

describe('splitPropertiesByLegalOwner', () => {
  const cos = [
    { id: 'ltd', name: 'Ltd Co', legal_owner: 'limited_company' },
    { id: 'pers', name: 'Personal Group', legal_owner: 'personal' },
    { id: 'unset', name: 'Unset Group', legal_owner: null },
  ]
  const props = [
    { id: 'p1', company_id: 'ltd' }, { id: 'p2', company_id: 'pers' },
    { id: 'p3', company_id: 'unset' }, { id: 'p4', company_id: null },
    { id: 'p5', company_id: 'unknown' }, { id: 'p6', company_id: 'ltd' },
  ]

  it('excludes only limited-company properties', () => {
    const r = splitPropertiesByLegalOwner(props, cos)
    expect(r.included.map(p => p.id)).toEqual(['p2', 'p3', 'p4', 'p5'])
    expect(r.excluded.map(p => p.id)).toEqual(['p1', 'p6'])
    expect(r.excludedCompanies).toEqual([{ id: 'ltd', name: 'Ltd Co', count: 2 }])
    expect(r.unsetCompanies).toEqual([{ id: 'unset', name: 'Unset Group', count: 1 }])
    expect(r.legalOwnerSupported).toBe(true)
  })

  it('treats a company row without the field (column absent) as not set', () => {
    const r = splitPropertiesByLegalOwner([{ id: 'p1', company_id: 'c' }], [{ id: 'c', name: 'C' }])
    expect(r.included.map(p => p.id)).toEqual(['p1'])
    expect(r.unsetCompanies).toEqual([{ id: 'c', name: 'C', count: 1 }])
  })

  it('includes everything and prompts nothing when legal_owner is unsupported', () => {
    const r = splitPropertiesByLegalOwner(props, cos, { legalOwnerSupported: false })
    expect(r.included).toHaveLength(6)
    expect(r.excluded).toEqual([])
    expect(r.unsetCompanies).toEqual([])
    expect(r.legalOwnerSupported).toBe(false)
  })

  it('copes with empty input', () => {
    expect(splitPropertiesByLegalOwner().included).toEqual([])
    expect(splitPropertiesByLegalOwner(null, null).excluded).toEqual([])
  })
})

describe('isMissingLegalOwnerColumnError', () => {
  it('recognises undefined-column and schema-cache errors', () => {
    expect(isMissingLegalOwnerColumnError({ code: '42703', message: 'column companies.legal_owner does not exist' })).toBe(true)
    expect(isMissingLegalOwnerColumnError({ code: 'PGRST204', message: "Could not find the 'legal_owner' column of 'companies' in the schema cache" })).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isMissingLegalOwnerColumnError(null)).toBe(false)
    expect(isMissingLegalOwnerColumnError({ code: '57014', message: 'statement timeout' })).toBe(false)
    expect(isMissingLegalOwnerColumnError({ code: '42501', message: 'permission denied for table companies' })).toBe(false)
  })
})

describe('buildQuarterlySummary — refunds (negative expenses)', () => {
  const range = { periodFrom: '2026-04-06', periodTo: '2026-07-05' }
  it('a repair refunded in full leaves £0 in that bucket', () => {
    const s = buildQuarterlySummary({ ...range, expenses: [
      { amount: 500, date: '2026-05-01', category: 'repairs' },
      { amount: -500, date: '2026-05-10', category: 'repairs' },
    ] })
    expect(s.expenses.repairsAndMaintenance).toBeUndefined()
    expect(s.totals.expenses).toBe(0)
  })
  it('a partial refund reduces the bucket', () => {
    const s = buildQuarterlySummary({ ...range, expenses: [
      { amount: 500, date: '2026-05-01', category: 'repairs' },
      { amount: -200, date: '2026-05-10', category: 'maintenance' },
    ] })
    expect(s.expenses.repairsAndMaintenance).toBe(300)
    expect(s.totals.expenses).toBe(300)
  })
  it('a lone refund floors at £0 and never nets against another bucket', () => {
    const s = buildQuarterlySummary({ ...range, expenses: [
      { amount: -150, date: '2026-05-10', category: 'repairs' },
      { amount: 400, date: '2026-05-01', category: 'insurance' },
    ] })
    expect(s.expenses.repairsAndMaintenance).toBeUndefined()
    expect(s.expenses.premisesRunningCosts).toBe(400)
    expect(s.totals.expenses).toBe(400)
    expect(Object.values(s.expenses).every(v => v >= 0)).toBe(true)
  })
})
