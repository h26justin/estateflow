import { describe, it, expect } from 'vitest'
import {
  resolveDealGroups, orderUnitsUnderParents, groupParentOptions, wouldCreateLoop, groupBadge, descendantIds,
} from '../dealGroups'
import { companyFunding, refurbPosition, explainDeal, linkedRefurbProject } from '../dealFinance'
import { buildDealExportModel, dealsToCsv, DEALS_CSV_HEADERS, modelGroups } from '../dealExport'
import { aggregateDeals } from '../dealCashflow'
import {
  findDuplicateRefurbProject, refurbProjectFieldsFromDeal, refurbProjectCandidates, propertiesForRefurb, dealRefurbBudget,
} from '../dealRefurbLink'

const line = (deal_id, category, amount, state = 'confirmed') => ({ id: `${deal_id}-${category}-${amount}`, deal_id, category, amount, state })

// 31–34 Lyndhurst Terrace: one acquisition, four flats.
const parent = { id: 'p', name: '31-34 Lyndhurst Terrace', company_id: 'c1', status: 'exchanged', purchase_price: 400000, purchase_type: 'cash', expected_completion_date: '2026-11-27' }
const units = [31, 32, 33, 34].map(n => ({
  id: `u${n}`, name: `${n} Lyndhurst Terrace`, company_id: 'c1', status: 'exchanged', parent_deal_id: 'p',
  // Each unit repeats a share of the price, as users enter it for letting.
  purchase_price: 100000, purchase_type: 'cash', expected_completion_date: '2026-11-27',
}))
const standalone = { id: 's', name: 'Park Row', company_id: 'c1', status: 'conveyancing', purchase_price: 50000, expected_completion_date: '2026-12-04' }
const deals = [parent, ...units, standalone]
const linesByDeal = {
  p: [line('p', 'purchase_price', 400000), line('p', 'sdlt', 20000), line('p', 'legal_fee', 2000), line('p', 'deposit_paid', 40000, 'paid')],
  ...Object.fromEntries(units.map(u => [u.id, [line(u.id, 'purchase_price', 100000), line(u.id, 'sdlt', 5000), line(u.id, 'refurb', 8000, 'estimate')]])),
  s: [line('s', 'purchase_price', 50000)],
}
const fundingByDeal = { u31: [{ source: 'mortgage', state: 'confirmed', amount: 60000 }] }
const cash = { amount: 100000, as_of: '2026-11-19' }
const companies = [{ id: 'c1', name: 'Alpha Homes Ltd' }]

describe('resolveDealGroups', () => {
  it('maps units to a present parent and lists them under it', () => {
    const g = resolveDealGroups(deals)
    expect(g.unitsOf(parent).map(d => d.id)).toEqual(['u31', 'u32', 'u33', 'u34'])
    expect(g.parentFor(units[0])).toBe(parent)
    expect(g.isUnit(standalone)).toBe(false)
    expect(g.orphans.size).toBe(0)
  })

  it('treats a unit as standalone when its parent is missing, dead, deleted or itself', () => {
    const g = resolveDealGroups([
      { id: 'a', parent_deal_id: 'gone' },
      { id: 'b', parent_deal_id: 'dead' }, { id: 'dead', status: 'dead' },
      { id: 'c', parent_deal_id: 'del' }, { id: 'del', deleted_at: '2026-11-01' },
      { id: 'd', parent_deal_id: 'd' },
    ])
    expect(g.parentOf.size).toBe(0)
    expect([...g.orphans.entries()].map(([id, o]) => [id, o.reason])).toEqual([['a', 'missing'], ['b', 'dead'], ['c', 'deleted'], ['d', 'self']])
  })

  it('breaks a loop so nothing in it is dropped', () => {
    const g = resolveDealGroups([{ id: 'a', parent_deal_id: 'b' }, { id: 'b', parent_deal_id: 'a' }])
    expect(g.isUnit({ id: 'a' })).toBe(false)
    expect(g.orphanFor({ id: 'a' }).reason).toBe('cycle')
    expect(g.orphanFor({ id: 'b' }).reason).toBe('cycle')
  })

  it('badges parents and units', () => {
    const g = resolveDealGroups(deals)
    expect(groupBadge(parent, g)).toMatchObject({ kind: 'parent', label: 'Group · 4 units' })
    expect(groupBadge(units[1], g)).toMatchObject({ kind: 'unit', label: 'Unit of 31-34 Lyndhurst Terrace' })
    expect(groupBadge(standalone, g)).toBeNull()
  })

  it('orders units straight after their parent', () => {
    const rows = [{ id: 'u1', parentId: 'p' }, { id: 'x' }, { id: 'p' }, { id: 'u2', parentId: 'p' }, { id: 'o', parentId: 'gone' }]
    expect(orderUnitsUnderParents(rows).map(r => r.id)).toEqual(['x', 'p', 'u1', 'u2', 'o'])
  })
})

