import { describe, it, expect } from 'vitest'
import { buildOwnershipRegister, ownersLabel, PERSONAL_BUCKET_NAME } from '../ownershipReport'

const COMPANIES = [
  { id: 'op1', name: 'Beta Lettings Ltd', abbr: 'Beta' },
  { id: 'op2', name: 'Alpha Homes Ltd', abbr: 'Alpha' },
  { id: 'hold', name: 'Group Holdings Ltd', company_type: 'holding' },
]

const PROPS = [
  { id: 'p1', name: 'Flat 10', company_id: 'op1', current_value: 200_000, status: 'rented' },
  { id: 'p2', name: 'Flat 2',  company_id: 'op1', est_value: 150_000, status: 'vacant' },
  { id: 'p3', name: 'The Mill', company_id: 'op2', current_value: 400_000, status: 'sold' },
  { id: 'p4', name: 'Home',    company_id: null, est_value: 300_000, status: 'rented' },
]

// Justin owns 50% of Alpha directly, and Beta is 100% owned by the holding
// company he owns 60% of — so his effective share of Beta is 60%.
const SHAREHOLDERS = [
  { company_id: 'op2', name: 'Justin', email: 'justin@example.com', percentage: 50 },
  { company_id: 'op2', name: 'Sam', email: 'sam@example.com', percentage: 50 },
  { company_id: 'op1', name: 'Group Holdings Ltd', percentage: 100, shareholder_type: 'company', shareholder_company_id: 'hold' },
  { company_id: 'hold', name: 'Justin', email: 'justin@example.com', percentage: 60 },
]

const USER = { id: 'u1', email: 'justin@example.com' }

const build = (over = {}) => buildOwnershipRegister({
  properties: PROPS, companies: COMPANIES, shareholders: SHAREHOLDERS, user: USER, ...over,
})

describe('buildOwnershipRegister', () => {
  it('groups every property under the company that holds it', () => {
    const { groups } = build()
    const byName = Object.fromEntries(groups.map(g => [g.name, g]))
    expect(byName['Beta Lettings Ltd'].properties.map(r => r.p.id)).toEqual(['p2', 'p1']) // natural sort
    expect(byName['Alpha Homes Ltd'].properties.map(r => r.p.id)).toEqual(['p3'])
    expect(byName[PERSONAL_BUCKET_NAME].properties.map(r => r.p.id)).toEqual(['p4'])
  })

  it('orders companies naturally and puts the personal bucket last', () => {
    expect(build().groups.map(g => g.name))
      .toEqual(['Alpha Homes Ltd', 'Beta Lettings Ltd', PERSONAL_BUCKET_NAME])
  })

  it('never drops a property whose company is not visible', () => {
    const { groups, totals } = build({ properties: [{ id: 'x', name: 'Orphan', company_id: 'gone' }] })
    expect(totals.properties).toBe(1)
    expect(groups[0].name).toBe(PERSONAL_BUCKET_NAME)
  })

  it('values properties with current_value over est_value', () => {
    const beta = build().groups.find(g => g.id === 'op1')
    expect(beta.value).toBe(350_000)
    expect(build().totals.value).toBe(1_050_000)
  })

  it('flags sold and archived properties instead of hiding them', () => {
    const { totals } = build({
      properties: [...PROPS, { id: 'p5', name: 'Old Barn', company_id: 'op2', archived_at: '2026-01-01' }],
    })
    expect(totals.properties).toBe(5)
    expect(totals.sold).toBe(1)
    expect(totals.archived).toBe(1)
  })

  it('reports the effective share, looking through a holding company', () => {
    const g = Object.fromEntries(build().groups.map(x => [x.id, x]))
    expect(g['op2'].sharePct).toBe(50)
    expect(g['op1'].sharePct).toBe(60)
    expect(g['op1'].via).toEqual(['Group Holdings Ltd'])
    // Anything in your own name is wholly yours.
    expect(build().groups.at(-1)).toMatchObject({ type: 'personal', sharePct: 100 })
  })

  it('leaves the share null (not 0) when no stake can be traced', () => {
    const g = build({ user: { id: 'u9', email: 'nobody@example.com' } }).groups
    expect(g.find(x => x.id === 'op1').sharePct).toBeNull()
  })

  it('lists companies holding no property, with what a holding company holds', () => {
    const { otherCompanies } = build()
    expect(otherCompanies.map(c => c.id)).toEqual(['hold'])
    expect(otherCompanies[0].type).toBe('holding')
    expect(otherCompanies[0].holds).toEqual([{ id: 'op1', name: 'Beta', pct: 100 }])
  })

  it('counts only companies that hold title in companiesWithProperty', () => {
    expect(build().totals).toMatchObject({ companiesWithProperty: 2, personallyHeld: 1 })
  })

  it('scopeCompanyId limits the empty-company list to the selected company', () => {
    const scoped = buildOwnershipRegister({
      properties: PROPS.filter(p => p.company_id === 'op2'),
      companies: COMPANIES, shareholders: SHAREHOLDERS, user: USER, scopeCompanyId: 'op2',
    })
    expect(scoped.groups.map(g => g.id)).toEqual(['op2'])
    expect(scoped.otherCompanies).toEqual([])
  })

  it('handles an empty account', () => {
    const r = buildOwnershipRegister({})
    expect(r.groups).toEqual([])
    expect(r.otherCompanies).toEqual([])
    expect(r.totals).toMatchObject({ properties: 0, value: 0, companiesWithProperty: 0 })
  })
})

describe('ownersLabel', () => {
  it('names the linked company for a corporate shareholder', () => {
    const beta = build().groups.find(g => g.id === 'op1')
    expect(ownersLabel(beta)).toBe('Group Holdings Ltd 100%')
  })

  it('collapses long cap tables', () => {
    expect(ownersLabel({ type: 'operating', owners: [
      { name: 'A', pct: 50 }, { name: 'B', pct: 30 }, { name: 'C', pct: 20 },
    ] })).toBe('A 50%, B 30% +1 more')
  })

  it('describes the personal bucket and an empty cap table', () => {
    expect(ownersLabel({ type: 'personal', owners: [] })).toBe('You, in your own name')
    expect(ownersLabel({ type: 'operating', owners: [] })).toBe('No shareholders recorded')
  })
})
