// Subscription tier gating helper.
//
// Two tiers as of May 2026:
//   - 'starter'  — £2/property. Core landlord features (everything most
//                  users had access to historically).
//   - 'investor' — £5/property. Adds AI Insights, Deals Pipeline,
//                  Remortgage broker alerts, future deal analyser.
//
// Single source of truth for "can this user see investor features?" —
// every UI component that gates on tier should call canUseInvestorFeatures
// rather than peeking at subscription.tier directly. Makes it trivial to
// add new tiers later (or to gate by feature flag instead).
//
// Platform admins always pass the gate (so we can demo / debug).
// Free-tier companies (is_free_tier=true) inherit Investor — Justin's
// manual grants are "everything unlocked" by design.
//
// `subs` is the array of subscription rows for the user's accessible
// companies (the same shape App.jsx loads into companySubs state).

import { subscriptionGrantsLive } from './subscriptionLive'

export const TIERS = {
  starter:  { key: 'starter',  label: 'Starter',  pricePerProp: 2,   color: '#888EA8' },
  investor: { key: 'investor', label: 'Investor', pricePerProp: 5,   color: '#C8A84B' },
}

// True if ANY of the user's accessible companies is on the investor
// tier OR if they're a platform admin OR if any company is on free tier.
// Coarse-grained on purpose — once a landlord pays Investor for their
// main portfolio, we don't lock other companies out of the features.
export function canUseInvestorFeatures({ subs = [], companies = [], isPlatformAdmin = false }) {
  if (isPlatformAdmin) return true
  // free_tier companies get everything (admin manually granted)
  if (companies.some(c => c?.is_free_tier)) return true
  // Same rule as highestTier(): only a subscription that still grants
  // liveness counts — a bare 'trialing' placeholder or a cancelled /
  // incomplete Investor row does not unlock Investor features.
  if (subs.some(s => s?.tier === 'investor' && subscriptionGrantsLive(s))) return true
  return false
}

// Get the highest tier for display purposes (header chip etc). Only a
// subscription that still grants liveness counts — a cancelled or
// never-completed Investor subscription is not Investor.
export function highestTier({ subs = [], companies = [], isPlatformAdmin = false }) {
  if (isPlatformAdmin) return TIERS.investor
  if (companies.some(c => c?.is_free_tier)) return TIERS.investor
  if (subs.some(s => s?.tier === 'investor' && subscriptionGrantsLive(s))) return TIERS.investor
  return TIERS.starter
}

// Tier the company's next charge uses. A live Stripe subscription keeps its
// own tier (payment changes go through the Stripe portal); otherwise the
// trial gate / "Add payment method" opens checkout with no tier, which
// create-checkout bills as Starter.
export function billingTierFor(sub) {
  return sub?.tier === 'investor' && subscriptionGrantsLive(sub) ? 'investor' : 'starter'
}

// Billable properties for a company from a loaded properties list: anything
// not in Trash (archived and sold still count) — mirrors
// countBillableProperties in supabase-functions/_shared/billing.ts.
export function billablePropertyCount(properties = [], companyId) {
  return properties.filter(p => p?.company_id === companyId && !p.deleted_at).length
}

// Volume floor: under-5-property companies pay a £10 monthly minimum
// (matches Hammock entry, kills the "I only have 2 BTLs" objection).
// Per-property pricing kicks in from property 6 onwards.
export function calcMonthlyPrice(propertyCount, tier = 'starter') {
  const pricePerProp = TIERS[tier]?.pricePerProp ?? 2
  const FLOOR = 10
  const calc = (propertyCount || 0) * pricePerProp
  return Math.max(FLOOR, calc)
}
