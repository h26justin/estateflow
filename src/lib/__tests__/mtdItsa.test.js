import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  taxYearForDate, parseTaxYear, quartersForTaxYear,
  mapExpenseCategoryToHmrc, buildQuarterlySummary, quarterStatusLabel,
  currentQuarter, estimateMortgageInterest,
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
    expect(s.totals.expenses).toBe(640)
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
