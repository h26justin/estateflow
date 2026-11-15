import { describe, it, expect, vi, beforeEach } from 'vitest'

// A recording Supabase stand-in: every awaited query is logged with its table,
// operation, payload and filters, and answered by `mock.handler`.
const mock = vi.hoisted(() => {
  const m = { calls: [], handler: () => ({ data: null, error: null }) }
  m.builder = (table) => {
    const st = { table, op: 'select', filters: [], payload: null }
    const q = {}
    q.select = () => q
    q.insert = (p) => { st.op = 'insert'; st.payload = p; return q }
    q.update = (p) => { st.op = 'update'; st.payload = p; return q }
    q.delete = () => { st.op = 'delete'; return q }
    for (const f of ['eq', 'in', 'is', 'gte', 'lte', 'order']) q[f] = (...a) => { st.filters.push([f, ...a]); return q }
    q.single = () => q
    q.maybeSingle = () => q
    q.then = (res, rej) => { m.calls.push(st); return Promise.resolve(m.handler(st)).then(res, rej) }
    return q
  }
  return m
})
vi.mock('../supabase', () => ({
  supabase: { from: (t) => mock.builder(t), auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } },
}))

import { reallocateReceipt, reverseReceipt, updateTenancy } from '../api/tenancies'

beforeEach(() => { mock.calls.length = 0; mock.handler = () => ({ data: null, error: null }) })

describe('reallocateReceipt (E15)', () => {
  const receipt = { id: 'r1', amount: 500, tenancy_id: 't1' }
  const next = [{ rent_payment_id: 'p2', amount: 500 }]

  it('inserts the new allocations before removing the old ones', async () => {
    mock.handler = (st) => {
      if (st.table === 'rent_allocations' && st.op === 'select') return { data: [{ id: 'a-old' }], error: null }
      if (st.table === 'rent_allocations' && st.op === 'insert') return { data: [{ id: 'a-new' }], error: null }
      if (st.table === 'rent_receipts') return { data: { id: 'r1' }, error: null }
      return { data: null, error: null }
    }
    await reallocateReceipt(receipt, next)
    const ops = mock.calls.filter(c => c.table === 'rent_allocations').map(c => c.op)
    expect(ops).toEqual(['select', 'insert', 'delete'])
    const del = mock.calls.find(c => c.op === 'delete')
    expect(del.filters).toContainEqual(['in', 'id', ['a-old']])
  })

  it('leaves the old allocations alone when the insert fails', async () => {
    mock.handler = (st) => {
      if (st.op === 'select') return { data: [{ id: 'a-old' }], error: null }
      if (st.op === 'insert') return { data: null, error: new Error('insert failed') }
      return { data: null, error: null }
    }
    await expect(reallocateReceipt(receipt, next)).rejects.toThrow('insert failed')
    expect(mock.calls.some(c => c.op === 'delete')).toBe(false)
  })

  it('removes the new set again if the old one cannot be deleted', async () => {
    let deletes = 0
    mock.handler = (st) => {
      if (st.op === 'select') return { data: [{ id: 'a-old' }], error: null }
      if (st.op === 'insert') return { data: [{ id: 'a-new' }], error: null }
      if (st.op === 'delete') return deletes++ === 0 ? { data: null, error: new Error('delete failed') } : { data: null, error: null }
      return { data: null, error: null }
    }
    await expect(reallocateReceipt(receipt, next)).rejects.toThrow('delete failed')
    const dels = mock.calls.filter(c => c.op === 'delete')
    expect(dels[1].filters).toContainEqual(['in', 'id', ['a-new']])
  })
})

describe('reverseReceipt (E6)', () => {
  it('carries the payment plan and tenancy into the reversal allocations', async () => {
    mock.handler = (st) => (st.table === 'rent_receipts' && st.op === 'insert' ? { data: { id: 'rev' }, error: null } : { data: null, error: null })
    const original = { id: 'r1', property_id: 'p1', tenancy_id: 't1', amount: 52, payer: 'tenant', received_date: '2026-04-01',
      rent_allocations: [{ rent_payment_id: null, tenancy_id: null, target: 'historic_arrears', amount: 52, payment_plan_id: 'pl1' }] }
    await reverseReceipt(original, { kind: 'bounce', received_date: '2026-04-03' })
    const ins = mock.calls.find(c => c.table === 'rent_allocations' && c.op === 'insert')
    expect(ins.payload).toEqual([expect.objectContaining({ amount: -52, payment_plan_id: 'pl1', tenancy_id: 't1', target: 'historic_arrears', receipt_id: 'rev' })])
  })
})

describe('updateTenancy', () => {
  it('a partial update never resets the opening arrears', async () => {
    mock.handler = () => ({ data: { id: 't1' }, error: null })
    await updateTenancy('t1', { tenancy_end: '2026-11-15', status: 'ended' })
    const up = mock.calls.find(c => c.op === 'update')
    expect('opening_arrears' in up.payload).toBe(false)
    await updateTenancy('t1', { opening_arrears: '' })
    expect(mock.calls.filter(c => c.op === 'update')[1].payload.opening_arrears).toBe(0)
  })
})
