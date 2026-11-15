import { describe, it, expect } from 'vitest'
import { highestTier, canUseInvestorFeatures, billingTierFor, billablePropertyCount, calcMonthlyPrice, TIERS } from '../tierGating'

describe('highestTier', () => {
  it('counts a live Investor subscription', () => {
    expect(highestTier({ subs: [{ tier: 'investor', status: 'active' }] })).toBe(TIERS.investor)
    expect(highestTier({ subs: [{ tier: 'investor', status: 'past_due' }] })).toBe(TIERS.investor)
    expect(highestTier({ subs: [{ tier: 'investor', status: 'trialing', stripe_subscription_id: 'sub_1' }] })).toBe(TIERS.investor)
  })

  it('ignores an Investor subscription that no longer grants liveness', () => {
    expect(highestTier({ subs: [{ tier: 'investor', status: 'canceled' }] })).toBe(TIERS.starter)
    expect(highestTier({ subs: [{ tier: 'investor', status: 'incomplete', stripe_customer_id: 'cus_1' }] })).toBe(TIERS.starter)
    expect(highestTier({ subs: [{ tier: 'investor', status: 'trialing' }] })).toBe(TIERS.starter)
  })

  it('platform admins and free-tier companies are Investor', () => {
    expect(highestTier({ isPlatformAdmin: true })).toBe(TIERS.investor)
    expect(highestTier({ companies: [{ is_free_tier: true }] })).toBe(TIERS.investor)
  })
})

describe('billingTierFor', () => {
  it('keeps the tier of a live subscription', () => {
    expect(billingTierFor({ tier: 'investor', status: 'past_due', stripe_subscription_id: 'sub_1' })).toBe('investor')
    expect(billingTierFor({ tier: 'starter', status: 'active' })).toBe('starter')
  })

  it('is Starter when checkout will open with no tier', () => {
    expect(billingTierFor(undefined)).toBe('starter')
    expect(billingTierFor({ tier: 'investor', status: 'canceled' })).toBe('starter')
  })
})

describe('billablePropertyCount', () => {
  const props = [
    { company_id: 'c1' },
    { company_id: 'c1', archived_at: '2026-01-01' },
    { company_id: 'c1', deleted_at: '2026-02-01' },
    { company_id: 'c2' },
  ]
  it('counts the company’s properties outside Trash, archived included', () => {
    expect(billablePropertyCount(props, 'c1')).toBe(2)
    expect(billablePropertyCount(props, 'c2')).toBe(1)
    expect(billablePropertyCount(props, 'c3')).toBe(0)
    expect(billablePropertyCount(undefined, 'c1')).toBe(0)
  })
})

describe('displayed price matches what checkout charges', () => {
  it('2 properties on Starter show the £10 minimum, not £4', () => {
    expect(calcMonthlyPrice(2, 'starter')).toBe(10)
    expect(calcMonthlyPrice(billablePropertyCount([{ company_id: 'c1' }, { company_id: 'c1' }], 'c1'), billingTierFor(undefined))).toBe(10)
  })

  it('applies the per-property rate above the floor', () => {
    expect(calcMonthlyPrice(6, 'starter')).toBe(12)
    expect(calcMonthlyPrice(3, 'investor')).toBe(15)
    expect(calcMonthlyPrice(1, 'investor')).toBe(10)
  })
})

describe('canUseInvestorFeatures — same liveness rule as highestTier', () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString()
  const past = new Date(Date.now() - 86400000).toISOString()
  it('a cancelled or not-live Investor row does not unlock Investor features', () => {
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'canceled' }] })).toBe(false)
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'incomplete' }] })).toBe(false)
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'trialing' }] })).toBe(false)
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'trialing', current_period_end: past }] })).toBe(false)
  })
  it('a live Investor trial or subscription does', () => {
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'trialing', stripe_subscription_id: 'sub_x' }] })).toBe(true)
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'trialing', current_period_end: future }] })).toBe(true)
    expect(canUseInvestorFeatures({ subs: [{ tier: 'investor', status: 'active' }] })).toBe(true)
    expect(canUseInvestorFeatures({ subs: [{ tier: 'starter', status: 'active' }] })).toBe(false)
  })
  it('agrees with highestTier', () => {
    for (const s of [{ tier: 'investor', status: 'trialing' }, { tier: 'investor', status: 'past_due' }, { tier: 'investor', status: 'canceled' }]) {
      expect(canUseInvestorFeatures({ subs: [s] })).toBe(highestTier({ subs: [s] }) === TIERS.investor)
    }
  })
})
