// EPC C retrofit planner API (Feature 10, flag: epc_planner).
// Backed by the epc_assessments table (RLS: read own/with-access, write needs
// property write permission + live company) and the epc-planner edge function
// which calls Claude to draft a prioritised retrofit plan.

import { supabase } from '../supabase'

// Fetch the most recent saved EPC retrofit plan for a property, or null if none
// has been generated yet.
export async function fetchLatestEpcAssessment(propertyId) {
  const { data, error } = await supabase
    .from('epc_assessments')
    .select('id, property_id, company_id, current_rating, target_rating, measures, est_total_cost, deadline, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Generate a retrofit plan via Claude. Pass save:true to persist it to
// epc_assessments (the edge function re-checks write access either way).
// opts: { current_rating, property_type, region, floor_area_sqm, save }
export async function generateEpcPlan(propertyId, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/epc-planner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': supabase.supabaseKey,
    },
    body: JSON.stringify({ property_id: propertyId, ...opts }),
  })
  let body
  try { body = await res.json() } catch { throw new Error(`EPC planner unreachable (HTTP ${res.status}). Is the edge function deployed?`) }
  if (!res.ok || body?.error) throw new Error(body?.error || `Failed to generate EPC plan (HTTP ${res.status})`)
  return body
}

// Delete a saved plan (write permission enforced by RLS).
export async function deleteEpcAssessment(id) {
  const { error } = await supabase.from('epc_assessments').delete().eq('id', id)
  if (error) throw error
}
