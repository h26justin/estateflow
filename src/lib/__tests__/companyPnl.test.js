import { describe, it, expect } from 'vitest'
import {
  ukCorporationTax, dividendTax, monthsInRange, buildCompanyPnl,
  findViewerShareholder, viewerEffectiveShares, aggregateShareholdersAcrossCompanies,
  buildPortfolioPnl, scalePortfolioPnl, estimateMissingRents,
  isHoldingCompany, countAssociatedCompanies, companyEffectiveStakes,
  TAX_BAND_LABELS, CT_MORTGAGE_NOTE, rentReceivedOnRow, indexRentAllocations,
} from '../companyPnl'
import { evaluatePeriod } from '../rentEngine'

describe('ukCorporationTax', () => {
  it('returns nil for zero or negative profit', () => {
    expect(ukCorporationTax(0).tax).toBe(0)
    expect(ukCorporationTax(-5000).tax).toBe(0)
  })

  it('applies 19% small profits rate at or below £50k', () => {
    expect(ukCorporationTax(40_000).tax).toBe(7_600)
    expect(ukCorporationTax(50_000).tax).toBe(9_500)
    expect(ukCorporationTax(50_000).band).toBe('small')
  })

  it('applies 25% main rate at or above £250k', () => {
    expect(ukCorporationTax(300_000).tax).toBe(75_000)
    expect(ukCorporationTax(250_000).tax).toBe(62_500)
    expect(ukCorporationTax(300_000).band).toBe('main')
  })

  it('applies marginal relief between the limits', () => {
    // 100k: 25,000 − (150,000 × 3/200) = 25,000 − 2,250 = 22,750
    const r = ukCorporationTax(100_000)
    expect(r.tax).toBe(22_750)
    expect(r.band).toBe('marginal')
    expect(r.effectiveRate).toBeCloseTo(0.2275, 4)
  })

  it('divides both limits by the associated companies count', () => {
    // 5 associated companies → limits £10k / £50k.
    const r = ukCorporationTax(40_000, { associatedCompanies: 5 })
    expect(r.lowerLimit).toBe(10_000)
    expect(r.upperLimit).toBe(50_000)
    expect(r.band).toBe('marginal')
    // 40k: 10,000 − (10,000 × 0.015) = 9,850
    expect(r.tax).toBe(9_850)
    // Same profit with one company stays at the small rate.
    expect(ukCorporationTax(40_000).band).toBe('small')
  })
})

describe('dividendTax', () => {
  it('applies the 2025-26 band rates to dates before 6 April 2026', () => {
    expect(dividendTax(10_000, 'basic', '2026-04-05')).toBe(875)
    expect(dividendTax(10_000, 'higher', '2026-04-05')).toBe(3_375)
    expect(dividendTax(10_000, 'additional', '2026-04-05')).toBe(3_935)
  })
  it('applies the 10.75% / 35.75% rates from 6 April 2026 (additional unchanged)', () => {
    expect(dividendTax(10_000, 'basic', '2026-04-06')).toBe(1_075)
    expect(dividendTax(10_000, 'higher', '2026-04-06')).toBe(3_575)
    expect(dividendTax(10_000, 'additional', '2026-04-06')).toBe(3_935)
    expect(dividendTax(10_000, 'higher', new Date(2027, 0, 31))).toBe(3_575)
  })
  it('uses the current rates when no date is given', () => {
    expect(dividendTax(10_000, 'basic')).toBe(1_075)
    expect(dividendTax(10_000, 'higher')).toBe(3_575)
    expect(TAX_BAND_LABELS.basic).toBe('Basic rate (10.75%)')
    expect(TAX_BAND_LABELS.higher).toBe('Higher rate (35.75%)')
  })
  it('returns null for unknown/absent band and 0 for negative amounts', () => {
    expect(dividendTax(10_000, null)).toBeNull()
    expect(dividendTax(10_000, 'weird')).toBeNull()
    expect(dividendTax(-500, 'basic')).toBe(0)
  })
})

describe('ukCorporationTax — short periods', () => {
  it('pro-rates the limits by period length', () => {
    // A quarter: limits become 50k x 92/365 and 250k x 92/365.
    const r = ukCorporationTax(30_000, { periodDays: 92 })
    expect(r.lowerLimit).toBeCloseTo(50_000 * 92 / 365, 6)
    expect(r.band).toBe('marginal')
    expect(r.tax).toBeGreaterThan(30_000 * 0.19)
    // 30k in a quarter is ~120k a year: same effective rate as the annual figure.
    expect(r.effectiveRate).toBeCloseTo(ukCorporationTax(30_000 * 365 / 92).effectiveRate, 6)
  })
  it('a full year keeps the annual limits', () => {
    expect(ukCorporationTax(40_000, { periodDays: 365 }).tax).toBe(7_600)
  })
  it('buildCompanyPnl tests a 3-month profit against 3 months of limits', () => {
    const pnl = buildCompanyPnl({
      properties: [{ id: 'p', rent_pcm: 10_000, status: 'rented' }], payments: [], months: 3,
    })
    expect(pnl.corporationTax.band).toBe('marginal')
  })
})

describe('monthsInRange', () => {
  it('counts the months a range lasts, not the calendar months it touches', () => {
    expect(monthsInRange('2026-04-06', '2027-04-05')).toBe(12) // a UK tax year is 12 months
    expect(monthsInRange('2026-01-01', '2026-12-31')).toBe(12)
    expect(monthsInRange('2026-06-01', '2026-06-30')).toBe(1)
    expect(monthsInRange('2026-03-01', '2026-03-31')).toBe(1)
    expect(monthsInRange('2026-01-15', '2026-02-14')).toBe(1)
    expect(monthsInRange('2026-01-31', '2026-02-28')).toBe(1)
    expect(monthsInRange('2026-01-01', '2026-03-31')).toBe(3)
  })
  it('accepts Date objects as the Reports page passes them', () => {
    expect(monthsInRange(new Date('2026-04-06'), new Date('2027-04-05'))).toBe(12)
  })
  it('the expected-rent fallback over a tax year is 12 months of rent', () => {
    const pnl = buildCompanyPnl({
      properties: [{ id: 'p', rent_pcm: 1000, status: 'rented' }], payments: [],
      months: monthsInRange('2026-04-06', '2027-04-05'),
    })
    expect(pnl.income.rentCollected).toBe(12000)
  })
  it('floors at 1 for bad input', () => {
    expect(monthsInRange('nope', '2026-01-01')).toBe(1)
    expect(monthsInRange('2026-05-01', '2026-01-01')).toBe(1)
  })
})

