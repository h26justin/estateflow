import { describe, it, expect, vi, beforeEach } from 'vitest'

// deal_milestones mock: select returns MILESTONES; delete/insert are recorded.
let MILESTONES = []
const writes = []
function chain() {
  const q = { op: 'select' }
  q.select = vi.fn(() => q)
  for (const m of ['eq', 'is', 'in', 'order']) q[m] = vi.fn((...args) => { (q.filters ||= []).push([m, ...args]); return q })
  q.delete = vi.fn(() => { q.op = 'delete'; return q })
  q.insert = vi.fn(rows => { writes.push({ op: 'insert', rows }); return Promise.resolve({ error: null }) })
  q.then = (res, rej) => {
    if (q.op === 'delete') {
      writes.push({ op: 'delete', filters: q.filters })
      const ids = q.filters.find(f => f[0] === 'in')[2]
      return Promise.resolve({ data: ids.map(id => ({ id })), error: null }).then(res, rej)
    }
    return Promise.resolve({ data: MILESTONES, error: null }).then(res, rej)
  }
  return q
}
vi.mock('../supabase', () => ({ supabase: { from: vi.fn(() => chain()) } }))

import {
  milestoneTemplate, trackerMatchesType, milestonesUntouched, rebuildMilestones,
  DEFAULT_MILESTONES_STANDARD,
} from '../api/deals'

const row = (m, over = {}) => ({ id: m.key, milestone_key: m.key, stage: m.stage, is_enabled: true, completed: false, completed_date: null, ...over })
const standard = () => DEFAULT_MILESTONES_STANDARD.map(m => row(m))

describe('purchase tracker templates', () => {
  beforeEach(() => { writes.length = 0; MILESTONES = [] })

  it('knows when the tracker already matches the deal type', () => {
    expect(trackerMatchesType(standard(), false, false)).toBe(true)
    expect(trackerMatchesType(standard(), true, false)).toBe(false)
    expect(trackerMatchesType(standard(), false, true)).toBe(false)
    const brrr = milestoneTemplate(false, true).map(m => row(m))
    expect(trackerMatchesType(brrr, false, true)).toBe(true)
  })

  it('treats ticked, dated or switched steps as progress', () => {
    expect(milestonesUntouched(standard())).toBe(true)
    const ms = standard()
    expect(milestonesUntouched([...ms.slice(1), { ...ms[0], completed: true }])).toBe(false)
    expect(milestonesUntouched([...ms.slice(1), { ...ms[0], completed_date: '2026-11-01' }])).toBe(false)
    expect(milestonesUntouched([...ms.slice(1), { ...ms[1], is_enabled: false }])).toBe(false)
    // ...unless the switch matches the user's master defaults
    expect(milestonesUntouched([...ms.slice(2), { ...ms[1], is_enabled: false }], { [ms[1].milestone_key]: false })).toBe(true)
  })

  it('rebuilds an untouched tracker as the auction checklist', async () => {
    MILESTONES = standard()
    await rebuildMilestones('d1', true, false)
    const del = writes.find(w => w.op === 'delete')
    expect(del.filters).toContainEqual(['eq', 'completed', false])
    expect(del.filters).toContainEqual(['is', 'completed_date', null])
    const ins = writes.find(w => w.op === 'insert')
    expect(ins.rows.map(r => r.milestone_key)).toEqual(milestoneTemplate(true, false).map(m => m.key))
  })

  it('refuses to rebuild a tracker with progress, writing nothing', async () => {
    MILESTONES = standard()
    MILESTONES[0] = { ...MILESTONES[0], completed: true, completed_date: '2026-11-01' }
    await expect(rebuildMilestones('d1', true, false)).rejects.toThrow(/progress/)
    expect(writes).toEqual([])
  })
})
