// Account: user profile, auth, onboarding, referrals and dashboard prefs.
import { supabase } from '../supabase'

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
