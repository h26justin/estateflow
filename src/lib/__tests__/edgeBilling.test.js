import { billedQuantity, floorQuantity, countBillableProperties } from '../../../supabase-functions/_shared/billing.ts'
import { calcMonthlyPrice, TIERS } from '../tierGating'

describe('edge billing rules', () => {
  it('floor quantity makes up the £10 minimum per tier', () => {
    expect(floorQuantity('starter')).toBe(5)
    expect(floorQuantity('investor')).toBe(2)
    expect(floorQuantity(undefined)).toBe(5)
  })

  it('matches calcMonthlyPrice for new subscriptions', () => {
    for (const tier of ['starter', 'investor']) {
      for (const n of [0, 1, 2, 4, 5, 6, 23]) {
        expect(billedQuantity(n, floorQuantity(tier)) * TIERS[tier].pricePerProp).toBe(Math.max(calcMonthlyPrice(n, tier), TIERS[tier].pricePerProp))
      }
    }
  })

  it('legacy subscriptions (min 1) follow the property count', () => {
    expect(billedQuantity(3, 1)).toBe(3)
    expect(billedQuantity(0, 1)).toBe(1)
    expect(billedQuantity(23, 1)).toBe(23)
  })

  it('countBillableProperties excludes Trash and returns null on error', async () => {
    const calls = []
    const q = (result) => ({
      from: (t) => { calls.push(['from', t]); return chain },
    })
    let result = { count: 7, error: null }
    const chain = {
      select: () => chain,
      eq: (c, v) => { calls.push(['eq', c, v]); return chain },
      is: (c, v) => { calls.push(['is', c, v]); return Promise.resolve(result) },
    }
    expect(await countBillableProperties(q(), 'co1')).toBe(7)
    expect(calls).toContainEqual(['is', 'deleted_at', null])
    result = { count: null, error: { message: 'x' } }
    expect(await countBillableProperties(q(), 'co1')).toBeNull()
  })
})
