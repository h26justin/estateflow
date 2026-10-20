// Edge-function shared helpers: behaviour + copy drift.
//
// Supabase deploys each edge function in isolation, so the canonical
// helpers in supabase-functions/_shared/ are copied into every function
// that needs them. These tests pin the helpers' security behaviour and
// fail if any per-function copy drifts from the canonical file.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual, secretMatches } from '../../../supabase-functions/_shared/secrets.ts'
import {
  readCookie, bindCookieHeader, clearBindCookieHeader, launchRefererAllowed,
  sha256Hex, browserBindingMatches, randomToken,
} from '../../../supabase-functions/_shared/oauth-state.ts'

const FN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase-functions')

function copiesOf(file) {
  return readdirSync(FN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_shared')
    .map(d => join(FN_DIR, d.name, file))
    .filter(p => existsSync(p))
}

describe('edge _shared copies', () => {
  for (const file of ['secrets.ts', 'oauth-state.ts', 'billing.ts']) {
    it(`every ${file} copy matches _shared/${file}`, () => {
      const canonical = readFileSync(join(FN_DIR, '_shared', file), 'utf8')
      const copies = copiesOf(file)
      expect(copies.length).toBeGreaterThan(0)
      for (const p of copies) expect({ p, same: readFileSync(p, 'utf8') === canonical }).toEqual({ p, same: true })
    })
  }

  it('every function importing ./secrets.ts or ./oauth-state.ts ships the file', () => {
    for (const d of readdirSync(FN_DIR, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === '_shared') continue
      const idx = join(FN_DIR, d.name, 'index.ts')
      if (!existsSync(idx)) continue
      const src = readFileSync(idx, 'utf8')
      for (const file of ['secrets.ts', 'oauth-state.ts', 'billing.ts']) {
        if (src.includes(`from './${file}'`)) expect(existsSync(join(FN_DIR, d.name, file))).toBe(true)
      }
      if (existsSync(join(FN_DIR, d.name, 'oauth-state.ts'))) {
        expect(existsSync(join(FN_DIR, d.name, 'secrets.ts'))).toBe(true)
      }
    }
  })
})

describe('timingSafeEqual / secretMatches', () => {
  it('compares exactly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
    expect(timingSafeEqual('é', 'e')).toBe(false)
  })

  it('fails closed when the expected secret is unset', () => {
    expect(secretMatches('', '')).toBe(false)
    expect(secretMatches('x', '')).toBe(false)
    expect(secretMatches(null, undefined)).toBe(false)
    expect(secretMatches(null, 's3cret')).toBe(false)
    expect(secretMatches('s3cret', 's3cret')).toBe(true)
    expect(secretMatches('s3cre', 's3cret')).toBe(false)
  })
})

describe('OAuth browser binding helpers', () => {
  const req = (headers) => new Request('https://x.supabase.co/functions/v1/xero-oauth-callback', { headers })

  it('reads a named cookie', () => {
    const r = req({ cookie: 'a=1; __Secure-ef_xero_oauth_bind=abc_DEF-1; b=2' })
    expect(readCookie(r, '__Secure-ef_xero_oauth_bind')).toBe('abc_DEF-1')
    expect(readCookie(r, 'missing')).toBe(null)
    expect(readCookie(req({}), 'a')).toBe(null)
  })

  it('sets an HttpOnly, Secure, SameSite=Lax, path-scoped cookie', () => {
    const h = bindCookieHeader('__Secure-x', 'v', '/functions/v1/xero-oauth-callback')
    expect(h).toMatch(/^__Secure-x=v; /)
    expect(h).toContain('Path=/functions/v1/xero-oauth-callback')
    expect(h).toContain('HttpOnly')
    expect(h).toContain('Secure')
    expect(h).toContain('SameSite=Lax')
    expect(clearBindCookieHeader('__Secure-x', '/p')).toContain('Max-Age=0')
  })

  it('only honours a launch navigation referred by an app origin', () => {
    expect(launchRefererAllowed(req({ referer: 'https://ownproperly.com/' }))).toBe(true)
    expect(launchRefererAllowed(req({ referer: 'https://www.ownproperly.com/settings' }))).toBe(true)
    expect(launchRefererAllowed(req({ referer: 'https://evil.example/' }))).toBe(false)
    expect(launchRefererAllowed(req({ referer: 'https://ownproperly.com.evil.example/' }))).toBe(false)
    expect(launchRefererAllowed(req({}))).toBe(false)
  })

  it('matches only the cookie whose hash is in the state', async () => {
    const value = randomToken()
    expect(value.length).toBeGreaterThanOrEqual(40)
    const hash = await sha256Hex(value)
    const name = '__Secure-ef_hmrc_oauth_bind'
    expect(await browserBindingMatches(req({ cookie: `${name}=${value}` }), name, hash)).toBe(true)
    expect(await browserBindingMatches(req({ cookie: `${name}=other` }), name, hash)).toBe(false)
    expect(await browserBindingMatches(req({}), name, hash)).toBe(false)
    expect(await browserBindingMatches(req({ cookie: `${name}=${value}` }), name, undefined)).toBe(false)
  })
})
