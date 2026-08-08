// EPC C retrofit planner API (Feature 10, flag: epc_planner).
// Backed by the epc_assessments table (RLS: read own/with-access, write needs
// property write permission + live company) and two edge functions:
//   epc-planner — Claude drafts a prioritised retrofit plan
//   epc-sync    — pulls the real EPC from the official England & Wales
//                 register (certificate number, band, expiry + the official
//                 find-energy-certificate.service.gov.uk link) into the
//                 epc_certificates table and the property's compliance row.

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

// ── EPC register (official certificates) ─────────────────────────────────

// Latest register certificate logged for a property, or null.
export async function fetchEpcCertificate(propertyId) {
  const { data, error } = await supabase
    .from('epc_certificates')
    .select('id, property_id, certificate_number, uprn, register_address, current_rating, potential_rating, lodgement_date, expiry_date, certificate_url, matched_by, fetched_at')
    .eq('property_id', propertyId)
    .order('lodgement_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function invokeEpcSync(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase.functions.invoke('epc-sync', {
    body: payload,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) {
    let msg = error.message || 'EPC register lookup failed'
    try {
      const ctxBody = await error.context?.json?.()
      if (ctxBody?.error) msg = ctxBody.error
    } catch { /* ignore */ }
    const e = new Error(msg)
    e.cause = error
    throw e
  }
  return data
}

// Fetch this property's EPC from the official register (write access req.).
export function syncEpcFromRegister(propertyId) {
  return invokeEpcSync({ action: 'sync_property', property_id: propertyId })
}

// Fetch EPCs for every property the caller can write to.
export function syncAllEpcFromRegister() {
  return invokeEpcSync({ action: 'sync_all' })
}
