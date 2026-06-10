// AI Maintenance Triage client API. Calls the maintenance-triage edge
// function, which analyses a repair's photos + description with Claude and
// writes a DRAFT triage assessment back to the maintenance_jobs row
// (ai_triage / ai_severity / ai_triaged_at). The landlord reviews and applies.

import { supabase } from '../supabase'

// Run AI triage for a maintenance job. Returns
// { success, triage, ai_triaged_at } where triage is
// { severity, category, suggested_trade, suggested_priority, diagnosis,
//   contractor_brief, confidence, model_used, disclaimer, ... }.
// Throws on any non-2xx response.
export async function triageJob(jobId) {
  if (!jobId) throw new Error('jobId is required')
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/maintenance-triage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ job_id: jobId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Triage failed (HTTP ${res.status})`)
  return body
}
