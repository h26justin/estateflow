import { describe, it, expect } from 'vitest'
import { groupKeyForAddress, flatKeyWithinBuilding, buildingTailFromName, naturalCompare, groupPropertiesByBuilding, sortPropertiesCanonically } from '../addressUtils'

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

describe('groupPropertiesByBuilding', () => {
  it('groups same-building properties and natural-sorts them', () => {
    const groups = groupPropertiesByBuilding([
      { id: 'a', name: 'Flat 10, Watts Moses House' },
      { id: 'b', name: '13 Lumley Street' },
      { id: 'c', name: 'Flat 1, Watts Moses House' },
      { id: 'd', name: 'Flat 2, Watts Moses House' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].tail).toBe('Watts Moses House')
    expect(groups[0].isBuilding).toBe(true)
    expect(groups[0].items.map(i => i.name)).toEqual([
      'Flat 1, Watts Moses House',
      'Flat 2, Watts Moses House',
      'Flat 10, Watts Moses House',
    ])
    expect(groups[1].tail).toBeNull()
    expect(groups[1].isBuilding).toBe(false)
    expect(groups[1].items.map(i => i.name)).toEqual(['13 Lumley Street'])
  })

  it('preserves first-seen ordering across multiple buildings', () => {
    const groups = groupPropertiesByBuilding([
      { id: '1', name: 'Flat 1, Building A' },
      { id: '2', name: 'Flat 1, Building B' },
      { id: '3', name: 'Flat 2, Building A' },
    ])
    expect(groups.map(g => g.tail)).toEqual(['Building A', 'Building B'])
    expect(groups[0].items).toHaveLength(2)
    expect(groups[1].items).toHaveLength(1)
  })

  it('returns an empty array for empty/null input', () => {
    expect(groupPropertiesByBuilding([])).toEqual([])
    expect(groupPropertiesByBuilding(null)).toEqual([])
  })

  it('treats solo properties as separate groups', () => {
    const groups = groupPropertiesByBuilding([
      { id: '1', name: 'House A' },
      { id: '2', name: 'House B' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every(g => !g.isBuilding)).toBe(true)
  })
})

describe('naturalCompare', () => {
  it('sorts numeric suffixes numerically, not lexically', () => {
    const items = ['Flat 10', 'Flat 1', 'Flat 2', 'Flat 3', 'Flat 11']
    items.sort(naturalCompare)
    expect(items).toEqual(['Flat 1', 'Flat 2', 'Flat 3', 'Flat 10', 'Flat 11'])
  })

  it('sorts room and unit prefixes', () => {
    const items = ['Room 100', 'Room 9', 'Room 10']
    items.sort(naturalCompare)
    expect(items).toEqual(['Room 9', 'Room 10', 'Room 100'])
  })

  it('case-insensitive', () => {
    expect(naturalCompare('flat 1', 'FLAT 2')).toBeLessThan(0)
  })

  it('handles null/undefined safely', () => {
    expect(naturalCompare(null, 'a')).toBeLessThan(0)
    expect(naturalCompare('a', undefined)).toBeGreaterThan(0)
    expect(naturalCompare(null, undefined)).toBe(0)
  })
})

describe('sortPropertiesCanonically', () => {
  it('natural-sorts names when no sort_order is set', () => {
    const props = [
      { name: 'Room 10, Piers View' },
      { name: 'Room 1, Piers View' },
      { name: 'Room 2, Piers View' },
    ]
    expect(sortPropertiesCanonically(props).map(p => p.name)).toEqual([
      'Room 1, Piers View', 'Room 2, Piers View', 'Room 10, Piers View',
    ])
  })

  it('puts explicit drag positions first, in order', () => {
    const props = [
      { name: 'B House' },
      { name: 'Z House', sort_order: 0 },
      { name: 'A House', sort_order: 1 },
    ]
    expect(sortPropertiesCanonically(props).map(p => p.name)).toEqual([
      'Z House', 'A House', 'B House',
    ])
  })

  it('falls back to address for unnamed rows and tolerates null input', () => {
    const props = [{ address: '10 High St' }, { address: '2 High St' }, { name: null, address: null }]
    const sorted = sortPropertiesCanonically(props)
    expect(sorted[0].name ?? sorted[0].address).toBeNull()
    expect(sorted.slice(1).map(p => p.address)).toEqual(['2 High St', '10 High St'])
    expect(sortPropertiesCanonically(null)).toEqual([])
  })

  it('does not mutate the input array', () => {
    const props = [{ name: 'B' }, { name: 'A' }]
    sortPropertiesCanonically(props)
    expect(props.map(p => p.name)).toEqual(['B', 'A'])
  })
})

describe('buildingTailFromName', () => {
  it('returns the part after the first comma', () => {
    expect(buildingTailFromName('Room 1, Watts Moses House')).toBe('Watts Moses House')
    expect(buildingTailFromName('Room 43, Watts Moses House')).toBe('Watts Moses House')
  })

  it('keeps later commas in the tail', () => {
    expect(buildingTailFromName('Flat 3, Piers View, Park Road')).toBe('Piers View, Park Road')
  })

  it('returns null for names without a comma', () => {
    expect(buildingTailFromName('13 Lumley Street')).toBeNull()
    expect(buildingTailFromName('Standalone')).toBeNull()
  })

  it('returns null for empty/blank input', () => {
    expect(buildingTailFromName('')).toBeNull()
    expect(buildingTailFromName(null)).toBeNull()
    expect(buildingTailFromName('Foo,   ')).toBeNull()  // comma with whitespace tail
  })
})
