import { describe, it, expect } from 'vitest'
import { calcDealScore, calcPropertyHealthScore, calcStampDuty } from '../api/calculators'
import { computeDealMetrics } from '../dealMetrics'

// A deal as the editor holds it: string inputs, the editor's default fees.
function deal(overrides = {}) {
  return {
    deal_type: 'btl',
    purchase_type: 'mortgage',
    purchase_price: '200000',
    deposit_percent: '25',
    mortgage_rate: '5.5',
    mortgage_type: 'interest_only',
    monthly_rent: '1100',
    void_percent: '5',
    agent_fee_percent: '10',
    maintenance_percent: '5',
    insurance_monthly: '30',
    legal_fees: '1500',
    survey_cost: '500',
    is_additional_property: true,
    ...overrides,
  }
}

describe('calcDealScore', () => {
  it('uses the same cash in and cash-on-cash as the deal editor', () => {
    const d = deal()
    const m = computeDealMetrics(d)
    const s = calcDealScore(d)
    expect(s.metrics.cashIn).toBe(m.cashIn)
    expect(s.metrics.annualProfit).toBe(m.annualProfit)
    expect(s.metrics.cashOnCash).toBeCloseTo(m.cashOnCash, 9)
    expect(s.metrics.grossYield).toBeCloseTo(m.grossYield, 9)
    // Calculated SDLT is in cash in (the old score ignored it unless overridden)
    expect(s.metrics.cashIn).toBe(50_000 + calcStampDuty(200_000, true) + 2_000)
    expect(s.breakdown.cash_on_cash.value).toBe(m.cashOnCash.toFixed(1) + '%')
  })

  it('does not string-concatenate the price when the SDLT override is cleared', () => {
    const s = calcDealScore(deal({ stamp_duty_override: '' }))
    expect(typeof s.metrics.cashIn).toBe('number')
    expect(s.metrics.cashIn).toBe(computeDealMetrics(deal()).cashIn)
  })

  it('defaults a blank deposit to 25% like the editor', () => {
    const s = calcDealScore(deal({ deposit_percent: '' }))
    expect(s.metrics.loanAmount).toBe(150_000)
    expect(s.metrics.ltv).toBe(75)
  })

  it('keeps the scoring bands', () => {
    const s = calcDealScore(deal({ purchase_type: 'cash' }))
    expect(s.breakdown.dscr.points).toBe(25)
    expect(s.breakdown.stress.points).toBe(20)
    expect(s.breakdown.ltv.points).toBe(15)
    expect(s.breakdown.yield.points).toBe(17) // 6.6% gross yield
  })

  it('reports insufficient data without a price', () => {
    expect(calcDealScore({}).rating).toBe('insufficient-data')
  })
})

describe('calcPropertyHealthScore', () => {
  it('ignores trashed compliance items', () => {
    const expired = { title: 'Gas Safety', expiry_date: '2000-01-01' }
    expect(calcPropertyHealthScore({}, [expired]).score).toBe(80)
    expect(calcPropertyHealthScore({}, [{ ...expired, deleted_at: '2026-01-01T00:00:00Z' }]).score).toBe(100)
  })
})
