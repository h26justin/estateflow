import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every query-builder call on supabase.from(table) and resolves each
// chain with the next queued result for that table.
const calls = []
const results = {}
function chain(table) {
  const q = {}
  for (const m of ['select', 'eq', 'is', 'in', 'or', 'gte', 'lte']) {
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

  it('takes all the user\'s properties by default (company_id is a portfolio group, not legal ownership)', async () => {
    results.properties = [{ data: [{ id: 'p1', mortgage_amount: 0, mortgage_rate: 0 }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    const props = calls.filter(c => c.table === 'properties')
    expect(props).toContainEqual({ table: 'properties', m: 'eq', args: ['user_id', 'u1'] })
    expect(props).not.toContainEqual({ table: 'properties', m: 'is', args: ['company_id', null] })
    // No company on any property → no companies lookup needed.
    expect(calls.some(c => c.table === 'companies')).toBe(false)
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
    expect(calls).toContainEqual({ table: 'companies', m: 'in', args: ['id', ['ltd', 'pers', 'unset']] })
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
    results.companies = [{ data: null, error: { code: '42703', message: 'column companies.legal_owner does not exist' } }]
    const out = await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
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
    results.companies = [{ data: null, error: { code: 'PGRST204', message: "Could not find the 'legal_owner' column of 'companies' in the schema cache" } }]
    const scope = await fetchMtdPropertyScope()
    expect(scope.legalOwnerSupported).toBe(false)
    expect(scope.included.map(p => p.id)).toEqual(['p1'])
  })

  it('throws when the properties query fails', async () => {
    results.properties = [{ data: null, error: { code: '500', message: 'boom' } }]
    await expect(fetchMtdPropertyScope()).rejects.toMatchObject({ message: 'boom' })
  })
})
