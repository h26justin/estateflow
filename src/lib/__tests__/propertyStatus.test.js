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
})

describe('isPropertyOccupied', () => {
  it('matches isPropertyEarningRent today (let_agreed still excluded)', () => {
    for (const s of PROPERTY_STATUSES) {
      expect(isPropertyOccupied(s)).toBe(isPropertyEarningRent(s))
    }
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
