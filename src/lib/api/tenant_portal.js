// Tenant portal — surface for tenants (not landlords) viewing their own
// tenancy.
//
// Tenants sign in via the same Supabase auth flow and land here when
// checkIsTenant returns rows for their user_id. RLS scopes everything
// they can see to their own property (via tenant_profiles).

import { supabase } from '../supabase'

export async function checkIsTenant(userId) {
  try {
    const { data } = await supabase.from('tenant_profiles')
      .select('*, property:properties(*, company:companies(*))').eq('user_id', userId)
    return data || []
  } catch (e) { return [] }
}

export async function inviteTenant(propertyId, email, invitedBy) {
  // Storing the property id in the signup URL — landlords share this
  // link with prospective tenants. Once they sign up + confirm, the
  // dashboard reads `tenant_property` from the URL and calls
  // registerTenantProfile to link them to the property.
  const baseUrl = window.location.origin
  const signupUrl = `${baseUrl}?tenant_property=${propertyId}`
  return { signupUrl, email }
}

export async function registerTenantProfile(userId, propertyId) {
  const { data, error } = await supabase.from('tenant_profiles')
    .upsert({ user_id: userId, property_id: propertyId }, { onConflict: 'user_id,property_id' })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchTenantProperty(userId) {
  const { data, error } = await supabase.from('tenant_profiles')
    .select(`
      *,
      property:properties(
        *,
        company:companies(*, contact_mode, agent_name, agent_phone, agent_email)
      )
    `)
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return data
}

export async function fetchTenantRentPayments(propertyId, userId) {
  const { data, error } = await supabase.from('rent_payments')
    .select('*').eq('property_id', propertyId).order('payment_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchTenantDocuments(propertyId) {
  const { data, error } = await supabase.from('property_documents')
    .select('*').eq('property_id', propertyId).eq('shared_with_tenant', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchTenantMaintenance(propertyId, userId) {
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('*').eq('property_id', propertyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function submitMaintenanceRequest(propertyId, tenantUserId, title, description, priority, photos = []) {
  const { data, error } = await supabase.from('maintenance_jobs').insert({
    property_id: propertyId, title, description, priority, status: 'open',
    reported_by_tenant: true, user_id: tenantUserId, photos,
  }).select().single()
  if (error) throw error
  // Notify landlord via edge function — never block submission if it fails.
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${supabaseUrl}/functions/v1/notify-landlord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ type: 'maintenance', property_id: propertyId, title, message: description, priority, photos }),
    })
  } catch (e) { /* fire-and-forget */ }
  return data
}

export async function fetchTenantMessages(propertyId, tenantUserId) {
  const { data, error } = await supabase.from('tenant_messages')
    .select('*').eq('property_id', propertyId).order('created_at')
  if (error) throw error
  return data || []
}

export async function sendTenantMessage(propertyId, tenantUserId, message, senderType = 'tenant') {
  const { data, error } = await supabase.from('tenant_messages')
    .insert({ property_id: propertyId, tenant_user_id: tenantUserId, message, sender_type: senderType })
    .select().single()
  if (error) throw error
  // Notify landlord only when the tenant sends (not landlord reply)
  if (senderType === 'tenant') {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`${supabaseUrl}/functions/v1/notify-landlord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ type: 'message', property_id: propertyId, message }),
      })
    } catch (e) { /* fire-and-forget */ }
  }
  return data
}

export async function markMessagesRead(propertyId, tenantUserId) {
  await supabase.from('tenant_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('property_id', propertyId).eq('sender_type', 'landlord').is('read_at', null)
}

export async function setDocumentSharedWithTenant(docId, shared) {
  const { error } = await supabase.from('property_documents')
    .update({ shared_with_tenant: shared }).eq('id', docId)
  if (error) throw error
}

export async function saveCompanyContactMode(companyId, mode, agentName, agentPhone, agentEmail) {
  const { error } = await supabase.from('companies')
    .update({ contact_mode: mode, agent_name: agentName, agent_phone: agentPhone, agent_email: agentEmail })
    .eq('id', companyId)
  if (error) throw error
}

export async function savePropertyContactOverride(propertyId, override) {
  const { error } = await supabase.from('properties')
    .update({ contact_mode_override: override }).eq('id', propertyId)
  if (error) throw error
}
