import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal PostgREST-style mock: records calls, serves rows filtered by .in().
const calls = []
let ROWS = []
function chain(table) {
  const q = { table, ops: [] }
  let inFilter = null
  let from = 0, to = 999
  for (const m of ['select', 'order', 'eq', 'is', 'update', 'insert', 'delete', 'single']) {
    q[m] = vi.fn((...args) => { q.ops.push([m, ...args]); return q })
  }
  q.in = vi.fn((col, ids) => { inFilter = { col, ids }; q.ops.push(['in', col, ids]); return q })
  q.range = vi.fn((a, b) => { from = a; to = b; return q })
  q.then = (res, rej) => {
    const rows = inFilter ? ROWS.filter(r => inFilter.ids.includes(r[inFilter.col])) : ROWS
    const single = q.ops.some(o => o[0] === 'single')
    return Promise.resolve({ data: single ? { id: 'new' } : rows.slice(from, to + 1), error: null }).then(res, rej)
  }
  calls.push(q)
  return q
}
vi.mock('../supabase', () => ({ supabase: { from: vi.fn(t => chain(t)) } }))

import { fetchCostLinesForDeals, upsertDealCostLine, fetchCompanyCashPositions } from '../api/deals'

beforeEach(() => { calls.length = 0; ROWS = [] })

describe('deal finance API', () => {
  it('fetches lines for many deals in chunks and groups them by deal', async () => {
    const ids = Array.from({ length: 320 }, (_, i) => `d${i}`)
    ROWS = [{ deal_id: 'd0', amount: 1 }, { deal_id: 'd0', amount: 2 }, { deal_id: 'd319', amount: 3 }]
    const out = await fetchCostLinesForDeals([...ids, null, 'd0'])
    expect(out.d0).toHaveLength(2)
    expect(out.d319).toHaveLength(1)
    const inCalls = calls.filter(c => c.table === 'deal_cost_lines').map(c => c.ops.find(o => o[0] === 'in')[2].length)
    expect(inCalls).toEqual([150, 150, 20])
  })

  it('whitelists fields on insert and sets deal_id', async () => {
    await upsertDealCostLine('deal-1', { category: 'sdlt', amount: 100, state: 'quoted', due_date: '', created_by: 'x', deal_id: 'other' })
    const insert = calls[0].ops.find(o => o[0] === 'insert')[1]
    expect(insert).toEqual({ category: 'sdlt', amount: 100, state: 'quoted', due_date: null, deal_id: 'deal-1' })
  })

  it('updates by id without changing deal_id', async () => {
    await upsertDealCostLine('deal-1', { id: 'line-1', amount: 5, deal_id: 'other' })
    const update = calls[0].ops.find(o => o[0] === 'update')[1]
    expect(update.amount).toBe(5)
    expect(update).not.toHaveProperty('deal_id')
    expect(calls[0].ops).toContainEqual(['eq', 'id', 'line-1'])
  })

  it('returns no rows for no companies without querying', async () => {
    expect(await fetchCompanyCashPositions([])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
