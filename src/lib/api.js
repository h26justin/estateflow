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
// ── COMPANY SETTINGS ──────────────────────────────────────
export async function fetchCompanySettings(companyId) {
  const { data, error } = await supabase.from('company_settings').select('*').eq('company_id', companyId).single()
  if (error) return null
  return data
}
export async function upsertCompanySettings(companyId, settings) {
  const userId = await uid()
  const { data, error } = await supabase.from('company_settings')
    .upsert({ ...settings, company_id: companyId, user_id: userId }, { onConflict: 'company_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── COMPLIANCE ────────────────────────────────────────────
export async function fetchCompliance(propertyId) {
  const { data, error } = await supabase.from('compliance_items').select('*').eq('property_id', propertyId).order('expiry_date')
  if (error) throw error
  return data || []
}
export async function createCompliance(propertyId, item) {
  const { data, error } = await supabase.from('compliance_items').insert({ ...item, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateCompliance(id, updates) {
  const { data, error } = await supabase.from('compliance_items').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCompliance(id) {
  const { error } = await supabase.from('compliance_items').delete().eq('id', id)
  if (error) throw error
}
export async function fetchAllCompliance(userId) {
  const { data, error } = await supabase.from('compliance_items').select('*, property:properties(name,company_id)').eq('user_id', userId).order('expiry_date')
  if (error) throw error
  return data || []
}

// ── TENANCY DETAILS ───────────────────────────────────────
export async function upsertTenancyDetails(propertyId, details) {
  const { data, error } = await supabase.from('tenancy_details')
    .upsert({ ...details, property_id: propertyId, user_id: await uid() }, { onConflict: 'property_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── MAINTENANCE ───────────────────────────────────────────
export async function fetchMaintenance(propertyId) {
  const { data, error } = await supabase.from('maintenance_jobs').select('*').eq('property_id', propertyId).order('created_at', {ascending:false})
  if (error) throw error
  return data || []
}
export async function createMaintenance(propertyId, job) {
  const { data, error } = await supabase.from('maintenance_jobs').insert({ ...job, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateMaintenance(id, updates) {
  const { data, error } = await supabase.from('maintenance_jobs').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteMaintenance(id) {
  const { error } = await supabase.from('maintenance_jobs').delete().eq('id', id)
  if (error) throw error
}

// ── EXPENSES ─────────────────────────────────────────────
export async function fetchExpenses(propertyId) {
  const { data, error } = await supabase.from('property_expenses').select('*').eq('property_id', propertyId).order('date', {ascending:false})
  if (error) throw error
  return data || []
}
export async function createExpense(propertyId, expense) {
  const { data, error } = await supabase.from('property_expenses').insert({ ...expense, property_id: propertyId, user_id: await uid() }).select().single()
  if (error) throw error
  return data
}
export async function updateExpense(id, updates) {
  const { data, error } = await supabase.from('property_expenses').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteExpense(id) {
  const { error } = await supabase.from('property_expenses').delete().eq('id', id)
  if (error) throw error
}

// ── AUTO-GENERATE FUTURE RENT MONTHS ─────────────────────
// Creates void payment slots up to 6 months ahead for all properties
export async function ensureFutureRentMonths(properties, monthsAhead = 6) {
  const userId = await uid()
  const now = new Date()

  // Build target months: current month up to 6 months ahead
  const targetMonths = []
  for (let i = 0; i <= monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    targetMonths.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString('en-GB', { month: 'short', year: 'numeric' })
    })
  }

  // For each property, check which future months are missing and insert them
  const inserts = []
  for (const prop of properties) {
    const existing = prop.rent_payments || []
    for (const tm of targetMonths) {
      const alreadyExists = existing.some(p => p.year === tm.year && p.month === tm.month)
      if (!alreadyExists) {
        inserts.push({
          property_id: prop.id,
          user_id: userId,
          month_label: tm.label,
          year: tm.year,
          month: tm.month,
          status: 'void'
        })
      }
    }
  }

  if (inserts.length === 0) return 0

  // Insert in batches of 100
  for (let i = 0; i < inserts.length; i += 100) {
    const batch = inserts.slice(i, i + 100)
    const { error } = await supabase.from('rent_payments').insert(batch)
    if (error) throw error
  }

  return inserts.length
}

// ── USER THEME PREFERENCE ─────────────────────────────────────────────────────
export async function fetchThemePreference(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('dark_mode').eq('user_id', userId).single()
    if (data && data.dark_mode !== null && data.dark_mode !== undefined) {
      return data.dark_mode
    }
  } catch(e) {}
  return null // null = not set yet, use default
}

export async function saveThemePreference(userId, email, darkMode) {
  try {
    await supabase.from('user_profiles').upsert(
      { user_id: userId, email, dark_mode: darkMode, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  } catch(e) { }
}

// ── USER PROFILE ──────────────────────────────────────────────────────────────
export async function fetchUserProfile(userId) {
  const { data } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single()
  return data || null
}

export async function upsertUserProfile(userId, email, updates) {
  const { data, error } = await supabase.from('user_profiles')
    .upsert({ ...updates, user_id: userId, email, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select().single()
  if (error) throw error
  return data
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function updateUserEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail })
  if (error) throw error
}

export async function updateUserPassword(currentPassword, newPassword, email) {
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (signInErr) throw new Error('Current password is incorrect')
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw error
}

// ── PROPERTY NOTES ────────────────────────────────────────────────────────────
export async function fetchNotes(propertyId, category) {
  let q = supabase.from('property_notes').select('*').eq('property_id', propertyId)
  if (category) q = q.eq('category', category)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createNote(propertyId, content, category, userId, userEmail) {
  const { data, error } = await supabase.from('property_notes')
    .insert({ property_id: propertyId, content, category, user_id: userId, user_email: userEmail })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteNote(id) {
  const { error } = await supabase.from('property_notes').delete().eq('id', id)
  if (error) throw error
}

// ── PROPERTY DOCUMENTS ────────────────────────────────────────────────────────
export async function fetchDocuments(propertyId) {
  const { data, error } = await supabase.from('property_documents')
    .select('*').eq('property_id', propertyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploadDocument(propertyId, propertyName, file, userId) {
  const ext = file.name.split('.').pop()
  const path = `${propertyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
  const { error: dbErr } = await supabase.from('property_documents').insert({
    property_id: propertyId, property_name: propertyName,
    name: file.name, file_path: path, url: publicUrl,
    size: file.size, type: file.type, user_id: userId,
  })
  if (dbErr) throw dbErr
  return publicUrl
}

export async function deleteDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('property_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// ── COMPANY DOCUMENTS ─────────────────────────────────────────────────────────
export async function fetchCompanyDocuments(companyId) {
  const { data, error } = await supabase.from('company_documents')
    .select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploadCompanyDocument(companyId, file, userId) {
  const ext = file.name.split('.').pop()
  const path = `company_${companyId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
  await supabase.from('company_documents').insert({
    company_id: companyId, name: file.name,
    file_path: path, url: publicUrl,
    size: file.size, type: file.type, user_id: userId,
  })
  return publicUrl
}

export async function deleteCompanyDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('company_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// ── USER ACCESS MANAGEMENT ────────────────────────────────────────────────────
export async function fetchAllUsers() {
  const { data, error } = await supabase.rpc('list_auth_users')
  if (error) throw error
  return data || []
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

// ── SORT ORDER ────────────────────────────────────────────────────────────────
export async function updatePropertySortOrder(id, sortOrder) {
  await supabase.from('properties').update({ sort_order: sortOrder }).eq('id', id)
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

// ── INVITATIONS ───────────────────────────────────────────────────────────────
export async function sendInvitation(companyIds, email, isAdmin = false) {
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds]
  const userId = (await supabase.auth.getUser()).data.user.id

  // Create one invitation row per company
  const rows = ids.map(company_id => ({ company_id, invited_by: userId, email, is_admin: isAdmin }))
  const { data, error } = await supabase.from('invitations').insert(rows).select()
  if (error) throw error

  // Trigger edge function — sends ONE email listing all companies
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const fnRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ invitation_ids: data.map(d => d.id) }),
    })
    const fnData = await fnRes.json()
    if (!fnRes.ok) throw new Error(fnData.error || fnData.message || 'Edge function error')
    return { data, emailSent: true }
  } catch(e) {
    return { data, emailSent: false, emailError: e.message }
  }
}

export async function fetchPendingInvitations(companyId) {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('company_id', companyId)
    .eq('accepted', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function acceptInvitation(token) {
  const { data, error } = await supabase
    .from('invitations')
    .update({ accepted: true, accepted_at: new Date().toISOString() })
    .eq('token', token)
    .eq('email', (await supabase.auth.getUser()).data.user.email)
    .select().single()
  if (error) throw error
  // Grant access to the company
  if (data) {
    await supabase.from('user_company_access').upsert({
      user_id: (await supabase.auth.getUser()).data.user.id,
      company_id: data.company_id,
      email: data.email,
      is_admin: data.is_admin,
      is_owner: false,
    }, { onConflict: 'user_id,company_id' })
  }
  return data
}

export async function deleteInvitation(id) {
  const { error } = await supabase.from('invitations').delete().eq('id', id)
  if (error) throw error
}

// ── PLATFORM ADMIN ────────────────────────────────────────────────────────────
export async function fetchIsPlatformAdmin() {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('platform_admin').eq('user_id', (await supabase.auth.getUser()).data.user.id).single()
    return data?.platform_admin === true
  } catch(e) { return false }
}

// ── BILLING ───────────────────────────────────────────────────────────────────
export async function fetchSubscriptions(companyIds) {
  if (!companyIds.length) return []
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .in('company_id', companyIds)
  if (error) throw error
  return data || []
}

export async function createCheckoutSession(companyId, action = 'checkout') {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ company_id: companyId, action }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Billing error')
  return data.url
}

export async function fetchAllCompaniesAdmin() {
  // Platform admin only — fetches all companies with owner emails
  const { data, error } = await supabase
    .from('companies')
    .select('*, subscriptions(*)')
    .order('name')
  if (error) throw error
  return data || []
}

export async function setCompanyFreeTier(companyId, isFreeTier, grantedBy) {
  const { error } = await supabase
    .from('companies')
    .update({
      is_free_tier: isFreeTier,
      free_tier_reason: isFreeTier ? 'Manually granted by admin' : null,
      free_tier_granted_by: isFreeTier ? grantedBy : null,
    })
    .eq('id', companyId)
  if (error) throw error
  // Update subscription status too
  await supabase
    .from('subscriptions')
    .update({ status: isFreeTier ? 'free_tier' : 'trialing' })
    .eq('company_id', companyId)
}

export async function fetchBillingStatus(companyId) {
  const { data } = await supabase
    .from('companies')
    .select('is_free_tier, trial_ends_at')
    .eq('id', companyId)
    .single()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('company_id', companyId)
    .single()
  return { company: data, subscription: sub }
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
export async function markOnboardingComplete(userId, email) {
  const { error } = await supabase.from('user_profiles').upsert({
    user_id: userId, email,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function fetchOnboardingStatus(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .single()
    return data?.onboarding_completed === true
  } catch(e) { return false }
}

// ── ADMIN: FULL COMPANY LIST WITH SUBS ───────────────────────────────────────
export async function fetchAdminAllCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select(`
      *,
      subscriptions ( status, property_count, current_period_end, stripe_subscription_id )
    `)
    .order('created_at', { ascending: false })
  if (error) throw error

  // Get real property counts directly from properties table
  const { data: propCounts } = await supabase
    .from('properties')
    .select('company_id')
  const countMap = {}
  if (propCounts) {
    propCounts.forEach(p => {
      countMap[p.company_id] = (countMap[p.company_id] || 0) + 1
    })
  }

  // Attach owner emails from user_profiles
  const ownerIds = [...new Set((data || []).map(c => c.owner_id).filter(Boolean))]
  let profileMap = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .in('user_id', ownerIds)
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p.email })
  }

  return (data || []).map(c => ({
    ...c,
    owner_email: profileMap[c.owner_id] || null,
    real_property_count: countMap[c.id] || 0,           // actual props on platform
    paid_property_count: c.subscriptions?.[0]?.property_count || 0, // Stripe billed count
  }))
}

// ── DEALS ─────────────────────────────────────────────────────────────────────
export const DEFAULT_MILESTONES_STANDARD = [
  { key:'offer_submitted',       label:'Offer submitted',                    stage:'offer',       sort:1,  required:true,  toggleable:false },
  { key:'offer_accepted',        label:'Offer accepted (verbal)',             stage:'offer',       sort:2,  required:false, toggleable:true  },
  { key:'memorandum_received',   label:'Memorandum of sale received',        stage:'offer',       sort:3,  required:false, toggleable:true  },
  { key:'solicitor_instructed',  label:'Solicitor instructed',               stage:'professionals',sort:4,  required:false, toggleable:true  },
  { key:'broker_instructed',     label:'Mortgage broker instructed',         stage:'professionals',sort:5,  required:false, toggleable:true  },
  { key:'mortgage_applied',      label:'Mortgage application submitted',     stage:'professionals',sort:6,  required:false, toggleable:true  },
  { key:'survey_instructed',     label:'Survey instructed',                  stage:'professionals',sort:7,  required:false, toggleable:true  },
  { key:'searches_ordered',      label:'Searches ordered',                   stage:'legal',       sort:8,  required:false, toggleable:true  },
  { key:'contract_pack_received',label:'Contract pack received',             stage:'legal',       sort:9,  required:false, toggleable:true  },
  { key:'survey_completed',      label:'Survey completed',                   stage:'legal',       sort:10, required:false, toggleable:true  },
  { key:'searches_received',     label:'Searches received',                  stage:'legal',       sort:11, required:false, toggleable:true  },
  { key:'enquiries_raised',      label:'Enquiries raised by solicitor',      stage:'legal',       sort:12, required:false, toggleable:true  },
  { key:'enquiries_satisfied',   label:'Enquiries satisfied',                stage:'legal',       sort:13, required:false, toggleable:true  },
  { key:'mortgage_offer',        label:'Mortgage offer received',            stage:'legal',       sort:14, required:false, toggleable:true  },
  { key:'insurance_arranged',    label:'Buildings insurance arranged',       stage:'exchange',    sort:15, required:false, toggleable:true  },
  { key:'deposit_paid',          label:'Deposit paid to solicitor',          stage:'exchange',    sort:16, required:false, toggleable:true  },
  { key:'insurance_active',      label:'Insurance active from exchange ✦',   stage:'exchange',    sort:17, required:true,  toggleable:false },
  { key:'contracts_exchanged',   label:'Contracts exchanged',                stage:'exchange',    sort:18, required:true,  toggleable:false },
  { key:'completion_date_set',   label:'Completion date confirmed',          stage:'exchange',    sort:19, required:false, toggleable:true  },
  { key:'funds_transferred',     label:'Completion funds transferred',       stage:'completion',  sort:20, required:true,  toggleable:false },
  { key:'keys_received',         label:'Keys received',                      stage:'completion',  sort:21, required:true,  toggleable:false },
  { key:'sdlt_filed',            label:'SDLT filed with HMRC (14 day deadline)', stage:'completion', sort:22, required:true, toggleable:false },
  { key:'title_registered',      label:'Title registered at Land Registry',  stage:'completion',  sort:23, required:false, toggleable:true  },
  { key:'utilities_transferred', label:'Utilities transferred',              stage:'completion',  sort:24, required:false, toggleable:true  },
]

export const DEFAULT_MILESTONES_AUCTION = [
  { key:'legal_pack_reviewed',   label:'Legal pack reviewed',                stage:'pre_auction', sort:1,  required:false, toggleable:true  },
  { key:'survey_pre_auction',    label:'Survey completed pre-auction',       stage:'pre_auction', sort:2,  required:false, toggleable:true  },
  { key:'finance_approved',      label:'Finance approved in principle',      stage:'pre_auction', sort:3,  required:false, toggleable:true  },
  { key:'insurance_quoted',      label:'Insurance quote obtained',           stage:'pre_auction', sort:4,  required:false, toggleable:true  },
  { key:'lot_won',               label:'Lot won at auction',                 stage:'auction_day', sort:5,  required:true,  toggleable:false },
  { key:'deposit_paid_auction',  label:'10% deposit paid on the day',        stage:'auction_day', sort:6,  required:true,  toggleable:false },
  { key:'insurance_active',      label:'Insurance active from today ✦',      stage:'auction_day', sort:7,  required:true,  toggleable:false },
  { key:'contracts_exchanged',   label:'Contracts exchanged on the day',     stage:'auction_day', sort:8,  required:true,  toggleable:false },
  { key:'solicitor_instructed',  label:'Solicitor instructed immediately',   stage:'completion',  sort:9,  required:false, toggleable:true  },
  { key:'searches_ordered',      label:'Searches ordered',                   stage:'completion',  sort:10, required:false, toggleable:true  },
  { key:'finance_arranged',      label:'Bridging/mortgage finance arranged', stage:'completion',  sort:11, required:false, toggleable:true  },
  { key:'funds_transferred',     label:'Completion funds transferred',       stage:'completion',  sort:12, required:true,  toggleable:false },
  { key:'keys_received',         label:'Keys received',                      stage:'completion',  sort:13, required:true,  toggleable:false },
  { key:'sdlt_filed',            label:'SDLT filed with HMRC (14 day deadline)', stage:'completion', sort:14, required:true, toggleable:false },
  { key:'title_registered',      label:'Title registered at Land Registry',  stage:'completion',  sort:15, required:false, toggleable:true  },
  { key:'utilities_transferred', label:'Utilities transferred',              stage:'completion',  sort:16, required:false, toggleable:true  },
]

export const DEFAULT_MILESTONES_BRRR = [
  { key:'refurb_complete',       label:'Refurbishment complete',             stage:'brrr',        sort:1,  required:false, toggleable:true  },
  { key:'refi_valuation',        label:'Refinance valuation instructed',     stage:'brrr',        sort:2,  required:false, toggleable:true  },
  { key:'refi_applied',          label:'New mortgage application submitted', stage:'brrr',        sort:3,  required:false, toggleable:true  },
  { key:'refi_offer',            label:'Refinance mortgage offer received',  stage:'brrr',        sort:4,  required:false, toggleable:true  },
  { key:'capital_released',      label:'Capital released from deal',         stage:'brrr',        sort:5,  required:false, toggleable:true  },
]

export async function fetchDeals(userId) {
  const { data, error } = await supabase.from('deals').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createDeal(userId, fields = {}) {
  const { data, error } = await supabase.from('deals')
    .insert({ user_id: userId, ...fields }).select().single()
  if (error) throw error
  return data
}

export async function updateDeal(id, fields) {
  const { data, error } = await supabase.from('deals')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteDeal(id) {
  const { error } = await supabase.from('deals').delete().eq('id', id)
  if (error) throw error
}

export async function duplicateDeal(deal) {
  const { id, created_at, updated_at, ...rest } = deal
  const { data, error } = await supabase.from('deals')
    .insert({ ...rest, name: rest.name + ' (copy)', status: 'analysing' }).select().single()
  if (error) throw error
  return data
}

export async function fetchDealMilestones(dealId) {
  const { data, error } = await supabase.from('deal_milestones')
    .select('*').eq('deal_id', dealId).order('sort_order')
  if (error) throw error
  return data || []
}

export async function initialiseMilestones(dealId, isAuction, isBRRR, milestoneConfig = {}) {
  const base = isAuction ? DEFAULT_MILESTONES_AUCTION : DEFAULT_MILESTONES_STANDARD
  const milestones = isBRRR ? [...base, ...DEFAULT_MILESTONES_BRRR] : base
  const rows = milestones.map(m => ({
    deal_id: dealId, milestone_key: m.key, label: m.label,
    stage: m.stage, sort_order: m.sort, is_required: m.required,
    // Apply user's master settings — if key is false in config, disable it
    is_enabled: milestoneConfig[m.key] !== false,
    completed: false,
  }))
  const { error } = await supabase.from('deal_milestones').insert(rows)
  if (error) throw error
}

export async function updateMilestone(id, fields) {
  const { error } = await supabase.from('deal_milestones').update(fields).eq('id', id)
  if (error) throw error
}

export async function fetchDealContacts(dealId) {
  const { data, error } = await supabase.from('deal_contacts')
    .select('*').eq('deal_id', dealId).order('created_at')
  if (error) throw error
  return data || []
}

export async function upsertDealContact(dealId, contact) {
  if (contact.id) {
    const { data, error } = await supabase.from('deal_contacts').update(contact).eq('id', contact.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('deal_contacts').insert({ ...contact, deal_id: dealId }).select().single()
  if (error) throw error
  return data
}

export async function deleteDealContact(id) {
  const { error } = await supabase.from('deal_contacts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDealDocuments(dealId) {
  const { data, error } = await supabase.from('deal_documents')
    .select('*').eq('deal_id', dealId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploadDealDocument(dealId, file, userId) {
  const ext = file.name.split('.').pop()
  const path = `deal_${dealId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('property-documents').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
  const { error } = await supabase.from('deal_documents').insert({
    deal_id: dealId, name: file.name, file_path: path,
    url: publicUrl, size: file.size, type: file.type, user_id: userId,
  })
  if (error) throw error
  return publicUrl
}

export async function deleteDealDocument(doc) {
  if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
  const { error } = await supabase.from('deal_documents').delete().eq('id', doc.id)
  if (error) throw error
}

// Stamp duty calculator (UK 2024 rates)
export function calcStampDuty(price, isAdditional = true, isFirstTimeBuyer = false) {
  if (!price || price <= 0) return 0
  let duty = 0
  if (isFirstTimeBuyer && !isAdditional) {
    // FTB relief
    if (price <= 425000) return 0
    if (price <= 625000) duty = (price - 425000) * 0.05
    else {
      duty = (625000 - 425000) * 0.05
      duty += (Math.min(price, 925000) - 625000) * 0.05
      if (price > 925000) duty += (Math.min(price, 1500000) - 925000) * 0.10
      if (price > 1500000) duty += (price - 1500000) * 0.12
    }
    return Math.round(duty)
  }
  // Standard rates
  if (price > 250000) duty += (Math.min(price, 925000) - 250000) * 0.05
  if (price > 925000) duty += (Math.min(price, 1500000) - 925000) * 0.10
  if (price > 1500000) duty += (price - 1500000) * 0.12
  // Additional property surcharge
  if (isAdditional) duty += price * 0.03
  return Math.round(duty)
}

// Mortgage repayment calculator
export function calcMonthlyRepayment(principal, ratePercent, termYears) {
  if (!principal || !ratePercent || !termYears) return 0
  const r = (ratePercent / 100) / 12
  const n = termYears * 12
  return Math.round(principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1))
}

// ── MASTER MILESTONE SETTINGS ─────────────────────────────────────────────────
export async function fetchMilestoneDefaults(userId) {
  try {
    const { data } = await supabase.from('user_profiles')
      .select('milestone_config').eq('user_id', userId).single()
    return data?.milestone_config || {}
  } catch(e) { return {} }
}

export async function saveMilestoneDefaults(userId, email, config) {
  const { error } = await supabase.from('user_profiles').upsert({
    user_id: userId, email,
    milestone_config: config,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

// ── COMPANY BRANDING & REPORT SETTINGS ───────────────────────────────────────
export async function saveReportSettings(companyId, settings) {
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, ...settings, updated_at: new Date().toISOString() },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}


// ── REPORTS DATA FETCHING ─────────────────────────────────────────────────────
export async function fetchAllComplianceItems(userId) {
  const { data, error } = await supabase.from('compliance_items')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('expiry_date')
  if (error) throw error
  return data || []
}

export async function fetchAllMaintenanceJobs(userId) {
  const { data, error } = await supabase.from('maintenance_jobs')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllTenancies(userId) {
  const { data, error } = await supabase.from('tenancy_details')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function fetchAllRentPayments(userId) {
  const { data, error } = await supabase.from('rent_payments')
    .select('*, property:properties(id,name,company_id,rent_pcm,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('payment_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAllExpenses(userId) {
  const { data, error } = await supabase.from('property_expenses')
    .select('*, property:properties(id,name,company_id,company:companies(name,abbr,color))')
    .eq('user_id', userId).order('date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveCompanyYearType(companyId, yearType) {
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, year_type: yearType },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}

export async function uploadCompanyLogo(companyId, file) {
  const ext = file.name.split('.').pop()
  const path = `company_logos/${companyId}.${ext}`
  await supabase.storage.from('property-documents').remove([path]).catch(()=>{})
  const { error: upErr } = await supabase.storage.from('property-documents').upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, logo_url: publicUrl, logo_path: path },
    { onConflict: 'company_id' }
  )
  if (error) throw error
  return publicUrl
}

// ── ADDRESS BOOK ──────────────────────────────────────────────────────────────
export async function fetchAddressBook(userId) {
  const { data, error } = await supabase.from('address_book')
    .select('*').eq('user_id', userId).order('name')
  if (error) throw error
  return data || []
}

export async function saveToAddressBook(userId, contact) {
  const { id, deal_id, created_at, ...fields } = contact
  const { data, error } = await supabase.from('address_book')
    .insert({ ...fields, user_id: userId, updated_at: new Date().toISOString() })
    .select().single()
  if (error) throw error
  return data
}

export async function updateAddressBookEntry(id, fields) {
  const { data, error } = await supabase.from('address_book')
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteAddressBookEntry(id) {
  const { error } = await supabase.from('address_book').delete().eq('id', id)
  if (error) throw error
}

// ── DELETE USER (platform admin only, calls edge function) ────────────────────
export async function deleteUser(targetUserId) {
  const { data: { session } } = await supabase.auth.getSession()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const response = await fetch(
    `${supabaseUrl}/functions/v1/delete-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ target_user_id: targetUserId }),
    }
  )
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── ADMIN SUITE ───────────────────────────────────────────────────────────────
export async function fetchAdminNotes(companyId) {
  const { data, error } = await supabase.from('admin_notes')
    .select('*').eq('company_id', companyId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addAdminNote(adminId, companyId, note) {
  const { data, error } = await supabase.from('admin_notes')
    .insert({ admin_id: adminId, company_id: companyId, note }).select().single()
  if (error) throw error
  return data
}

export async function deleteAdminNote(id) {
  const { error } = await supabase.from('admin_notes').delete().eq('id', id)
  if (error) throw error
}

export async function setCompanyFlag(companyId, flagged) {
  const { error } = await supabase.from('companies').update({ flagged }).eq('id', companyId)
  if (error) throw error
}

export async function extendTrial(companyId, days) {
  const newDate = new Date()
  newDate.setDate(newDate.getDate() + days)
  const { error } = await supabase.from('companies')
    .update({ trial_ends_at: newDate.toISOString() }).eq('id', companyId)
  if (error) throw error
  return newDate
}

export async function fetchAnnouncements() {
  const { data } = await supabase.from('admin_announcements')
    .select('*').eq('is_active', true).order('created_at', { ascending: false })
  return data || []
}

export async function createAnnouncement(msg, type, linkText, linkUrl, adminId) {
  const { data, error } = await supabase.from('admin_announcements')
    .insert({ message: msg, type, link_text: linkText, link_url: linkUrl, created_by: adminId, is_active: true })
    .select().single()
  if (error) throw error
  return data
}

export async function deactivateAnnouncement(id) {
  const { error } = await supabase.from('admin_announcements').update({ is_active: false }).eq('id', id)
  if (error) throw error
}

export async function sendAdminEmail(session, to, subject, message) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const res = await fetch(`${supabaseUrl}/functions/v1/send-admin-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ to, subject, message })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

// ── TENANT PORTAL ─────────────────────────────────────────────────────────────
export async function checkIsTenant(userId) {
  try {
    const { data } = await supabase.from('tenant_profiles')
      .select('*, property:properties(*, company:companies(*))').eq('user_id', userId)
    return data || []
  } catch(e) { return [] }
}

export async function inviteTenant(propertyId, email, invitedBy) {
  // Create a Supabase auth invite
  const { data, error } = await supabase.auth.admin ? 
    { error: new Error('Use edge function') } : { error: new Error('Use edge function') }
  // Store pending invite in a simple way - email the tenant with a signup link
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

export async function submitMaintenanceRequest(propertyId, tenantUserId, title, description, priority) {
  const { data, error } = await supabase.from('maintenance_jobs').insert({
    property_id: propertyId, title, description, priority, status: 'open',
    reported_by_tenant: true, user_id: tenantUserId
  }).select().single()
  if (error) throw error
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
  return data
}

export async function markMessagesRead(propertyId, tenantUserId) {
  await supabase.from('tenant_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('property_id', propertyId).eq('sender_type', 'landlord').is('read_at', null)
}

export async function fetchTenancyDetails(propertyId) {
  const { data } = await supabase.from('tenancy_details')
    .select('*').eq('property_id', propertyId).single()
  return data
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

// ── SUBDOMAIN / COMPANY LOOKUP ────────────────────────────────────────────────
export async function fetchCompanyBySubdomain(subdomain) {
  const { data, error } = await supabase
    .from('companies')
    .select('*, company_settings:company_settings(*)')
    .eq('subdomain', subdomain.toLowerCase())
    .single()
  if (error) return null
  return data
}

export async function fetchCompanyBankDetails(companyId) {
  const { data } = await supabase.from('company_settings')
    .select('bank_name, bank_sort_code, bank_account_no, bank_reference_prefix, logo_url')
    .eq('company_id', companyId).single()
  return data || {}
}

export async function saveCompanyBankDetails(companyId, details) {
  const { error } = await supabase.from('company_settings').upsert(
    { company_id: companyId, ...details },
    { onConflict: 'company_id' }
  )
  if (error) throw error
}

export async function saveCompanySubdomain(companyId, subdomain) {
  const { error } = await supabase.from('companies')
    .update({ subdomain: subdomain.toLowerCase() }).eq('id', companyId)
  if (error) throw error
}

export async function uploadMaintenancePhoto(jobId, file) {
  const ext = file.name.split('.').pop()
  const path = `maintenance/${jobId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('property-documents').upload(path, file, { upsert: true })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('property-documents').getPublicUrl(path)
  return { url: publicUrl, path, name: file.name }
}

export async function attachPhotosToJob(jobId, photos) {
  const { error } = await supabase.from('maintenance_jobs')
    .update({ photos: photos }).eq('id', jobId)
  if (error) throw error
}

export async function fetchTenantPaymentTracker(propertyId) {
  // Get last 12 months of rent payments
  const { data } = await supabase.from('rent_payments')
    .select('*').eq('property_id', propertyId)
    .order('payment_date', { ascending: false })
  return data || []
}

// ── AUDIT LOG ─────────────────────────────────────────────────────────────────
export async function logAction(userId, companyId, action, entityType, entityId, entityName, metadata = {}) {
  try {
    await supabase.from('audit_log').insert({
      user_id: userId, company_id: companyId, action,
      entity_type: entityType, entity_id: entityId,
      entity_name: entityName, metadata,
    })
  } catch(e) {} // Never block the main action if logging fails
}

export async function fetchAuditLog(userId, companyId, limit = 100) {
  const q = supabase.from('audit_log').select('*')
  if (companyId) q.eq('company_id', companyId)
  else q.eq('user_id', userId)
  const { data } = await q.order('created_at', { ascending: false }).limit(limit)
  return data || []
}

// ── SOFT DELETE ───────────────────────────────────────────────────────────────
export async function softDeleteProperty(propertyId, userId) {
  const { error } = await supabase.from('properties')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', propertyId)
  if (error) throw error
  await logAction(userId, null, 'property.deleted', 'property', propertyId, null)
}

export async function restoreProperty(propertyId, userId) {
  const { error } = await supabase.from('properties')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', propertyId)
  if (error) throw error
  await logAction(userId, null, 'property.restored', 'property', propertyId, null)
}

export async function fetchDeletedProperties(userId) {
  const { data, error } = await supabase.from('properties')
    .select('*, company:companies(name,abbr,color)')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ── GDPR DATA EXPORT ──────────────────────────────────────────────────────────
export async function exportUserData(userId) {
  const [
    profile, companies, properties, deals,
    compliance, maintenance, expenses, tenancies,
    rentPayments, documents
  ] = await Promise.all([
    supabase.from('user_profiles').select('*').eq('user_id', userId).single().then(r=>r.data),
    supabase.from('companies').select('*').eq('owner_id', userId).then(r=>r.data||[]),
    supabase.from('properties').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('deals').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('compliance_items').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('maintenance_jobs').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('property_expenses').select('*').eq('user_id', userId).then(r=>r.data||[]),
    supabase.from('tenancy_details').select('*').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[]),
    supabase.from('rent_payments').select('*').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[]),
    supabase.from('property_documents').select('id,name,created_at,url').eq('user_id', userId).then(r=>r.data||[]).catch(()=>[]),
  ])
  return {
    exported_at: new Date().toISOString(),
    user_id: userId,
    profile,
    companies,
    properties,
    deals,
    compliance_items: compliance,
    maintenance_jobs: maintenance,
    expenses,
    tenancies,
    rent_payments: rentPayments,
    documents: documents.map(d=>({ id:d.id, name:d.name, created_at:d.created_at, url:d.url })),
  }
}
