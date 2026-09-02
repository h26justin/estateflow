import { describe, it, expect } from 'vitest'
import { computeDealMetrics, grossMonthlyRent, stampDuty, num } from '../dealMetrics'
import { calcStampDuty } from '../api'

function deal(overrides = {}) {
  return {
    deal_type: 'btl',
    purchase_type: 'mortgage',
    purchase_price: 200_000,
    deposit_percent: 25,
    mortgage_rate: 5,
    mortgage_type: 'interest_only',
    monthly_rent: 1_000,
    void_percent: 0,
    agent_fee_percent: 0,
    maintenance_percent: 0,
    is_additional_property: true,
    ...overrides,
  }
}

describe('num', () => {
  it('normalises strings, blanks and nulls', () => {
    expect(num('1500')).toBe(1500)
    expect(num('')).toBe(0)
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num('abc')).toBe(0)
    expect(num(12.5)).toBe(12.5)
  })
})

describe('grossMonthlyRent', () => {
  it('uses monthly_rent for BTL / BRRR / flip', () => {
    expect(grossMonthlyRent({ deal_type: 'btl', monthly_rent: 950 })).toBe(950)
    expect(grossMonthlyRent({ deal_type: 'brrr', monthly_rent: '1200' })).toBe(1200)
  })
  it('multiplies rooms by rent per room for HMO by default', () => {
    expect(grossMonthlyRent({ deal_type: 'hmo', hmo_rooms: 5, hmo_rent_per_room: 600 })).toBe(3000)
  })
  it('sums per-room rents for HMO in individual mode', () => {
    expect(grossMonthlyRent({ deal_type: 'hmo', hmo_rent_mode: 'individual', hmo_room_rents: [500, '650', 700], hmo_rooms: 3, hmo_rent_per_room: 999 })).toBe(1850)
  })
  it('falls back to rooms × rate when individual mode has no rents yet', () => {
    expect(grossMonthlyRent({ deal_type: 'hmo', hmo_rent_mode: 'individual', hmo_room_rents: [], hmo_rooms: 4, hmo_rent_per_room: 500 })).toBe(2000)
  })
  it('models serviced accommodation from nightly rate and occupancy', () => {
    expect(grossMonthlyRent({ deal_type: 'sa', sa_nightly_rate: 100, sa_occupancy_percent: 70 })).toBeCloseTo(2128, 0)
  })
})

describe('stampDuty', () => {
  it('prefers the user override when set', () => {
    expect(stampDuty({ purchase_price: 300_000, stamp_duty_override: 1234 })).toBe(1234)
    expect(stampDuty({ purchase_price: 300_000, stamp_duty_override: '0' })).toBe(0)
  })
  it('falls back to the SDLT calculator, treating a missing flag as an additional property', () => {
    expect(stampDuty({ purchase_price: 300_000 })).toBe(calcStampDuty(300_000, undefined, undefined))
    expect(stampDuty({ purchase_price: 300_000, is_additional_property: false })).toBe(calcStampDuty(300_000, false, undefined))
  })
})

