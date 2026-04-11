import { supabase } from './supabase'

const uid = async () => (await supabase.auth.getUser()).data.user.id

export async function fetchCompanies() {
  const { data, error } = await supabase.from('companies').select('*').order('name')
  if (error) throw error
  return data
}
export async function createCompany(co) {
  const { data, error } = await supabase.from('companies').insert({ ...co, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateCompany(id, updates) {
  const { data, error } = await supabase.from('companies').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCompany(id) {
  const { error } = await supabase.from('companies').delete().eq('id', id)
  if (error) throw error
}

export async function fetchProperties() {
  const { data, error } = await supabase
    .from('properties')
    .select('*, company:companies(id,name,abbr,color), refurb_phases(*), refurb_costs(*), rent_payments(*)')
    .order('sort_order', {ascending:true})
    .order('name', {ascending:true})
  if (error) throw error
  return data
}
export async function createProperty(prop) {
  const { data, error } = await supabase
    .from('properties').insert({ ...prop, user_id: await uid() })
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return { ...data, refurb_phases: [], refurb_costs: [], rent_payments: [] }
}
export async function updateProperty(id, updates) {
  const { data, error } = await supabase
    .from('properties').update(updates).eq('id', id)
    .select('*, company:companies(id,name,abbr,color)').single()
  if (error) throw error
  return data
}
export async function deleteProperty(id) {
  const { error } = await supabase.from('properties').delete().eq('id', id)
  if (error) throw error
}

export async function createRefurbPhase(propertyId, phase) {
  const { data, error } = await supabase
    .from('refurb_phases').insert({ ...phase, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function createRefurbCost(propertyId, cost) {
  const { data, error } = await supabase
    .from('refurb_costs').insert({ ...cost, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}

export async function upsertRentPayment(propertyId, year, month, status, amount, notes) {
  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const { data, error } = await supabase
    .from('rent_payments')
    .upsert({ property_id: propertyId, user_id: await uid(), year, month, month_label: monthLabel, status, amount, notes },
      { onConflict: 'property_id,year,month' })
    .select().single()
  if (error) throw error
  return data
}
// ── USER COMPANY ACCESS ────────────────────────────────────────────────────
export async function fetchUserAccess(userId) {
  const { data, error } = await supabase
    .from('user_company_access')
    .select('*')
    .eq('user_id', userId)
  // If table doesn't exist, return empty (admin mode)
  if (error) return []
  return data || []
}

export async function updateUserAccess(userId, companyId, email, grant) {
  if (grant) {
    const { error } = await supabase.from('user_company_access')
      .upsert({ user_id: userId, company_id: companyId, email, is_admin: false },
        { onConflict: 'user_id,company_id' })
    if (error) throw error
  } else {
    const { error } = await supabase.from('user_company_access')
      .delete().eq('user_id', userId).eq('company_id', companyId)
    if (error) throw error
  }
}