describe('buildCompanyPnl', () => {
  const shareholders = [
    { id: 's1', name: 'Justin', percentage: 75, tax_band: 'higher', user_id: 'u1' },
    { id: 's2', name: 'Partner', percentage: 25, tax_band: null },
  ]

  const agents = [
    { id: 'a1', name: 'Propertunity', fee_percent: 10, vat_treatment: 'ex_vat' },
    { id: 'a2', name: 'RMS Letting', fee_percent: 7, vat_treatment: 'inc_vat' },
    { id: 'a3', name: 'No Fee Agent', fee_percent: null, vat_treatment: 'ex_vat' },
  ]

  it('computes the full pipeline with per-agency management fees', () => {
    const r = buildCompanyPnl({
      properties: [
        { id: 'p1', status: 'rented', rent_pcm: 3_000, managed_by_agent_id: 'a1' },
        { id: 'p2', status: 'rented', rent_pcm: 1_500, managed_by_agent_id: 'a2' },
        { id: 'p3', status: 'rented', rent_pcm: 1_000 }, // self-managed — no fee
        { id: 'p4', status: 'rented', rent_pcm: 500, managed_by_agent_id: 'a3' }, // agent without a fee set
      ],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 40_000 },
        { property_id: 'p2', status: 'paid', amount: 20_000 },
        { property_id: 'p1', status: 'overdue', amount: 5_000 }, // ignored
      ],
      expenses: [
        { category: 'repairs', amount: 4_000 },
        { category: 'insurance', amount: 1_000 },
        { category: 'agent_fees', amount: 3_000 }, // excluded — calculated fee replaces it
      ],
      agents, shareholders, months: 12,
      periodEnd: '2026-03-31', // 2025-26 dividend rates
    })

    expect(r.income.rentCollected).toBe(60_000)
    expect(r.income.usedFallback).toBe(false)
    // Propertunity: 10% of p1's £40k + 20% VAT = £4,800.
    // RMS: 7% of p2's £20k, VAT-inclusive = £1,400. p3/p4 contribute nothing.
    const prop = r.managementFees.find(f => f.agentName === 'Propertunity')
    expect(prop.amount).toBe(4_800)
    expect(prop.propertyCount).toBe(1)
    expect(r.managementFees.find(f => f.agentName === 'RMS Letting').amount).toBe(1_400)
    expect(r.managementFees).toHaveLength(2)
    expect(r.totalManagementFees).toBe(6_200)
    expect(r.excludedAgentFeeExpenses).toBe(3_000)
    expect(r.totalOperatingExpenses).toBe(5_000)
    expect(r.totalExpenses).toBe(11_200)
    expect(r.operatingProfit).toBe(48_800)
    // Below £50k → 19%
    expect(r.corporationTax.tax).toBeCloseTo(9_272, 2)
    expect(r.profitAfterTax).toBeCloseTo(39_528, 2)

    const justin = r.shareholders.find(s => s.name === 'Justin')
    expect(justin.share).toBeCloseTo(29_646, 2)
    expect(justin.dividendTax).toBeCloseTo(10_005.53, 1)
    expect(justin.net).toBeCloseTo(19_640.47, 1)
    expect(justin.netMonthly).toBeCloseTo(1_636.71, 1)

    const partner = r.shareholders.find(s => s.name === 'Partner')
    expect(partner.dividendTax).toBeNull()
    expect(partner.net).toBeCloseTo(9_882, 2)

    expect(r.ownershipTotal).toBe(100)
  })

  it('applies agency fees to expected rent when no payments exist', () => {
    const r = buildCompanyPnl({
      properties: [{ id: 'p1', status: 'rented', rent_pcm: 1_000, managed_by_agent_id: 'a1' }],
      payments: [], agents, shareholders: [], months: 12,
    })
    expect(r.income.rentCollected).toBe(12_000)
    expect(r.income.usedFallback).toBe(true)
    // 10% of £12k + VAT = £1,440
    expect(r.totalManagementFees).toBe(1_440)
  })

  it('keeps logged agent_fees expenses when no property has a fee-bearing agent', () => {
    const r = buildCompanyPnl({
      properties: [{ id: 'p1', status: 'rented', rent_pcm: 1_000 }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 10_000 }],
      expenses: [{ category: 'agent_fees', amount: 1_000 }],
      agents, shareholders: [], months: 12,
    })
    expect(r.excludedAgentFeeExpenses).toBe(0)
    expect(r.totalManagementFees).toBe(0)
    expect(r.totalOperatingExpenses).toBe(1_000)
    expect(r.expenseCategories[0].label).toBe('Agent / Management Fees')
  })

  it('falls back to expected rent when there are no paid payments', () => {
    const r = buildCompanyPnl({
      properties: [
        { status: 'rented', rent_pcm: 1_000 },
        { status: 'vacant', rent_pcm: 800 }, // not earning
      ],
      payments: [], months: 12, shareholders: [],
    })
    expect(r.income.rentCollected).toBe(12_000)
    expect(r.income.usedFallback).toBe(true)
  })

  it('charges no corporation tax on a loss and splits the loss', () => {
    const r = buildCompanyPnl({
      payments: [{ status: 'paid', amount: 1_000 }],
      expenses: [{ category: 'repairs', amount: 5_000 }],
      shareholders, months: 12,
    })
    expect(r.operatingProfit).toBe(-4_000)
    expect(r.corporationTax.tax).toBe(0)
    expect(r.profitAfterTax).toBe(-4_000)
    const justin = r.shareholders.find(s => s.name === 'Justin')
    expect(justin.share).toBe(-3_000)
    // No dividend tax on a negative share.
    expect(justin.dividendTax).toBe(0)
  })
})

