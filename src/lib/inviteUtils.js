// Distinguishes a company-invite code (e.g. "ABC-7K3X") from a per-email
// invitation UUID. UUIDs have 4 hyphens in fixed positions and are lowercase
// hex; company invite codes are uppercase letters/digits with a single dash
// and at most 16 chars.
export function looksLikeCompanyInviteCode(s) {
  if (!s || typeof s !== 'string') return false
  const upper = s.toUpperCase()
  const dashCount = (upper.match(/-/g) || []).length
  if (dashCount !== 1) return false
  return /^[A-Z0-9]+-[A-Z0-9]+$/.test(upper) && upper.length <= 16
}