describe('group parent select', () => {
  const all = [
    { id: 'a', name: 'A', company_id: 'c1' },
    { id: 'b', name: 'B', company_id: 'c1', parent_deal_id: 'a' },
    { id: 'c', name: 'C', company_id: 'c1', parent_deal_id: 'b' },
    { id: 'd', name: 'D', company_id: 'c1' },
    { id: 'e', name: 'E', company_id: 'c2' },
    { id: 'f', name: 'F', company_id: 'c1', status: 'dead' },
  ]
  it('offers same-company deals, never itself or its own units', () => {
    expect(groupParentOptions(all[0], all).map(d => d.id)).toEqual(['d'])
    expect(groupParentOptions(all[3], all).map(d => d.id)).toEqual(['a', 'b', 'c'])
  })
  it('guards a two-step loop', () => {
    expect([...descendantIds(all[0], all)].sort()).toEqual(['b', 'c'])
    expect(wouldCreateLoop(all[0], 'c', all)).toBe(true)
    expect(wouldCreateLoop(all[0], 'a', all)).toBe(true)
    expect(wouldCreateLoop(all[0], 'd', all)).toBe(false)
    // A deal whose parent chain runs back through `a` is not offered to `a`,
    // even if the parent link was saved before the child link existed.
    const loopy = [{ id: 'a', company_id: 'c1' }, { id: 'x', company_id: 'c1', parent_deal_id: 'y' }, { id: 'y', company_id: 'c1', parent_deal_id: 'a' }]
    expect(groupParentOptions(loopy[0], loopy).map(d => d.id)).toEqual([])
  })
})

describe('four-unit group purchase is counted once', () => {
  const f = companyFunding({ deals, linesByDeal, fundingByDeal, cashPosition: cash, from: '2026-11-19' })

  it('company cash need and gap count the parent, not the units', () => {
    // Parent: 400,000 + 20,000 + 2,000 − 40,000 deposit = 382,000. Park Row 50,000.
    expect(f.needInWindow).toBe(432000)
    expect(f.fundingGap).toBe(332000)
    expect(f.unitCount).toBe(4)
    expect(f.activeDeals).toBe(6)
    // Unit refurb lines are an allocation too: not added to the forecast.
    expect(f.refurbForecast).toBe(0)
    // Unit funding is not counted either.
    expect(f.financingExpected).toBe(0)
  })

  it('lists units under their parent with a "part of" note', () => {
    expect(f.rows.map(r => r.dealId)).toEqual(['p', 'u31', 'u32', 'u33', 'u34', 's'])
    expect(f.rows[1]).toMatchObject({ unit: true, counted: false, partOf: '31-34 Lyndhurst Terrace' })
    // Their own figures are still shown.
    expect(f.rows[1].balanceDue).toBe(105000)
    expect(f.rows[0].units).toEqual(['u31', 'u32', 'u33', 'u34'])
  })

  it('keeps units out of the weekly schedule', () => {
    expect(f.weeks).toHaveLength(2)
    expect(f.weeks[0].deals).toEqual(['p'])
    expect(f.weeks[0].need).toBe(382000)
    expect(f.explain.join('\n')).toMatch(/4 units are listed under their parent deal and not added again/)
  })

  it('export totals count the purchase once', () => {
    const m = buildDealExportModel({ deals, companies, linesByDeal, fundingByDeal, cashByCompany: { c1: cash }, asOf: '2026-11-19' })
    const g = modelGroups(m)[0]
    expect(g.deals.map(r => r.id)).toEqual(['p', 'u31', 'u32', 'u33', 'u34', 's'])
    expect(g.totals.cashNeed).toBe(432000)
    expect(g.totals.balanceDue).toBe(432000)
    expect(g.totals.price).toBe(450000)
    expect(g.totals.financingConfirmed).toBe(0)
    expect(g.totals.fundingGap).toBe(332000)
    expect(g.totals.liveDeals).toBe(6)
    expect(g.totals.groupUnits).toBe(4)
    expect(m.totals.cashNeed).toBe(432000)
    expect(m.totals.groupUnits).toBe(4)
    const u = g.deals[1]
    expect(u).toMatchObject({ live: true, countsInFunding: false, groupRole: 'unit', partOf: '31-34 Lyndhurst Terrace' })
    expect(g.deals[0]).toMatchObject({ groupRole: 'parent', unitCount: 4 })
    expect(m.dataQuality.join('\n')).toMatch(/4 units of group purchases are listed under their parent/)
    expect(m.dataQuality.join('\n')).not.toMatch(/counted on its own/)
    const csv = dealsToCsv(m)
    const col = name => DEALS_CSV_HEADERS.indexOf(name)
    expect(csv[2][col('part_of')]).toBe('31-34 Lyndhurst Terrace')
    expect(csv[2][col('counts_in_funding')]).toBe('no')
    expect(csv[1][col('group_role')]).toBe('Group parent (4 units)')
  })

  it('cashflow panel aggregates do not double count, the parent wins', () => {
    const agg = aggregateDeals(deals)
    const alone = aggregateDeals([parent, standalone])
    expect(agg.totalHeadline).toBe(alone.totalHeadline)
    expect(agg.totalCashOut).toBe(alone.totalCashOut)
    expect(agg.totalCount).toBe(2)
    expect(agg.groupUnitCount).toBe(4)
    const listed = agg.byGroup.committed.deals
    expect(listed).toHaveLength(5)
    const unit = listed.find(d => d.id === 'u32')
    expect(unit._cashflow).toMatchObject({ headline: 0, cashOut: 0, unitOf: '31-34 Lyndhurst Terrace' })
    expect(unit._cashflow.own.headline).toBeGreaterThan(0)
  })
})

