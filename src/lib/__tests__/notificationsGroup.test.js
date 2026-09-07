import { describe, it, expect } from 'vitest'
import { groupNotifications, typeLabel } from '../notificationsGroup'

describe('groupNotifications', () => {
  it('groups by type, counts unread, newest group first', () => {
    const items = [
      { id: 1, type: 'compliance_expired', created_at: '2026-09-01T00:00:00Z', read_at: null },
      { id: 2, type: 'autopilot', created_at: '2026-09-06T00:00:00Z', read_at: '2026-09-06T01:00:00Z' },
      { id: 3, type: 'compliance_expired', created_at: '2026-09-05T00:00:00Z', read_at: null },
    ]
    const g = groupNotifications(items)
    expect(g.map(x => x.type)).toEqual(['autopilot', 'compliance_expired'])
    expect(g[1].items).toHaveLength(2); expect(g[1].unread).toBe(2); expect(g[1].label).toBe('Certificates expired')
    expect(g[0].unread).toBe(0)
  })
  it('labels unknown types readably', () => {
    expect(typeLabel('statement_received')).toBe('Statements received')
    expect(typeLabel('some_new_thing')).toBe('Some new thing')
  })
})
