// Open-banking rent collection — client API (INERT SCAFFOLD).
//
// Mandate RECORDS only. There is no money-movement path on the client; the
// `initiateCollection` call hits the edge-function stub, which always refuses
// (pending FCA authorisation + a TrueLayer VRP agreement). Gated behind the
// `rent_collection` feature flag at the UI layer.

import { supabase } from '../supabase'

async function callMandateFn(payload) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${supabaseUrl}/functions/v1/rent-collection-mandate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      apikey: supabaseKey,
    },
    body: JSON.stringify(payload),
  })
  let json = {}
  try { json = await res.json() } catch (_e) { /* non-JSON */ }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

export async function fetchMandate(propertyId) {
  const { data, error } = await supabase.from('rent_collection_mandates')
    .select('*').eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) || null
}

export async function fetchMandatesForProperty(propertyId) {
  const { data, error } = await supabase.from('rent_collection_mandates')
    .select('*').eq('property_id', propertyId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchMandateAttempts(mandateId) {
  const { data, error } = await supabase.from('rent_collection_attempts')
    .select('*').eq('mandate_id', mandateId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createMandate({ propertyId, companyId, tenantUserId, amountPcm, dayOfMonth, provider }) {
  const { mandate } = await callMandateFn({
    action: 'create',
    property_id: propertyId,
    company_id: companyId,
    tenant_user_id: tenantUserId || null,
    amount_pcm: amountPcm ?? null,
    day_of_month: dayOfMonth ?? null,
    provider: provider || 'truelayer',
  })
  return mandate
}

export async function cancelMandate(mandateId) {
  const { mandate } = await callMandateFn({ action: 'cancel', mandate_id: mandateId })
  return mandate
}

// INERT: always rejects via the edge-function stub. Never moves money.
export async function initiateCollection(mandateId) {
  return callMandateFn({ action: 'initiate', mandate_id: mandateId })
}

// Tenant-side: read the mandate that applies to the tenant's own property.
// RLS (is_tenant_of_property) scopes this to the signed-in tenant.
export async function fetchTenantMandate(propertyId) {
  const { data, error } = await supabase.from('rent_collection_mandates')
    .select('id, status, provider, amount_pcm, day_of_month, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) || null
}
