import { describe, it, expect } from 'vitest'
import { matchesFilters, sortDeals, cleanViews, upsertView, ownerOptions, isFiltered, DEFAULT_FILTERS, MAX_SAVED_VIEWS } from '../dealViews'

const TODAY = '2026-11-20'
const deals = [
  { id: 'a', company_id: 'vpg', status: 'under_offer', attention_status: 'on_track', next_action_owner: 'Tiffany', next_action_due: '2026-12-14', purchase_price: 20000, updated_at: '2026-11-19' },
  { id: 'b', company_id: 'vpg', status: 'conveyancing', attention_status: 'blocked', next_action_owner: 'tiffany ', next_action_due: '2026-11-18', purchase_price: 72000, updated_at: '2026-11-20' },
  { id: 'c', company_id: null, status: 'analysing', attention_status: null, next_action_owner: null, next_action_due: null, purchase_price: 0, updated_at: '2026-10-01' },
  { id: 'd', company_id: 'wxh', status: 'conveyancing', attention_status: 'awaiting_response', next_action_owner: 'Justin', next_action_due: '2026-11-25', purchase_price: 157500, updated_at: '2026-11-01' },
]
const ids = f => deals.filter(d => matchesFilters(d, f, TODAY)).map(d => d.id)

describe('matchesFilters', () => {
  it('defaults keep everything', () => expect(ids(DEFAULT_FILTERS)).toEqual(['a', 'b', 'c', 'd']))
  it('company, unassigned and stage', () => {
    expect(ids({ company: 'vpg' })).toEqual(['a', 'b'])
    expect(ids({ company: '' })).toEqual(['c'])
    expect(ids({ status: 'conveyancing' })).toEqual(['b', 'd'])
  })
  it('attention: needs attention means set and not on track', () => {
    expect(ids({ attention: 'needs' })).toEqual(['b', 'd'])
    expect(ids({ attention: 'blocked' })).toEqual(['b'])
  })
  it('owner matches ignoring case and spaces; blank means no owner', () => {
    expect(ids({ owner: 'Tiffany' })).toEqual(['a', 'b'])
    expect(ids({ owner: '' })).toEqual(['c'])
  })
  it('due windows', () => {
    expect(ids({ due: 'overdue' })).toEqual(['b'])
    expect(ids({ due: 'week' })).toEqual(['b', 'd'])
    expect(ids({ due: 'none' })).toEqual(['c'])
  })
  it('combines filters', () => expect(ids({ company: 'vpg', owner: 'tiffany', due: 'overdue' })).toEqual(['b']))
})

describe('sortDeals', () => {
  it('sorts by due (blanks last), price and recency; default keeps order', () => {
    expect(sortDeals(deals, 'due').map(d => d.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(sortDeals(deals, 'price_desc').map(d => d.id)).toEqual(['d', 'b', 'a', 'c'])
    expect(sortDeals(deals, 'updated').map(d => d.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(sortDeals(deals, 'default').map(d => d.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('saved views', () => {
  it('cleans stored views: drops junk, unknown values and extra keys', () => {
    const out = cleanViews([
      { id: 'v1', name: ' Tiff overdue ', filters: { owner: 'Tiffany', due: 'overdue', attention: 'nonsense', sort: 'evil', extra: 1 } },
      { id: 2, name: 'bad id' }, null, { id: 'v3', name: '   ' },
    ])
    expect(out).toEqual([{ id: 'v1', name: 'Tiff overdue', filters: { ...DEFAULT_FILTERS, owner: 'Tiffany', due: 'overdue' } }])
    expect(cleanViews('x')).toEqual([])
  })
  it('upserts by name, case-insensitive, keeping the id', () => {
    let v = upsertView([], 'My actions', { owner: 'Tiffany' }, () => 'id1')
    v = upsertView(v, 'my ACTIONS', { owner: 'Tiffany', due: 'week' }, () => 'id2')
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ id: 'id1', name: 'my ACTIONS', filters: { due: 'week' } })
    expect(() => upsertView(v, '  ', {})).toThrow(/name/)
  })
  it('caps the number of views', () => {
    let v = []
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) v = upsertView(v, `v${i}`, {}, () => `id${i}`)
    expect(() => upsertView(v, 'one more', {})).toThrow(/up to/)
  })
  it('owner options and isFiltered', () => {
    expect(ownerOptions(deals)).toEqual(['Justin', 'Tiffany'])
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false)
    expect(isFiltered({ ...DEFAULT_FILTERS, sort: 'due' })).toBe(true)
  })
})