describe('missing parent fallback', () => {
  it('counts a unit on its own when its parent is filtered out, with a note', () => {
    const only = [units[0], standalone]
    const f = companyFunding({ deals: only, linesByDeal, fundingByDeal, cashPosition: cash, from: '2026-11-19' })
    // 105,000 balance due − 60,000 confirmed mortgage = 45,000, plus Park Row.
    expect(f.needInWindow).toBe(95000)
    expect(f.unitCount).toBe(0)
    expect(f.refurbForecast).toBe(8000)
    expect(f.groupNotes).toHaveLength(1)
    expect(f.explain.join('\n')).toMatch(/31 Lyndhurst Terrace: its group purchase parent is not in this list/)

    const m = buildDealExportModel({ deals: only, companies, linesByDeal, fundingByDeal, cashByCompany: { c1: cash }, asOf: '2026-11-19' })
    expect(m.totals.cashNeed).toBe(95000)
    const r = modelGroups(m)[0].deals.find(x => x.id === 'u31')
    expect(r).toMatchObject({ countsInFunding: true, partOf: null })
    expect(m.dataQuality.join('\n')).toMatch(/31 Lyndhurst Terrace \(Alpha Homes Ltd\): its group purchase parent is not in this list.*counted twice/)
    expect(aggregateDeals(only).totalCount).toBe(2)
  })

  it('counts units on their own when the parent has fallen through', () => {
    const dead = { ...parent, status: 'dead' }
    const f = companyFunding({ deals: [dead, ...units], linesByDeal, fundingByDeal: {}, cashPosition: null })
    expect(f.unitCount).toBe(0)
    expect(f.needInWindow).toBe(4 * 105000)
    expect(f.groupNotes[0]).toMatch(/fallen through/)
    expect(aggregateDeals([dead, ...units]).totalCount).toBe(4)
  })

  it('a parent in another company leaves the unit standalone in the export', () => {
    const other = { ...parent, company_id: 'c2' }
    const m = buildDealExportModel({
      deals: [other, units[1]], companies: [...companies, { id: 'c2', name: 'Beta' }], linesByDeal, fundingByDeal: {}, asOf: '2026-11-19',
    })
    const r = modelGroups(m).find(g => g.company.id === 'c1').deals[0]
    expect(r.countsInFunding).toBe(true)
    expect(r.groupNote).toMatch(/not in this list/)
  })
})

