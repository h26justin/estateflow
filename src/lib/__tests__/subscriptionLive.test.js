import { describe, it, expect } from 'vitest'
import { subscriptionGrantsLive, billingDisplayStatus } from '../subscriptionLive'

const NOW = new Date('2026-10-15T12:00:00Z')

describe('subscriptionGrantsLive (mirror of company_is_live)', () => {
  it('counts active and past_due', () => {
    expect(subscriptionGrantsLive({ status: 'active' }, NOW)).toBe(true)
    expect(subscriptionGrantsLive({ status: 'past_due' }, NOW)).toBe(true)
  })

  it('does not count a bare trialing row written before any payment', () => {
    expect(subscriptionGrantsLive({ status: 'trialing', stripe_customer_id: 'cus_x' }, NOW)).toBe(false)
    expect(subscriptionGrantsLive({ status: 'trialing', current_period_end: '2026-10-01T00:00:00Z' }, NOW)).toBe(false)
  })

  it('counts a real Stripe trial', () => {
    expect(subscriptionGrantsLive({ status: 'trialing', stripe_subscription_id: 'sub_x' }, NOW)).toBe(true)
    expect(subscriptionGrantsLive({ status: 'trialing', current_period_end: '2026-10-20T00:00:00Z' }, NOW)).toBe(true)
  })

  it('never counts incomplete, canceled or no row', () => {
    expect(subscriptionGrantsLive({ status: 'incomplete', stripe_customer_id: 'cus_x' }, NOW)).toBe(false)
    expect(subscriptionGrantsLive({ status: 'canceled' }, NOW)).toBe(false)
    expect(subscriptionGrantsLive(null, NOW)).toBe(false)
  })
})

describe('billingDisplayStatus', () => {
  it('shows an unfinished checkout as an unpaid trial so checkout stays on offer', () => {
    expect(billingDisplayStatus({}, { status: 'incomplete' })).toBe('trialing')
    expect(billingDisplayStatus({}, null)).toBe('trialing')
    expect(billingDisplayStatus({}, { status: 'active' })).toBe('active')
    expect(billingDisplayStatus({ is_free_tier: true }, { status: 'incomplete' })).toBe('free_tier')
  })
})
