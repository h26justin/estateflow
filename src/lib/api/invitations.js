// Invitations: per-email invitations and shareable company invite codes.
import { supabase } from '../supabase'

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

// Accepting is done server-side by accept_company_invitation() (SECURITY
// DEFINER): it checks the token belongs to the signed-in email, is unexpired
// and unaccepted, then marks the invitations accepted and grants access.
// The browser can no longer insert its own user_company_access rows.
// Inviting someone to several companies creates one invitations row per
// company but the email carries ONE token, so a valid token accepts all of
// that email's pending invitations. Returns [{ company_id, is_admin }].
export async function acceptInvitation(token) {
  const { data, error } = await supabase.rpc('accept_company_invitation', { p_token: token })
  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('not_signed_in'))           throw new Error('Sign in to accept this invitation')
    if (msg.includes('invite_invalid'))          throw new Error('This invitation is not valid for this account. Sign in with the email address the invite was sent to')
    if (msg.includes('invite_expired'))          throw new Error('This invitation has expired. Ask to be invited again')
    if (msg.includes('invite_already_accepted')) throw new Error('This invitation has already been used. Ask to be invited again')
    throw new Error('Could not accept the invitation. Please try again')
  }
  return Array.isArray(data) ? data : (data ? [data] : [])
}

export async function deleteInvitation(id) {
  const { error } = await supabase.from('invitations').delete().eq('id', id)
  if (error) throw error
}

// ── COMPANY INVITES (shareable link/code) ─────────────────────────────────────
//
// Different from `invitations` (per-email). This is for owner-generated
// codes that can be shared as URLs or short codes, used multiple times,
// and revoked at any time.

/**
 * Generate a short human-friendly code like "HMD-7K3X" from the company name.
 * The hyphen makes it easier to read aloud and harder to confuse 0/O, 1/I etc.
 * Uses uppercase letters and numbers only — no easily confused characters.
 */
function generateInviteCode(companyName) {
  // Take up to 3 alphanumeric chars from the company name as a prefix
  const prefix = (companyName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X') // pad with X if name is too short
  // 4 random characters from a confusable-free alphabet
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += ALPH.charAt(Math.floor(Math.random() * ALPH.length))
  }
  return `${prefix}-${suffix}`
}

/**
 * Create a new shareable invite for a company. Returns the full row
 * including the generated code. The caller decides whether to display it
 * as a link or a short code (the underlying record is the same).
 */
export async function createCompanyInvite(companyId, opts = {}) {
  // Accepts both new `role` and legacy `isAdmin`. Role is preferred and is
  // one of 'admin' | 'editor' | 'viewer'. If only isAdmin is passed (older
  // callers), we map true → 'admin' and false → 'editor'.
  let { maxUses = null, expiresAt = null, role = null, isAdmin = false, label = '' } = opts
  if (!role) role = isAdmin ? 'admin' : 'editor'
  if (!['admin','editor','viewer'].includes(role)) role = 'editor'
  // Keep is_admin in sync with role for legacy code paths that still read
  // company_invites.is_admin without checking role.
  isAdmin = role === 'admin'

  const userId = (await supabase.auth.getUser()).data.user.id
  // Look up the company name to seed the code prefix
  const { data: co } = await supabase.from('companies').select('name').eq('id', companyId).single()

  // Generate a unique code. Retry on the rare collision.
  let code = generateInviteCode(co?.name)
  for (let attempts = 0; attempts < 3; attempts++) {
    const { data: existing } = await supabase.from('company_invites')
      .select('id').eq('code', code).maybeSingle()
    if (!existing) break
    code = generateInviteCode(co?.name)
  }

  const { data, error } = await supabase.from('company_invites').insert({
    company_id: companyId,
    created_by: userId,
    code,
    max_uses:   maxUses,
    expires_at: expiresAt,
    role,
    is_admin:   isAdmin,
    label:      label || null,
  }).select().single()
  if (error) throw error
  return data
}

/**
 * List active (non-revoked) invites for a company. Owners/admins only
 * (enforced by RLS).
 */
export async function fetchCompanyInvites(companyId) {
  const { data, error } = await supabase
    .from('company_invites')
    .select('*')
    .eq('company_id', companyId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Revoke (soft-delete) an invite. Once revoked, the code can no longer be
 * redeemed. The row stays for audit purposes.
 */
export async function revokeCompanyInvite(inviteId) {
  const userId = (await supabase.auth.getUser()).data.user.id
  const { error } = await supabase
    .from('company_invites')
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq('id', inviteId)
  if (error) throw error
}

/**
 * Redeem an invite code — atomically validates and grants company access
 * to the calling user. Server-side function does all the work via
 * SECURITY DEFINER so we don't need to expose company_invites to anon.
 *
 * Throws on:
 * - 'not_signed_in' — user is anonymous
 * - 'invite_not_found' — bad code
 * - 'invite_revoked' / 'invite_expired' / 'invite_exhausted'
 *
 * Returns: { company_id, role, company_name }
 *   role is one of 'admin' | 'editor' | 'viewer'.
 */
export async function redeemCompanyInvite(code) {
  const { data, error } = await supabase.rpc('redeem_company_invite', { p_code: code })
  if (error) {
    // Map server-side error codes to friendlier messages here so callers can
    // just .catch and surface e.message to the user without translating.
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('not_signed_in'))     throw new Error('You need to sign in or sign up first')
    if (msg.includes('invite_not_found'))  throw new Error('That invite code is not valid')
    if (msg.includes('invite_revoked'))    throw new Error('This invite has been revoked')
    if (msg.includes('invite_expired'))    throw new Error('This invite has expired')
    if (msg.includes('invite_exhausted'))  throw new Error('This invite has reached its maximum uses')
    throw error
  }
  return Array.isArray(data) ? data[0] : data
}

/**
 * Find companies with names similar to the user's input. Used by the
 * duplicate-name guard at signup to suggest "did you mean to join an
 * existing one?" Limited to 5 results.
 */
export async function findCompaniesByNameFuzzy(query) {
  if (!query || query.trim().length < 3) return []
  const { data, error } = await supabase.rpc('find_companies_by_name_fuzzy', { p_query: query })
  if (error) {
    // Non-fatal — fail silently and let the user proceed with creation
    return []
  }
  return data || []
}
