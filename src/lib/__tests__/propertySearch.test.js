import { describe, it, expect } from 'vitest'
import {
  normaliseQuery,
  propertySearchText,
  propertySearchMeta,
  matchesQuery,
  searchProperties,
  rankProperties,
} from '../propertySearch'

const EXH   = { id: 'co-exh',  name: 'ExH Property Group', abbr: 'ExH', color: '#C8A96A' }
const ALI   = { id: 'co-ali',  name: 'AliCat Property',    abbr: 'AliCat', color: '#5B8DEF' }
const NOU   = { id: 'co-nou',  name: 'Nouchette',          abbr: 'Nou', color: '#7BC47F' }

const PROPS = [
  { id: 'p1', name: 'Flat 1, Watts Moses House', address: 'Flat 1, Watts Moses House, John Street, Sunderland, SR1 1QH', company_id: EXH.id, company: EXH, tenant_name: 'Alice Brown', status: 'rented', arrears: 0 },
  { id: 'p2', name: 'Flat 1, Park Place West', address: 'Flat 1, Park Place West, Sunderland, SR2 8HZ', company_id: ALI.id, company: ALI, tenant_name: '', status: 'rented', arrears: 120 },
  { id: 'p3', name: 'Flat 1, Park Place East', address: 'Flat 1, Park Place East, Sunderland, SR2 8HY', company_id: NOU.id, company: NOU, tenant_name: null, status: 'vacant', arrears: 0 },
  { id: 'p4', name: 'Flat 10, Watts Moses House', address: 'Flat 10, Watts Moses House, John Street, Sunderland, SR1 1QH', company_id: EXH.id, company: EXH, tenant_name: 'Bob Green', status: 'rented', arrears: 0 },
  { id: 'p5', name: '13 Lumley Street', address: '13 Lumley Street, Sunderland, SR4 6JR', company_id: ALI.id, company: ALI, status: 'rented', arrears: 0,
    tenancy_details: { tenant_names: 'Carol White, Dave Black' } },
  { id: 'p6', name: 'The Cottage, St Georges House', address: 'The Cottage, St Georges House, Park Road, Sunderland, SR2 7BJ', company_id: NOU.id, company: NOU, status: 'sold', arrears: 0,
    tenancy_details: [{ tenant_names: 'Erin Grey' }] },
]

describe('normaliseQuery', () => {
  it('lowercases and splits on whitespace, dropping empties', () => {
    expect(normaliseQuery('  Flat   1  WATTS ')).toEqual(['flat', '1', 'watts'])
  })
  it('returns [] for empty, whitespace-only, null and undefined', () => {
    expect(normaliseQuery('')).toEqual([])
    expect(normaliseQuery('   ')).toEqual([])
    expect(normaliseQuery(null)).toEqual([])
    expect(normaliseQuery(undefined)).toEqual([])
  })
})

describe('propertySearchText', () => {
  it('includes name, address, building, company name + abbr and tenant name', () => {
    const t = propertySearchText(PROPS[0])
    expect(t).toContain('flat 1, watts moses house')
    expect(t).toContain('john street')
    expect(t).toContain('exh property group')
    expect(t).toContain('exh')
    expect(t).toContain('alice brown')
  })
  it('includes tenancy_details.tenant_names whether joined as object or array', () => {
    expect(propertySearchText(PROPS[4])).toContain('carol white, dave black')
    expect(propertySearchText(PROPS[5])).toContain('erin grey')
  })
  it('never contains phone or email fields even if present on the row', () => {
    const p = { ...PROPS[0], tenant_phone: '07700 900123', tenant_email: 'alice@example.com' }
    const t = propertySearchText(p)
    expect(t).not.toContain('07700')
    expect(t).not.toContain('alice@example.com')
  })
  it('returns an empty string for null / undefined', () => {
    expect(propertySearchText(null)).toBe('')
    expect(propertySearchText(undefined)).toBe('')
  })
})

describe('matchesQuery', () => {
  it('is case-insensitive', () => {
    expect(matchesQuery(PROPS[0], 'WATTS MOSES')).toBe(true)
    expect(matchesQuery(PROPS[0], 'watts moses')).toBe(true)
  })
  it('accepts partial tokens', () => {
    expect(matchesQuery(PROPS[0], 'wat mos')).toBe(true)
    expect(matchesQuery(PROPS[4], 'luml')).toBe(true)
  })
  it('requires every token to match somewhere', () => {
    expect(matchesQuery(PROPS[0], 'flat 1 watts')).toBe(true)
    expect(matchesQuery(PROPS[1], 'flat 1 watts')).toBe(false)
    expect(matchesQuery(PROPS[0], 'flat 1 nowhere')).toBe(false)
  })
  it('matches on tenant name from the property row', () => {
    expect(matchesQuery(PROPS[0], 'alice')).toBe(true)
    expect(matchesQuery(PROPS[3], 'alice')).toBe(false)
  })
  it('matches on tenancy_details.tenant_names when present', () => {
    expect(matchesQuery(PROPS[4], 'dave')).toBe(true)
    expect(matchesQuery(PROPS[5], 'erin')).toBe(true)
  })
  it('matches on company name and abbreviation', () => {
    expect(matchesQuery(PROPS[1], 'alicat')).toBe(true)
    expect(matchesQuery(PROPS[2], 'nou')).toBe(true)
  })
  it('matches on postcode fragments from the address', () => {
    expect(matchesQuery(PROPS[4], 'sr4')).toBe(true)
  })
  it('an empty query matches everything', () => {
    for (const p of PROPS) expect(matchesQuery(p, '')).toBe(true)
    expect(matchesQuery(PROPS[0], null)).toBe(true)
  })
  it('accepts pre-normalised token arrays', () => {
    expect(matchesQuery(PROPS[0], ['flat', 'watts'])).toBe(true)
  })
})

