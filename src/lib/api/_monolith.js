import { supabase } from '../supabase'
import { collectClientFraudHeaders } from '../hmrcFraudHeaders'
import { RECEIVED_STATUSES, estimateMortgageInterest } from '../mtdItsa'
import { ROLE_DEFAULTS, getEffectivePermissions } from './roles'

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
  // redirectTo lands the recovery link on the app origin, where AuthContext's
  // PASSWORD_RECOVERY handler shows the set-new-password screen.
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  if (error) throw error
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

// ── REFERRALS ─────────────────────────────────────────────────────────────────
export async function fetchOrCreateReferralCode(userId, email) {
  const { data: existing } = await supabase.from('user_profiles')
    .select('referral_code').eq('user_id', userId).single()
  if (existing?.referral_code) return existing.referral_code
  const code = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,'') + Math.random().toString(36).substring(2,6)
  await supabase.from('user_profiles').update({ referral_code: code }).eq('user_id', userId)
  return code
}

export async function fetchReferrals(userId) {
  const { data } = await supabase.from('referrals').select('*').eq('referrer_id', userId).order('created_at', { ascending: false })
  return data || []
}

// ── ONBOARDING EMAIL ──────────────────────────────────────────────────────────
// No-op stub. The /functions/v1/onboarding-email edge function was
// never deployed, so every call from App.jsx login → 404 + CORS spam
// in the logs (was firing on every page load). Kept the export so we
// don't have to rip the call site out; when we want real onboarding
// emails, build the edge function and replace this body.
export async function sendOnboardingEmail(_email, _name, _sequence) {
  return null
}

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

// ── DASHBOARD WIDGET + SECTION PREFS ─────────────────────────────────────────
// Stored per-user in user_profiles as JSONB arrays of { key, enabled }:
// dashboard_widgets (KPI cards) and dashboard_sections (page sections).
// Section order used to live only in localStorage, so it was lost on another
// device, browser, private window or storage clear.
export async function fetchWidgetPrefs() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return null
    const { data } = await supabase.from('user_profiles').select('dashboard_widgets').eq('user_id', u.id).single()
    return data?.dashboard_widgets || null
  } catch(e) { return null }
}

export async function fetchSectionPrefs() {
  try {
    const u = (await supabase.auth.getUser()).data.user
    if (!u) return null
    const { data } = await supabase.from('user_profiles').select('dashboard_sections').eq('user_id', u.id).maybeSingle()
    return data?.dashboard_sections || null
  } catch(e) { return null }
}

