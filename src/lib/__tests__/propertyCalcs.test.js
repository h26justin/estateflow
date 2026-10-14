import { describe, it, expect } from 'vitest'
import { isSafeUrl, calcMonthlyMortgage, calcGrossYield, calcMonthlyProfit, propTypeMeta } from '../propertyCalcs'
import { rentStatusPair, enginePair, STL_PAIR } from '../rentColors'
import { statusColors } from '../styles'
import { engineSummary } from '../rentEngineSummary'

describe('isSafeUrl', () => {
  it('allows http(s) and relative URLs, blocks script-ish schemes', () => {
    expect(isSafeUrl('https://example.com/x')).toBe(true)
    expect(isSafeUrl('http://example.com')).toBe(true)
    expect(isSafeUrl('/settings')).toBe(true)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html,hi')).toBe(false)
  })
})

describe('calcMonthlyMortgage', () => {
  it('prefers an entered monthly payment', () => {
    expect(calcMonthlyMortgage({ mortgage_monthly_payment: '612.5', mortgage_amount: 100000, mortgage_rate: 0.05 })).toBe(612.5)
  })
  it('returns 0 without rate or amount', () => {
    expect(calcMonthlyMortgage({ mortgage_amount: 100000 })).toBe(0)
    expect(calcMonthlyMortgage({ mortgage_rate: 0.05 })).toBe(0)
  })
  it('interest-only is amount * rate / 12', () => {
    expect(calcMonthlyMortgage({ mortgage_amount: 120000, mortgage_rate: 0.05, mortgage_type: 'interest_only' })).toBeCloseTo(500, 6)
  })
  it('repayment uses the annuity formula with a 25y default term', () => {
    // 100k at 6% over 25 years: 644.30 / month
    expect(calcMonthlyMortgage({ mortgage_amount: 100000, mortgage_rate: 0.06 })).toBeCloseTo(644.30, 2)
  })
})

describe('calcGrossYield / calcMonthlyProfit', () => {
  const p = { purchase_price: 180000, refurb_cost: 20000, rent_pcm: 1000, insurance: 240 }
  it('cost basis = purchase + refurb', () => {
    expect(calcGrossYield(p)).toBeCloseTo(6, 6)
  })
  it('0 when there is no base or rent', () => {
    expect(calcGrossYield({ rent_pcm: 1000 })).toBe(0)
    expect(calcGrossYield({ purchase_price: 1 })).toBe(0)
  })
  it('profit = rent - mortgage - insurance/12', () => {
    expect(calcMonthlyProfit({ ...p, mortgage_monthly_payment: 400 })).toBeCloseTo(580, 6)
  })
})

describe('propTypeMeta', () => {
  it('reads beds and icon from free text', () => {
    expect(propTypeMeta('2-Bed Flat')).toEqual({ icon: 'building', beds: 2, studio: false })
    expect(propTypeMeta('HMO Room')).toEqual({ icon: 'bed', beds: null, studio: false })
    expect(propTypeMeta('Studio')).toEqual({ icon: 'building', beds: null, studio: true })
    expect(propTypeMeta('Retail unit')).toEqual({ icon: 'landmark', beds: null, studio: false })
    expect(propTypeMeta(null)).toEqual({ icon: 'home', beds: null, studio: false })
  })
})

describe('rent colour pairs', () => {
  it('maps statuses to the shared traffic-light pairs', () => {
    expect(rentStatusPair('paid', false)).toEqual(statusColors('ok', false))
    expect(rentStatusPair('overdue', true)).toEqual(statusColors('bad', true))
    expect(rentStatusPair('pending', true)).toBe(STL_PAIR.dark)
    expect(rentStatusPair('whatever', false)).toEqual(statusColors('void', false))
  })
  it('engine states', () => {
    expect(enginePair(null, false)).toBeNull()
    expect(enginePair({ state: 'stl' }, false)).toBe(STL_PAIR.light)
    expect(enginePair({ state: 'part_paid' }, false)).toEqual(statusColors('warn', false))
    expect(enginePair({ state: 'legacy', evals: [{ legacyStatus: 'paid' }] }, false)).toEqual(statusColors('ok', false))
  })
})

describe('engineSummary', () => {
  it('skips short-term lets and returns zeroed counts for nothing to count', () => {
    expect(engineSummary([{ status: 'short_term_let' }], null)).toEqual({ paid: 0, due: 0, missed: 0, nc: 0, backfill: 0, legacy: 0, received: 0 })
    expect(engineSummary([], 2026)).toEqual({ paid: 0, due: 0, missed: 0, nc: 0, backfill: 0, legacy: 0, received: 0 })
  })
  it('counts pre-2026 legacy months by their stored status and amount', () => {
    const m = (id, mo, status, amount) => ({ id, year: 2025, month: mo, month_label: `${mo}/2025`, period_start: `2025-${String(mo).padStart(2, '0')}-01`, period_end: `2025-${String(mo).padStart(2, '0')}-28`, status, amount })
    const p = { id: 'p1', status: 'rented', rent_pcm: 500, rent_due_day: '1st', tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
      rent_payments: [m('a', 3, 'paid', 500), m('b', 4, 'overdue', null), m('c', 5, 'late', 120.5)] }
    const s = engineSummary([p], 2025)
    expect(s.legacy).toBe(3)
    expect(s.paid).toBe(1)
    expect(s.missed).toBe(1)
    expect(s.due).toBe(1)
    expect(s.received).toBe(620.5)
  })
})
