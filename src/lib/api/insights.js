// AI portfolio insights. Backed by the portfolio_insights table (RLS:
// select+delete own) and the portfolio-insights edge function which is
// rate-limited to once per 30 min per user.

import { supabase } from '../supabase'

// Fetch the latest AI-generated insights for the current user, optionally
// scoped to a single company. Pass companyId=null for the "all companies"
// view, an actual UUID to get the per-company cached row. Returns null if
// nothing's been generated yet at that scope.
export async function fetchLatestPortfolioInsights(companyId = null) {
  let q = supabase
    .from('portfolio_insights')
    .select('id, insights, stats, generated_at, company_id')
    .order('generated_at', { ascending: false })
    .limit(1)
  // .is() for null is required — `.eq('company_id', null)` doesn't match.
  q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  return data
}

// Trigger the portfolio-insights edge function to generate a fresh batch
// at the given scope (null = all companies, UUID = single company).
// Rate-limited per (user, company_id); 429 surfaces as a thrown Error.
export async function regeneratePortfolioInsights(companyId = null) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portfolio-insights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ company_id: companyId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Failed to generate insights (HTTP ${res.status})`)
  return body
}
