import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { addYearsIso } from '../api/insurance'

describe('addYearsIso (policy renewal dates)', () => {
  it('does not slip a day across the October clock change', () => {
    expect(addYearsIso('2026-10-28', 1)).toBe('2027-10-28')
  })
  it('handles 29 February', () => {
    expect(addYearsIso('2028-02-29', 1)).toBe('2029-02-28')
    expect(addYearsIso('2028-02-29', 4)).toBe('2032-02-29')
  })
  it('accepts a timestamp string', () => {
    expect(addYearsIso('2026-03-31T00:00:00Z', 1)).toBe('2027-03-31')
  })
})
