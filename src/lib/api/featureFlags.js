// Feature flags, overrides and my-permissions map.
import { supabase } from '../supabase'
import { ROLE_DEFAULTS, getEffectivePermissions } from './roles'

// ── FEATURE FLAGS ─────────────────────────────────────────────────────────────
export async function fetchFeatureFlags() {
  const { data, error } = await supabase.from('feature_flags').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function fetchFlagUserOverrides(flagKey) {
  const { data, error } = await supabase.from('feature_flag_users').select('*, user:user_id').eq('flag_key', flagKey)
  if (error) throw error
  return data || []
}

export async function fetchFlagCompanyOverrides(flagKey) {
  const { data, error } = await supabase.from('feature_flag_companies').select('*, company:companies(name,abbr,color)').eq('flag_key', flagKey)
  if (error) throw error
  return data || []
}

export async function createFeatureFlag({ key, name, description, enabled_globally }) {
  const { data, error } = await supabase.from('feature_flags').insert({ key, name, description, enabled_globally }).select().single()
  if (error) throw error
  return data
}

export async function updateFeatureFlag(key, updates) {
  const { error } = await supabase.from('feature_flags').update({ ...updates, updated_at: new Date().toISOString() }).eq('key', key)
  if (error) throw error
}

export async function deleteFeatureFlag(key) {
  const { error } = await supabase.from('feature_flags').delete().eq('key', key)
  if (error) throw error
}

export async function setFlagUserOverride(flagKey, userId, enabled) {
  const { error } = await supabase.from('feature_flag_users').upsert({ flag_key: flagKey, user_id: userId, enabled }, { onConflict: 'flag_key,user_id' })
  if (error) throw error
}

export async function removeFlagUserOverride(flagKey, userId) {
  const { error } = await supabase.from('feature_flag_users').delete().eq('flag_key', flagKey).eq('user_id', userId)
  if (error) throw error
}

export async function setFlagCompanyOverride(flagKey, companyId, enabled) {
  const { error } = await supabase.from('feature_flag_companies').upsert({ flag_key: flagKey, company_id: companyId, enabled }, { onConflict: 'flag_key,company_id' })
  if (error) throw error
}

export async function removeFlagCompanyOverride(flagKey, companyId) {
  const { error } = await supabase.from('feature_flag_companies').delete().eq('flag_key', flagKey).eq('company_id', companyId)
  if (error) throw error
}

// Check if a feature is enabled for current user (checks user override → company override → global)
export async function fetchMyActiveFlags() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return new Set()
    const [flagsRes, userOverridesRes, companyOverridesRes] = await Promise.all([
      supabase.from('feature_flags').select('key, enabled_globally'),
      supabase.from('feature_flag_users').select('flag_key, enabled').eq('user_id', u.id),
      supabase.from('feature_flag_companies').select('flag_key, enabled')
    ])
    const globalMap = {}
    ;(flagsRes.data || []).forEach(f => { globalMap[f.key] = f.enabled_globally })
    const userMap = {}
    ;(userOverridesRes.data || []).forEach(o => { userMap[o.flag_key] = o.enabled })
    const companyMap = {}
    ;(companyOverridesRes.data || []).forEach(o => {
      // If ANY of the user's companies has the flag ON, it's on
      if (o.enabled && companyMap[o.flag_key] !== true) companyMap[o.flag_key] = true
      else if (!o.enabled && companyMap[o.flag_key] === undefined) companyMap[o.flag_key] = false
    })
    const active = new Set()
    Object.keys(globalMap).forEach(k => {
      // Priority: user override → company override → global
      if (userMap[k] !== undefined) {
        if (userMap[k]) active.add(k)
      } else if (companyMap[k] !== undefined) {
        if (companyMap[k]) active.add(k)
      } else if (globalMap[k]) {
        active.add(k)
      }
    })
    return active
  } catch(e) {
    return new Set()
  }
}

// Bulk version: permissions for ALL my accessible companies
export async function fetchMyPermissionsMap(isDeveloper = false) {
  const map = {}
  try {
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return map
    if (isDeveloper) {
      const { data: cos } = await supabase.from('companies').select('id')
      ;(cos || []).forEach(c => { map[c.id] = { ...ROLE_DEFAULTS.owner, _role: 'developer' } })
      return map
    }
    const [ownedRes, accessRes] = await Promise.all([
      supabase.from('companies').select('id').eq('owner_id', user.id),
      supabase.from('user_company_access').select('company_id, role, is_admin, permissions').eq('user_id', user.id),
    ])
    ;(ownedRes.data || []).forEach(c => { map[c.id] = { ...ROLE_DEFAULTS.owner, _role: 'owner' } })
    ;(accessRes.data || []).forEach(a => {
      if (!map[a.company_id]) {
        map[a.company_id] = { ...getEffectivePermissions(a, false), _role: a.role || (a.is_admin ? 'admin' : 'editor') }
      }
    })
    return map
  } catch(e) {
    return map
  }
}