describe('searchProperties', () => {
  it('empty query returns all properties in the same order', () => {
    const out = searchProperties(PROPS, '')
    expect(out.map(p => p.id)).toEqual(PROPS.map(p => p.id))
    expect(out).not.toBe(PROPS) // a copy, not the same reference
  })
  it('"flat 1" returns every Flat 1 across buildings and companies (plus Flat 10 as a partial)', () => {
    const out = searchProperties(PROPS, 'flat 1')
    expect(out.map(p => p.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
    // Same-named units must each carry enough to tell them apart
    const metas = out.map(propertySearchMeta)
    const keys = metas.map(m => `${m.unit}|${m.building}|${m.companyAbbr}`)
    expect(new Set(keys).size).toBe(out.length)
    for (const m of metas) {
      expect(m.building).not.toBe('')
      expect(m.companyAbbr).not.toBe('')
      expect(m.companyName).not.toBe('')
    }
  })
  it('"flat 1 watts" narrows to the Watts Moses House flats only', () => {
    const out = searchProperties(PROPS, 'flat 1 watts')
    expect(out.map(p => p.id).sort()).toEqual(['p1', 'p4'])
    expect(out.every(p => p.company.abbr === 'ExH')).toBe(true)
  })
  it('a company token disambiguates identical unit names', () => {
    expect(searchProperties(PROPS, 'flat 1 alicat').map(p => p.id)).toEqual(['p2'])
    expect(searchProperties(PROPS, 'flat 1 nou').map(p => p.id)).toEqual(['p3'])
  })
  it('tenant name search finds the right property', () => {
    expect(searchProperties(PROPS, 'bob green').map(p => p.id)).toEqual(['p4'])
    expect(searchProperties(PROPS, 'carol').map(p => p.id)).toEqual(['p5'])
  })
  it('returns [] when nothing matches, and [] for a non-array input', () => {
    expect(searchProperties(PROPS, 'zzzz')).toEqual([])
    expect(searchProperties(null, 'flat')).toEqual([])
  })
})

describe('propertySearchMeta', () => {
  it('splits unit and building from a comma-separated name', () => {
    const m = propertySearchMeta(PROPS[0])
    expect(m.unit).toBe('flat 1')
    expect(m.building).toBe('Watts Moses House')
    expect(m.companyAbbr).toBe('ExH')
    expect(m.companyColor).toBe('#C8A96A')
  })
  it('a standalone property has no unit / building', () => {
    const m = propertySearchMeta(PROPS[4])
    expect(m.unit).toBe('')
    expect(m.building).toBe('')
    expect(m.name).toBe('13 Lumley Street')
  })
  it('tolerates a missing company join', () => {
    const m = propertySearchMeta({ id: 'x', name: 'Solo', company_id: 'co-1' })
    expect(m.companyId).toBe('co-1')
    expect(m.companyAbbr).toBe('')
    expect(m.companyColor).toBeNull()
  })
})

describe('tenancies join (Stage 2)', () => {
  it('matches tenant name and reference from the tenancies join', () => {
    const p = { id: 'x', name: 'Flat 9, Watts Moses House', address: 'High Street East', tenancies: [{ tenant_name: 'Priya Patel', tenant_ref: 'WMH-09' }] }
    expect(matchesQuery(p, 'priya')).toBe(true)
    expect(matchesQuery(p, 'wmh-09')).toBe(true)
    expect(matchesQuery(p, 'nobody')).toBe(false)
  })
})


describe('rankProperties', () => {
  it('returns nothing for an empty query', () => {
    expect(rankProperties(PROPS, '')).toEqual([])
    expect(rankProperties(PROPS, '   ')).toEqual([])
    expect(rankProperties(PROPS, null)).toEqual([])
  })

  it('puts a name prefix match first', () => {
    const r = rankProperties(PROPS, '13 lum')
    expect(r[0].id).toBe('p5')
  })

  it('ranks a word inside the name above an address-only match', () => {
    const r = rankProperties(PROPS, 'lumley')
    expect(r[0].id).toBe('p5')
  })

  it('ranks name/address matches above a tenant match', () => {
    const r = rankProperties(PROPS, 'park')
    // Park Place West / East carry "Park" in the name; The Cottage only has
    // Park Road in its address.
    expect(r.map(p => p.id).slice(0, 2).sort()).toEqual(['p2', 'p3'])
    expect(r[r.length - 1].id).toBe('p6')
  })

  it('still finds a property by tenant name', () => {
    expect(rankProperties(PROPS, 'carol').map(p => p.id)).toEqual(['p5'])
    expect(rankProperties(PROPS, 'erin grey').map(p => p.id)).toEqual(['p6'])
  })

  it('orders units naturally, so Flat 1 precedes Flat 10', () => {
    const r = rankProperties(PROPS, 'watts')
    expect(r.map(p => p.id)).toEqual(['p1', 'p4'])
  })

  it('respects the limit', () => {
    expect(rankProperties(PROPS, 'flat', 2)).toHaveLength(2)
    expect(rankProperties(PROPS, 'flat', 0).length).toBeGreaterThan(2)
  })

  it('tolerates a non-array input', () => {
    expect(rankProperties(null, 'flat')).toEqual([])
  })
})
