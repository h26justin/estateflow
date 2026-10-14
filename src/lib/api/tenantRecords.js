// Tenancy records: tenancy details, tenant messages, right to rent,
// deposit protection, legal notices, rent history and tenant invite email.
import { supabase } from '../supabase'
import { uid } from './_shared'
import { upsertCompanySettings } from './companySettings'

// ── TENANCY DETAILS ───────────────────────────────────────
export async function upsertTenancyDetails(propertyId, details) {
  const { data, error } = await supabase.from('tenancy_details')
    .upsert({ ...details, property_id: propertyId, user_id: await uid() }, { onConflict: 'property_id' })
    .select().single()
  if (error) throw error
  return data
}

export async function markTenantMessageReadByLandlord(messageId) {
  await supabase.from('tenant_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
}

export async function replyToTenantMessage(propertyId, tenantUserId, message) {
  const { data, error } = await supabase.from('tenant_messages')
    .insert({ property_id: propertyId, tenant_user_id: tenantUserId, message, sender_type: 'landlord' })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchAllTenantMessages(propertyId) {
  const { data } = await supabase.from('tenant_messages')
    .select('*').eq('property_id', propertyId).order('created_at')
  return data || []
}

export async function saveTenantNotificationEmail(companyId, email) {
  await upsertCompanySettings(companyId, { tenant_notification_email: email })
}

// ── RIGHT TO RENT ─────────────────────────────────────────────────────────────
export async function fetchRightToRent(propertyId) {
  const { data, error } = await supabase.from('right_to_rent')
    .select('*').eq('property_id', propertyId).order('check_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveRightToRent(record) {
  const { data, error } = await supabase.from('right_to_rent')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── TENANT INVITE EMAIL ───────────────────────────────────────────────────────
export async function sendTenantInviteEmail(session, tenantEmail, propertyId, propertyAddress, companyName) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const res = await fetch(`${supabaseUrl}/functions/v1/send-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ tenant_email: tenantEmail, property_id: propertyId, property_address: propertyAddress, company_name: companyName })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── DEPOSIT PROTECTION ────────────────────────────────────────────────────────
export async function fetchDepositProtection(propertyId) {
  const { data, error } = await supabase.from('deposit_protection')
    .select('*').eq('property_id', propertyId).order('registered_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function saveDepositProtection(record) {
  const { data, error } = await supabase.from('deposit_protection')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── LEGAL NOTICES ─────────────────────────────────────────────────────────────
export async function fetchNotices(propertyId) {
  const { data, error } = await supabase.from('legal_notices')
    .select('*').eq('property_id', propertyId).order('served_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function saveNotice(record) {
  const { data, error } = await supabase.from('legal_notices')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── RENT HISTORY ──────────────────────────────────────────────────────────────
export async function fetchRentHistory(propertyId) {
  const { data, error } = await supabase.from('rent_history')
    .select('*').eq('property_id', propertyId).order('effective_date', { ascending: false })
  if (error) throw error
  return data || []
}
export async function saveRentHistory(record) {
  const { data, error } = await supabase.from('rent_history')
    .upsert(record, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data
}

// ── TENANCY DETAILS UPDATE ────────────────────────────────────────────────────
export async function updateTenancyDetails(propertyId, fields) {
  const { error } = await supabase.from('tenancy_details')
    .update(fields).eq('property_id', propertyId)
  if (error) throw error
}
export async function fetchTenancyDetails(propertyId) {
  const { data } = await supabase.from('tenancy_details')
    .select('*').eq('property_id', propertyId).single()
  return data
}
