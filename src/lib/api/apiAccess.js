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
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// → { tokens: [{ id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at }] }
export function listApiTokens() {
  return call('/tokens')
}

// → { token: 'opat_…', id, name, token_prefix, … } — token plaintext is
// returned exactly once; it is never retrievable again.
export function createApiToken({ name, expiresInDays } = {}) {
  return call('/tokens', { method: 'POST', body: { name, expires_in_days: expiresInDays } })
}

export function revokeApiToken(id) {
  return call(`/tokens/${id}`, { method: 'DELETE' })
}
