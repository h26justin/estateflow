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

// Does an owned company need a subscription before it can be used? True
// when it is not free tier, has no live subscription, and has no in-app
// trial still running — trial_ends_at in the past, or NULL. NULL matters: a
// second company an owner creates gets no trial (supabase-migrations/
// 2026-11-15_25_company_trial_one_per_owner.sql), so company_is_live() is
// false and every write is refused; without this it looked like a normal
// company whose saves all failed, with no way to pay. This is the client
// mirror of NOT company_is_live() for the owner's own billing view.
export function companyNeedsSubscription(company, sub, now = new Date()) {
  if (!company || company.is_free_tier) return false
  if (subscriptionGrantsLive(sub, now)) return false
  const end = company.trial_ends_at ? new Date(company.trial_ends_at).getTime() : NaN
  return !(end > now.getTime())
}

// Status to show on the billing page. 'incomplete' means checkout was opened
// but never finished — to the user that is still "not paying yet", so it
// renders (and offers checkout) exactly like an unpaid trial while an in-app
// trial is running, and as 'needs_subscription' once there is no trial
// (ended, or none given) — the "subscribe to activate" state.
export function billingDisplayStatus(company, sub, now = new Date()) {
  if (company?.is_free_tier) return 'free_tier'
  const s = sub?.status
  const notPaying = !s || s === 'incomplete' || s === 'incomplete_expired' || (s === 'trialing' && !subscriptionGrantsLive(sub, now))
  if (notPaying) return companyNeedsSubscription(company, sub, now) ? 'needs_subscription' : 'trialing'
  return s
}
