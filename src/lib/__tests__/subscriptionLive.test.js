import { describe, it, expect } from 'vitest'
import { subscriptionGrantsLive, billingDisplayStatus, companyNeedsSubscription } from '../subscriptionLive'

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
  const NOW = new Date('2026-11-15T12:00:00Z')
  const inTrial = { trial_ends_at: '2026-11-30T00:00:00Z' }
  it('shows an unfinished checkout as an unpaid trial while the in-app trial runs, so checkout stays on offer', () => {
    expect(billingDisplayStatus(inTrial, { status: 'incomplete' }, NOW)).toBe('trialing')
    expect(billingDisplayStatus(inTrial, null, NOW)).toBe('trialing')
    expect(billingDisplayStatus({}, { status: 'active' }, NOW)).toBe('active')
    expect(billingDisplayStatus({ is_free_tier: true }, { status: 'incomplete' }, NOW)).toBe('free_tier')
  })
  it('a company with no trial (NULL) or an ended one and no live subscription needs a subscription', () => {
    expect(billingDisplayStatus({ trial_ends_at: null }, null, NOW)).toBe('needs_subscription')
    expect(billingDisplayStatus({ trial_ends_at: '2026-11-01T00:00:00Z' }, { status: 'incomplete' }, NOW)).toBe('needs_subscription')
    // A bare trialing row (no Stripe subscription) is not live either.
    expect(billingDisplayStatus({}, { status: 'trialing', stripe_subscription_id: null }, NOW)).toBe('needs_subscription')
    expect(billingDisplayStatus({}, { status: 'trialing', stripe_subscription_id: 'sub_1' }, NOW)).toBe('trialing')
    expect(billingDisplayStatus({}, { status: 'canceled' }, NOW)).toBe('canceled')
  })
})

describe('companyNeedsSubscription', () => {
  const NOW = new Date('2026-11-15T12:00:00Z')
  it('mirrors NOT company_is_live for an owned company', () => {
    expect(companyNeedsSubscription({ trial_ends_at: null }, null, NOW)).toBe(true)
    expect(companyNeedsSubscription({ trial_ends_at: '2026-11-01T00:00:00Z' }, null, NOW)).toBe(true)
    expect(companyNeedsSubscription({ trial_ends_at: '2026-12-01T00:00:00Z' }, null, NOW)).toBe(false)
    expect(companyNeedsSubscription({ trial_ends_at: null, is_free_tier: true }, null, NOW)).toBe(false)
    expect(companyNeedsSubscription({ trial_ends_at: null }, { status: 'active' }, NOW)).toBe(false)
    expect(companyNeedsSubscription({ trial_ends_at: null }, { status: 'trialing', stripe_subscription_id: 'sub_1' }, NOW)).toBe(false)
  })
})
