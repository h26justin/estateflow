// Edge authz helper (supabase-functions/_shared/authz.ts): role rules that
// mirror public.has_company_write(), JWT aal reading, MFA factor lookup,
// and copy drift across the functions that ship it.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  effectiveAccessRole, roleCanWrite, roleIsAdmin, companyRoleFor,
  jwtClaims, tokenIsAal2, userHasVerifiedFactor,
} from '../../../supabase-functions/_shared/authz.ts'
import { companyRole, canWriteCompany, canAdminCompany } from '../permissions'

const FN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase-functions')

describe('authz.ts copies', () => {
  it('every copy matches _shared/authz.ts and importers ship it', () => {
    const canonical = readFileSync(join(FN_DIR, '_shared', 'authz.ts'), 'utf8')
    let copies = 0
    for (const d of readdirSync(FN_DIR, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === '_shared') continue
      const copy = join(FN_DIR, d.name, 'authz.ts')
      const idx = join(FN_DIR, d.name, 'index.ts')
      if (existsSync(idx) && readFileSync(idx, 'utf8').includes("from './authz.ts'")) {
        expect({ fn: d.name, ships: existsSync(copy) }).toEqual({ fn: d.name, ships: true })
      }
      if (existsSync(copy)) {
        copies++
        expect({ fn: d.name, same: readFileSync(copy, 'utf8') === canonical }).toEqual({ fn: d.name, same: true })
      }
    }
    expect(copies).toBeGreaterThanOrEqual(4)
  })

  it('the write-gated functions no longer gate mutations on has_company_access alone', () => {
    const src = f => readFileSync(join(FN_DIR, f, 'index.ts'), 'utf8')
    expect(src('bookkeeping-ai')).toContain("rpc('has_company_write'")
    expect(src('bookkeeping-ai')).not.toContain("rpc('has_company_access'")
    expect(src('xero-sync')).toContain("rpc('has_company_write'")
    expect(src('xero-sync')).not.toContain('userCanAccessCompany')
    expect(src('xero-oauth-callback')).toContain("rpc('has_company_write'")
    expect(src('xero-oauth-callback')).toContain('roleIsAdmin(role)')
    expect(src('delete-user')).toContain('tokenIsAal2(token)')
    expect(src('api-access')).toContain('tokenIsAal2(bearer)')
    expect(src('api-access')).toContain("rpc('company_is_live'")
  })
})

describe('effectiveAccessRole (mirrors has_company_write)', () => {
  it('role column wins; legacy rows fall back on is_admin', () => {
    expect(effectiveAccessRole(null)).toBe(null)
    expect(effectiveAccessRole({ role: 'viewer', is_admin: true })).toBe('viewer')
    expect(effectiveAccessRole({ role: 'editor' })).toBe('editor')
    expect(effectiveAccessRole({ role: null, is_admin: true })).toBe('admin')
    expect(effectiveAccessRole({ role: null, is_admin: false })).toBe('editor')
    expect(effectiveAccessRole({ role: 'viewer', is_owner: true })).toBe('owner')
    expect(effectiveAccessRole({ role: 'superuser' })).toBe('viewer')
  })

  it('write = developer/owner/admin/editor; admin = developer/owner/admin', () => {
    for (const r of ['developer', 'owner', 'admin', 'editor']) expect(roleCanWrite(r)).toBe(true)
    for (const r of ['viewer', null]) expect(roleCanWrite(r)).toBe(false)
    for (const r of ['developer', 'owner', 'admin']) expect(roleIsAdmin(r)).toBe(true)
    for (const r of ['editor', 'viewer', null]) expect(roleIsAdmin(r)).toBe(false)
  })
})

// Minimal chainable stand-in for the service-role client.
function fakeAdmin(tables) {
  return {
    from(table) {
      const filters = {}
      const rows = () => (tables[table] || []).filter(r => Object.entries(filters).every(([k, v]) => r[k] === v))
      const q = {
        select: () => q,
        eq: (k, v) => { filters[k] = v; return q },
        limit: n => Promise.resolve({ data: rows().slice(0, n) }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] || null }),
      }
      return q
    },
  }
}

