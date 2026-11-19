import { describe, it, expect, vi, beforeEach } from 'vitest'

// Recording Supabase stand-in (same shape as tenanciesApi.test.js).
const mock = vi.hoisted(() => {
  const m = { calls: [], handler: () => ({ data: null, error: null }) }
  m.builder = (table) => {
    const st = { table, op: 'select', filters: [], payload: null }
    const q = {}
    q.select = () => q
    q.insert = (p) => { st.op = 'insert'; st.payload = p; return q }
    q.update = (p) => { st.op = 'update'; st.payload = p; return q }
    q.delete = () => { st.op = 'delete'; return q }
    for (const f of ['eq', 'in', 'order', 'range']) q[f] = (...a) => { st.filters.push([f, ...a]); return q }
    q.single = () => q
    q.then = (res, rej) => { m.calls.push(st); return Promise.resolve(m.handler(st)).then(res, rej) }
    return q
  }
  return m
})
vi.mock('../supabase', () => ({ supabase: { from: (t) => mock.builder(t) } }))

import { fetchArrearsNotes, addArrearsNote } from '../api/arrearsNotes'

beforeEach(() => { mock.calls.length = 0; mock.handler = () => ({ data: null, error: null }) })

describe('fetchArrearsNotes', () => {
  it('does not query for no properties', async () => {
    expect(await fetchArrearsNotes([])).toEqual([])
    expect(mock.calls).toHaveLength(0)
  })

  it('batches property ids with .in() and returns newest first', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`)
    mock.handler = (st) => {
      const part = st.filters.find(f => f[0] === 'in')[2]
      return { data: [{ id: `n-${part[0]}`, property_id: part[0], created_at: part[0] === 'p0' ? '2026-10-01' : '2026-11-01' }], error: null }
    }
    const rows = await fetchArrearsNotes(ids)
    const ins = mock.calls.map(c => c.filters.find(f => f[0] === 'in'))
    expect(ins.map(f => f[2].length)).toEqual([100, 50])
    expect(ins.every(f => f[1] === 'property_id')).toBe(true)
    expect(mock.calls.every(c => c.table === 'arrears_notes' && c.op === 'select')).toBe(true)
    expect(rows.map(r => r.id)).toEqual(['n-p100', 'n-p0'])
  })
})

describe('addArrearsNote', () => {
  it('inserts only known fields, blanks to null, and leaves author to the database', async () => {
    mock.handler = (st) => ({ data: { id: 'n1', ...st.payload }, error: null })
    await addArrearsNote({ property_id: 'p1', period: '2026-11', reason: '  Lost job ', response: '', author: 'someone-else', id: 'x', created_at: 'y', supersedes: 'n0', status: '' })
    const [c] = mock.calls
    expect(c.op).toBe('insert')
    expect(c.payload).toEqual({ property_id: 'p1', period: '2026-11', reason: 'Lost job', response: null, supersedes: 'n0' })
    expect(mock.calls.some(x => x.op === 'update' || x.op === 'delete')).toBe(false)
  })

  it('needs a property', async () => {
    await expect(addArrearsNote({ reason: 'x' })).rejects.toThrow(/property/)
  })
})
