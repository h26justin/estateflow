// Client mirror of the subscription half of public.company_is_live()
// (hardened in supabase-migrations/2026-10-15_billing_trialing_guard.sql).
//
// 'active' and 'past_due' (grace period) count as live. 'trialing' only
// counts when Stripe actually holds a subscription for it — a
// stripe_subscription_id, or a billing period that has not ended yet. A bare
// 'trialing' row (the old create-checkout placeholder, written before any
// payment) no longer grants access; in-app trials live on
// companies.trial_ends_at and are checked separately by the caller.
// 'incomplete' (customer created, checkout not finished) is never live.
export function subscriptionGrantsLive(sub, now = new Date()) {
  if (!sub) return false
  if (sub.status === 'active' || sub.status === 'past_due') return true
  if (sub.status !== 'trialing') return false
  if (sub.stripe_subscription_id) return true
  const end = sub.current_period_end ? new Date(sub.current_period_end).getTime() : 0
  return end > now.getTime()
}

// Status to show on the billing page. 'incomplete' means checkout was opened
// but never finished — to the user that is still "not paying yet", so it
// renders (and offers checkout) exactly like an unpaid trial.
export function billingDisplayStatus(company, sub) {
  if (company?.is_free_tier) return 'free_tier'
  const s = sub?.status
  if (!s || s === 'incomplete' || s === 'incomplete_expired') return 'trialing'
  return s
}
