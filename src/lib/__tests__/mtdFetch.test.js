import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every query-builder call on supabase.from(table) and resolves each
// chain with the next queued result for that table.
const calls = []
const results = {}
function chain(table) {
  const q = {}
  for (const m of ['select', 'eq', 'is', 'in', 'or', 'gte', 'lte', 'order', 'range']) {
    q[m] = vi.fn((...args) => { calls.push({ table, m, args }); return q })
  }
  const next = () => (results[table] || []).shift() || { data: [], error: null }
  q.then = (res, rej) => Promise.resolve(next()).then(res, rej)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(table => chain(table)),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}))

import { fetchMtdRawForPeriod, fetchMtdPropertyScope } from '../api/mtd'

describe('fetchMtdRawForPeriod', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(results)) delete results[k] })

  it('with no companies owned, takes the no-company properties the user added', async () => {
    results.properties = [{ data: [{ id: 'p1', mortgage_amount: 0, mortgage_rate: 0 }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(calls).toContainEqual({ table: 'companies', m: 'eq', args: ['owner_id', 'u1'] })
    const props = calls.filter(c => c.table === 'properties')
    expect(props).toContainEqual({ table: 'properties', m: 'eq', args: ['user_id', 'u1'] })
    expect(props).toContainEqual({ table: 'properties', m: 'is', args: ['company_id', null] })
    expect(rentPropIds()).toEqual(['p1'])
  })

  it('scopes by the companies the user owns, not by who added each property', async () => {
    results.companies = [{ data: [{ id: 'co1', name: 'My Group', legal_owner: 'personal' }], error: null }]
    // p2 was added to my company by a collaborator (its user_id is theirs).
    results.properties = [{ data: [{ id: 'p1', company_id: 'co1' }, { id: 'p2', company_id: 'co1' }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    const props = calls.filter(c => c.table === 'properties')
    expect(props).toContainEqual({ table: 'properties', m: 'or', args: ['company_id.in.(co1),and(company_id.is.null,user_id.eq.u1)'] })
    expect(props.some(c => c.m === 'eq' && c.args[0] === 'user_id')).toBe(false)
    expect(rentPropIds()).toEqual(['p1', 'p2'])
  })

  const rentPropIds = () => calls.find(c => c.table === 'rent_payments' && c.m === 'in' && c.args[0] === 'property_id')?.args[1]

  it('leaves out properties whose company is a limited company; personal, unset and no-company stay in', async () => {
    results.properties = [{ data: [
      { id: 'p1', company_id: 'ltd' },
      { id: 'p2', company_id: 'pers' },
      { id: 'p3', company_id: 'unset' },
      { id: 'p4', company_id: null },
    ], error: null }]
    results.companies = [{ data: [
      { id: 'ltd', name: 'Ltd Co', legal_owner: 'limited_company' },
      { id: 'pers', name: 'Personal Group', legal_owner: 'personal' },
      { id: 'unset', name: 'Unset Group', legal_owner: null },
    ], error: null }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(calls).toContainEqual({ table: 'companies', m: 'select', args: ['id, name, legal_owner'] })
    expect(calls).toContainEqual({ table: 'companies', m: 'eq', args: ['owner_id', 'u1'] })
    expect(rentPropIds()).toEqual(['p2', 'p3', 'p4'])
    expect(out.scope.excluded.map(p => p.id)).toEqual(['p1'])
    expect(out.scope.excludedCompanies).toEqual([{ id: 'ltd', name: 'Ltd Co', count: 1 }])
    expect(out.scope.unsetCompanies).toEqual([{ id: 'unset', name: 'Unset Group', count: 1 }])
  })

  it('does not estimate mortgage interest for a limited-company property', async () => {
    results.properties = [{ data: [
      { id: 'p1', company_id: 'ltd', mortgage_amount: 100000, mortgage_rate: 0.05 },
      { id: 'p2', company_id: null, mortgage_amount: 100000, mortgage_rate: 0.05 },
    ], error: null }]
    results.companies = [{ data: [{ id: 'ltd', name: 'Ltd Co', legal_owner: 'limited_company' }], error: null }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(out.mortgageInterest).toBe(Math.round(5000 * 92 / 365 * 100) / 100)
  })

  it('returns nothing when every property is held by a limited company', async () => {
    results.properties = [{ data: [{ id: 'p1', company_id: 'ltd' }], error: null }]
    results.companies = [{ data: [{ id: 'ltd', name: 'Ltd Co', legal_owner: 'limited_company' }], error: null }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(out.payments).toEqual([])
    expect(out.expenses).toEqual([])
    expect(calls.some(c => c.table === 'rent_payments')).toBe(false)
  })

  it('falls back to including every property when companies.legal_owner does not exist yet', async () => {
    results.properties = [{ data: [{ id: 'p1', company_id: 'ltd' }, { id: 'p2', company_id: null }], error: null }]
    results.companies = [
      { data: null, error: { code: '42703', message: 'column companies.legal_owner does not exist' } },
      { data: [{ id: 'ltd', name: 'Ltd Co' }], error: null },
    ]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(calls).toContainEqual({ table: 'companies', m: 'select', args: ['id, name'] })
    expect(rentPropIds()).toEqual(['p1', 'p2'])
    expect(out.scope.legalOwnerSupported).toBe(false)
    expect(out.scope.excluded).toEqual([])
    expect(out.scope.unsetCompanies).toEqual([])
  })

  it('still throws on other companies lookup errors', async () => {
    results.properties = [{ data: [{ id: 'p1', company_id: 'c1' }], error: null }]
    results.companies = [{ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }]
    await expect(fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' }))
      .rejects.toMatchObject({ code: '57014' })
  })

  it('an explicit propertyIds selection is used as given (no legal-owner filter)', async () => {
    results.properties = [{ data: [{ id: 'p1' }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05', propertyIds: ['p1'] })
    expect(calls.some(c => c.table === 'companies')).toBe(false)
    expect(calls.some(c => c.table === 'properties' && c.m === 'eq')).toBe(false)
    expect(rentPropIds()).toEqual(['p1'])
  })

  it('fetches paid, partial and late rent rows, not only paid', async () => {
    results.properties = [{ data: [{ id: 'p1' }], error: null }]
    results.rent_payments = [{ data: [
      { id: 'r1', property_id: 'p1', amount: 1000, status: 'late', period_start: '2026-08-01' },
    ], error: null }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    const rp = calls.filter(c => c.table === 'rent_payments')
    expect(rp).toContainEqual({ table: 'rent_payments', m: 'in', args: ['status', ['paid', 'partial', 'late']] })
    expect(rp.some(c => c.m === 'eq' && c.args[0] === 'status')).toBe(false)
    expect(out.payments).toHaveLength(1)
  })

  it('does not estimate interest for a property with recorded mortgage interest', async () => {
    results.properties = [{ data: [
      { id: 'p1', mortgage_amount: 100000, mortgage_rate: 0.05 },
      { id: 'p2', mortgage_amount: 100000, mortgage_rate: 0.05 },
    ], error: null }]
    results.property_expenses = [{ data: [
      { id: 'e1', property_id: 'p1', amount: 1200, date: '2026-08-01', category: 'mortgage_interest' },
    ], error: null }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(out.mortgageInterest).toBe(Math.round(5000 * 92 / 365 * 100) / 100)
  })

  it('bounds legacy NULL-period rows to the months in the window', async () => {
    results.properties = [{ data: [{ id: 'p1' }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-10-06', periodTo: '2027-01-05' })
    const or = calls.find(c => c.table === 'rent_payments' && c.m === 'or').args[0]
    expect(or).toBe('and(period_start.gte.2026-10-06,period_start.lte.2027-01-05),'
      + 'and(period_start.is.null,year.eq.2026,month.gte.10,month.lte.12),'
      + 'and(period_start.is.null,year.eq.2027,month.gte.1,month.lte.1)')
    expect(or).not.toMatch(/,period_start\.is\.null(,|$)/)
  })

  it('pages every query with a stable order', async () => {
    results.properties = [{ data: [{ id: 'p1' }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    for (const table of ['properties', 'rent_payments', 'property_expenses', 'rent_receipts']) {
      expect(calls).toContainEqual({ table, m: 'order', args: ['id', { ascending: true }] })
      expect(calls).toContainEqual({ table, m: 'range', args: [0, 999] })
    }
  })

  it('loads receipts received in the window, and each row\'s allocations', async () => {
    results.properties = [{ data: [{ id: 'p1' }], error: null }]
    results.rent_receipts = [{ data: [{ id: 'r1', received_date: '2026-09-03', rent_allocations: [] }], error: null }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    expect(calls).toContainEqual({ table: 'rent_receipts', m: 'gte', args: ['received_date', '2026-07-06'] })
    expect(calls).toContainEqual({ table: 'rent_receipts', m: 'lte', args: ['received_date', '2026-10-05'] })
    const sel = calls.find(c => c.table === 'rent_payments' && c.m === 'select').args[0]
    expect(sel).toMatch(/rent_allocations\(/)
    expect(out.receipts).toHaveLength(1)
  })
})

describe('fetchMtdPropertyScope', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(results)) delete results[k] })

  it('reports excluded and not-yet-set companies for the MTD page note', async () => {
    results.properties = [{ data: [
      { id: 'p1', company_id: 'ltd' }, { id: 'p2', company_id: 'ltd' }, { id: 'p3', company_id: 'unset' },
    ], error: null }]
    results.companies = [{ data: [
      { id: 'ltd', name: 'Ltd Co', legal_owner: 'limited_company' },
      { id: 'unset', name: 'Unset Group', legal_owner: null },
    ], error: null }]
    const scope = await fetchMtdPropertyScope()
    expect(scope.legalOwnerSupported).toBe(true)
    expect(scope.included.map(p => p.id)).toEqual(['p3'])
    expect(scope.excludedCompanies).toEqual([{ id: 'ltd', name: 'Ltd Co', count: 2 }])
    expect(scope.unsetCompanies).toEqual([{ id: 'unset', name: 'Unset Group', count: 1 }])
  })

  it('treats a PostgREST schema-cache miss on legal_owner as column-missing too', async () => {
    results.properties = [{ data: [{ id: 'p1', company_id: 'ltd' }], error: null }]
    results.companies = [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'legal_owner' column of 'companies' in the schema cache" } },
      { data: [{ id: 'ltd', name: 'Ltd Co' }], error: null },
    ]
    const scope = await fetchMtdPropertyScope()
    expect(scope.legalOwnerSupported).toBe(false)
    expect(scope.included.map(p => p.id)).toEqual(['p1'])
  })

  it('throws when the properties query fails', async () => {
    results.properties = [{ data: null, error: { code: '500', message: 'boom' } }]
    await expect(fetchMtdPropertyScope()).rejects.toMatchObject({ message: 'boom' })
  })
})
