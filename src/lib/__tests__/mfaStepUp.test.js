import { vi } from 'vitest'

const mfa = {
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}
vi.mock('../supabase', () => ({ supabase: { auth: { mfa } } }))

const { ensureAal2, isMfaRequiredError } = await import('../mfaStepUp')

beforeEach(() => {
  for (const f of Object.values(mfa)) f.mockReset()
  mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1', status: 'verified' }] } })
  mfa.challenge.mockResolvedValue({ data: { id: 'ch1' } })
  mfa.verify.mockResolvedValue({ error: null })
})

describe('ensureAal2', () => {
  it('is a no-op when already aal2 or when there is no factor', async () => {
    const ask = vi.fn()
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } })
    expect(await ensureAal2(ask)).toBe('aal2')
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } })
    expect(await ensureAal2(ask)).toBe('none')
    expect(ask).not.toHaveBeenCalled()
  })

  it('prompts, verifies the code against the verified factor, and reports cancel', async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } })
    expect(await ensureAal2(async () => ' 123456 ')).toBe('aal2')
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'ch1', code: '123456' })
    expect(await ensureAal2(async () => null)).toBe('cancelled')
  })

  it('surfaces a wrong code as an error', async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } })
    mfa.verify.mockResolvedValue({ error: new Error('Invalid TOTP code') })
    await expect(ensureAal2(async () => '000000')).rejects.toThrow('Invalid TOTP code')
  })

  it('recognises the server code', () => {
    expect(isMfaRequiredError(Object.assign(new Error('x'), { code: 'mfa_required' }))).toBe(true)
    expect(isMfaRequiredError(new Error('x'))).toBe(false)
  })
})
