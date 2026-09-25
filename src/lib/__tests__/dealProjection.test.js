import { describe, it, expect } from 'vitest'
import { computeDealMetrics, projectDeal, refinanceScenarios, growthAssumptions, startingValue, REFI_LTVS } from '../dealMetrics'

function deal(overrides = {}) {
  return {
    deal_type: 'btl', purchase_type: 'mortgage',
    purchase_price: 100_000, deposit_percent: 25, mortgage_rate: 6, mortgage_type: 'interest_only',
    monthly_rent: 1_000, void_percent: 0, agent_fee_percent: 0, maintenance_percent: 0, insurance_monthly: 0,
    legal_fees: 0, survey_cost: 0, refurb_cost: 0, is_additional_property: false, stamp_duty_override: 0,
    ...overrides,
  }
}

describe('growthAssumptions', () => {
  it('defaults to 5% rent and 3% capital growth, honours stored values including zero', () => {
    expect(growthAssumptions({})).toEqual({ rentGrowth: 5, capitalGrowth: 3 })
    expect(growthAssumptions({ rent_growth_percent: '', capital_growth_percent: null })).toEqual({ rentGrowth: 5, capitalGrowth: 3 })
    expect(growthAssumptions({ rent_growth_percent: 0, capital_growth_percent: '2.5' })).toEqual({ rentGrowth: 0, capitalGrowth: 2.5 })
  })
})

describe('startingValue', () => {
  it('uses the post-refurb estimate when set, else the purchase price', () => {
    expect(startingValue(deal())).toBe(100_000)
    expect(startingValue(deal({ brrr_end_value: 140_000 }))).toBe(140_000)
    expect(startingValue(deal({ brrr_end_value: 0 }))).toBe(100_000)
  })
})

describe('projectDeal', () => {
  it('grows rent by the rent assumption and value by the capital assumption', () => {
    const p = projectDeal(deal({ rent_growth_percent: 5, capital_growth_percent: 3 }))
    expect(p.rows).toHaveLength(10)
    expect(p.rows[0].grossMonthlyRent).toBe(1_000)                 // year 1 = as analysed
    expect(p.rows[1].grossMonthlyRent).toBeCloseTo(1_050, 6)
    expect(p.rows[9].grossMonthlyRent).toBeCloseTo(1_000 * 1.05 ** 9, 6)
    expect(p.rows[0].value).toBeCloseTo(103_000, 6)                 // one year of growth by end of year 1
    expect(p.rows[9].value).toBeCloseTo(100_000 * 1.03 ** 10, 6)
    expect(p.rows[9].equityGain).toBeCloseTo(100_000 * 1.03 ** 10 - 100_000, 6)
  })

  it('keeps the interest-only mortgage flat and accumulates profit', () => {
    const d = deal()
    const m = computeDealMetrics(d)
    const p = projectDeal(d, m)
    expect(m.monthlyRepayment).toBe(375) // 75k at 6% interest only
    expect(p.rows[0].annualProfit).toBeCloseTo((1_000 - 375) * 12, 6)
    expect(p.rows[0].cumulativeProfit).toBeCloseTo(p.rows[0].annualProfit, 6)
    expect(p.rows[1].cumulativeProfit).toBeCloseTo(p.rows[0].annualProfit + p.rows[1].annualProfit, 6)
    expect(p.rows[9].loanBalance).toBe(75_000)
    expect(p.rows[9].principalRepaid).toBe(0)
  })

  it('scales percentage costs with rent but holds fixed costs flat', () => {
    const p = projectDeal(deal({ agent_fee_percent: 10, agent_fee_vat: 'inc_vat', insurance_monthly: 50, rent_growth_percent: 10 }))
    const y1 = p.rows[0], y2 = p.rows[1]
    // year 2: rent 1100, agent 110, insurance still 50, mortgage still 375
    expect(y2.annualProfit).toBeCloseTo((1_100 - 110 - 50 - 375) * 12, 6)
    expect(y1.annualProfit).toBeCloseTo((1_000 - 100 - 50 - 375) * 12, 6)
  })

  it('amortises a repayment mortgage and credits principal repaid to total return', () => {
    const d = deal({ mortgage_type: 'repayment', mortgage_term: 25 })
    const p = projectDeal(d)
    expect(p.rows[0].loanBalance).toBeLessThan(75_000)
    expect(p.rows[9].loanBalance).toBeLessThan(p.rows[0].loanBalance)
    const last = p.rows[9]
    expect(last.totalReturn).toBeCloseTo(last.cumulativeProfit + last.equityGain + last.principalRepaid, 6)
    expect(last.principalRepaid).toBeCloseTo(75_000 - last.loanBalance, 6)
  })

  it('reports return on cash relative to cash in the deal', () => {
    const d = deal()
    const m = computeDealMetrics(d)
    const p = projectDeal(d, m)
    expect(m.cashIn).toBe(25_000)
    expect(p.rows[9].roiOnCash).toBeCloseTo(p.rows[9].totalReturn / 25_000 * 100, 6)
  })

  it('handles a cash purchase and an empty deal without NaN', () => {
    const p = projectDeal(deal({ purchase_type: 'cash' }))
    expect(p.rows[9].loanBalance).toBe(0)
    const e = projectDeal({})
    for (const r of e.rows) for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('refinanceScenarios', () => {
  it('returns null until a post-refurb value is entered', () => {
    expect(refinanceScenarios(deal())).toBeNull()
    expect(refinanceScenarios(deal({ brrr_end_value: '' }))).toBeNull()
  })

  it('models the four standard LTVs against the post-refurb value', () => {
    const d = deal({ brrr_end_value: 150_000, brrr_new_rate: 5, refurb_cost: 20_000 })
    const m = computeDealMetrics(d)
    const r = refinanceScenarios(d, m)
    expect(r.scenarios.map(s => s.ltv)).toEqual(REFI_LTVS)
    const s75 = r.scenarios.find(s => s.ltv === 75)
    expect(s75.newLoan).toBe(112_500)
    expect(s75.released).toBe(112_500 - 75_000)            // 37,500 back
    expect(m.cashIn).toBe(45_000)                           // 25k deposit + 20k refurb
    expect(s75.moneyLeft).toBe(45_000 - 37_500)
    expect(s75.allMoneyOut).toBe(false)
    expect(s75.newPayment).toBe(Math.round(112_500 * 0.05 / 12))
    expect(s75.monthlyProfit).toBeCloseTo(1_000 - s75.newPayment, 6)
    const s55 = r.scenarios.find(s => s.ltv === 55)
    expect(s55.released).toBe(82_500 - 75_000)
  })

  it('flags an all-money-out refinance and falls back to the purchase rate', () => {
    const d = deal({ brrr_end_value: 200_000, brrr_new_rate: 0, refurb_cost: 10_000 })
    const r = refinanceScenarios(d)
    expect(r.rate).toBe(6)                                   // brrr_new_rate unset -> purchase mortgage rate
    const s75 = r.scenarios.find(s => s.ltv === 75)
    expect(s75.released).toBe(150_000 - 75_000)             // 75k back vs 35k in
    expect(s75.allMoneyOut).toBe(true)
    expect(s75.cashOnCash).toBeNull()
  })
})
