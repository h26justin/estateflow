// Personal API access tokens — client for the api-access edge function.
//
// Token management only. The data routes (GET /api-access/properties etc.)
// are for EXTERNAL clients holding an opat_ token — the app itself never
// calls them (it talks to Supabase directly with the user's session).
// See API_ACCESS.md at the repo root for the external-consumer docs.

import { supabase } from '../supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-access`

async function call(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Keep the server's machine-readable code (e.g. 'mfa_required') so the
    // panel can offer the 2FA step-up instead of a bare error.
    const err = new Error(data.error || `Request failed (${res.status})`)
    if (data.code) err.code = data.code
    err.status = res.status
    throw err
  }
  return data
}

// → { tokens: [{ id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at }] }
export function listApiTokens() {
  return call('/tokens')
}

// → { token: 'opat_…', id, name, token_prefix, … } — token plaintext is
// returned exactly once; it is never retrievable again. Expiry defaults to
// 90 days server-side (max 365). A 2FA account must be at aal2 to mint —
// see ensureAal2 in ../mfaStepUp.
export function createApiToken({ name, expiresInDays } = {}) {
  return call('/tokens', { method: 'POST', body: { name, expires_in_days: expiresInDays } })
}

export function revokeApiToken(id) {
  return call(`/tokens/${id}`, { method: 'DELETE' })
}
