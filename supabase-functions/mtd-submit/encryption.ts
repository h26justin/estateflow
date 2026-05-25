// Application-level AES-GCM encryption for OAuth tokens.
//
// IMPORTANT: This file is intentionally NOT shared at runtime — Supabase
// edge functions deploy each function in isolation, so this file must be
// inlined wherever encryption is needed (xero-oauth-callback, xero-sync,
// future mtd-submit, future bank-plaid encryption pass). It lives here
// as the canonical source of truth — copy/paste when adding to another
// edge function and please remember to update all copies together.
//
// Key: OWNPROPERLY_TOKEN_KEY supabase secret, 64 hex chars (32 bytes).
// Generate one with:
//   openssl rand -hex 32
//
// Cipher format on disk: `<iv_hex>:<ciphertext_hex>` in a TEXT column.
// The IV is 12 random bytes per call. AES-GCM auth-tag is appended to
// the ciphertext (Web Crypto convention).
//
// When the env key is absent, encrypt/decrypt no-op and we fall back
// to the legacy plaintext column. That way existing connections keep
// working until they're refreshed (next OAuth or token rotation).

const KEY_ENV = 'OWNPROPERLY_TOKEN_KEY'

let _cachedKey: CryptoKey | null = null

async function getKey(): Promise<CryptoKey | null> {
  if (_cachedKey) return _cachedKey
  const hex = (typeof Deno !== 'undefined' ? Deno.env.get(KEY_ENV) : process.env[KEY_ENV]) || ''
  if (!hex) return null
  if (hex.length !== 64) {
    throw new Error(`${KEY_ENV} must be 64 hex chars (32 bytes). Got ${hex.length}.`)
  }
  const raw = new Uint8Array(32)
  for (let i = 0; i < 32; i++) raw[i] = parseInt(hex.substr(i * 2, 2), 16)
  _cachedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  return _cachedKey
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function hexToBuf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length / 2; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

// Encrypt a string. Returns null if no key is configured (caller should
// then store the plaintext to the legacy column).
export async function encryptToken(plaintext: string): Promise<string | null> {
  if (!plaintext) return null
  const key = await getKey()
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return `${bufToHex(iv.buffer)}:${bufToHex(ct)}`
}

// Decrypt a string stored as `iv_hex:ciphertext_hex`. Returns null if
// no key is configured or the stored value isn't in the expected format.
export async function decryptToken(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null
  const key = await getKey()
  if (!key) return null
  const [ivHex, ctHex] = stored.split(':')
  if (!ivHex || !ctHex) return null
  try {
    const iv = hexToBuf(ivHex)
    const ct = hexToBuf(ctHex)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

// Helper: pick the freshest token source. Prefers encrypted column.
// Caller passes both possible sources; returns the usable plaintext.
export async function resolveToken(opts: { encrypted?: string | null; plaintext?: string | null }): Promise<string | null> {
  if (opts.encrypted) {
    const decrypted = await decryptToken(opts.encrypted)
    if (decrypted) return decrypted
  }
  return opts.plaintext || null
}
