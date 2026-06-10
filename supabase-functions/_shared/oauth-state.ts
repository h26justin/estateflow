// HMAC-signed OAuth state + return_to allow-listing + HTML escaping.
//
// IMPORTANT: This file is intentionally NOT shared at runtime — Supabase
// edge functions deploy each function in isolation, so this file must be
// inlined wherever it's needed (xero-oauth-callback, hmrc-oauth-callback).
// It lives here as the canonical source of truth — copy/paste when adding
// to another edge function and please remember to update all copies together.
//
// State format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload)).
//
// Key: STATE_SIGNING_SECRET supabase secret. When absent we fall back to
// SHA-256(SUPABASE_SERVICE_ROLE_KEY) so existing deployments keep working
// without rotating any client config. Set a dedicated secret with:
//   supabase secrets set STATE_SIGNING_SECRET=$(openssl rand -hex 32)
//
// Payloads should carry { user_id, nonce, exp, ... }. The nonce must be
// persisted in oauth_nonces at "start" and deleted (burned) at callback so
// a captured state can't be replayed.

const enc = new TextEncoder()

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

let _stateKey: CryptoKey | null = null

async function getStateKey(): Promise<CryptoKey> {
  if (_stateKey) return _stateKey
  const secret = Deno.env.get('STATE_SIGNING_SECRET') || ''
  let raw: Uint8Array
  if (secret) {
    raw = enc.encode(secret)
  } else {
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!svc) throw new Error('Neither STATE_SIGNING_SECRET nor SUPABASE_SERVICE_ROLE_KEY is configured')
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(svc)))
  }
  _stateKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  return _stateKey
}

export async function signState(payload: Record<string, unknown>): Promise<string> {
  const key = await getStateKey()
  const body = enc.encode(JSON.stringify(payload))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
  return `${b64urlEncode(body)}.${b64urlEncode(sig)}`
}

// Returns the payload when the signature is valid and not expired; null
// otherwise. crypto.subtle.verify compares in constant time.
export async function verifyState(state: string): Promise<Record<string, any> | null> {
  try {
    const [bodyB64, sigB64] = (state || '').split('.')
    if (!bodyB64 || !sigB64) return null
    const key = await getStateKey()
    const body = b64urlDecode(bodyB64)
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), body)
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(body))
    if (payload.exp && Date.now() > Number(payload.exp)) return null
    return payload
  } catch {
    return null
  }
}

// Allow-list of app origins we'll honour for post-OAuth redirects.
// Anything else falls back — defence against open redirect via a
// caller-supplied return_to.
const ALLOWED_APP_ORIGINS = new Set([
  'https://ownproperly.com',
  'https://www.ownproperly.com',
  'http://localhost:5173',
  'http://localhost:3000',
])
try {
  const base = Deno.env.get('APP_RETURN_BASE')
  if (base) ALLOWED_APP_ORIGINS.add(new URL(base).origin)
} catch { /* malformed APP_RETURN_BASE — ignore */ }

export function safeReturnTo(value: unknown, fallback = 'https://ownproperly.com'): string {
  if (typeof value === 'string' && value) {
    try {
      const u = new URL(value)
      if (ALLOWED_APP_ORIGINS.has(u.origin)) return u.href
    } catch { /* not an absolute URL — fall through */ }
  }
  return fallback
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