describe('refurb link', () => {
  const project = {
    id: 'rp1', title: 'Lyndhurst refurb', property_id: 'prop1', company_id: 'c1', stage: 'in_progress', agreed_price: 30000,
    refurb_lines: [{ kind: 'extra', amount: 2000 }, { kind: 'payment', amount: 12000 }, { kind: 'credit', amount: 1000 }],
  }
  const deal = { id: 'p', name: 'Lyndhurst', refurb_cost: 25000, refurb_project_id: 'rp1', status: 'completed' }

  it('prefers the linked project budget and payments and says so', () => {
    const r = refurbPosition(deal, [line('p', 'refurb', 20000)], [project])
    expect(r).toMatchObject({ basis: 'project', amount: 32000, paid: 11000, outstanding: 21000, source: 'Refurb project "Lyndhurst refurb"' })
    expect(explainDeal(deal, [], [], { rp1: project }).join('\n')).toMatch(/linked Refurb project "Lyndhurst refurb": budget £32,000, paid £11,000, outstanding £21,000/)
  })

  it('falls back to the deal when the project is not linked, deleted or has no price', () => {
    expect(refurbPosition({ ...deal, refurb_project_id: null }, [], [project])).toMatchObject({ basis: 'estimate', amount: 25000, source: 'Deal refurb cost (estimate)' })
    expect(linkedRefurbProject(deal, [{ ...project, deleted_at: '2026-11-01' }])).toBeNull()
    const noPrice = refurbPosition(deal, [line('p', 'refurb', 20000)], { ...project, agreed_price: 0, refurb_lines: [] })
    expect(noPrice).toMatchObject({ basis: 'lines', amount: 20000 })
    expect(noPrice.missing).toContain('Linked refurb project has no agreed price yet')
  })

  it('company funding counts what is left to pay on a linked project', () => {
    const live = { ...deal, status: 'exchanged', purchase_price: 100000, company_id: 'c1' }
    const f = companyFunding({ deals: [live], refurbProjects: [project] })
    expect(f.refurbForecast).toBe(21000)
    expect(f.rows[0].refurbSource).toBe('Refurb project "Lyndhurst refurb"')
  })

  const properties = [
    { id: 'prop1', name: '31-34 Lyndhurst Terrace', address: '31-34 Lyndhurst Terrace, Leeds', company_id: 'c1', refurb_projects: [project] },
    { id: 'prop2', name: 'Park Row', address: '1 Park Row', company_id: 'c1', refurb_projects: [] },
    { id: 'prop3', name: 'Elsewhere', address: '9 Other St', company_id: 'c2', refurb_projects: [{ id: 'rp9', title: 'Other', property_id: 'prop3', company_id: 'c2', stage: 'planned', agreed_price: 1 }] },
  ]
  const newDeal = { id: 'd9', name: '31-34 Lyndhurst Terrace', address: '31-34 Lyndhurst Terrace, Leeds', company_id: 'c1', refurb_cost: 15000, purchase_type: 'cash' }

  it('finds an existing project instead of creating a duplicate', () => {
    expect(findDuplicateRefurbProject(newDeal, properties, 'prop1').project.id).toBe('rp1')
    expect(findDuplicateRefurbProject({ ...newDeal, name: 'Something else', address: '' }, properties, 'prop2')).toBeNull()
    // Same name, other property: still offered.
    expect(findDuplicateRefurbProject({ ...newDeal, name: 'Lyndhurst refurb' }, properties, 'prop2').project.id).toBe('rp1')
    // Already created from this deal.
    const fromDeal = [{ ...properties[1], refurb_projects: [{ id: 'rp5', title: 'X', property_id: 'prop2', stage: 'complete', deal_id: 'd9' }] }]
    expect(findDuplicateRefurbProject(newDeal, fromDeal, null).project.id).toBe('rp5')
  })

  it('offers the company and address matches to link, and the right properties to create on', () => {
    expect(refurbProjectCandidates(newDeal, properties, []).map(p => p.id)).toEqual(['rp1'])
    expect(propertiesForRefurb(newDeal, properties).map(p => p.id)).toEqual(['prop1', 'prop2'])
  })

  it('builds the create payload from the deal', () => {
    expect(dealRefurbBudget(newDeal, [line('d9', 'refurb', 9000), line('d9', 'contingency', 1000)])).toEqual({ amount: 10000, source: 'refurb cost lines' })
    const f = refurbProjectFieldsFromDeal(newDeal, properties[1], [])
    expect(f).toMatchObject({ property_id: 'prop2', company_id: 'c1', title: '31-34 Lyndhurst Terrace', agreed_price: 15000, deal_id: 'd9', stage: 'planned', funding: 'cash' })
    expect(f.notes).toMatch(/Created from the deal/)
  })
})
