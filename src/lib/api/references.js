// Tenant referencing.
//
// Pre-partnership stage: orders are stored locally and surfaced to the
// user as "Coming soon". Once a partner contract is in place (Goodlord /
// RentProfile / OpenRent), the createTenantReference call will trigger
// an edge function that POSTs to the partner API and updates the row's
// status + result fields.

import { supabase } from '../supabase'

export async function fetchTenantReferences(propertyId) {
  let q = supabase.from('tenant_references')
    .select('*')
    .order('created_at', { ascending: false })
  if (propertyId) q = q.eq('property_id', propertyId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createTenantReference(propertyId, fields) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { data, error } = await supabase
    .from('tenant_references')
    .insert({
      ...fields,
      property_id: propertyId,
      user_id: userId,
      status: 'requested',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTenantReference(id) {
  const { error } = await supabase.from('tenant_references').delete().eq('id', id)
  if (error) throw error
}
