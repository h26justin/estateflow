import { describe, it, expect } from 'vitest'
import { groupKeyForAddress, flatKeyWithinBuilding } from '../addressUtils'

describe('groupKeyForAddress', () => {
  it('returns null for empty input', () => {
    expect(groupKeyForAddress('')).toBeNull()
    expect(groupKeyForAddress(null)).toBeNull()
  })

  it('groups flats in the same building under one key', () => {
    const a = groupKeyForAddress('Flat 1, St Georges House, Park Road, Sunderland, SR2 7BJ')
    const b = groupKeyForAddress('Flat 10, St Georges House, Park Road, Sunderland, SR2 7BJ')
    expect(a).toBe(b)
    expect(a).toBe('stgeorgeshouse|sunderland')
  })

  it('groups named secondary units with the same building', () => {
    const a = groupKeyForAddress('Flat 1, St Georges House, Park Road, Sunderland, SR2 7BJ')
    const b = groupKeyForAddress('The Cottage, St Georges House, Park Road, Sunderland, SR2 7BJ')
    expect(a).toBe(b)
  })

  it('keeps different buildings separate', () => {
    const a = groupKeyForAddress('Flat 1, St Georges House, Park Road, Sunderland, SR2 7BJ')
    const b = groupKeyForAddress('Flat 1, St Peters House, Park Road, Sunderland, SR2 7BJ')
    expect(a).not.toBe(b)
  })

  it('skips trailing postcode when picking the town', () => {
    const k = groupKeyForAddress('123 High Street, Newcastle, NE1 4AB')
    expect(k).toBe('123highstreet|newcastle')
  })

  it('handles addresses with no postcode', () => {
    const k = groupKeyForAddress('1 Vale Road, Acklington')
    expect(k).toBe('1valeroad|acklington')
  })

  it('handles apartment and unit prefixes', () => {
    const k1 = groupKeyForAddress('Apt 3, Tower View, Glasgow, G1 1AA')
    const k2 = groupKeyForAddress('Unit 5, Tower View, Glasgow, G1 1AA')
    expect(k1).toBe(k2)
  })

  it('handles ground-floor flat prefixes', () => {
    const k1 = groupKeyForAddress('Ground Floor Flat, 12 Tyne Street, Newcastle, NE1 4AB')
    const k2 = groupKeyForAddress('First Floor Flat, 12 Tyne Street, Newcastle, NE1 4AB')
    expect(k1).toBe(k2)
  })
})

describe('flatKeyWithinBuilding', () => {
  it('returns the leading chunk of the address, lowercased', () => {
    expect(flatKeyWithinBuilding('Flat 1, St Georges House')).toBe('flat 1')
    expect(flatKeyWithinBuilding('Flat 10, St Georges House')).toBe('flat 10')
    expect(flatKeyWithinBuilding('The Cottage, St Georges House')).toBe('the cottage')
  })

  it('returns empty string for empty input', () => {
    expect(flatKeyWithinBuilding('')).toBe('')
    expect(flatKeyWithinBuilding(null)).toBe('')
  })
})
