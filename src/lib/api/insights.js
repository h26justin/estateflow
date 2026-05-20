// AI portfolio insights. Backed by the portfolio_insights table (RLS:
// select+delete own) and the portfolio-insights edge function which is
// rate-limited to once per 30 min per user.

import { supabase } from '../supabase'

// Fetch the latest AI-generated insights for the current user. Returns
// null if they've never generated any.
export async function fetchLatestPortfolioInsights() {
  const { data, error } = await supabase
    .from('portfolio_insights')
    .select('id, insights, stats, generated_at')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Trigger the portfolio-insights edge function to generate a fresh batch.
// The function is rate-limited (one per 30 min per user); a 429 is bubbled
// up as a thrown Error.
export async function regeneratePortfolioInsights() {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portfolio-insights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Failed to generate insights (HTTP ${res.status})`)
  return body
}
