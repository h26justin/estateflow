import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client so getSession() yields a deterministic JWT.
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-jwt' } } })),
    },
  },
}))

import { supabase } from '../supabase'
import { listApiTokens, createApiToken, revokeApiToken } from '../api/apiAccess'

function mockFetch(body = {}, ok = true, status = 200) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => body }))
  globalThis.fetch = fn
  return fn
}

describe('apiAccess client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-jwt' } } })
  })

  it('lists tokens with the session JWT in the Authorization header', async () => {
    const fetchSpy = mockFetch({ tokens: [{ id: 't1' }] })
    const res = await listApiTokens()
    expect(res.tokens).toHaveLength(1)
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/api-access\/tokens$/)
    expect(opts.method).toBe('GET')
    expect(opts.headers.Authorization).toBe('Bearer test-jwt')
  })

  it('creates a token via POST with name and expiry', async () => {
    const fetchSpy = mockFetch({ token: 'opat_abc', id: 't2', name: 'Claude' })
    const res = await createApiToken({ name: 'Claude', expiresInDays: 90 })
    expect(res.token).toBe('opat_abc')
    const [, opts] = fetchSpy.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ name: 'Claude', expires_in_days: 90 })
  })

  it('revokes a token via DELETE to /tokens/:id', async () => {
    const fetchSpy = mockFetch({ revoked: 't3' })
    await revokeApiToken('t3')
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/api-access\/tokens\/t3$/)
    expect(opts.method).toBe('DELETE')
  })

  it('throws the server error message on a non-OK response', async () => {
    mockFetch({ error: 'Token limit reached' }, false, 409)
    await expect(createApiToken({})).rejects.toThrow('Token limit reached')
  })

  it('throws when not signed in', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(listApiTokens()).rejects.toThrow('Not signed in')
  })
})
