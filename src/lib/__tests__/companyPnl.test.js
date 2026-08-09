import { describe, it, expect } from 'vitest'
import {
  ukCorporationTax, dividendTax, monthsInRange, buildCompanyPnl,
  findViewerShareholder, aggregateShareholdersAcrossCompanies,
} from '../companyPnl'

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
  it('applies band rates', () => {
    expect(dividendTax(10_000, 'basic')).toBe(875)
    expect(dividendTax(10_000, 'higher')).toBe(3_375)
    expect(dividendTax(10_000, 'additional')).toBe(3_935)
  })
  it('returns null for unknown/absent band and 0 for negative amounts', () => {
    expect(dividendTax(10_000, null)).toBeNull()
    expect(dividendTax(10_000, 'weird')).toBeNull()
    expect(dividendTax(-500, 'basic')).toBe(0)
  })
})

describe('monthsInRange', () => {
  it('counts inclusive calendar months', () => {
    expect(monthsInRange('2026-04-06', '2027-04-05')).toBe(13) // tax year touches 13 calendar months
    expect(monthsInRange('2026-01-01', '2026-12-31')).toBe(12)
    expect(monthsInRange('2026-06-01', '2026-06-30')).toBe(1)
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

  it('computes the full pipeline with calculated management fees', () => {
    const r = buildCompanyPnl({
      payments: [
        { status: 'paid', amount: 60_000 },
        { status: 'overdue', amount: 5_000 }, // ignored
      ],
      expenses: [
        { category: 'repairs', amount: 4_000 },
        { category: 'insurance', amount: 1_000 },
        { category: 'agent_fees', amount: 3_000 }, // excluded — calculated fee replaces it
      ],
      feeConfigs: [
        { fee_percent: 10, vat_treatment: 'inc_vat', agent: { name: 'Acme Lettings' } },
        { fee_percent: 5, vat_treatment: 'ex_vat', agent: { name: 'Other Agent' } },
      ],
      shareholders, months: 12,
    })

    expect(r.income.rentCollected).toBe(60_000)
    expect(r.income.usedFallback).toBe(false)
    // 10% inc VAT = 6,000; 5% ex VAT = 3,000 × 1.2 = 3,600
    expect(r.totalManagementFees).toBe(9_600)
    expect(r.excludedAgentFeeExpenses).toBe(3_000)
    expect(r.totalOperatingExpenses).toBe(5_000)
    expect(r.totalExpenses).toBe(14_600)
    expect(r.operatingProfit).toBe(45_400)
    // Below £50k → 19%
    expect(r.corporationTax.tax).toBeCloseTo(8_626, 2)
    expect(r.profitAfterTax).toBeCloseTo(36_774, 2)

    const justin = r.shareholders.find(s => s.name === 'Justin')
    expect(justin.share).toBeCloseTo(27_580.5, 2)
    expect(justin.dividendTax).toBeCloseTo(9_308.42, 2)
    expect(justin.net).toBeCloseTo(18_272.08, 2)
    expect(justin.netMonthly).toBeCloseTo(1_522.67, 2)

    const partner = r.shareholders.find(s => s.name === 'Partner')
    expect(partner.dividendTax).toBeNull()
    expect(partner.net).toBeCloseTo(9_193.5, 2)

    expect(r.ownershipTotal).toBe(100)
  })

  it('keeps logged agent_fees expenses when no fee configs exist', () => {
    const r = buildCompanyPnl({
      payments: [{ status: 'paid', amount: 10_000 }],
      expenses: [{ category: 'agent_fees', amount: 1_000 }],
      feeConfigs: [], shareholders: [], months: 12,
    })
    expect(r.excludedAgentFeeExpenses).toBe(0)
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
})
