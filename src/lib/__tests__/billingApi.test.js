import { describe, it, expect, beforeEach, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [], results: {} }))
vi.mock('../supabase', () => ({
  supabase: {
    from: (table) => {
      const call = { table, ops: [] }
      state.calls.push(call)
      const chain = {
        update: (v) => { call.ops.push(['update', v]); return chain },
        select: (...a) => { call.ops.push(['select', ...a]); return chain },
        eq: (c, v) => { call.ops.push(['eq', c, v]); return chain },
        is: (c, v) => { call.ops.push(['is', c, v]); return chain },
        then: (res, rej) => Promise.resolve(state.results[table] || { error: null }).then(res, rej),
      }
      return chain
    },
  },
}))

import { setCompanyFreeTier, fetchBillablePropertyCounts } from '../api/billing'

describe('setCompanyFreeTier', () => {
  beforeEach(() => { state.calls.length = 0; state.results = {} })

  it('never overwrites the status of a row backed by a Stripe subscription', async () => {
    await setCompanyFreeTier('co1', false, 'admin1')
    const sub = state.calls.find(c => c.table === 'subscriptions')
    expect(sub.ops).toContainEqual(['update', { status: 'trialing' }])
    expect(sub.ops).toContainEqual(['is', 'stripe_subscription_id', null])
  })

  it('throws when the subscription update fails', async () => {
    state.results.subscriptions = { error: { message: 'denied' } }
    await expect(setCompanyFreeTier('co1', true, 'admin1')).rejects.toEqual({ message: 'denied' })
  })
})

describe('fetchBillablePropertyCounts', () => {
  beforeEach(() => { state.calls.length = 0; state.results = {} })

  it('counts properties outside Trash per company', async () => {
    state.results.properties = { count: 2, error: null }
    expect(await fetchBillablePropertyCounts(['c1', 'c2'])).toEqual({ c1: 2, c2: 2 })
    const call = state.calls.find(c => c.table === 'properties')
    expect(call.ops).toContainEqual(['eq', 'company_id', 'c1'])
    expect(call.ops).toContainEqual(['is', 'deleted_at', null])
  })
})