describe('aggregateShareholdersAcrossCompanies', () => {
  it('links the same person across companies by user id, email, then name', () => {
    const rows = aggregateShareholdersAcrossCompanies([
      { companyName: 'Alpha Ltd', shareholders: [
        { name: 'Justin', userId: 'u1', email: 'j@x.com', percentage: 75, net: 7500, netMonthly: 625 },
        { name: 'Partner', percentage: 25, net: 2500, netMonthly: 208.33 },
      ]},
      { companyName: 'Beta Ltd', shareholders: [
        // No userId here — links to the Alpha row via email.
        { name: 'J Hammond', email: 'J@X.COM', percentage: 50, net: 5000, netMonthly: 416.67 },
        // Links by exact (case-insensitive) name.
        { name: 'partner', percentage: 50, net: 5000, netMonthly: 416.67 },
      ]},
      { companyName: 'Gamma Ltd', shareholders: [
        // Links by userId even though name/email differ.
        { name: 'Justin H', userId: 'u1', percentage: 100, net: 12000, netMonthly: 1000 },
      ]},
    ])

    expect(rows).toHaveLength(2)
    const justin = rows[0] // sorted by total net desc
    expect(justin.userId).toBe('u1')
    expect(justin.companiesCount).toBe(3)
    expect(justin.totalPercent).toBe(225)
    expect(justin.totalNet).toBe(24_500)
    expect(justin.totalMonthly).toBeCloseTo(2_041.67, 2)
    expect(justin.holdings.map(h => h.company)).toEqual(['Alpha Ltd', 'Beta Ltd', 'Gamma Ltd'])

    const partner = rows[1]
    expect(partner.companiesCount).toBe(2)
    expect(partner.totalPercent).toBe(75)
    expect(partner.totalNet).toBe(7_500)
  })

  it('keeps different people separate and handles empty input', () => {
    expect(aggregateShareholdersAcrossCompanies([])).toEqual([])
    const rows = aggregateShareholdersAcrossCompanies([
      { companyName: 'A', shareholders: [{ name: 'Ann', email: 'ann@x.com', percentage: 50, net: 100, netMonthly: 8.33 }] },
      { companyName: 'B', shareholders: [{ name: 'Ann Other', email: 'other@x.com', percentage: 50, net: 100, netMonthly: 8.33 }] },
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('buildPortfolioPnl', () => {
  it('groups by company with property rows summing to company totals and CT apportioned pro-rata on positive profit', () => {
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }, { id: 'cB', name: 'Beta Ltd' }],
      properties: [
        { id: 'p1', name: 'Flat 1', company_id: 'cA' },
        { id: 'p2', name: 'Flat 2', company_id: 'cA' },
        { id: 'p3', name: 'House 3', company_id: 'cB' },
      ],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 12_000 },
        { property_id: 'p2', status: 'paid', amount: 8_000 },
        { property_id: 'p3', status: 'paid', amount: 20_000 },
      ],
      expenses: [
        { property_id: 'p1', category: 'repairs', amount: 2_000 },
        { property_id: 'p2', category: 'insurance', amount: 10_000 },
      ],
      months: 12, associatedCompanies: 1,
    })

    expect(r.companies).toHaveLength(2)
    const alpha = r.companies[0]
    expect(alpha.name).toBe('Alpha Ltd')
    const [p1, p2] = alpha.rows
    expect(p1.pretax).toBe(10_000)
    expect(p2.pretax).toBe(-2_000)
    expect(alpha.totals.pretax).toBe(8_000)
    // CT on 8,000 at 19% = 1,520 — all carried by the profitable property.
    expect(alpha.totals.ct).toBe(1_520)
    expect(p1.ctShare).toBe(1_520)
    expect(p2.ctShare).toBe(0)
    expect(p1.posttax).toBe(8_480)
    expect(p2.posttax).toBe(-2_000)
    expect(alpha.totals.posttax).toBe(6_480)
    // Rows reconcile exactly to the block totals.
    expect(p1.income + p2.income).toBe(alpha.totals.income)
    expect(p1.posttax + p2.posttax).toBe(alpha.totals.posttax)

    // Grand totals span both companies.
    expect(r.grand.income).toBe(40_000)
    expect(r.grand.pretax).toBe(28_000)
    expect(r.grand.ct).toBe(1_520 + 3_800)
    expect(r.grand.posttax).toBe(28_000 - 5_320)
  })

  it('prefers a real logged agent fee over the calculated percentage', () => {
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', managed_by_agent_id: 'ag1' }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 10_000 }],
      expenses: [{ property_id: 'p1', category: 'agent_fees', amount: 500 }],
      agents: [{ id: 'ag1', name: 'LetCo', fee_percent: 10, vat_treatment: 'ex_vat' }],
      months: 12,
    })
    const block = r.companies[0]
    // The agent was actually invoiced £500. The 12%-of-£10,000 estimate
    // (£1,200) is suppressed for this property rather than replacing the
    // invoice, so the fee is counted once, at its real value.
    expect(block.rows[0].fees).toBe(0)
    expect(block.rows[0].expenses).toBe(500)
    expect(block.excludedAgentFeeExpenses).toBe(0)
    expect(block.actualAgentFeeExpenses).toBe(500)
    expect(block.actualFeePropertyCount).toBe(1)
    expect(block.rows[0].pretax).toBe(9_500)
  })

  it('still calculates the fee for properties that have no logged fee', () => {
    // Mixed portfolio: p1 has a real invoice, p2 does not.
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [
        { id: 'p1', name: 'Flat 1', company_id: 'cA', managed_by_agent_id: 'ag1' },
        { id: 'p2', name: 'Flat 2', company_id: 'cA', managed_by_agent_id: 'ag1' },
      ],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 10_000 },
        { property_id: 'p2', status: 'paid', amount: 10_000 },
      ],
      expenses: [{ property_id: 'p1', category: 'agent_fees', amount: 500 }],
      agents: [{ id: 'ag1', name: 'LetCo', fee_percent: 10, vat_treatment: 'ex_vat' }],
      months: 12,
    })
    const block = r.companies[0]
    const p1 = block.rows.find(x => x.name === 'Flat 1')
    const p2 = block.rows.find(x => x.name === 'Flat 2')
    expect(p1.fees).toBe(0)
    expect(p1.expenses).toBe(500)
    expect(p2.fees).toBe(1_200)
    expect(p2.expenses).toBe(0)
    expect(block.actualFeePropertyCount).toBe(1)
  })

  it('falls back to expected rent per company when it has no paid payments', () => {
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [
        { id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1_000 },
        { id: 'p2', name: 'Flat 2', company_id: 'cA', status: 'vacant', rent_pcm: 800 },
      ],
      payments: [], months: 12,
    })
    const block = r.companies[0]
    expect(block.usedFallback).toBe(true)
    expect(block.rows[0].income).toBe(12_000)
    expect(block.rows[1].income).toBe(0)
  })

  it('puts properties without a company in a personally-held bucket with no corporation tax', () => {
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [
        { id: 'p1', name: 'Flat 1', company_id: 'cA' },
        { id: 'p9', name: 'Own house', company_id: null },
      ],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 10_000 },
        { property_id: 'p9', status: 'paid', amount: 6_000 },
      ],
      months: 12,
    })
    const personal = r.companies.find(b => b.personal)
    expect(personal.name).toMatch(/Personally held/)
    expect(personal.corporationTax).toBeNull()
    expect(personal.totals.ct).toBe(0)
    expect(personal.totals.posttax).toBe(personal.totals.pretax)
  })

  it('produces month-by-month pre-tax nets that reconcile to the period totals', () => {
    const monthKeys = [{ m: 0, y: 2026 }, { m: 1, y: 2026 }, { m: 2, y: 2026 }]
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', managed_by_agent_id: 'ag1' }],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 1_000, year: 2026, month: 1 },
        { property_id: 'p1', status: 'paid', amount: 1_000, year: 2026, month: 3 },
      ],
      expenses: [{ property_id: 'p1', category: 'repairs', amount: 300, date: '2026-02-14' }],
      agents: [{ id: 'ag1', name: 'LetCo', fee_percent: 10, vat_treatment: 'inc_vat' }],
      months: 3, monthKeys,
    })
    const row = r.companies[0].rows[0]
    // Jan: 1,000 − 100 fee; Feb: −300 expense; Mar: 1,000 − 100 fee.
    expect(row.monthly).toEqual([900, -300, 900])
    expect(row.monthly.reduce((s, v) => s + v, 0)).toBeCloseTo(row.pretax, 2)
    expect(r.companies[0].totals.monthly).toEqual([900, -300, 900])
    expect(r.grand.monthly).toEqual([900, -300, 900])
  })

  it('forecasts future months with expected rent while keeping past actuals', () => {
    const monthKeys = [{ m: 3, y: 2026 }, { m: 4, y: 2026 }, { m: 5, y: 2026 }, { m: 6, y: 2026 }]
    const args = {
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [
        { id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1_000, managed_by_agent_id: 'ag1' },
        { id: 'p2', name: 'Flat 2', company_id: 'cA', status: 'vacant', rent_pcm: 900 },
      ],
      payments: [
        // April collected under contract; May missed; June (current) not yet in.
        { property_id: 'p1', status: 'paid', amount: 800, year: 2026, month: 4 },
      ],
      expenses: [{ property_id: 'p1', category: 'repairs', amount: 100, date: '2026-05-20' }],
      agents: [{ id: 'ag1', name: 'LetCo', fee_percent: 10, vat_treatment: 'inc_vat' }],
      months: 4, monthKeys,
      forecast: { now: new Date('2026-06-15') },
    }
    const r = buildPortfolioPnl(args)
    const flat1 = r.companies[0].rows[0]
    // Apr actual £800; May actual £0 (missed, in the past — not re-forecast);
    // Jun = max(0, expected £1,000); Jul = expected £1,000. Fee 10% on rent.
    expect(flat1.monthly).toEqual([720, -100, 900, 900])
    expect(flat1.income).toBe(2_800)
    expect(flat1.fees).toBe(280)
    expect(flat1.pretax).toBe(2_420)
    // Vacant property forecasts nothing.
    expect(r.companies[0].rows[1].income).toBe(0)
    // Current + future buckets are flagged as forecast.
    expect(r.monthFlags).toEqual([false, false, true, true])
    expect(r.forecast).toBe(true)

    // Same inputs without forecast: only the April actual counts.
    const actuals = buildPortfolioPnl({ ...args, forecast: null })
    expect(actuals.companies[0].rows[0].income).toBe(800)
    expect(actuals.forecast).toBe(false)
  })

  it('keeps an above-contract collection in the current month when forecasting', () => {
    const monthKeys = [{ m: 5, y: 2026 }]
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1_000 }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 1_500, year: 2026, month: 6 }],
      months: 1, monthKeys,
      forecast: { now: new Date('2026-06-15') },
    })
    expect(r.companies[0].rows[0].income).toBe(1_500)
  })

  it('ignores forecast when monthKeys are not supplied', () => {
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1_000 }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 800 }],
      months: 12,
      forecast: { now: new Date('2026-06-15') },
    })
    expect(r.forecast).toBe(false)
    expect(r.companies[0].rows[0].income).toBe(800)
  })

  it('buckets legacy payments by period_start when year/month are missing', () => {
    const monthKeys = [{ m: 0, y: 2026 }, { m: 1, y: 2026 }]
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA' }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 950, period_start: '2026-02-01' }],
      months: 2, monthKeys,
    })
    expect(r.companies[0].rows[0].monthly).toEqual([0, 950])
  })

  it('honours the include switches for fees, expenses, mortgage, and corporation tax', () => {
    const args = {
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', managed_by_agent_id: 'ag1' }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 10_000 }],
      expenses: [
        { property_id: 'p1', category: 'repairs', amount: 1_000 },
        { property_id: 'p1', category: 'mortgage', amount: 3_000 },
        { property_id: 'p1', category: 'agent_fees', amount: 500 },
      ],
      agents: [{ id: 'ag1', name: 'LetCo', fee_percent: 10, vat_treatment: 'inc_vat' }],
      months: 12,
    }
    // Fees off: no calculated fee AND the logged agent_fees cost is dropped.
    const noFees = buildPortfolioPnl({ ...args, include: { managementFees: false } }).companies[0]
    expect(noFees.rows[0].fees).toBe(0)
    expect(noFees.rows[0].expenses).toBe(4_000)
    expect(noFees.excludedAgentFeeExpenses).toBe(0)
    // Mortgage off: only the mortgage category goes. Repairs £1,000 plus the
    // logged agent fee £500 remain, and the calculated fee is suppressed
    // because that real fee is being counted.
    const noMortgage = buildPortfolioPnl({ ...args, include: { mortgage: false } }).companies[0]
    expect(noMortgage.rows[0].expenses).toBe(1_500)
    expect(noMortgage.rows[0].fees).toBe(0)
    // Expenses off: everything logged goes, and the calculated fee comes BACK
    // — with the real fee excluded from the numbers there is nothing for it to
    // double-count against, and dropping both would delete the fee entirely.
    const noExp = buildPortfolioPnl({ ...args, include: { expenses: false } }).companies[0]
    expect(noExp.rows[0].expenses).toBe(0)
    expect(noExp.rows[0].fees).toBe(1_000)
    // CT off: post-tax equals pre-tax.
    const noCt = buildPortfolioPnl({ ...args, include: { corporationTax: false } }).companies[0]
    expect(noCt.totals.ct).toBe(0)
    expect(noCt.corporationTax).toBeNull()
    expect(noCt.totals.posttax).toBe(noCt.totals.pretax)
  })

  it('fills every void month to contract rent under fullOccupancy', () => {
    const monthKeys = [{ m: 0, y: 2026 }, { m: 1, y: 2026 }, { m: 2, y: 2026 }]
    const args = {
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [
        // Rented but with gaps: Jan collected above contract, Feb short, Mar void.
        { id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1_000 },
        // Vacant all period — pure void.
        { id: 'p2', name: 'Flat 2', company_id: 'cA', status: 'vacant', rent_pcm: 800 },
      ],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 1_200, year: 2026, month: 1 },
        { property_id: 'p1', status: 'paid', amount: 400, year: 2026, month: 2 },
      ],
      months: 3, monthKeys,
    }
    const r = buildPortfolioPnl({ ...args, fullOccupancy: true })
    const [p1, p2] = r.companies[0].rows
    // Above-contract Jan kept; short Feb and void Mar floored to 1,000.
    expect(p1.monthly).toEqual([1_200, 1_000, 1_000])
    expect(p1.income).toBe(3_200)
    // Vacant property earns its contract rent every month.
    expect(p2.monthly).toEqual([800, 800, 800])
    expect(p2.income).toBe(2_400)
    expect(r.fullOccupancy).toBe(true)

    // Off (default): actuals only, vacant earns nothing.
    const off = buildPortfolioPnl(args)
    expect(off.companies[0].rows[0].income).toBe(1_600)
    expect(off.companies[0].rows[1].income).toBe(0)
    expect(off.fullOccupancy).toBe(false)

    // Ignored without monthKeys, like forecast.
    const noKeys = buildPortfolioPnl({ ...args, monthKeys: null, fullOccupancy: true })
    expect(noKeys.fullOccupancy).toBe(false)
    expect(noKeys.companies[0].rows[0].income).toBe(1_600)
  })

  it('composes fullOccupancy with forecast (floor applies after future months fill)', () => {
    const monthKeys = [{ m: 4, y: 2026 }, { m: 5, y: 2026 }, { m: 6, y: 2026 }]
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      // Vacant: plain forecast would give £0 in every month.
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'vacant', rent_pcm: 900 }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 100, year: 2026, month: 5 }],
      months: 3, monthKeys,
      forecast: { now: new Date('2026-06-15') },
      fullOccupancy: true,
    })
    // May actual 100 → floored to 900; Jun/Jul forecast 0 (vacant) → floored.
    expect(r.companies[0].rows[0].monthly).toEqual([900, 900, 900])
    expect(r.forecast).toBe(true)
    expect(r.fullOccupancy).toBe(true)
  })

  it('uses rentEstimates for fallback, forecast, and the full-occupancy floor — never overriding a real rent', () => {
    const monthKeys = [{ m: 0, y: 2026 }, { m: 1, y: 2026 }]
    const args = {
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [
        { id: 'p1', name: 'Flat 1, Kings Court', company_id: 'cA', status: 'rented', rent_pcm: 700 },
        { id: 'p2', name: 'Flat 2, Kings Court', company_id: 'cA', status: 'rented', rent_pcm: 0 },
      ],
      payments: [], months: 2, monthKeys,
      rentEstimates: { p2: 700 },
    }
    // Fallback (no payments): the estimated rent projects like a real one.
    const r = buildPortfolioPnl(args)
    expect(r.companies[0].rows[1].income).toBe(1_400)
    expect(r.companies[0].rows[1].rentEstimated).toBe(true)
    expect(r.companies[0].rows[0].rentEstimated).toBe(false)
    // Full occupancy floors a vacant £0-rent unit to its estimate.
    const occ = buildPortfolioPnl({
      ...args,
      properties: [{ id: 'p2', name: 'Flat 2, Kings Court', company_id: 'cA', status: 'vacant', rent_pcm: 0 }],
      payments: [{ property_id: 'p2', status: 'paid', amount: 100, year: 2026, month: 1 }],
      fullOccupancy: true,
    })
    expect(occ.companies[0].rows[0].monthly).toEqual([700, 700])
    // A property with its own rent never takes the estimate.
    const own = buildPortfolioPnl({ ...args, rentEstimates: { p1: 9_999, p2: 700 } })
    expect(own.companies[0].rows[0].income).toBe(1_400)
  })

  it('uses expected rent in every month bucket when falling back', () => {
    const monthKeys = [{ m: 3, y: 2026 }, { m: 4, y: 2026 }]
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 750 }],
      payments: [], months: 2, monthKeys,
    })
    expect(r.companies[0].rows[0].monthly).toEqual([750, 750])
    expect(r.companies[0].rows[0].income).toBe(1_500)
  })
})

