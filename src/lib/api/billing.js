// Billing: subscriptions, Stripe checkout and free-tier grants.
import { supabase } from '../supabase'

// ── BILLING ───────────────────────────────────────────────────────────────────
export async function fetchSubscriptions(companyIds) {
  if (!companyIds.length) return []
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .in('company_id', companyIds)
  if (error) throw error
  return data || []
}

export async function createCheckoutSession(companyId, action = 'checkout', tier = 'starter') {
  const { data: { session } } = await supabase.auth.getSession()
  // Send our window.origin so the edge function redirects back to the
  // SAME hostname the user is on (apex vs www). Browser session is
  // per-origin, so a cross-host redirect drops the user at the login
  // screen — that's the bug we just fixed.
  const returnOrigin = typeof window !== 'undefined' ? window.location.origin : null
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ company_id: companyId, action, tier, return_origin: returnOrigin }),
  })
  const data = await res.json()
  if (!res.ok) {
    const e = new Error(data.error || 'Billing error')
    // Machine-readable error id (e.g. 'investor_unavailable') — lets the UI
    // branch on the failure kind without regex-matching the human message.
    e.code = data.code
    throw e
  }
  return data.url
}

export async function fetchAllCompaniesAdmin() {
  // Platform admin only — fetches all companies with owner emails + subs.
  // Two queries instead of embedded join — see fetchAdminAllCompanies for why.
  const [{ data: cos, error: ce }, { data: subs }] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('subscriptions').select('*'),
  ])
  if (ce) throw ce
  const subsByCo = {}
  for (const s of (subs || [])) (subsByCo[s.company_id] ||= []).push(s)
  return (cos || []).map(c => ({ ...c, subscriptions: subsByCo[c.id] || [] }))
}

export async function setCompanyFreeTier(companyId, isFreeTier, grantedBy) {
  const { error } = await supabase
    .from('companies')
    .update({
      is_free_tier: isFreeTier,
      free_tier_reason: isFreeTier ? 'Manually granted by admin' : null,
      free_tier_granted_by: isFreeTier ? grantedBy : null,
    })
    .eq('id', companyId)
  if (error) throw error
  // Update subscription status too
  await supabase
    .from('subscriptions')
    .update({ status: isFreeTier ? 'free_tier' : 'trialing' })
    .eq('company_id', companyId)
}
