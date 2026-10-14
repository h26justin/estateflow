import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records every supabase.from(table).<method>(...) and supabase.rpc(...) call
// and resolves each with the next queued result.
const calls = []
const results = {}
let rpcResult = { data: null, error: null }
function chain(table) {
  const q = {}
  for (const m of ['select', 'update', 'insert', 'upsert', 'eq', 'order', 'delete']) {
    q[m] = vi.fn((...args) => { calls.push({ table, m, args }); return q })
  }
  const next = () => (results[table] || []).shift() || { data: null, error: null }
  q.single = vi.fn(async () => next())
  q.maybeSingle = vi.fn(async () => next())
  q.then = (res, rej) => Promise.resolve(next()).then(res, rej)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(table => chain(table)),
    rpc: vi.fn(async (fn, args) => { calls.push({ rpc: fn, args }); return rpcResult }),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
      getUser: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@b.com' } } })),
    },
  },
}))

import { acceptInvitation } from '../api/invitations'
import { saveMtdSettings, fetchMtdSettings } from '../api/_monolith'
import { fetchBankConnections, registerBankInterest } from '../api/bank'

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(results)) delete results[k]
  rpcResult = { data: null, error: null }
})

describe('acceptInvitation', () => {
  it('accepts through the server RPC and never writes user_company_access itself', async () => {
    rpcResult = { data: [{ company_id: 'co1', is_admin: false }, { company_id: 'co2', is_admin: true }], error: null }
    const out = await acceptInvitation('tok-123')
    expect(calls).toEqual([{ rpc: 'accept_company_invitation', args: { p_token: 'tok-123' } }])
    expect(out).toHaveLength(2)
    expect(calls.some(c => c.table === 'user_company_access' || c.table === 'invitations')).toBe(false)
  })

  it('returns an empty list when the link was already used by this account', async () => {
    rpcResult = { data: [], error: null }
    expect(await acceptInvitation('tok')).toEqual([])
  })

  it.each([
    ['invite_invalid', /not valid for this account/],
    ['invite_expired', /has expired/],
    ['invite_already_accepted', /already been used/],
    ['not_signed_in', /Sign in to accept/],
    ['something unexpected', /Could not accept the invitation/],
  ])('maps %s to a friendly message', async (code, re) => {
    rpcResult = { data: null, error: { message: code } }
    await expect(acceptInvitation('tok')).rejects.toThrow(re)
  })
})

describe('integration token columns are never selected', () => {
  it('bank connections use an explicit list without partner_data', async () => {
    results.bank_connections = [{ data: [], error: null }, { data: { id: 'c1' }, error: null }]
    await fetchBankConnections()
    await registerBankInterest('pending-partner', 'Monzo')
    const selects = calls.filter(c => c.table === 'bank_connections' && c.m === 'select').map(c => c.args[0])
    expect(selects).toHaveLength(2)
    for (const cols of selects) {
      expect(cols).toBeTruthy()
      expect(cols).not.toMatch(/\*|partner_data/)
    }
  })

  it('MTD settings reads and the save round-trip never name a token column', async () => {
    const future = new Date(Date.now() + 3600e3).toISOString()
    results.mtd_settings = [
      { data: { user_id: 'u1', hmrc_token_expires_at: future }, error: null },
      { data: { user_id: 'u1', hmrc_token_expires_at: null }, error: null },
    ]
    const got = await fetchMtdSettings()
    expect(got.hmrc_access_token).toBe(true)
    const saved = await saveMtdSettings({ nino: 'QQ123456C', hmrc_access_token: 'x', encrypted_hmrc_access_token: 'y' })
    expect(saved.hmrc_access_token).toBe(false)
    const selects = calls.filter(c => c.table === 'mtd_settings' && c.m === 'select').map(c => c.args[0])
    expect(selects).toHaveLength(2)
    for (const cols of selects) expect(cols).not.toMatch(/\*|access_token|refresh_token/)
    const up = calls.find(c => c.table === 'mtd_settings' && c.m === 'upsert').args[0]
    expect(up).toEqual({ user_id: 'u1', nino: 'QQ123456C' })
  })
})