describe('estimateMissingRents', () => {
  it('estimates a missing rent from the median of sibling units in the same building', () => {
    const est = estimateMissingRents([
      { id: 'p1', name: 'Flat 1, Park Place East', company_id: 'cN', rent_pcm: 500 },
      { id: 'p2', name: 'Flat 2, Park Place East', company_id: 'cN', rent_pcm: 550 },
      { id: 'p3', name: 'Flat 3, Park Place East', company_id: 'cN', rent_pcm: 550 },
      { id: 'p4', name: 'Flat 4, Park Place East', company_id: 'cN', rent_pcm: 600 },
      { id: 'p5', name: 'Flat 5, Park Place East', company_id: 'cN', rent_pcm: 0 },
    ])
    // Median of 500/550/550/600 = 550.
    expect(est).toEqual({ p5: 550 })
  })

  it('matches trailing unit designators and lettered house numbers', () => {
    const est = estimateMissingRents([
      { id: 'e1', name: 'Esplanade West Flat 1', company_id: 'cV', rent_pcm: 550 },
      { id: 'e2', name: 'Esplanade West Flat 2', company_id: 'cV', rent_pcm: null },
      { id: 's1', name: '47A Somerset Street', company_id: 'cE', rent_pcm: 484 },
      { id: 's2', name: '47B Somerset Street', company_id: 'cE', rent_pcm: 0 },
      { id: 'r1', name: 'Room 2A, 10 Elms West', company_id: 'cV', rent_pcm: 600 },
      { id: 'r2', name: 'Room 3B, 10 Elms West', company_id: 'cV', rent_pcm: 0 },
    ])
    expect(est).toEqual({ e2: 550, s2: 484, r2: 600 })
  })

  it('never crosses companies and gives nothing when no sibling has a rent', () => {
    const est = estimateMissingRents([
      // Same building name, different companies — must not mix.
      { id: 'a1', name: 'Flat 1, High Street', company_id: 'cA', rent_pcm: 900 },
      { id: 'b1', name: 'Flat 2, High Street', company_id: 'cB', rent_pcm: 0 },
      // All-zero building: no basis for an estimate.
      { id: 'd1', name: 'Flat 1 Douro Terrace', company_id: 'cW', rent_pcm: 0 },
      { id: 'd2', name: 'Flat 2 Douro Terrace', company_id: 'cW', rent_pcm: 0 },
    ])
    expect(est).toEqual({})
  })
})