// Upsert, not update: a user without a user_profiles row would otherwise
// "save" zero rows and report success.
async function saveDashboardPref(column, value) {
  const u = (await supabase.auth.getUser()).data.user
  if (!u) throw new Error('Not signed in')
  const { error } = await supabase.from('user_profiles')
    .upsert({ user_id: u.id, [column]: value }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function saveWidgetPrefs(widgets) {
  await saveDashboardPref('dashboard_widgets', widgets)
}

export async function saveSectionPrefs(sections) {
  await saveDashboardPref('dashboard_sections', sections)
}

// ── MTD ITSA (Making Tax Digital — Income Tax Self Assessment) ────────────────
// HMRC mandate hits 6 Apr 2026 for landlords > £50k income, 6 Apr 2027 > £30k.
// We provide per-user HMRC settings (NINO + business ID + OAuth tokens) and
// per-quarter submission rows with the aggregated income/expenses snapshot.

// Never select the HMRC token columns: anon/authenticated have no SELECT on
// them (2026-10-14_integration_token_column_grants.sql), so '*' would fail.
const MTD_SETTINGS_SAFE_COLS = 'user_id, nino, mtd_business_id, sandbox_mode, cash_basis, property_business_type, hmrc_token_expires_at, created_at, updated_at'

export async function fetchMtdSettings() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  // Explicit column list — never pull the OAuth tokens back to the client.
  // Token presence is exposed as the boolean `hmrc_oauth_connected` so the
  // UI can show whether the user has done the gov.uk handshake without
  // sending the actual token over the wire.
  const { data, error } = await supabase
    .from('mtd_settings')
    .select(MTD_SETTINGS_SAFE_COLS)
    .eq('user_id', uid).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...data,
    // Synthetic flag for UI gating — true if a non-expired access token exists.
    hmrc_access_token: !!(data.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function saveMtdSettings(patch) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  // Never let the client write OAuth tokens directly — those land via the
  // mtd-submit edge function during the HMRC OAuth callback.
  const safe = { ...patch }
  delete safe.hmrc_access_token
  delete safe.hmrc_refresh_token
  delete safe.encrypted_hmrc_access_token
  delete safe.encrypted_hmrc_refresh_token
  delete safe.hmrc_token_expires_at
  const { data, error } = await supabase
    .from('mtd_settings')
    .upsert({ user_id: uid, ...safe }, { onConflict: 'user_id' })
    .select(MTD_SETTINGS_SAFE_COLS).single()
  if (error) throw error
  return {
    ...data,
    // Same synthetic flag as fetchMtdSettings (the token itself is never read).
    hmrc_access_token: !!(data?.hmrc_token_expires_at && new Date(data.hmrc_token_expires_at) > new Date()),
  }
}

export async function fetchMtdSubmissions(taxYear) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  let q = supabase.from('mtd_submissions').select('*').eq('user_id', uid)
  if (taxYear) q = q.eq('tax_year', taxYear)
  const { data, error } = await q.order('quarter_number', { ascending: true })
  if (error) throw error
  return data || []
}

export async function upsertMtdSubmission({ tax_year, quarter_number, period_from, period_to, deadline, summary_json, status = 'draft' }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('mtd_submissions')
    .upsert({
      user_id: uid, tax_year, quarter_number, period_from, period_to, deadline,
      summary_json, status,
    }, { onConflict: 'user_id,tax_year,quarter_number' })
    .select().single()
  if (error) throw error
  return data
}

// Aggregate the user's rent + expenses for a given period across ALL their
// personally held properties. Returns the raw rows so the caller can run
// buildQuarterlySummary from src/lib/mtdItsa.js client-side (keeps tax logic
// in one place).
export async function fetchMtdRawForPeriod({ periodFrom, periodTo, propertyIds = null }) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')

  // Default: all user's non-deleted properties. Companies are also used as
  // plain portfolio groups (nearly every property has a company_id), so
  // company_id can't tell a limited-company holding from a personal one;
  // excluding company properties needs an explicit ownership flag first.
  // We also need mortgage_amount +
  // mortgage_rate so we can compute the period's mortgage interest accrual
  // (residential financial cost — gets 20% basic-rate relief under S24).
  let propIds = propertyIds
  let mortgageProps = []
  if (!propIds) {
    const { data: props, error: pe } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .eq('user_id', uid).is('deleted_at', null)
    if (pe) throw pe
    propIds = (props || []).map(p => p.id)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  } else {
    const { data: props } = await supabase
      .from('properties').select('id, mortgage_amount, mortgage_rate')
      .in('id', propIds).is('deleted_at', null)
    mortgageProps = (props || []).filter(p => Number(p.mortgage_amount) > 0 && Number(p.mortgage_rate) > 0)
  }
  if (propIds.length === 0) return { payments: [], expenses: [], mortgageInterest: 0 }

  // Legacy rows carry only year/month (period_start IS NULL) — a plain
  // gte/lte on period_start silently excludes them, understating MTD income.
  // Fetch NULL-period rows too, synthesise whole-month period dates from
  // year/month, then re-filter to the requested window client-side.
  const [paymentsRes, expensesRes] = await Promise.all([
    supabase.from('rent_payments').select('id, property_id, amount, period_start, period_end, status, year, month')
      .in('property_id', propIds)
      .in('status', RECEIVED_STATUSES)
      .or(`and(period_start.gte.${periodFrom},period_start.lte.${periodTo}),period_start.is.null`),
    supabase.from('property_expenses').select('id, property_id, amount, date, category, description')
      .in('property_id', propIds)
      .is('deleted_at', null)
      .gte('date', periodFrom).lte('date', periodTo),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (expensesRes.error) throw expensesRes.error

  const pad2 = (n) => String(n).padStart(2, '0')
  const payments = (paymentsRes.data || [])
    .map(p => {
      if (p.period_start || !p.year || !p.month) return p
      const lastDay = new Date(p.year, p.month, 0).getDate()
      return {
        ...p,
        period_start: `${p.year}-${pad2(p.month)}-01`,
        period_end: p.period_end || `${p.year}-${pad2(p.month)}-${pad2(lastDay)}`,
      }
    })
    .filter(p => p.period_start && p.period_start >= periodFrom && p.period_start <= periodTo)

  // Estimated mortgage interest accrued over the period =
  //   sum(balance × annual_rate) × (period_days / 365)
  // mortgage_rate is stored as DECIMAL (0.05 for 5%). Year-one approximation
  // (true interest declines as principal is paid down on repayment mortgages).
  // Properties with actual 'mortgage_interest' expenses recorded in the
  // period are left out of the estimate: the recorded figure is used instead.
  const expenses = expensesRes.data || []
  const mortgageInterest = estimateMortgageInterest({ mortgageProps, expenses, periodFrom, periodTo })

  return { payments, expenses, mortgageInterest }
}

// Start the HMRC gov.uk OAuth flow. Returns nothing — performs a
// full-page redirect to HMRC's authorize endpoint. After the user
// consents, HMRC redirects back to our hmrc-oauth-callback edge
// function which stores tokens + bounces user back here with
// ?hmrc_connected=1.
export async function startHmrcOAuth() {
  const { data, error } = await supabase.functions.invoke('hmrc-oauth-callback', {
    body: { action: 'start', return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('HMRC OAuth not configured — Justin needs to set HMRC_CLIENT_ID and add the redirect URI to the HMRC dev hub app.')
  window.location.href = data.authorize_url
}

// Clear the stored HMRC access + refresh tokens (next submission falls
// back to the local mock path). Keeps NINO / business ID / cash basis
// settings intact.
export async function disconnectHmrc() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase.from('mtd_settings').update({
    hmrc_access_token: null,
    hmrc_refresh_token: null,
    encrypted_hmrc_access_token: null,
    encrypted_hmrc_refresh_token: null,
    hmrc_token_expires_at: null,
  }).eq('user_id', uid)
  if (error) throw error
}

// Submit (or re-submit) a quarterly summary to HMRC via the mtd-submit
// edge function. In sandbox mode the edge function returns a mock
// reference; otherwise we collect Gov-Client-* fraud prevention headers
// (mandatory per HMRC's Fraud Prevention Spec — submissions without
// them are increasingly rejected in sandbox and always rejected in
// production) and pass them along so the edge function can forward
// them to HMRC.
export async function submitMtdQuarter(submissionId) {
  const fraudHeaders = await collectClientFraudHeaders()
  const { data, error } = await supabase.functions.invoke('mtd-submit', {
    body: { submission_id: submissionId, fraud_headers: fraudHeaders }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ── XERO INTEGRATION ─────────────────────────────────────────────────────────
//
// Phase 2 (24 May 2026): multi-company. xero_connections is now keyed by
// (user_id, company_id) so a user with multiple OwnProperly companies can
// link a SEPARATE Xero org per company. Most helpers take companyId.

// Returns ALL of the user's Xero connections (one per company).
export async function fetchXeroConnections() {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('xero_connections')
    .select('user_id, company_id, tenant_id, tenant_name, expires_at, scopes, last_sync_at, last_sync_status, last_sync_error, created_at')
    .eq('user_id', uid)
  if (error) throw error
  return data || []
}

// Start the Xero OAuth flow for a SPECIFIC company. The companyId is
// encoded in the state token so the callback knows which company to
// associate the new tokens with.
export async function startXeroOAuth(companyId) {
  if (!companyId) throw new Error('companyId required — Xero connections are per-company')
  const { data, error } = await supabase.functions.invoke('xero-oauth-callback', {
    body: { action: 'start', company_id: companyId, return_to: window.location.href }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (!data?.authorize_url) throw new Error('Xero auth not configured — Justin needs to set XERO_CLIENT_ID')
  window.location.href = data.authorize_url
}

export async function disconnectXero(companyId) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const { error } = await supabase
    .from('xero_connections').delete()
    .eq('user_id', uid).eq('company_id', companyId)
  if (error) throw error
}

export async function runXeroSync(companyId, direction = 'to_xero') {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { direction, company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// What a push would post (counts, totals, bank, start date) without
// posting. The UI shows it in a confirm dialog before every manual push.
export async function previewXeroSync(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'preview', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Delete from Xero the transactions the latest push posted. dryRun only
// counts them.
export async function undoXeroPush(companyId, { dryRun = false } = {}) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'undo_push', company_id: companyId, dry_run: dryRun }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ── Per-(user,company) Xero sync settings ──────────────────────────────

export async function fetchXeroSyncSettings(companyId) {
  if (!companyId) return null
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  const { data, error } = await supabase
    .from('xero_sync_settings').select('*')
    .eq('user_id', uid).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveXeroSyncSettings(companyId, patch) {
  if (!companyId) throw new Error('companyId required')
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Not signed in')
  const safe = { ...patch }
  // Server-managed fields the client shouldn't write
  delete safe.user_id; delete safe.company_id
  delete safe.created_at; delete safe.updated_at
  const { data, error } = await supabase
    .from('xero_sync_settings')
    .upsert({ user_id: uid, company_id: companyId, ...safe }, { onConflict: 'user_id,company_id' })
    .select().single()
  if (error) throw error
  return data
}

// Live-fetch the user's chart of accounts + bank accounts from Xero so
// the UI can render <select> dropdowns for the user to pick which
// account codes to use. Calls xero-sync with action='list_accounts'.
export async function fetchXeroAccounts(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'list_accounts', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.accounts || []
}

// Sync only specific properties (per-property "Sync just this one" button).
export async function runXeroSyncForProperties(companyId, propertyIds) {
  if (!companyId) throw new Error('companyId required')
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) throw new Error('propertyIds required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'both', company_id: companyId, property_ids: propertyIds }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// Wipe the sync map for this (user, company). After this, the next
// normal sync re-pushes everything. Used by the "Re-sync everything"
// button after the user has cleared records on the Xero side.
export async function resyncAllXero(companyId) {
  if (!companyId) throw new Error('companyId required')
  const { data, error } = await supabase.functions.invoke('xero-sync', {
    body: { action: 'resync_all', company_id: companyId }
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.cleared || 0
}
