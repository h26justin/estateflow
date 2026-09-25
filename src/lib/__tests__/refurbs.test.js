import { describe, it, expect } from 'vitest'
import {
  projectTotals, daysLeft, isOverdue, suggestStage, mirrorFields,
  summariseProjects, ledgerLines, knownPayees, propertyRefurbSummary, projectsFromProperties,
} from '../refurbs'

const project = (over = {}) => ({
  id: 'p1', stage: 'in_progress', agreed_price: 30000, target_end_date: null, refurb_lines: [], ...over,
})
const line = (kind, amount, over = {}) => ({ id: Math.random().toString(36).slice(2), kind, amount, date: '2026-09-01', ...over })

describe('projectTotals', () => {
  it('agreed = original + extras, paid = payments - credits', () => {
    const t = projectTotals(project({ refurb_lines: [
      line('payment', 7000), line('payment', 7000), line('extra', 1800), line('credit', 500),
    ] }))
    expect(t.original).toBe(30000)
    expect(t.extras).toBe(1800)
    expect(t.agreed).toBe(31800)
    expect(t.paid).toBe(13500)
    expect(t.remaining).toBe(18300)
    expect(t.overpaid).toBe(0)
    expect(t.pct).toBe(42)
    expect(t.over).toBe(true)
  })
  it('ignores soft-deleted lines', () => {
    const t = projectTotals(project({ refurb_lines: [line('payment', 5000), line('payment', 9999, { deleted_at: '2026-09-01' })] }))
    expect(t.paid).toBe(5000)
    expect(t.lineCount).toBe(1)
  })
  it('remaining never goes negative; overpaid captures the excess', () => {
    const t = projectTotals(project({ agreed_price: 1000, refurb_lines: [line('payment', 1500)] }))
    expect(t.remaining).toBe(0)
    expect(t.overpaid).toBe(500)
    expect(t.pct).toBe(100)
  })
  it('handles a project with no price yet', () => {
    const t = projectTotals(project({ agreed_price: 0 }))
    expect(t.agreed).toBe(0)
    expect(t.pct).toBe(0)
    expect(t.over).toBe(false)
  })
})

describe('daysLeft / isOverdue', () => {
  const today = new Date('2026-09-02T10:00:00')
  it('counts whole days to the target', () => {
    expect(daysLeft(project({ target_end_date: '2026-09-05' }), today)).toBe(3)
    expect(daysLeft(project({ target_end_date: '2026-08-20' }), today)).toBe(-13)
    expect(daysLeft(project(), today)).toBe(null)
  })
  it('only active projects can be overdue', () => {
    expect(isOverdue(project({ target_end_date: '2026-08-20' }), today)).toBe(true)
    expect(isOverdue(project({ target_end_date: '2026-08-20', stage: 'complete' }), today)).toBe(false)
    expect(isOverdue(project({ target_end_date: '2026-10-01' }), today)).toBe(false)
  })
})

describe('suggestStage', () => {
  it('suggests complete once paid reaches agreed', () => {
    expect(suggestStage(project({ refurb_lines: [line('payment', 30000)] }))).toBe('complete')
  })
  it('suggests in_progress on the first payment of a planned job', () => {
    expect(suggestStage(project({ stage: 'planned', refurb_lines: [line('payment', 100)] }))).toBe('in_progress')
  })
  it('stays quiet otherwise', () => {
    expect(suggestStage(project({ refurb_lines: [line('payment', 100)] }))).toBe(null)
    expect(suggestStage(project({ stage: 'complete', refurb_lines: [line('payment', 30000)] }))).toBe(null)
    expect(suggestStage(project({ agreed_price: 0 }))).toBe(null)
  })
})