describe('computeDealMetrics', () => {
  it('splits a mortgage purchase into loan, deposit and cash in', () => {
    const m = computeDealMetrics(deal({ legal_fees: 1_500, refurb_cost: 10_000 }))
    expect(m.loanAmount).toBe(150_000)
    expect(m.deposit).toBe(50_000)
    expect(m.sd).toBe(calcStampDuty(200_000, true, undefined))
    expect(m.totalAcquisition).toBe(200_000 + m.sd + 11_500)
    expect(m.cashIn).toBe(m.totalAcquisition - 150_000)
  })

  it('treats a cash purchase as no loan, no repayment, no arrangement fee', () => {
    const m = computeDealMetrics(deal({ purchase_type: 'cash', mortgage_fee_percent: 2 }))
    expect(m.loanAmount).toBe(0)
    expect(m.mortgageFee).toBe(0)
    expect(m.monthlyRepayment).toBe(0)
    expect(m.cashIn).toBe(m.totalAcquisition)
  })

  it('adds the arrangement fee to acquisition costs on mortgage deals', () => {
    const m = computeDealMetrics(deal({ mortgage_fee_percent: 2 }))
    expect(m.mortgageFee).toBe(3_000) // 2% of 150k loan
    expect(m.totalAcquisition).toBe(200_000 + m.sd + 3_000)
  })

  it('defaults the mortgage to interest-only and honours a repayment choice', () => {
    const io = computeDealMetrics(deal())
    expect(io.isInterestOnly).toBe(true)
    expect(io.monthlyRepayment).toBe(Math.round(150_000 * 0.05 / 12))
    const rep = computeDealMetrics(deal({ mortgage_type: 'repayment', mortgage_term: 25 }))
    expect(rep.isInterestOnly).toBe(false)
    expect(rep.monthlyRepayment).toBeGreaterThan(io.monthlyRepayment)
  })

  it('applies void, agent fee (with VAT) and maintenance to running costs', () => {
    const m = computeDealMetrics(deal({ void_percent: 10, agent_fee_percent: 10, maintenance_percent: 5 }))
    expect(m.effectiveRent).toBe(900)
    expect(m.agentFee).toBeCloseTo(900 * 0.10 * 1.2, 6)
    expect(m.maintenanceFee).toBeCloseTo(45, 6)
    const inc = computeDealMetrics(deal({ void_percent: 10, agent_fee_percent: 10, agent_fee_vat: 'inc_vat' }))
    expect(inc.agentFee).toBeCloseTo(90, 6)
  })

  it('adds HMO utilities, council tax and licence to monthly costs', () => {
    const m = computeDealMetrics(deal({ deal_type: 'hmo', hmo_rooms: 4, hmo_rent_per_room: 500, hmo_utilities_monthly: 200, hmo_council_tax_monthly: 150, hmo_licence_annual: 1_200 }))
    expect(m.grossMonthlyRent).toBe(2_000)
    expect(m.hmoExtras).toBe(450)
    expect(m.totalMonthlyCosts).toBe(m.monthlyRepayment + 450)
  })

  it('derives yields and returns consistently', () => {
    const m = computeDealMetrics(deal())
    expect(m.grossYield).toBeCloseTo(6, 6) // 12k / 200k
    expect(m.monthlyProfit).toBe(1_000 - m.monthlyRepayment)
    expect(m.annualProfit).toBe(m.monthlyProfit * 12)
    expect(m.netYield).toBeCloseTo(m.annualProfit / 200_000 * 100, 6)
    expect(m.cashOnCash).toBeCloseTo(m.annualProfit / m.cashIn * 100, 6)
    expect(m.roce).toBeCloseTo(m.annualProfit / m.totalAcquisition * 100, 6)
    expect(m.payback).toBeCloseTo(m.cashIn / m.annualProfit, 6)
  })

  it('reports zero returns rather than NaN/Infinity on an empty deal', () => {
    const m = computeDealMetrics({})
    for (const k of ['grossYield', 'netYield', 'cashOnCash', 'roce', 'payback', 'monthlyRepayment', 'cashIn']) {
      expect(Number.isFinite(m[k])).toBe(true)
      expect(m[k]).toBe(0)
    }
  })

  it('models a BRRR refinance', () => {
    const m = computeDealMetrics(deal({ deal_type: 'brrr', refurb_cost: 20_000, brrr_end_value: 300_000, brrr_refinance_ltv: 75, brrr_new_rate: 5 }))
    expect(m.brrrNewLoan).toBe(225_000)
    expect(m.brrrCapitalReleased).toBe(75_000)
    expect(m.brrrMoneyLeft).toBe(m.cashIn - 75_000)
    expect(m.brrrNewRepayment).toBe(Math.round(225_000 * 0.05 / 12))
  })

  it('accepts string values straight from form inputs', () => {
    const a = computeDealMetrics(deal())
    const b = computeDealMetrics(deal({ purchase_price: '200000', deposit_percent: '25', mortgage_rate: '5', monthly_rent: '1000' }))
    expect(b).toEqual(a)
  })
})
