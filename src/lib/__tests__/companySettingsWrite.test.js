import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every call on supabase.from(table) and resolves each chain with the
// next queued result for that table.
const calls = []
const results = {}
function chain(table) {
  const q = {}
  for (const m of ['select', 'update', 'insert', 'upsert', 'eq']) {
    q[m] = vi.fn((...args) => { calls.push({ table, m, args }); return q })
  }
  const next = () => (results[table] || []).shift() || { data: null, error: null }
  q.single = vi.fn(async () => next())
  q.maybeSingle = vi.fn(async () => next())
  q.then = (res, rej) => Promise.resolve(next()).then(res, rej)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(table => chain(table)),
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'team-member' } } } })) },
  },
}))

import { upsertCompanySettings, saveReportSettings } from '../api/_monolith'

describe('company_settings writes', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(results)) delete results[k] })

  it('updates the existing row and never sends user_id or an upsert', async () => {
    results.company_settings = [{ data: [{ company_id: 'co1', logo_url: 'x' }], error: null }]
    const row = await upsertCompanySettings('co1', { logo_url: 'x' })
    expect(row.logo_url).toBe('x')
    expect(calls.find(c => c.m === 'update').args[0]).toEqual({ logo_url: 'x' })
    expect(calls.some(c => c.m === 'upsert' || c.m === 'insert')).toBe(false)
  })

  it('inserts a missing row owned by the company owner, not the caller', async () => {
    results.company_settings = [{ data: [], error: null }, { data: { company_id: 'co1' }, error: null }]
    results.companies = [{ data: { user_id: 'owner' }, error: null }]
    await upsertCompanySettings('co1', { year_type: 'calendar' })
    const ins = calls.find(c => c.m === 'insert').args[0]
    expect(ins).toEqual({ year_type: 'calendar', company_id: 'co1', user_id: 'owner' })
  })

  it('surfaces update errors', async () => {
    results.company_settings = [{ data: null, error: new Error('denied') }]
    await expect(saveReportSettings('co1', { report_color: '#000' })).rejects.toThrow('denied')
  })
})
