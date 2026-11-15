import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { repairTimersFor } from '../api/rentersRights'

const NOW = new Date('2026-11-15T12:00:00').getTime()

describe('repair timers (guidance targets)', () => {
  it('count from the date raised on the form, not when the row was created', () => {
    const [t] = repairTimersFor([{ id: 1, status: 'open', priority: 'medium', date_raised: '2026-10-20', created_at: '2026-11-14T09:00:00Z' }], NOW)
    expect(t.elapsed_days).toBe(26)
    expect(t.breached).toBe(true)
    expect(t.severity).toBe('standard')
  })
  it('fall back to created_at when no date was raised', () => {
    const [t] = repairTimersFor([{ id: 1, status: 'open', priority: 'medium', date_raised: null, created_at: '2026-11-14T12:00:00' }], NOW)
    expect(t.elapsed_days).toBe(1); expect(t.breached).toBe(false)
  })
  it("treat only 'urgent' and 'emergency' as the 24-hour target; 'high' is standard", () => {
    const jobs = ['urgent', 'emergency', 'high', 'low'].map((priority, id) => ({ id, status: 'open', priority, created_at: '2026-11-15T09:00:00' }))
    expect(repairTimersFor(jobs, NOW).map(t => t.sla_days)).toEqual([1, 1, 14, 14])
  })
  it('a completed job is never past target', () => {
    const [t] = repairTimersFor([{ id: 1, status: 'complete', priority: 'urgent', date_raised: '2026-01-01' }], NOW)
    expect(t.open).toBe(false); expect(t.breached).toBe(false)
  })
})
