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

// Defaults applied server-side by create_company_invite() when the caller
// does not choose explicitly. Exported so the UI can show them.
export const COMPANY_INVITE_DEFAULTS = Object.freeze({ expiryDays: 14, maxUses: 25 })

const CREATE_INVITE_ERRORS = {
  not_signed_in:       'You need to sign in first',
  not_authorized:      'Only company owners and admins can create invite codes',
  company_unavailable: 'This company is no longer available',
  invalid_role:        'Choose viewer, editor or admin for this invite',
  invalid_expiry:      'Pick an expiry date in the next year',
  invalid_max_uses:    'Max uses must be between 1 and 1000',
}

/**
 * Create a new shareable invite for a company. Returns the full row
 * including the generated code. The caller decides whether to display it
 * as a link or a short code (the underlying record is the same).
 *
 * The code is generated in the database (create_company_invite, SECURITY
 * DEFINER): a 3-letter company prefix for readability plus 16 random
 * characters (80 bits). The browser never picks the code. Unless the caller
 * opts out explicitly, invites expire after 14 days and allow 25 uses.
 *
 * opts: { role, isAdmin (legacy), label,
 *         expiresAt (ISO, null = default), neverExpires,
 *         maxUses (int, null = default), unlimitedUses }
 */
export async function createCompanyInvite(companyId, opts = {}) {
  // Accepts both new `role` and legacy `isAdmin`. Role is preferred and is
  // one of 'admin' | 'editor' | 'viewer'. If only isAdmin is passed (older
  // callers), we map true → 'admin' and false → 'editor'.
  const {
    maxUses = null, expiresAt = null, isAdmin = false, label = '',
    neverExpires = false, unlimitedUses = false,
  } = opts
  let role = opts.role || (isAdmin ? 'admin' : 'editor')
  if (!['admin', 'editor', 'viewer'].includes(role)) role = 'editor'

  const { data, error } = await supabase.rpc('create_company_invite', {
    p_company_id:     companyId,
    p_role:           role,
    p_expires_at:     neverExpires ? null : (expiresAt || null),
    p_max_uses:       unlimitedUses ? null : (maxUses ?? null),
    p_label:          (label || '').trim() || null,
    p_no_expiry:      !!neverExpires,
    p_unlimited_uses: !!unlimitedUses,
  })
  if (error) {
    const msg = (error.message || '').toLowerCase()
    const key = Object.keys(CREATE_INVITE_ERRORS).find(k => msg.includes(k))
    throw new Error(key ? CREATE_INVITE_ERRORS[key] : 'Could not create the invite. Please try again')
  }
  return Array.isArray(data) ? data[0] : data
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

const REDEEM_ERRORS = {
  not_signed_in:       'You need to sign in or sign up first',
  too_many_attempts:   'Too many invalid invite codes. Wait an hour and try again, or ask for a new invite link',
  invite_not_found:    'That invite code is not valid',
  invite_revoked:      'This invite has been revoked',
  invite_expired:      'This invite has expired',
  invite_exhausted:    'This invite has reached its maximum uses',
  company_unavailable: 'This company is no longer available',
}
function redeemError(text) {
  const msg = (text || '').toLowerCase()
  const key = Object.keys(REDEEM_ERRORS).find(k => msg.includes(k))
  return key ? new Error(REDEEM_ERRORS[key]) : null
}

/**
 * Redeem an invite code — atomically validates and grants company access
 * to the calling user. Server-side function does all the work via
 * SECURITY DEFINER so we don't need to expose company_invites to anon.
 *
 * The server records every attempt and, after 10 failed codes in an hour,
 * refuses further attempts with 'too_many_attempts'. Invite failures come
 * back as an `error_code` column (a raised error would roll back the attempt
 * record); 'not_signed_in' and 'too_many_attempts' are raised.
 *
 * Throws a friendly Error for: not_signed_in, too_many_attempts,
 * invite_not_found, invite_revoked, invite_expired, invite_exhausted,
 * company_unavailable.
 *
 * Returns: { company_id, role, company_name }
 *   role is one of 'admin' | 'editor' | 'viewer'.
 */
export async function redeemCompanyInvite(code) {
  const { data, error } = await supabase.rpc('redeem_company_invite', { p_code: (code || '').trim() })
  if (error) {
    // Map server-side error codes to friendlier messages here so callers can
    // just .catch and surface e.message to the user without translating.
    throw redeemError(error.message) || error
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error(REDEEM_ERRORS.invite_not_found)
  if (row.error_code) throw redeemError(row.error_code) || new Error('Could not redeem that invite code')
  if (!row.company_id) throw new Error('Could not redeem that invite code')
  const result = { ...row }
  delete result.error_code
  return result
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
