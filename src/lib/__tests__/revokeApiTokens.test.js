import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => ({ deletes: [], updateUser: vi.fn(async () => ({ error: null })) }))
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      signInWithPassword: async () => ({ error: null }),
      updateUser: calls.updateUser,
    },
    from: (table) => ({
      delete: () => ({ eq: async (col, val) => { calls.deletes.push([table, col, val]); return { error: null } } }),
    }),
  },
}))

import { revokeAllApiTokens } from '../api/apiAccess'
import { updateUserPassword } from '../api/account'

describe('API tokens are revoked when credentials change', () => {
  beforeEach(() => { calls.deletes.length = 0 })

  it('deletes only the caller’s own tokens', async () => {
    await revokeAllApiTokens()
    expect(calls.deletes).toEqual([['api_access_tokens', 'user_id', 'u1']])
  })

  it('a password change revokes them', async () => {
    await updateUserPassword('old-pass', 'new-pass-123', 'a@example.com')
    expect(calls.updateUser).toHaveBeenCalledWith({ password: 'new-pass-123' })
    expect(calls.deletes).toEqual([['api_access_tokens', 'user_id', 'u1']])
  })
})