describe('scalePortfolioPnl', () => {
  // Base result: Alpha (viewer holds 50%), Beta (no holding), and a
  // personally-held property.
  const base = () => buildPortfolioPnl({
    companies: [{ id: 'cA', name: 'Alpha Ltd' }, { id: 'cB', name: 'Beta Ltd' }],
    properties: [
      { id: 'p1', name: 'Flat 1', company_id: 'cA' },
      { id: 'p3', name: 'House 3', company_id: 'cB' },
      { id: 'p9', name: 'Own house', company_id: null },
    ],
    payments: [
      { property_id: 'p1', status: 'paid', amount: 12_000 },
      { property_id: 'p3', status: 'paid', amount: 20_000 },
      { property_id: 'p9', status: 'paid', amount: 6_000 },
    ],
    expenses: [{ property_id: 'p1', category: 'repairs', amount: 2_000 }],
    months: 12,
  })

  it('scales each block by the holder percentage and drops companies with no holding', () => {
    const r = scalePortfolioPnl(base(), { cA: 50 })
    expect(r.scaled).toBe(true)
    // Beta dropped; Alpha + personal survive.
    expect(r.companies.map(b => b.name)).toEqual(['Alpha Ltd', 'Personally held (no company)'])
    const alpha = r.companies[0]
    expect(alpha.sharePercent).toBe(50)
    // Alpha whole-company: income 12,000, pretax 10,000, CT 1,900 (19%),
    // posttax 8,100 → halved.
    expect(alpha.rows[0].income).toBe(6_000)
    expect(alpha.totals.pretax).toBe(5_000)
    expect(alpha.totals.ct).toBe(950)
    expect(alpha.totals.posttax).toBe(4_050)
    // Personal bucket kept at 100%.
    const personal = r.companies[1]
    expect(personal.sharePercent).toBe(100)
    expect(personal.totals.income).toBe(6_000)
    // Grand recomputed over surviving blocks only.
    expect(r.grand.income).toBe(12_000)
    expect(r.grand.posttax).toBe(4_050 + 6_000)
  })

  it('scales monthly buckets and recomputes grand monthly columns', () => {
    const monthKeys = [{ m: 0, y: 2026 }, { m: 1, y: 2026 }]
    const raw = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA' }],
      payments: [
        { property_id: 'p1', status: 'paid', amount: 1_000, year: 2026, month: 1 },
        { property_id: 'p1', status: 'paid', amount: 1_000, year: 2026, month: 2 },
      ],
      months: 2, monthKeys,
    })
    const r = scalePortfolioPnl(raw, { cA: 25 })
    expect(r.companies[0].rows[0].monthly).toEqual([250, 250])
    expect(r.companies[0].totals.monthly).toEqual([250, 250])
    expect(r.grand.monthly).toEqual([250, 250])
    // Pass-through fields survive the reshape.
    expect(r.months).toBe(2)
    expect(r.monthFlags).toEqual([false, false])
  })

  it('applies dividend tax per company when bands are supplied', () => {
    // Alpha whole-company posttax 8,100 → 50% share = 4,050; higher band
    // 33.75% → 1,366.88 dividend tax → net 2,683.12.
    const r = scalePortfolioPnl(base(), { cA: 50 }, { dividendTaxBands: { cA: 'higher' }, periodEnd: '2026-03-31' })
    const alpha = r.companies[0]
    expect(alpha.totals.dividendTax).toBeCloseTo(1_366.88, 2)
    expect(alpha.totals.posttax).toBeCloseTo(2_683.12, 2)
    expect(alpha.rows[0].dividendTax).toBeCloseTo(1_366.88, 2)
    expect(alpha.rows[0].posttax).toBeCloseTo(2_683.12, 2)
    // Personal bucket untouched by dividend tax.
    expect(r.companies[1].totals.dividendTax).toBe(0)
    expect(r.grand.dividendTax).toBeCloseTo(1_366.88, 2)
    expect(r.grand.posttax).toBeCloseTo(2_683.12 + 6_000, 2)
    // No band map → no dividend tax (previous behaviour).
    const plain = scalePortfolioPnl(base(), { cA: 50 })
    expect(plain.companies[0].totals.dividendTax).toBe(0)
    expect(plain.grand.dividendTax).toBe(0)
  })

  it('returns no blocks when the holder has no shares anywhere', () => {
    const raw = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA' }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 1_000 }],
      months: 12,
    })
    const r = scalePortfolioPnl(raw, {})
    expect(r.companies).toEqual([])
    expect(r.grand.income).toBe(0)
    expect(r.grand.posttax).toBe(0)
  })
})

