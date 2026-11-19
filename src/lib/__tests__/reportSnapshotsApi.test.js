import { describe, it, expect, vi, beforeEach } from 'vitest'

// Recording Supabase stand-in (same shape as arrearsNotesApi.test.js).
const mock = vi.hoisted(() => {
  const m = { calls: [], handler: () => ({ data: null, error: null }) }
  m.builder = (table) => {
    const st = { table, op: 'select', filters: [], payload: null }
    const q = {}
    q.select = () => q
    q.insert = (p) => { st.op = 'insert'; st.payload = p; return q }
    q.update = (p) => { st.op = 'update'; st.payload = p; return q }
    q.delete = () => { st.op = 'delete'; return q }
    for (const f of ['eq', 'is', 'in', 'order', 'range']) q[f] = (...a) => { st.filters.push([f, ...a]); return q }
    q.single = () => q
    q.then = (res, rej) => { m.calls.push(st); return Promise.resolve(m.handler(st)).then(res, rej) }
    return q
  }
  return m
})
vi.mock('../supabase', () => ({ supabase: { from: (t) => mock.builder(t) } }))

import { fetchReportSnapshots, addReportSnapshot } from '../api/reportSnapshots'
import * as api from '../api'

beforeEach(() => { mock.calls.length = 0; mock.handler = () => ({ data: [], error: null }) })

const base = { kind: 'agent_rent_report', agent_id: 'ag1', company_id: 'c1', as_of: '2026-10-31', period: '2026-10', formula_version: 'rent-engine-2026-11-19', summary: { owed: 500 }, lines: [] }

describe('fetchReportSnapshots', () => {
  it('is re-exported from the api index', () => {
    expect(api.fetchReportSnapshots).toBe(fetchReportSnapshots)
    expect(api.addReportSnapshot).toBe(addReportSnapshot)
  })

  it('filters by kind, agent and company, newest first, paged', async () => {
    await fetchReportSnapshots({ kind: 'agent_rent_report', agentId: 'ag1', companyId: 'c1' })
    const [c] = mock.calls
    expect(c.table).toBe('report_snapshots')
    expect(c.op).toBe('select')
    expect(c.filters).toEqual(expect.arrayContaining([['eq', 'kind', 'agent_rent_report'], ['eq', 'agent_id', 'ag1'], ['eq', 'company_id', 'c1'], ['order', 'created_at', { ascending: false }]]))
    expect(c.filters.some(f => f[0] === 'range')).toBe(true)
  })

  it('companyId null means no company; undefined means any', async () => {
    await fetchReportSnapshots({ kind: 'agent_rent_report', companyId: null })
    await fetchReportSnapshots({})
    expect(mock.calls[0].filters).toContainEqual(['is', 'company_id', null])
    expect(mock.calls[1].filters.filter(f => f[0] === 'eq' || f[0] === 'is')).toEqual([])
  })
})

describe('addReportSnapshot', () => {
  it('inserts known fields only and leaves created_by to the database', async () => {
    mock.handler = (st) => ({ data: { id: 's1', ...st.payload }, error: null })
    const row = await addReportSnapshot({ ...base, created_by: 'someone-else', id: 'x', created_at: 'y', note: '  ' })
    const [c] = mock.calls
    expect(c.op).toBe('insert')
    expect(c.payload).toEqual({ ...base, note: null })
    expect('created_by' in c.payload).toBe(false)
    expect(row.id).toBe('s1')
    expect(mock.calls.some(x => x.op === 'update' || x.op === 'delete')).toBe(false)
  })

  it('a restatement needs a note', async () => {
    await expect(addReportSnapshot({ ...base, supersedes: 's0' })).rejects.toThrow(/note/)
    await expect(addReportSnapshot({ ...base, supersedes: 's0', note: ' ' })).rejects.toThrow(/note/)
    mock.handler = (st) => ({ data: st.payload, error: null })
    const r = await addReportSnapshot({ ...base, supersedes: 's0', note: ' Late receipt posted ' })
    expect(r).toMatchObject({ supersedes: 's0', note: 'Late receipt posted' })
  })

  it('validates kind, as-of, formula version, summary and period', async () => {
    await expect(addReportSnapshot({ ...base, kind: 'other' })).rejects.toThrow(/kind/)
    await expect(addReportSnapshot({ ...base, as_of: null })).rejects.toThrow(/as-of/)
    await expect(addReportSnapshot({ ...base, formula_version: '' })).rejects.toThrow(/formula/)
    await expect(addReportSnapshot({ ...base, summary: null })).rejects.toThrow(/summary/)
    await expect(addReportSnapshot({ ...base, period: '2026-1' })).rejects.toThrow(/YYYY-MM/)
    await expect(addReportSnapshot({ ...base, supersedes: 's0', note: 'x'.repeat(1001) })).rejects.toThrow(/too long/)
    expect(mock.calls).toHaveLength(0)
  })

  it('throws the database error', async () => {
    mock.handler = () => ({ data: null, error: new Error('new row violates row-level security policy') })
    await expect(addReportSnapshot(base)).rejects.toThrow(/row-level security/)
  })
})
