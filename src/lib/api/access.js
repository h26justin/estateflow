// User company access: access rows, role updates, grants / revokes and
// per-company admin rights.
import { supabase } from '../supabase'

// ── USER COMPANY ACCESS ────────────────────────────────────────────────────
export async function fetchUserAccessByEmail(email) {
  if (!email) return []
  const { data, error } = await supabase
    .from('user_company_access')
    .select('*')
    .eq('email', email)
  if (error) return []
  return data || []
}

export async function updateUserIdByEmail(email, userId) {
  try {
    await supabase.from('user_company_access')
      .update({ user_id: userId })
      .eq('email', email)
      .neq('user_id', userId)
  } catch(e) { }
}

export async function fetchUserAccess(userId) {
  const { data, error } = await supabase
    .from('user_company_access')
    .select('*')
    .eq('user_id', userId)
  // If table doesn't exist, return empty (admin mode)
  if (error) return []
  return data || []
}

// ── ROLE MANAGEMENT ───────────────────────────────────────────────────────────
// Update a user's role on a company. Role is one of: 'admin','editor','viewer'
export async function updateUserRole(userId, companyId, role, permissionOverrides = {}) {
  const validRoles = ['admin','editor','viewer']
  if (!validRoles.includes(role)) throw new Error('Invalid role: ' + role)
  const { error } = await supabase.from('user_company_access')
    .update({ role, permissions: permissionOverrides, is_admin: role === 'admin' })
    .eq('user_id', userId)
    .eq('company_id', companyId)
  if (error) throw error
}

// ── USER ACCESS MANAGEMENT ────────────────────────────────────────────────────
export async function fetchAllUsers() {
  const { data, error } = await supabase.rpc('list_auth_users')
  if (error) throw error
  const users = data || []
  // Enrich with profile data (first_name, last_name, full_name, phone)
  try {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name, full_name, phone')
    if (profiles) {
      const profileMap = {}
      profiles.forEach(p => { profileMap[p.user_id] = p })
      return users.map(u => ({ ...u, profile: profileMap[u.id] || null }))
    }
  } catch(e) { /* Fall back to basic user list if profile fetch fails */ }
  return users
}

export async function fetchAllAccessRows() {
  const { data, error } = await supabase.from('user_company_access').select('*')
  if (error) throw error
  return data || []
}

export async function grantCompanyAccess(userId, companyId, email) {
  const { error } = await supabase.from('user_company_access')
    .insert({ user_id: userId, company_id: companyId, email, is_admin: false })
  if (error) throw error
}

export async function revokeCompanyAccess(userId, companyId) {
  const { error } = await supabase.from('user_company_access')
    .delete().eq('user_id', userId).eq('company_id', companyId)
  if (error) throw error
}

export async function setAllCompanyAccess(userId, userEmail, companyIds) {
  await supabase.from('user_company_access').delete().eq('user_id', userId)
  if (companyIds.length > 0) {
    const rows = companyIds.map(cid => ({ user_id: userId, company_id: cid, email: userEmail, is_admin: false }))
    const { error } = await supabase.from('user_company_access').insert(rows)
    if (error) throw error
  }
}

export async function removeUserAccess(userId) {
  const { error } = await supabase.from('user_company_access').delete().eq('user_id', userId)
  if (error) throw error
}

// ── TOGGLE ADMIN RIGHTS for a shared user on a single company ────────────────
export async function setUserCompanyAdmin(userId, companyId, isAdmin) {
  const { error } = await supabase
    .from('user_company_access')
    .update({ is_admin: isAdmin })
    .eq('user_id', userId)
    .eq('company_id', companyId)
  if (error) throw error
  return { success: true }
}
