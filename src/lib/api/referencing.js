// Tenant referencing + Right-to-Rent checks (Feature 7 scaffold).
//
// Partner-agnostic order lifecycle backed by the referencing_checks table
// (RLS: read own/property, write requires property write + live company) and
// the referencing-request edge function. The provider-order path is INERT
// until REFERENCING_PROVIDER_API_KEY is set on the edge function — until then
// orderReferencingCheck creates a 'draft' row and returns { inert: true }.
//
// Gated client-side behind feature flag key "referencing".

import { supabase } from '../supabase'

// List checks, optionally scoped to a single property, newest first.
export async function fetchReferencingChecks(propertyId) {
  let q = supabase
    .from('referencing_checks')
    .select('*')
    .order('created_at', { ascending: false })
  if (propertyId) q = q.eq('property_id', propertyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Order a reference / RTR check via the edge function. Returns the created
// check plus an `inert` flag indicating whether a live provider order was
// placed. fields: { applicant_name, applicant_email?, check_type? }.
export async function orderReferencingCheck(propertyId, fields) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/referencing-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ property_id: propertyId, ...fields }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Failed to order check (HTTP ${res.status})`)
  return body
}

// Cancel/remove a draft check.
export async function deleteReferencingCheck(id) {
  const { error } = await supabase.from('referencing_checks').delete().eq('id', id)
  if (error) throw error
}
