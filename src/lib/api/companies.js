// Companies: list, update, delete, and owner-side company creation.
import { supabase } from '../supabase'

export async function fetchCompanies() {
  const { data, error } = await supabase.from('companies').select('*').is('deleted_at', null).order('name')
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

// ── MULTI-TENANT: COMPANY CREATION ───────────────────────────────────────────
export async function createCompanyForOwner(name, abbr, color) {
  const { data, error } = await supabase.rpc('create_company_for_owner', {
    p_name: name, p_abbr: abbr, p_color: color
  })
  if (error) throw error
  return data // returns company_id
}

export async function fetchMyCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('name')
  if (error) throw error
  return data || []
}
