import { describe, it, expect } from 'vitest'
import {
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  isPropertyEarningRent,
  isPropertyOccupied,
  isPropertyVacant,
  isPropertyActive,
  isPropertyInvested,
} from '../propertyStatus'

describe('Property status constants', () => {
  it('every status has a label', () => {
    for (const s of PROPERTY_STATUSES) {
      expect(PROPERTY_STATUS_LABELS[s]).toBeDefined()
      expect(PROPERTY_STATUS_LABELS[s].length).toBeGreaterThan(0)
    }
  })
})

describe('isPropertyEarningRent', () => {
  it('rented and notice_given earn rent', () => {
    expect(isPropertyEarningRent('rented')).toBe(true)
    expect(isPropertyEarningRent('notice_given')).toBe(true)
  })

  it('let_agreed does NOT earn rent (no tenant moved in yet)', () => {
    expect(isPropertyEarningRent('let_agreed')).toBe(false)
  })

  it('vacant / refurb / purchased / sold do not earn rent', () => {
    for (const s of ['vacant', 'refurb', 'purchased', 'sold']) {
      expect(isPropertyEarningRent(s)).toBe(false)
    }
  })

  it('short_term_let does NOT earn monthly rent (income is booking actuals)', () => {
    expect(isPropertyEarningRent('short_term_let')).toBe(false)
  })
})

describe('isPropertyOccupied', () => {
  it('matches isPropertyEarningRent except short_term_let (occupied, not monthly-earning)', () => {
    for (const s of PROPERTY_STATUSES) {
      if (s === 'short_term_let') continue
      expect(isPropertyOccupied(s)).toBe(isPropertyEarningRent(s))
    }
  })

  it('short_term_let counts as occupied so it never shows as vacant', () => {
    expect(isPropertyOccupied('short_term_let')).toBe(true)
  })
})

describe('isPropertyVacant', () => {
  it('only `vacant` is vacant — let_agreed is not', () => {
    expect(isPropertyVacant('vacant')).toBe(true)
    expect(isPropertyVacant('let_agreed')).toBe(false)
    expect(isPropertyVacant('rented')).toBe(false)
  })
})

describe('isPropertyActive', () => {
  it('everything except sold is active', () => {
    for (const s of PROPERTY_STATUSES) {
      expect(isPropertyActive(s)).toBe(s !== 'sold')
    }
  })
})

describe('isPropertyInvested', () => {
  it('everything except sold counts as invested', () => {
    expect(isPropertyInvested('sold')).toBe(false)
    expect(isPropertyInvested('rented')).toBe(true)
    expect(isPropertyInvested('purchased')).toBe(true)
  })
})

describe('On Rental Market', () => {
  it('is its own status: not earning, not occupied, not vacant', async () => {
    const m = await import('../propertyStatus')
    expect(m.PROPERTY_STATUSES).toContain('on_rental_market')
    expect(m.PROPERTY_STATUS_LABELS.on_rental_market).toBe('On rental market')
    expect(m.isPropertyEarningRent('on_rental_market')).toBe(false)
    expect(m.isPropertyOccupied('on_rental_market')).toBe(false)
    expect(m.isPropertyVacant('on_rental_market')).toBe(false)
    expect(m.isPropertyOnMarket('on_rental_market')).toBe(true)
  })

  it('opens a dated on-market period when the status is set', async () => {
    const { planOnMarketPeriods } = await import('../propertyStatus')
    const plan = planOnMarketPeriods({ from: 'vacant', to: 'on_rental_market', date: '2026-10-03', periods: [] })
    expect(plan.create).toMatchObject({ reason: 'on_market', start_date: '2026-10-03', end_date: null })
    expect(plan.close).toEqual([])
  })

  it('does not open a second period if one is already open', async () => {
    const { planOnMarketPeriods } = await import('../propertyStatus')
    const plan = planOnMarketPeriods({ from: 'vacant', to: 'on_rental_market', date: '2026-10-03', periods: [{ id: 'n1', reason: 'on_market', start_date: '2026-09-01', end_date: null }] })
    expect(plan.create).toBeNull()
  })

  it('closes it the day before the tenancy starts, leaving other periods alone', async () => {
    const { planOnMarketPeriods } = await import('../propertyStatus')
    const periods = [
      { id: 'n1', reason: 'on_market', start_date: '2026-10-03', end_date: null },
      { id: 'n2', reason: 'refurbishment', start_date: '2026-08-01', end_date: null },
    ]
    const plan = planOnMarketPeriods({ from: 'on_rental_market', to: 'rented', date: '2026-11-01', periods })
    expect(plan.close).toEqual([{ id: 'n1', end_date: '2026-10-31' }])
    expect(plan.remove).toEqual([]); expect(plan.create).toBeNull()
  })

  it('removes a period that would have covered no days (let the same day)', async () => {
    const { planOnMarketPeriods } = await import('../propertyStatus')
    const plan = planOnMarketPeriods({ from: 'on_rental_market', to: 'rented', date: '2026-10-03', periods: [{ id: 'n1', reason: 'on_market', start_date: '2026-10-03', end_date: null }] })
    expect(plan.remove).toEqual(['n1']); expect(plan.close).toEqual([])
  })

  it('changes nothing for unrelated status changes', async () => {
    const { planOnMarketPeriods } = await import('../propertyStatus')
    const plan = planOnMarketPeriods({ from: 'rented', to: 'notice_given', date: '2026-10-03', periods: [] })
    expect(plan).toEqual({ create: null, close: [], remove: [] })
  })
})
