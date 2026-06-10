import { describe, it, expect } from 'vitest'
import { dealCashflow, propertyRefurbCashflow, STATUS_GROUP } from '../dealCashflow'

// Helper to build a deal with sensible defaults; spread overrides last.
function deal(overrides = {}) {
  return {
    status: 'analysing',
    purchase_type: 'mortgage',
    purchase_price: 200_000,
    deposit_percent: 25,
    refurb_cost: 0,
    stamp_duty: 0,
    legal_fees: 0,
    survey_cost: 0,
    auction_fees: 0,
    broker_fee: 0,
    other_costs: 0,
    mortgage_fee_percent: 0,
    ...overrides,
  }
}

describe('STATUS_GROUP — status to cashflow bucket', () => {
  it('maps the three pipeline states', () => {
    expect(STATUS_GROUP.analysing).toBe('pipeline')
    expect(STATUS_GROUP.offer_made).toBe('pipeline')
    expect(STATUS_GROUP.under_offer).toBe('pipeline')
  })

  it('exchanged is committed; completed is refurb; dead is excluded', () => {
    expect(STATUS_GROUP.exchanged).toBe('committed')
    expect(STATUS_GROUP.completed).toBe('refurb')
    expect(STATUS_GROUP.dead).toBeNull()
  })
})

describe('dealCashflow — cash purchase', () => {
  it('headline equals cash out (no leverage)', () => {
    const r = dealCashflow(deal({
      purchase_type: 'cash',
      purchase_price: 100_000,
      stamp_duty: 5000,
      legal_fees: 1500,
      refurb_cost: 20_000,
    }))
    expect(r.headline).toBe(126_500)
    expect(r.cashOut).toBe(126_500)
    expect(r.group).toBe('pipeline')
  })
})

describe('dealCashflow — mortgage purchase', () => {
  it('cash out = deposit + costs + refurb (lender funds the rest)', () => {
    const r = dealCashflow(deal({
      purchase_type: 'mortgage',
      purchase_price: 200_000,
      deposit_percent: 25,
      stamp_duty: 7500,
      legal_fees: 1500,
      refurb_cost: 15_000,
    }))
    // Deposit = 50,000; costs = 9,000; refurb = 15,000
    expect(r.cashOut).toBe(50_000 + 9_000 + 15_000)
    expect(r.headline).toBe(200_000 + 9_000 + 15_000)
  })

  it('includes mortgage product fee in cash out', () => {
    const r = dealCashflow(deal({
      purchase_type: 'mortgage',
      purchase_price: 200_000,
      deposit_percent: 25,
      mortgage_fee_percent: 1, // 1% of the 75% LTV portion = 1500
    }))
    // Deposit 50k + mortgage fee 1500 = 51500
    expect(r.cashOut).toBe(51_500)
  })

  it('computes the fee on the defaulted 75% loan when deposit_percent is blank', () => {
    const r = dealCashflow(deal({
      purchase_type: 'mortgage',
      purchase_price: 200_000,
      deposit_percent: null, // unset — defaults to 25%
      mortgage_fee_percent: 1, // 1% of 150k loan = 1500, NOT 1% of 200k
    }))
    // Defaulted deposit 50k + fee on the 75% loan 1500 = 51500
    expect(r.cashOut).toBe(51_500)
  })
})

describe('dealCashflow — bridge purchase', () => {
  it('bridge funds refurb, only deposit + costs out of pocket', () => {
    const r = dealCashflow(deal({
      purchase_type: 'bridge',
      purchase_price: 100_000,
      deposit_percent: 30,
      stamp_duty: 3000,
      refurb_cost: 50_000,
    }))
    // Deposit 30k + stamp 3k; refurb funded by bridge
    expect(r.cashOut).toBe(33_000)
    expect(r.headline).toBe(100_000 + 3000 + 50_000)
  })
})

describe('dealCashflow — committed (exchanged) deals', () => {
  it('subtracts deposit already paid from cash out', () => {
    const r = dealCashflow(deal({
      status: 'exchanged',
      purchase_type: 'mortgage',
      purchase_price: 200_000,
      deposit_percent: 25,
      stamp_duty: 7500,
    }))
    // Pre-exchange cashOut = 50k deposit + 7.5k costs = 57.5k
    // After exchange, subtract 50k deposit already paid → 7.5k remaining
    expect(r.cashOut).toBe(7500)
    expect(r.group).toBe('committed')
  })

  it('cash deals subtract the standard 10% exchange deposit already paid', () => {
    const r = dealCashflow(deal({
      status: 'exchanged',
      purchase_type: 'cash',
      purchase_price: 100_000,
      stamp_duty: 3000,
    }))
    // Full cash out 103k minus 10% exchange deposit (10k) already paid
    expect(r.cashOut).toBe(93_000)
    expect(r.group).toBe('committed')
  })
})

describe('dealCashflow — completed (refurb pending)', () => {
  it('purchase already paid, only refurb remains', () => {
    const r = dealCashflow(deal({
      status: 'completed',
      purchase_price: 200_000,
      refurb_cost: 25_000,
    }))
    expect(r.cashOut).toBe(25_000)
    expect(r.group).toBe('refurb')
  })
})

describe('dealCashflow — dead deals', () => {
  it('returns zero and null group', () => {
    const r = dealCashflow(deal({ status: 'dead', purchase_price: 200_000 }))
    expect(r.cashOut).toBe(0)
    expect(r.headline).toBe(0)
    expect(r.group).toBeNull()
  })
})

describe('propertyRefurbCashflow', () => {
  it('returns 0 for sold properties', () => {
    expect(propertyRefurbCashflow({ status: 'sold', refurb_cost: 10_000 })).toEqual(
      expect.objectContaining({ unpaid: 0, source: 'excluded' })
    )
  })

  it('returns 0 for deleted properties', () => {
    expect(propertyRefurbCashflow({ status: 'rented', deleted_at: '2026-01-01' })).toEqual(
      expect.objectContaining({ unpaid: 0, source: 'excluded' })
    )
  })

  it('uses itemised refurb_costs rows when present (sums unpaid)', () => {
    const r = propertyRefurbCashflow({
      status: 'refurb',
      refurb_costs: [
        { cost: 1000, paid: true },
        { cost: 2500, paid: false },
        { cost: 500,  paid: false },
      ],
    })
    expect(r.unpaid).toBe(3000)
    expect(r.source).toBe('itemised')
  })

  it('honours refurb_cost_unpaid flag even when rented', () => {
    const r = propertyRefurbCashflow({
      status: 'rented',
      refurb_cost: 7500,
      refurb_cost_unpaid: true,
    })
    expect(r.unpaid).toBe(7500)
    expect(r.source).toBe('user-flag')
  })

  it('treats budget as unpaid for purchased / refurb statuses with no line items', () => {
    expect(propertyRefurbCashflow({ status: 'purchased', refurb_cost: 5000 }).unpaid).toBe(5000)
    expect(propertyRefurbCashflow({ status: 'refurb',    refurb_cost: 5000 }).unpaid).toBe(5000)
  })

  it('excludes rented/vacant with no line items and no flag', () => {
    expect(propertyRefurbCashflow({ status: 'rented', refurb_cost: 5000 }).unpaid).toBe(0)
    expect(propertyRefurbCashflow({ status: 'vacant', refurb_cost: 5000 }).unpaid).toBe(0)
  })
})
