// Server-side authorisation helpers shared by edge functions.
//
// Canonical copy lives in supabase-functions/_shared/authz.ts and is COPIED
// into each function that uses it (Supabase deploys functions in isolation).
// src/lib/__tests__/edgeAuthz.test.js pins the behaviour and fails if a
// copy drifts. No Deno-only imports: Vitest imports this file directly.
//
// Company roles mirror public.has_company_write() (live definition, read
// 15 Oct 2026): platform admin / developer and the company owner always
// write; otherwise the caller's user_company_access row decides, with
// role = coalesce(role, is_admin ? 'admin' : 'editor') and write for
// is_owner or role in (owner, admin, editor). 'viewer' (including the
// "Rent Tracker Editor" preset, which is a viewer with edit_rent) is
// read-only. "Admin" here is role-first: an is_admin=true row whose role
// is 'viewer' is a viewer, matching roleFromAccessRow() in the client.

export type CompanyRole = 'developer' | 'owner' | 'admin' | 'editor' | 'viewer' | null

const ACCESS_ROLES = ['owner', 'admin', 'editor', 'viewer']

// One user_company_access row → effective role.
export function effectiveAccessRole(row: any): CompanyRole {
  if (!row) return null
  if (row.is_owner === true) return 'owner'
  const role = row.role ?? (row.is_admin === true ? 'admin' : 'editor')
  // Unknown role strings get no write (has_company_write returns false).
  return ACCESS_ROLES.includes(role) ? role : 'viewer'
}

export const roleCanWrite = (r: CompanyRole) =>
  r === 'developer' || r === 'owner' || r === 'admin' || r === 'editor'
export const roleIsAdmin = (r: CompanyRole) =>
  r === 'developer' || r === 'owner' || r === 'admin'

// Effective role of `userId` on `companyId`, read with the service-role
// client. For callers WITHOUT a JWT (cron) or as a second check alongside
// the caller-JWT RPC. The row matched by user_id wins over one matched by
// email (has_company_write matches either).
export async function companyRoleFor(
  admin: any, userId: string, email: string | null | undefined, companyId: string,
): Promise<CompanyRole> {
  if (!userId || !companyId) return null
  const { data: profile } = await admin.from('user_profiles')
    .select('is_developer, platform_admin').eq('user_id', userId).maybeSingle()
  if (profile?.is_developer === true || profile?.platform_admin === true) return 'developer'
  const { data: owned } = await admin.from('companies')
    .select('id').eq('id', companyId).eq('owner_id', userId).maybeSingle()
  if (owned) return 'owner'
  const { data: byId } = await admin.from('user_company_access')
    .select('role, is_admin, is_owner').eq('company_id', companyId).eq('user_id', userId).limit(1)
  if (byId && byId.length) return effectiveAccessRole(byId[0])
  if (email) {
    const { data: byEmail } = await admin.from('user_company_access')
      .select('role, is_admin, is_owner').eq('company_id', companyId).eq('email', email).limit(1)
    if (byEmail && byEmail.length) return effectiveAccessRole(byEmail[0])
  }
  return null
}

// ── JWT assurance level ─────────────────────────────────────────────────
// Decode a JWT payload. ONLY call this on a token that has already been
// verified (auth.getUser(token) succeeded): this does not check the
// signature. Returns null on anything malformed.
export function jwtClaims(token: string): Record<string, any> | null {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes))
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

export const tokenIsAal2 = (token: string) => jwtClaims(token)?.aal === 'aal2'

// Whether the user has at least one VERIFIED MFA factor. Prefers the
// admin factor listing; falls back to the factors on the user object.
// Fails CLOSED (true) if neither source can be read, so a broken lookup
// demands aal2 rather than waiving it.
export async function userHasVerifiedFactor(admin: any, user: any): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
    if (!error && Array.isArray(data?.factors)) {
      return data.factors.some((f: any) => f?.status === 'verified')
    }
  } catch { /* fall through */ }
  if (Array.isArray(user?.factors)) return user.factors.some((f: any) => f?.status === 'verified')
  return true
}

export const MFA_REQUIRED_CODE = 'mfa_required'
export const MFA_REQUIRED_MESSAGE = 'Two-factor verification required'