describe('findViewerShareholder', () => {
  const rows = [
    { id: 'a', name: 'Justin', user_id: 'u1' },
    { id: 'b', name: 'Jo', email: 'JO@example.com' },
  ]
  it('matches by user_id first, then email case-insensitively', () => {
    expect(findViewerShareholder(rows, { id: 'u1' })?.id).toBe('a')
    expect(findViewerShareholder(rows, { id: 'x', email: 'jo@example.com' })?.id).toBe('b')
    expect(findViewerShareholder(rows, { id: 'x', email: 'none@example.com' })).toBeNull()
    expect(findViewerShareholder(rows, null)).toBeNull()
  })

  it('never matches a corporate shareholder, even on the viewer email or user_id', () => {
    const corp = [
      { id: 'h', name: 'Biggie Group Ltd', shareholder_type: 'company', email: 'justin@example.com', user_id: 'u1' },
      { id: 'j', name: 'Justin', email: 'justin@example.com' },
    ]
    expect(findViewerShareholder(corp, { id: 'u1', email: 'justin@example.com' })?.id).toBe('j')
    expect(findViewerShareholder([corp[0]], { id: 'u1', email: 'justin@example.com' })).toBeNull()
  })
})

describe('corporate shareholders (buildCompanyPnl)', () => {
  it('estimates no dividend tax for a company shareholder even when a band is recorded', () => {
    const r = buildCompanyPnl({
      properties: [{ id: 'p1', status: 'rented', rent_pcm: 1_000 }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 10_000 }],
      shareholders: [
        { id: 's1', name: 'Biggie Group Ltd', shareholder_type: 'company', shareholder_company_id: 'cH', percentage: 50, tax_band: 'additional' },
        { id: 's2', name: 'Brian', percentage: 50, tax_band: 'additional' },
      ],
      months: 12,
    })
    const corp = r.shareholders.find(s => s.id === 's1')
    const person = r.shareholders.find(s => s.id === 's2')
    expect(corp.type).toBe('company')
    expect(corp.shareholderCompanyId).toBe('cH')
    expect(corp.taxBand).toBeNull()
    expect(corp.dividendTax).toBeNull()
    expect(corp.net).toBe(corp.share)
    expect(person.type).toBe('individual')
    expect(person.dividendTax).toBeGreaterThan(0)
  })
})

