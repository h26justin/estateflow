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
