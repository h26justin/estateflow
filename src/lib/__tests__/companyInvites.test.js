import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every supabase.from(table) / supabase.rpc(...) call.
const calls = []
let rpcResult = { data: null, error: null }
function chain(table) {
  const q = {}
  for (const m of ['select', 'update', 'insert', 'upsert', 'eq', 'is', 'order', 'delete', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...args) => { calls.push({ table, m, args }); return q })
  }
  q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(table => chain(table)),
    rpc: vi.fn(async (fn, args) => { calls.push({ rpc: fn, args }); return rpcResult }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@b.com' } } })),
    },
  },
}))

import { createCompanyInvite, redeemCompanyInvite, COMPANY_INVITE_DEFAULTS } from '../api/invitations'

beforeEach(() => {
  calls.length = 0
  rpcResult = { data: null, error: null }
})

describe('createCompanyInvite', () => {
  const row = { id: 'i1', company_id: 'co1', code: 'ABC-7K3XQ9MWR2TZHB4N', max_uses: 25, used_count: 0 }

  it('creates through the server RPC and never generates or inserts a code itself', async () => {
    rpcResult = { data: row, error: null }
    const out = await createCompanyInvite('co1', { role: 'viewer', label: '  WhatsApp  ' })
    expect(out).toEqual(row)
    expect(calls).toEqual([{ rpc: 'create_company_invite', args: {
      p_company_id: 'co1', p_role: 'viewer', p_expires_at: null, p_max_uses: null,
      p_label: 'WhatsApp', p_no_expiry: false, p_unlimited_uses: false,
    } }])
    expect(calls.some(c => c.table === 'company_invites')).toBe(false)
  })

  it('leaves expiry and max uses to the server defaults unless set', () => {
    expect(COMPANY_INVITE_DEFAULTS).toEqual({ expiryDays: 14, maxUses: 25 })
  })

  it('passes explicit expiry / uses and the explicit opt-outs', async () => {
    rpcResult = { data: [row], error: null }
    await createCompanyInvite('co1', { expiresAt: '2026-11-01T00:00:00.000Z', maxUses: 3 })
    expect(calls[0].args).toMatchObject({ p_expires_at: '2026-11-01T00:00:00.000Z', p_max_uses: 3, p_no_expiry: false })
    calls.length = 0
    await createCompanyInvite('co1', { neverExpires: true, expiresAt: '2026-11-01', unlimitedUses: true, maxUses: 3 })
    expect(calls[0].args).toMatchObject({ p_expires_at: null, p_no_expiry: true, p_max_uses: null, p_unlimited_uses: true })
  })

  it('maps legacy isAdmin and rejects unknown roles to editor', async () => {
    rpcResult = { data: row, error: null }
    await createCompanyInvite('co1', { isAdmin: true })
    expect(calls[0].args.p_role).toBe('admin')
    calls.length = 0
    await createCompanyInvite('co1', { role: 'owner' })
    expect(calls[0].args.p_role).toBe('editor')
  })

  it.each([
    ['not_authorized', /owners and admins/],
    ['invalid_expiry', /expiry date/],
    ['invalid_max_uses', /between 1 and 1000/],
    ['boom', /Could not create the invite/],
  ])('maps %s to a friendly message', async (code, re) => {
    rpcResult = { data: null, error: { message: code } }
    await expect(createCompanyInvite('co1')).rejects.toThrow(re)
  })
})

describe('redeemCompanyInvite', () => {
  it('returns the joined company without the error_code column', async () => {
    rpcResult = { data: [{ company_id: 'co1', role: 'editor', company_name: 'Acme', error_code: null }], error: null }
    expect(await redeemCompanyInvite(' abc-7k3x ')).toEqual({ company_id: 'co1', role: 'editor', company_name: 'Acme' })
    expect(calls).toEqual([{ rpc: 'redeem_company_invite', args: { p_code: 'abc-7k3x' } }])
  })

  it.each([
    ['invite_not_found', /not valid/],
    ['invite_revoked', /revoked/],
    ['invite_expired', /expired/],
    ['invite_exhausted', /maximum uses/],
    ['company_unavailable', /no longer available/],
  ])('throws on a returned error_code %s (recorded as a failed attempt server-side)', async (code, re) => {
    rpcResult = { data: [{ company_id: null, role: null, company_name: null, error_code: code }], error: null }
    await expect(redeemCompanyInvite('ABC-XXXX')).rejects.toThrow(re)
  })

  it('surfaces the rate limit clearly', async () => {
    rpcResult = { data: null, error: { message: 'too_many_attempts' } }
    await expect(redeemCompanyInvite('ABC-XXXX')).rejects.toThrow(/Too many invalid invite codes/)
  })

  it('maps not_signed_in and treats an empty result as not found', async () => {
    rpcResult = { data: null, error: { message: 'not_signed_in' } }
    await expect(redeemCompanyInvite('ABC-XXXX')).rejects.toThrow(/sign in/)
    rpcResult = { data: [], error: null }
    await expect(redeemCompanyInvite('ABC-XXXX')).rejects.toThrow(/not valid/)
  })
})