describe('viewerEffectiveShares', () => {
  const user = { id: 'u1', email: 'justin@example.com' }
  const companies = [
    { id: 'cOp', name: 'WXH Property Group Ltd', abbr: 'WXH' },
    { id: 'cH', name: 'Biggie Group Ltd' },
  ]

  it('counts a direct holding with its band', () => {
    const r = viewerEffectiveShares({
      shareholders: [{ company_id: 'cOp', name: 'Justin', user_id: 'u1', percentage: 40, tax_band: 'higher' }],
      companies, user,
    })
    expect(r.pct.cOp).toBe(40)
    expect(r.bands.cOp).toBe('higher')
    expect(r.via.cOp).toBeUndefined()
  })

  it('looks through a linked holding company, taking the band from the row where the viewer holds personally', () => {
    const r = viewerEffectiveShares({
      shareholders: [
        { company_id: 'cOp', name: 'Biggie Group Ltd', shareholder_type: 'company', shareholder_company_id: 'cH', percentage: 50 },
        { company_id: 'cH', name: 'Justin', user_id: 'u1', percentage: 100, tax_band: 'additional' },
      ],
      companies, user,
    })
    expect(r.pct.cOp).toBe(50) // 50% × 100%
    expect(r.bands.cOp).toBe('additional')
    expect(r.via.cOp).toEqual(['Biggie Group Ltd'])
    expect(r.pct.cH).toBe(100)
  })

  it('sums direct and indirect stakes and chains through multiple levels', () => {
    const threeLevels = [...companies, { id: 'cTop', name: 'TopCo Ltd' }]
    const r = viewerEffectiveShares({
      shareholders: [
        { company_id: 'cOp', name: 'Justin', email: 'JUSTIN@example.com', percentage: 10 },
        { company_id: 'cOp', name: 'Biggie Group Ltd', shareholder_type: 'company', shareholder_company_id: 'cH', percentage: 50 },
        { company_id: 'cH', name: 'TopCo Ltd', shareholder_type: 'company', shareholder_company_id: 'cTop', percentage: 80 },
        { company_id: 'cTop', name: 'Justin', user_id: 'u1', percentage: 50, tax_band: 'basic' },
      ],
      companies: threeLevels, user,
    })
    // 10 direct + 50% × (80% × 50%) = 10 + 20 = 30
    expect(r.pct.cOp).toBe(30)
    expect(r.bands.cOp).toBe('basic')
  })

  it('ignores unlinked corporate rows and survives ownership cycles', () => {
    const r = viewerEffectiveShares({
      shareholders: [
        { company_id: 'cOp', name: 'Unlinked Holdings', shareholder_type: 'company', percentage: 50 },
        { company_id: 'cOp', name: 'Biggie Group Ltd', shareholder_type: 'company', shareholder_company_id: 'cH', percentage: 25 },
        // cycle: the holding company is "owned" back by the operating company
        { company_id: 'cH', name: 'WXH Property Group Ltd', shareholder_type: 'company', shareholder_company_id: 'cOp', percentage: 60 },
        { company_id: 'cH', name: 'Justin', user_id: 'u1', percentage: 40 },
      ],
      companies, user,
    })
    expect(r.pct.cOp).toBe(10) // 25% × 40%, cycle contributes nothing
    expect(r.pct.cH).toBe(40)
  })

  it('returns nothing for a signed-out viewer or one who holds nothing', () => {
    const rows = [{ company_id: 'cOp', name: 'Someone Else', percentage: 100 }]
    expect(viewerEffectiveShares({ shareholders: rows, companies, user: null }).pct).toEqual({})
    expect(viewerEffectiveShares({ shareholders: rows, companies, user }).pct).toEqual({})
  })
})

describe('holding companies', () => {
  it('isHoldingCompany reads company_type, defaulting to operating', () => {
    expect(isHoldingCompany({ company_type: 'holding' })).toBe(true)
    expect(isHoldingCompany({ company_type: 'operating' })).toBe(false)
    expect(isHoldingCompany({})).toBe(false)
    expect(isHoldingCompany(null)).toBe(false)
  })

  it('countAssociatedCompanies excludes passive holdcos, counts active ones, floors at 1', () => {
    const op1 = { id: 'a' }, op2 = { id: 'b', company_type: 'operating' }
    const passive = { id: 'h1', company_type: 'holding' }             // ct_passive defaults true
    const passiveExplicit = { id: 'h2', company_type: 'holding', ct_passive: true }
    const active = { id: 'h3', company_type: 'holding', ct_passive: false }
    expect(countAssociatedCompanies([op1, op2])).toBe(2)
    expect(countAssociatedCompanies([op1, op2, passive, passiveExplicit])).toBe(2)
    expect(countAssociatedCompanies([op1, op2, active])).toBe(3)
    expect(countAssociatedCompanies([passive])).toBe(1)
    expect(countAssociatedCompanies([])).toBe(1)
  })

  it('companyEffectiveStakes finds direct and chained stakes, cycle-safe', () => {
    const shareholders = [
      // H owns 50% of Op directly...
      { company_id: 'cOp', name: 'H Ltd', shareholder_type: 'company', shareholder_company_id: 'cH', percentage: 50 },
      // ...and 80% of Mid, which owns 25% of Op2
      { company_id: 'cMid', name: 'H Ltd', shareholder_type: 'company', shareholder_company_id: 'cH', percentage: 80 },
      { company_id: 'cOp2', name: 'Mid Ltd', shareholder_type: 'company', shareholder_company_id: 'cMid', percentage: 25 },
      // noise: an individual, an unlinked corporate, and a cycle back to H
      { company_id: 'cOp', name: 'Justin', percentage: 50 },
      { company_id: 'cOp2', name: 'Unlinked Holdings', shareholder_type: 'company', percentage: 30 },
      { company_id: 'cH', name: 'Op Ltd', shareholder_type: 'company', shareholder_company_id: 'cOp', percentage: 10 },
    ]
    const stakes = companyEffectiveStakes(shareholders, 'cH')
    expect(stakes.cOp).toBe(50)
    expect(stakes.cMid).toBe(80)
    expect(stakes.cOp2).toBe(20) // 25% × 80%
    expect(stakes.cH).toBeUndefined() // never itself
    expect(companyEffectiveStakes(shareholders, null)).toEqual({})
  })
})

describe('rent collected counts late and partial receipts', () => {
  it('buildCompanyPnl includes late/partial rows that carry an amount', () => {
    const pnl = buildCompanyPnl({
      properties: [{ id: 'p', rent_pcm: 1000, status: 'rented' }],
      payments: [
        { property_id: 'p', status: 'paid', amount: 1000 },
        { property_id: 'p', status: 'late', amount: 1000 },
        { property_id: 'p', status: 'partial', amount: 400 },
        { property_id: 'p', status: 'overdue', amount: 1000 },
        { property_id: 'p', status: 'late', amount: null },
      ],
      months: 3,
    })
    expect(pnl.income.rentCollected).toBe(2400)
  })
  it('a portfolio with only late receipts uses them, not the expected-rent fallback', () => {
    const pnl = buildCompanyPnl({
      properties: [{ id: 'p', rent_pcm: 1000, status: 'rented' }],
      payments: [{ property_id: 'p', status: 'late', amount: 900 }],
      months: 3,
    })
    expect(pnl.income.rentCollected).toBe(900)
  })
  it('buildPortfolioPnl includes late/partial rows too', () => {
    const r = buildPortfolioPnl({
      properties: [{ id: 'p', rent_pcm: 1000, status: 'rented', company_id: null }],
      payments: [
        { property_id: 'p', status: 'paid', amount: 1000 },
        { property_id: 'p', status: 'partial', amount: 400 },
      ],
      months: 2,
    })
    expect(r.grand.income).toBe(1400)
  })
})

