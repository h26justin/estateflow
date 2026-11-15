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
  // Throw, don't return []: a transient failure made a collaborator look like
  // a brand-new user and loadData showed them the onboarding wizard. loadData
  // shows its error + Retry state instead.
  if (error) throw error
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
  // Throw (see fetchUserAccessByEmail): an error is not "no access".
  if (error) throw error
  return data || []
}

// Company ids the user owns or has an access row for. Data-layer reads that
// mean "the user's data" scope by these (and let RLS decide), never by the
// creator user_id — rows carry whoever created them, so creator scoping hid
// team-mates' rows. Throws on error.
export async function fetchAccessibleCompanyIds(userId, { adminOnly = false } = {}) {
  const accessQ = supabase.from('user_company_access').select('company_id, role, is_admin').eq('user_id', userId)
  const [owned, access] = await Promise.all([
    supabase.from('companies').select('id').eq('owner_id', userId),
    accessQ,
  ])
  if (owned.error) throw owned.error
  if (access.error) throw access.error
  const shared = (access.data || [])
    .filter(a => !adminOnly || a.is_admin === true || a.role === 'admin')
    .map(a => a.company_id)
  return [...new Set([...(owned.data || []).map(c => c.id), ...shared].filter(Boolean))]
}

// ── ROLE MANAGEMENT ───────────────────────────────────────────────────────────
// Update a user's role on a company. Role is one of: 'admin','editor','viewer'
export async function updateUserRole(userId, companyId, role, permissionOverrides = {}) {
  const validRoles = ['admin','editor','viewer']
  if (!validRoles.includes(role)) throw new Error('Invalid role: ' + role)
  const { data, error } = await supabase.from('user_company_access')
    .update({ role, permissions: permissionOverrides, is_admin: role === 'admin' })
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .select('company_id')
  if (error) throw error
  // RLS hides rows the caller may not change: zero rows is a refusal.
  if (!data || data.length === 0) throw new Error('Role not changed — you may not have permission to manage this member')
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

// Least to most privileged — ties in accessRoleForNewGrants go to the
// LEAST privileged, so a bulk grant never upgrades anyone.
const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 }
const rowRole = (r) => r.role || (r.is_admin ? 'admin' : 'editor')

// The (role, permissions) pair new grants should carry when the caller does
// not say: the member's most common existing pair. With no existing rows
// the default is viewer (least privilege) rather than the column default
// 'editor'. Pure — exported for tests.
export function accessRoleForNewGrants(existingRows) {
  const counts = new Map()
  for (const r of existingRows || []) {
    const role = rowRole(r)
    if (!(role in ROLE_RANK)) continue
    const permissions = r.permissions || {}
    const key = role + '|' + JSON.stringify(permissions)
    const e = counts.get(key) || { role, permissions, n: 0 }
    e.n += 1
    counts.set(key, e)
  }
  let best = null
  for (const e of counts.values()) {
    if (!best || e.n > best.n || (e.n === best.n && ROLE_RANK[e.role] < ROLE_RANK[best.role])) best = e
  }
  return best ? { role: best.role, permissions: best.permissions } : { role: 'viewer', permissions: {} }
}

// Plan the "All companies" toggle as a per-company diff. Pure — exported for
// tests. scopeCompanyIds limits what may be REMOVED to the caller's own
// companies (a landlord's Team tab must not touch the member's access to
// someone else's companies); omitted = every existing row is in scope.
export function planCompanyAccessDiff(existingRows, companyIds, scopeCompanyIds = null) {
  const want = new Set(companyIds)
  const have = new Set((existingRows || []).map(r => r.company_id))
  const scope = scopeCompanyIds ? new Set(scopeCompanyIds) : null
  return {
    toAdd: [...want].filter(id => !have.has(id)),
    // An is_owner row is never removed by a bulk toggle.
    toRemove: [...new Set((existingRows || []).filter(r => !r.is_owner).map(r => r.company_id))]
      .filter(id => !want.has(id) && (!scope || scope.has(id))),
  }
}

// Set a member's access to exactly `companyIds` (within scope). Was: delete
// every access row for the user (error ignored), then re-insert with
// is_admin:false and no role — a Viewer silently became an Editor, an Admin
// was demoted, and a failed insert left the user with no access at all.
// Now: existing rows keep their role untouched; only missing companies are
// inserted (with opts.role/opts.permissions, else the member's existing
// most-common role, never an upgrade); removed companies are deleted only
// AFTER the inserts succeeded; every error is checked.
export async function setAllCompanyAccess(userId, userEmail, companyIds, opts = {}) {
  const { data: existing, error: readErr } = await supabase.from('user_company_access')
    .select('company_id, role, permissions, is_admin, is_owner')
    .eq('user_id', userId)
  if (readErr) throw readErr
  const { toAdd, toRemove } = planCompanyAccessDiff(existing, companyIds, opts.scopeCompanyIds)
  if (toAdd.length > 0) {
    const fallback = accessRoleForNewGrants(existing)
    const role = opts.role || fallback.role
    const permissions = opts.permissions || (opts.role ? {} : fallback.permissions)
    const rows = toAdd.map(cid => ({ user_id: userId, company_id: cid, email: userEmail, role, permissions, is_admin: role === 'admin' }))
    const { error } = await supabase.from('user_company_access').insert(rows)
    if (error) throw error
  }
  if (toRemove.length > 0) {
    const { error } = await supabase.from('user_company_access')
      .delete().eq('user_id', userId).in('company_id', toRemove)
    if (error) throw error
  }
  return { added: toAdd, removed: toRemove }
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
