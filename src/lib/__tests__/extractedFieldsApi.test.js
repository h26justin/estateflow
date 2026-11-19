import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal PostgREST-style mock: records each chained call.
const calls = []
let RESULT = { data: [], error: null }
function chain(table) {
  const q = { table, ops: [] }
  for (const m of ['select', 'order', 'eq', 'insert', 'update', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...args) => { q.ops.push([m, ...args]); return q })
  }
  q.then = (res, rej) => Promise.resolve(table === 'audit_log' ? { data: null, error: null } : RESULT).then(res, rej)
  calls.push(q)
  return q
}
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(t => chain(t)),
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } })) },
  },
}))

import { addExtractedFields, fetchExtractedFields, reviewExtractedField } from '../api/extractedFields'

const op = (q, name) => q.ops.find(o => o[0] === name)
const main = () => calls.find(c => c.table === 'extracted_fields')

beforeEach(() => { calls.length = 0; RESULT = { data: [], error: null } })

describe('addExtractedFields', () => {
  it('whitelists columns and never sends status or created_by', async () => {
    RESULT = { data: [{ id: 'x' }], error: null }
    const out = await addExtractedFields([{
      deal_id: 'd1', document_id: 'doc1', field: 'balance_due', value_number: 16739.004, page: 2,
      quote: 'Balance due £16,739.00', confidence: 0.95, status: 'approved', created_by: 'someone', category: null, label: 'x',
    }])
    expect(out).toEqual([{ id: 'x' }])
    const [row] = op(main(), 'insert')[1]
    expect(row).toEqual({ deal_id: 'd1', document_id: 'doc1', field: 'balance_due', value_number: 16739, page: 2, quote: 'Balance due £16,739.00', confidence: 0.95 })
  })

  it('clips long text and clamps confidence', async () => {
    await addExtractedFields([{ deal_id: 'd1', field: 'f'.repeat(100), quote: 'q'.repeat(2000), confidence: 1.7 }])
    const [row] = op(main(), 'insert')[1]
    expect(row.field).toHaveLength(80)
    expect(row.quote).toHaveLength(1000)
    expect(row.confidence).toBe(1)
  })

  it('does nothing for no rows and refuses rows without a deal or field', async () => {
    expect(await addExtractedFields([])).toEqual([])
    expect(calls).toHaveLength(0)
    await expect(addExtractedFields([{ field: 'total' }])).rejects.toThrow(/deal/)
    await expect(addExtractedFields([{ deal_id: 'd1' }])).rejects.toThrow(/field/)
    await expect(addExtractedFields([{ deal_id: 'd1', field: 'total', value_number: 'abc' }])).rejects.toThrow(/number/)
  })

  it('throws the database error', async () => {
    RESULT = { data: null, error: new Error('denied') }
    await expect(addExtractedFields([{ deal_id: 'd1', field: 'total' }])).rejects.toThrow('denied')
  })
})

describe('fetchExtractedFields', () => {
  it('filters by deal and, optionally, document', async () => {
    RESULT = { data: [{ id: 'a' }], error: null }
    expect(await fetchExtractedFields('d1', { documentId: 'doc1' })).toEqual([{ id: 'a' }])
    expect(main().ops).toContainEqual(['eq', 'deal_id', 'd1'])
    expect(main().ops).toContainEqual(['eq', 'document_id', 'doc1'])
  })

  it('returns nothing without a deal', async () => {
    expect(await fetchExtractedFields(null)).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('reviewExtractedField', () => {
  it('approves a pending row, setting reviewer, time, applied_to and the approved value', async () => {
    RESULT = { data: { id: 'e1', field: 'sdlt', deal_id: 'd1', status: 'approved' }, error: null }
    await reviewExtractedField('e1', { status: 'approved', applied_to: 'line-9', value_number: '2500' })
    const q = main()
    const patch = op(q, 'update')[1]
    expect(patch).toMatchObject({ status: 'approved', reviewed_by: 'user-1', applied_to: 'line-9', value_number: 2500 })
    expect(new Date(patch.reviewed_at).toString()).not.toBe('Invalid Date')
    expect(q.ops).toContainEqual(['eq', 'id', 'e1'])
    expect(q.ops).toContainEqual(['eq', 'status', 'pending'])
    // The decision is logged.
    expect(calls.some(c => c.table === 'audit_log')).toBe(true)
  })

  it('rejects without touching applied_to or the value', async () => {
    RESULT = { data: { id: 'e1', status: 'rejected' }, error: null }
    await reviewExtractedField('e1', { status: 'rejected', applied_to: 'ignored', value_number: 5 })
    const patch = op(main(), 'update')[1]
    expect(patch).not.toHaveProperty('applied_to')
    expect(patch).not.toHaveProperty('value_number')
    expect(patch.status).toBe('rejected')
  })

  it('refuses an unknown status and an already-reviewed row', async () => {
    await expect(reviewExtractedField('e1', { status: 'pending' })).rejects.toThrow(/approved or rejected/)
    RESULT = { data: null, error: null }
    await expect(reviewExtractedField('e1', { status: 'approved' })).rejects.toThrow(/already been reviewed/)
  })
})