// Rent Tracker parity: a period's rent comes from its receipt allocations
// when it has any (rentEngine.js evaluatePeriod), else the legacy row amount.
describe('income from receipt allocations (Rent Tracker parity)', () => {
  // September: row still 'pending' but a £1,000 manual receipt is allocated.
  // October: row 'paid' £1,000 from a statement import whose receipt bounced.
  const sep = { id: 'sep', property_id: 'p1', year: 2026, month: 9, status: 'pending', amount: null, period_start: '2026-09-01', period_end: '2026-09-30' }
  const oct = { id: 'oct', property_id: 'p1', year: 2026, month: 10, status: 'paid', amount: 1_000, period_start: '2026-10-01', period_end: '2026-10-31' }
  const receipts = [
    { id: 'r1', received_date: '2026-09-03', amount: 1_000, kind: 'receipt', source: 'manual', rent_allocations: [{ rent_payment_id: 'sep', target: 'current_rent', amount: 1_000 }] },
    { id: 'r2', received_date: '2026-10-02', amount: 1_000, kind: 'receipt', source: 'statement', rent_allocations: [{ rent_payment_id: 'oct', target: 'current_rent', amount: 1_000 }] },
    { id: 'r3', received_date: '2026-10-20', amount: -1_000, kind: 'bounce', source: 'manual', rent_allocations: [{ rent_payment_id: 'oct', target: 'current_rent', amount: -1_000 }] },
  ]
  const property = { id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1_000 }

  it('matches the rent engine row by row', () => {
    const idx = indexRentAllocations(receipts)
    for (const row of [sep, oct]) {
      const engine = evaluatePeriod(row, { property, receipts, today: '2026-11-15' })
      expect(rentReceivedOnRow(row, idx)).toBe(engine.received)
    }
    expect(rentReceivedOnRow(sep, idx)).toBe(1_000)
    expect(rentReceivedOnRow(oct, idx)).toBe(0)
  })

  it('buildCompanyPnl counts September and not the bounced October', () => {
    const r = buildCompanyPnl({ properties: [property], payments: [sep, oct], receipts, months: 2 })
    expect(r.income.rentCollected).toBe(1_000)
    expect(r.income.usedFallback).toBe(false)
  })

  it('buildPortfolioPnl puts the £1,000 in September and nothing in October', () => {
    const r = buildPortfolioPnl({
      companies: [{ id: 'cA', name: 'Alpha Ltd' }], properties: [property],
      payments: [sep, oct], receipts, months: 2,
      monthKeys: [{ m: 8, y: 2026 }, { m: 9, y: 2026 }],
    })
    expect(r.companies[0].rows[0].income).toBe(1_000)
    expect(r.companies[0].rows[0].monthly).toEqual([1_000, 0])
  })

  it('keeps the row-only behaviour when no receipts are passed', () => {
    const r = buildCompanyPnl({ properties: [property], payments: [sep, oct], months: 2 })
    expect(r.income.rentCollected).toBe(1_000) // October's row amount, as before
  })

  it('falls back to the row amount for a period with no allocations', () => {
    const legacy = { id: 'aug', property_id: 'p1', year: 2026, month: 8, status: 'paid', amount: 950 }
    const r = buildCompanyPnl({ properties: [property], payments: [legacy, sep, oct], receipts, months: 3 })
    expect(r.income.rentCollected).toBe(1_950)
  })
})

describe('mortgage payments (incl. capital) and the corporation tax estimate', () => {
  it('buildCompanyPnl adds the mortgage category back before CT and says so', () => {
    const r = buildCompanyPnl({
      properties: [{ id: 'p1', status: 'rented' }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 30_000 }],
      expenses: [
        { property_id: 'p1', category: 'mortgage', amount: 10_000 },
        { property_id: 'p1', category: 'mortgage_interest', amount: 2_000 },
        { property_id: 'p1', category: 'repairs', amount: 1_000 },
      ],
      months: 12,
    })
    // Cash profit still deducts the whole payment...
    expect(r.operatingProfit).toBe(17_000)
    // ...but CT is on 30,000 − 2,000 interest − 1,000 repairs = 27,000 at 19%.
    expect(r.ctBase).toBe(27_000)
    expect(r.mortgageExcludedFromCt).toBe(10_000)
    expect(r.corporationTax.tax).toBe(5_130)
    expect(r.profitAfterTax).toBe(17_000 - 5_130)
    expect(r.ctNote).toBe(CT_MORTGAGE_NOTE)
  })

  it('has no note when there is no mortgage payment', () => {
    const r = buildCompanyPnl({ properties: [{ id: 'p1' }], payments: [{ property_id: 'p1', status: 'paid', amount: 1_000 }], months: 12 })
    expect(r.ctNote).toBeNull()
    expect(r.mortgageExcludedFromCt).toBe(0)
  })

  it('buildPortfolioPnl leaves the mortgage category out of the CT base', () => {
    const args = {
      companies: [{ id: 'cA', name: 'Alpha Ltd' }],
      properties: [{ id: 'p1', name: 'Flat 1', company_id: 'cA' }],
      payments: [{ property_id: 'p1', status: 'paid', amount: 20_000 }],
      expenses: [{ property_id: 'p1', category: 'mortgage', amount: 8_000 }],
      months: 12,
    }
    const b = buildPortfolioPnl(args).companies[0]
    expect(b.totals.pretax).toBe(12_000)
    expect(b.totals.ct).toBe(3_800) // 19% of 20,000
    expect(b.mortgageExcludedFromCt).toBe(8_000)
    expect(b.rows[0].ctShare).toBe(3_800)
    expect(b.rows[0].posttax).toBe(8_200)
    // Mortgage switched off by assumption: nothing to add back.
    const off = buildPortfolioPnl({ ...args, include: { mortgage: false } }).companies[0]
    expect(off.totals.ct).toBe(3_800)
    expect(off.mortgageExcludedFromCt).toBe(0)
  })
})

describe('dividend rates follow the period being reported', () => {
  const args = {
    properties: [{ id: 'p1' }],
    payments: [{ property_id: 'p1', status: 'paid', amount: 10_000 }],
    shareholders: [{ id: 's1', name: 'A', percentage: 100, tax_band: 'basic' }],
    months: 12,
  }
  it('2025-26 period keeps 8.75%, 2026-27 period uses 10.75%', () => {
    // 10,000 − 19% CT = 8,100 after tax.
    expect(buildCompanyPnl({ ...args, periodEnd: '2026-04-05' }).shareholders[0].dividendTax).toBeCloseTo(708.75, 2)
    expect(buildCompanyPnl({ ...args, periodEnd: '2027-04-05' }).shareholders[0].dividendTax).toBeCloseTo(870.75, 2)
  })
})
