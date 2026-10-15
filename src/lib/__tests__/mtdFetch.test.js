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

import { fetchMtdRawForPeriod } from '../api/mtd'

describe('fetchMtdRawForPeriod', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(results)) delete results[k] })

  it('takes all the user\'s properties by default (company_id is a portfolio group, not legal ownership)', async () => {
    results.properties = [{ data: [{ id: 'p1', mortgage_amount: 0, mortgage_rate: 0 }], error: null }]
    await fetchMtdRawForPeriod({ periodFrom: '2026-07-06', periodTo: '2026-10-05' })
    const props = calls.filter(c => c.table === 'properties')
    expect(props).toContainEqual({ table: 'properties', m: 'eq', args: ['user_id', 'u1'] })
    expect(props).not.toContainEqual({ table: 'properties', m: 'is', args: ['company_id', null] })
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