describe('companyRoleFor', () => {
  const base = {
    user_profiles: [{ user_id: 'dev', is_developer: true, platform_admin: false }],
    companies: [{ id: 'c1', owner_id: 'own' }],
    user_company_access: [
      { company_id: 'c1', user_id: 'v', email: 'v@x', role: 'viewer', is_admin: true },
      { company_id: 'c1', user_id: 'e', email: 'e@x', role: 'editor' },
      { company_id: 'c1', user_id: 'pending', email: 'inv@x', role: 'admin' },
    ],
  }
  it('resolves developer, owner, row by id, row by email, none', async () => {
    const a = fakeAdmin(base)
    expect(await companyRoleFor(a, 'dev', null, 'c1')).toBe('developer')
    expect(await companyRoleFor(a, 'own', null, 'c1')).toBe('owner')
    expect(await companyRoleFor(a, 'v', 'v@x', 'c1')).toBe('viewer')
    expect(await companyRoleFor(a, 'e', 'e@x', 'c1')).toBe('editor')
    expect(await companyRoleFor(a, 'other', 'inv@x', 'c1')).toBe('admin')
    expect(await companyRoleFor(a, 'stranger', 's@x', 'c1')).toBe(null)
    expect(await companyRoleFor(a, '', null, 'c1')).toBe(null)
  })
})

describe('jwtClaims / tokenIsAal2', () => {
  const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const jwt = claims => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`
  it('reads the aal claim and fails closed on junk', () => {
    expect(tokenIsAal2(jwt({ aal: 'aal2', sub: 'u' }))).toBe(true)
    expect(tokenIsAal2(jwt({ aal: 'aal1' }))).toBe(false)
    expect(tokenIsAal2(jwt({}))).toBe(false)
    expect(tokenIsAal2('opat_abc')).toBe(false)
    expect(tokenIsAal2('a.%%%.c')).toBe(false)
    expect(jwtClaims(jwt({ amr: [{ method: 'totp' }], name: 'Zoë' })).name).toBe('Zoë')
  })
})

describe('userHasVerifiedFactor', () => {
  const adminWith = impl => ({ auth: { admin: { mfa: { listFactors: impl } } } })
  it('uses the admin listing, then the user object, else fails closed', async () => {
    expect(await userHasVerifiedFactor(adminWith(async () => ({ data: { factors: [{ status: 'verified' }] } })), { id: 'u' })).toBe(true)
    expect(await userHasVerifiedFactor(adminWith(async () => ({ data: { factors: [{ status: 'unverified' }] } })), { id: 'u' })).toBe(false)
    const broken = adminWith(async () => { throw new Error('down') })
    expect(await userHasVerifiedFactor(broken, { id: 'u', factors: [] })).toBe(false)
    expect(await userHasVerifiedFactor(broken, { id: 'u', factors: [{ status: 'verified' }] })).toBe(true)
    expect(await userHasVerifiedFactor(broken, { id: 'u' })).toBe(true)
  })
})

describe('client role helpers (permissions.js)', () => {
  const map = { __owner: { own: true }, a: { _role: 'admin' }, e: { _role: 'editor' }, v: { _role: 'viewer' } }
  it('mirror the server write / admin split', () => {
    expect(companyRole(map, 'own')).toBe('owner')
    expect(companyRole(null, 'a')).toBe(null)
    expect(companyRole(null, 'a', true)).toBe('developer')
    expect([canWriteCompany(map, 'a'), canWriteCompany(map, 'e'), canWriteCompany(map, 'v'), canWriteCompany(map, 'x')])
      .toEqual([true, true, false, false])
    expect([canAdminCompany(map, 'own'), canAdminCompany(map, 'a'), canAdminCompany(map, 'e'), canAdminCompany(map, 'v')])
      .toEqual([true, true, false, false])
  })
})