describe('mirrorFields (client copy of the DB trigger)', () => {
  it('refurb_cost mirrors PAID, not agreed', () => {
    const m = mirrorFields([project({ refurb_lines: [line('payment', 12000)] })])
    expect(m.refurb_cost).toBe(12000)
    expect(m.refurb_status).toBe('in-progress')
    expect(m.refurb_cost_unpaid).toBe(false)
  })
  it('status: in-progress beats planned beats complete', () => {
    expect(mirrorFields([project({ stage: 'planned' }), project({ stage: 'complete' })]).refurb_status).toBe('planned')
    expect(mirrorFields([project({ stage: 'complete' })]).refurb_status).toBe('complete')
    expect(mirrorFields([project({ stage: 'on_hold' })]).refurb_status).toBe('in-progress')
  })
  it('returns null with no live projects so the legacy value is left alone', () => {
    expect(mirrorFields([])).toBe(null)
    expect(mirrorFields([project({ deleted_at: 'x' })])).toBe(null)
  })
})

describe('summariseProjects', () => {
  const today = new Date('2026-09-02T10:00:00')
  it('totals active projects only and counts the alerts', () => {
    const s = summariseProjects([
      project({ id: 'a', agreed_price: 30000, refurb_lines: [line('payment', 21000), line('extra', 1800)], target_end_date: '2026-10-14' }),
      project({ id: 'b', agreed_price: 31500, refurb_lines: [line('payment', 28000)], target_end_date: '2026-08-20' }),
      project({ id: 'c', stage: 'planned', agreed_price: 0 }),
      project({ id: 'd', stage: 'complete', agreed_price: 27000, refurb_lines: [line('payment', 27000)] }),
    ], today)
    expect(s.active).toBe(3)
    expect(s.complete).toBe(1)
    expect(s.agreed).toBe(63300)
    expect(s.paid).toBe(49000)
    expect(s.remaining).toBe(14300)
    expect(s.overBudget).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.noPrice).toBe(1)
    expect(s.byStage.complete.length).toBe(1)
    expect(s.byStage.in_progress.length).toBe(2)
  })
})

describe('ledgerLines / knownPayees', () => {
  it('flattens lines newest first with the project attached', () => {
    const rows = ledgerLines([
      project({ id: 'a', refurb_lines: [line('payment', 1, { date: '2026-08-01', payee: 'GLB Builders' }), line('payment', 2, { date: '2026-09-01', payee: 'Kitchen Co' })] }),
      project({ id: 'b', contractor_name: 'Sparky Ltd', refurb_lines: [line('extra', 3, { date: '2026-08-15', payee: 'GLB Builders' })] }),
    ])
    expect(rows.map(r => r.amount)).toEqual([2, 3, 1])
    expect(rows[0].project.id).toBe('a')
    // Newest payee first, case-insensitive de-dupe, contractor names last.
    expect(knownPayees([
      project({ id: 'a', refurb_lines: [line('payment', 1, { date: '2026-08-01', payee: 'glb builders' }), line('payment', 2, { date: '2026-09-01', payee: 'Kitchen Co' })] }),
      project({ id: 'b', contractor_name: 'Sparky Ltd', refurb_lines: [line('extra', 3, { date: '2026-08-15', payee: 'GLB Builders' })] }),
    ])).toEqual(['Kitchen Co', 'GLB Builders', 'Sparky Ltd'])
  })
})

describe('propertyRefurbSummary / projectsFromProperties', () => {
  it('sums active projects and picks the earliest target date', () => {
    const s = propertyRefurbSummary({ refurb_projects: [
      project({ id: 'a', agreed_price: 30000, refurb_lines: [line('payment', 21000)], target_end_date: '2026-10-14' }),
      project({ id: 'b', agreed_price: 5000, target_end_date: '2026-09-20' }),
      project({ id: 'c', stage: 'complete', agreed_price: 99999 }),
    ] })
    expect(s.headline).toBe(35000)
    expect(s.unpaid).toBe(14000)
    expect(s.trigger).toBe('2026-09-20')
    expect(s.count).toBe(2)
  })
  it('attaches the property and skips deleted rows', () => {
    const list = projectsFromProperties([
      { id: 'P', name: 'Flat 3', refurb_projects: [project({ id: 'a' }), project({ id: 'b', deleted_at: 'x' })] },
      { id: 'Q', deleted_at: 'x', refurb_projects: [project({ id: 'c' })] },
    ])
    expect(list.map(p => p.id)).toEqual(['a'])
    expect(list[0].property.name).toBe('Flat 3')
  })
})
