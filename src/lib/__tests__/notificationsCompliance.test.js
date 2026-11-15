import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ existing: [], inserts: [] }))
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const b = {
        select() { return b },
        in(_col, keys) { return Promise.resolve({ data: db.existing.filter(k => keys.includes(k)).map(dedupe_key => ({ dedupe_key })), error: null }) },
        insert(row) { db.inserts.push(row); return { select: () => ({ single: async () => ({ data: row, error: null }) }) } },
      }
      return b
    },
  },
}))

import { complianceNotificationFor, maybeWarnComplianceExpiring } from '../api/notifications'

const NOW = new Date('2026-11-15T12:00:00Z').getTime()
const item = (over = {}) => ({ id: 'c1', property_id: 'p1', cert_type: 'gas_safety', cert_name: null, expiry_date: '2026-12-01', property: { name: 'Flat 1' }, ...over })

describe('complianceNotificationFor', () => {
  it('titles from cert_name / cert_type, not the non-existent item_type', () => {
    expect(complianceNotificationFor(item(), { now: NOW }).title).toMatch(/^Gas Safety \(CP12\) expires in 16 days — Flat 1$/)
    expect(complianceNotificationFor(item({ cert_name: 'Landlord gas cert' }), { now: NOW }).title).toMatch(/^Landlord gas cert /)
  })

  it('keys one notification per item per stage, and per expiry date', () => {
    expect(complianceNotificationFor(item(), { now: NOW }).dedupe_key).toBe('compliance:c1:30:2026-12-01')
    expect(complianceNotificationFor(item({ expiry_date: '2026-11-20' }), { now: NOW }).dedupe_key).toBe('compliance:c1:7:2026-11-20')
    expect(complianceNotificationFor(item({ expiry_date: '2026-10-01' }), { now: NOW }).dedupe_key).toBe('compliance:c1:expired:2026-10-01')
    expect(complianceNotificationFor(item({ expiry_date: '2027-06-01' }), { now: NOW })).toBeNull()
  })
})

describe('maybeWarnComplianceExpiring', () => {
  beforeEach(() => { db.existing = []; db.inserts.length = 0 })

  it('does not insert an expired notification the user already has (no daily repeat)', async () => {
    const expired = item({ expiry_date: '2020-01-01' })
    db.existing = ['compliance:c1:expired:2020-01-01']
    expect(await maybeWarnComplianceExpiring([expired])).toBe(0)
    expect(db.inserts).toHaveLength(0)
  })

  it('inserts a new stage once, with the dedupe key the trigger honours', async () => {
    expect(await maybeWarnComplianceExpiring([item({ expiry_date: '2020-01-01' })])).toBe(1)
    expect(db.inserts[0].dedupe_key).toBe('compliance:c1:expired:2020-01-01')
    expect(db.inserts[0].type).toBe('compliance_expired')
  })
})
