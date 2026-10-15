// Platform admin: company admin actions, user deletion and the admin suite
// (notes, flags, inbox tokens, trials, announcements).
import { supabase } from '../supabase'

// ── ADMIN: CREATE COMPANY FOR A SPECIFIC USER ────────────────────────────────
export async function adminCreateCompanyForUser(userId, userEmail, name, abbr, color) {
  // Creates a new company owned by a target user (admin action)
  // Note: owner_email is NOT stored on the companies table — it's derived from user_profiles
  const { data: co, error } = await supabase
    .from('companies')
    .insert({ name, abbr: (abbr || name.slice(0,3)).toUpperCase(), color: color || '#C8A84B', owner_id: userId })
    .select()
    .single()
  if (error) throw error
  return co
}

// ── ADMIN: MERGE TWO COMPANIES (move all properties from source to target, delete source) ──
export async function adminMergeCompanies(sourceCompanyId, targetCompanyId) {
  // Move all properties from source to target
  const { error: pErr } = await supabase
    .from('properties')
    .update({ company_id: targetCompanyId })
    .eq('company_id', sourceCompanyId)
  if (pErr) throw pErr

  // Move access rows
  const { data: existingTarget } = await supabase.from('user_company_access').select('user_id').eq('company_id', targetCompanyId)
  const existingIds = new Set((existingTarget || []).map(r => r.user_id))
  const { data: sourceAccess } = await supabase.from('user_company_access').select('*').eq('company_id', sourceCompanyId)
  if (sourceAccess) {
    for (const row of sourceAccess) {
      if (!existingIds.has(row.user_id)) {
        await supabase.from('user_company_access').insert({ user_id: row.user_id, company_id: targetCompanyId, email: row.email })
      }
    }
    await supabase.from('user_company_access').delete().eq('company_id', sourceCompanyId)
  }

  // Delete the source company
  const { error: dErr } = await supabase.from('companies').delete().eq('id', sourceCompanyId)
  if (dErr) throw dErr
  return { success: true }
}

// ── ADMIN: TRANSFER COMPANY OWNERSHIP TO ANOTHER USER ────────────────────────
export async function adminTransferCompany(companyId, newOwnerId, newOwnerEmail) {
  // Note: owner_email is NOT stored on the companies table — it's derived from user_profiles
  // Step 1: Update the company's owner
  const { error } = await supabase
    .from('companies')
    .update({ owner_id: newOwnerId })
    .eq('id', companyId)
  if (error) throw error

  // Step 2: Make sure the new owner has an access row with is_admin=true
  // (Upsert — if they already had shared access it gets promoted to admin; if not it creates a fresh row)
  try {
    await supabase.from('user_company_access')
      .upsert({ user_id: newOwnerId, company_id: companyId, email: newOwnerEmail, is_admin: true },
              { onConflict: 'user_id,company_id' })
  } catch (e) { /* Non-fatal — ownership transfer already succeeded */ }

  return { success: true }
}

// ── ADMIN: FULL COMPANY LIST WITH SUBS ───────────────────────────────────────
// Fetches all companies + their subscription status as a flat list for the
// admin dashboard. Previously used a PostgREST embedded join (`subscriptions(...)`)
// but that occasionally returned an empty `subscriptions` array even when
// the row clearly exists in the DB — turned out to be PostgREST schema
// cache flakiness on this particular relationship. Switched to two
// independent queries + a client-side merge: bulletproof.
export async function fetchAdminAllCompanies() {
  const [{ data: cos, error: ce }, { data: subs }, { data: propCounts }] = await Promise.all([
    supabase.from('companies').select('*').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('company_id, status, property_count, current_period_end, stripe_subscription_id, tier'),
    supabase.from('properties').select('company_id'),
  ])
  if (ce) throw ce

  // Group subscriptions by company_id (most companies have at most 1; defensive in case of dupes)
  const subsByCo = {}
  for (const s of (subs || [])) {
    (subsByCo[s.company_id] ||= []).push(s)
  }

  // Count properties per company
  const countMap = {}
  for (const p of (propCounts || [])) {
    countMap[p.company_id] = (countMap[p.company_id] || 0) + 1
  }

  // Attach owner emails from user_profiles
  const ownerIds = [...new Set((cos || []).map(c => c.owner_id).filter(Boolean))]
  let profileMap = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .in('user_id', ownerIds)
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p.email })
  }

  return (cos || []).map(c => ({
    ...c,
    subscriptions: subsByCo[c.id] || [],
    owner_email: profileMap[c.owner_id] || null,
    real_property_count: countMap[c.id] || 0,
    paid_property_count: subsByCo[c.id]?.[0]?.property_count || 0,
  }))
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

// Fetch the statement-email inbox token for a company. Used by the
// CompanyInboxPanel to display the per-company forwarding address.
export async function fetchCompanyInboxToken(companyId) {
  const { data, error } = await supabase
    .from('companies').select('statement_email_token')
    .eq('id', companyId).single()
  if (error) throw error
  return data?.statement_email_token || null
}

// Rotate the token (in case the address leaks / spam starts coming in).
// Server-side RPC only: it owns the address format (<company-slug>-<key>)
// and the owner/admin permission check. Returns the new token.
export async function rotateCompanyInboxToken(companyId) {
  const { data, error } = await supabase.rpc('regenerate_statement_email_token', { p_company_id: companyId })
  if (error) throw error
  return data
}

export async function extendTrial(companyId, days) {
  const newDate = new Date()
  newDate.setDate(newDate.getDate() + days)
  const { error } = await supabase.from('companies')
    .update({ trial_ends_at: newDate.toISOString() }).eq('id', companyId)
  if (error) throw error
  return newDate
}

// Force-end a trial right now. Sets companies.trial_ends_at = now() so
// the trial period is over, and flips any matching subscription row to
// 'past_due' so the BillingPage shows the "Add payment method" CTA
// the next time the customer signs in (existing logic at
// BillingPage.jsx:126 — past_due renders the upgrade prompt). After
// this, only payment via Stripe Checkout restores access.
//
// Returns true on success; throws on the company update so the admin
// UI can surface a clear error. The subscription update is best-effort
// (some companies don't have a subscription row yet — that's fine, the
// trial_ends_at change alone forces re-billing once they sign in).
export async function endTrialNow(companyId) {
  const now = new Date()
  const { error: coErr } = await supabase.from('companies')
    .update({ trial_ends_at: now.toISOString() }).eq('id', companyId)
  if (coErr) throw coErr
  // Mirror on subscriptions if a row exists — best-effort.
  try {
    await supabase.from('subscriptions')
      .update({ status: 'past_due', updated_at: now.toISOString() })
      .eq('company_id', companyId)
      .in('status', ['trialing', 'free_tier'])
  } catch (_) { /* swallow — companies update is the source of truth */ }
  return now
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
