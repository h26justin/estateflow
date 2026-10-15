import { describe, it, expect } from 'vitest'
import { looksLikeCompanyInviteCode } from '../inviteUtils'

describe('looksLikeCompanyInviteCode', () => {
  it('accepts the canonical company-invite shape', () => {
    expect(looksLikeCompanyInviteCode('ABC-7K3X')).toBe(true)
    expect(looksLikeCompanyInviteCode('VPG-X9Y2')).toBe(true)
    expect(looksLikeCompanyInviteCode('AB-CD')).toBe(true) // minimal valid shape
  })

  it('accepts the server-generated 80-bit shape (3-char prefix + 16)', () => {
    expect(looksLikeCompanyInviteCode('ABC-7K3XQ9MWR2TZHB4N')).toBe(true)
    expect(looksLikeCompanyInviteCode('abc-7k3xq9mwr2tzhb4n')).toBe(true)
  })

  it('rejects a suffix longer than 16 characters', () => {
    expect(looksLikeCompanyInviteCode('ABC-7K3XQ9MWR2TZHB4NX')).toBe(false)
  })

  it('accepts lowercase by normalising to upper', () => {
    expect(looksLikeCompanyInviteCode('abc-7k3x')).toBe(true)
  })

  it('rejects UUIDs (4 hyphens)', () => {
    expect(looksLikeCompanyInviteCode('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })

  it('rejects empty / non-string', () => {
    expect(looksLikeCompanyInviteCode('')).toBe(false)
    expect(looksLikeCompanyInviteCode(null)).toBe(false)
    expect(looksLikeCompanyInviteCode(undefined)).toBe(false)
    expect(looksLikeCompanyInviteCode(123)).toBe(false)
  })

  it('rejects codes without a hyphen', () => {
    expect(looksLikeCompanyInviteCode('ABCDEF')).toBe(false)
  })

  it('rejects overly long codes', () => {
    expect(looksLikeCompanyInviteCode('ABCDEFGHIJ-KLMNOPQRST')).toBe(false)
  })

  it('rejects non-alphanumeric chars', () => {
    expect(looksLikeCompanyInviteCode('ABC-7K3!')).toBe(false)
    expect(looksLikeCompanyInviteCode('AB C-7K3X')).toBe(false)
  })
})
