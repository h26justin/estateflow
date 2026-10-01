import { describe, it, expect } from 'vitest'
import {
  stageTree, flatStages, worksProgress, stageCompletion, currentStage, stageDelay,
  cascadeDates, wouldCreateCycle, forecastFinalCost, templateRows, templateFromStages,
  filterProjects, statusOptions, parseStatusValue, statusValue, statusLabel, programmeEnd,
  isTaskOverdue, journeySummary, BUILT_IN_TEMPLATES, addDays, daysBetween,
} from '../refurbWorkspace'

const st = (id, over = {}) => ({ id, project_id: 'p1', name: id.toUpperCase(), sort_order: 0, status: 'not_started', weight: 1, ...over })

describe('templates', () => {
  it('ships the brief residential and commercial journeys', () => {
    expect(BUILT_IN_TEMPLATES.residential.stages.map(s => s.name)).toEqual([
      'Scope & Survey', 'Design & Plans', 'Approvals', 'Strip Out', 'Structural Works', 'First Fix',
      'Plastering', 'Second Fix', 'Kitchen & Bathroom', 'Flooring & Decoration', 'Snagging', 'Handover',
    ])
    expect(BUILT_IN_TEMPLATES.commercial.stages).toHaveLength(11)
    expect(BUILT_IN_TEMPLATES.commercial.stages[7].name).toBe('Fit-Out')
  })

  it('templateRows numbers stages and keeps substages under their parent', () => {
    const rows = templateRows({ stages: [{ key: 'a', name: 'A', substages: [{ name: 'A1' }, { name: ' ' }] }, { name: '' }, { key: 'b', name: 'B' }] })
    expect(rows).toEqual([
      { stage_key: 'a', name: 'A', sort_order: 1, parent_key: null, weight: 1 },
      { stage_key: null, name: 'A1', sort_order: 1, parent_key: 'a', weight: 1 },
      { stage_key: 'b', name: 'B', sort_order: 3, parent_key: null, weight: 1 },
    ])
  })

  it('templateFromStages round-trips a customised journey, dropping archived stages', () => {
    const stages = [st('a', { sort_order: 2, stage_key: 'a' }), st('b', { sort_order: 1 }), st('a1', { parent_id: 'a', sort_order: 1 }), st('x', { archived_at: '2026-10-01' })]
    expect(templateFromStages(stages)).toEqual([
      { key: null, name: 'B', weight: 1, substages: [] },
      { key: 'a', name: 'A', weight: 1, substages: [{ key: null, name: 'A1', weight: 1 }] },
    ])
  })
})

describe('stage tree', () => {
  it('orders by sort_order and nests substages, hiding archived and deleted', () => {
    const tree = stageTree([st('b', { sort_order: 2 }), st('a', { sort_order: 1 }), st('a2', { parent_id: 'a', sort_order: 2 }), st('a1', { parent_id: 'a', sort_order: 1 }), st('gone', { deleted_at: 'x' }), st('arch', { archived_at: 'x' })])
    expect(tree.map(s => s.id)).toEqual(['a', 'b'])
    expect(tree[0].children.map(s => s.id)).toEqual(['a1', 'a2'])
    expect(flatStages([st('a', { sort_order: 1 }), st('a1', { parent_id: 'a' }), st('b', { sort_order: 2 })]).map(s => s.id)).toEqual(['a', 'a1', 'b'])
  })
})

describe('statuses', () => {
  it('offers the six categories plus valid custom statuses', () => {
    const opts = statusOptions([{ label: 'Waiting on BC', category: 'blocked' }, { label: 'Bad', category: 'nope' }, { label: '', category: 'complete' }])
    expect(opts).toHaveLength(7)
    expect(opts[6]).toEqual({ value: 'blocked|Waiting on BC', status: 'blocked', label: 'Waiting on BC' })
    expect(parseStatusValue('blocked|Waiting on BC')).toEqual({ status: 'blocked', status_label: 'Waiting on BC' })
    expect(parseStatusValue('complete')).toEqual({ status: 'complete', status_label: null })
    expect(parseStatusValue('rubbish')).toEqual({ status: 'not_started', status_label: null })
    expect(statusValue({ status: 'blocked', status_label: 'Waiting on BC' })).toBe('blocked|Waiting on BC')
    expect(statusLabel({ status: 'on_hold' })).toBe('On hold')
  })
})

describe('works progress', () => {
  it('is null with no journey', () => {
    expect(worksProgress([])).toMatchObject({ pct: null, hasJourney: false })
  })

  it('weights stages, leaves skipped and archived out, and never counts money', () => {
    const stages = [
      st('a', { status: 'complete', sort_order: 1 }),
      st('b', { status: 'in_progress', progress_pct: 50, sort_order: 2 }),
      st('c', { status: 'skipped', sort_order: 3 }),
      st('d', { sort_order: 4, weight: 2 }),
      st('e', { status: 'complete', archived_at: 'x', sort_order: 5 }),
    ]
    // (1*1 + 1*0.5 + 2*0) / 4 = 37.5%
    expect(worksProgress(stages)).toMatchObject({ pct: 38, counted: 3, complete: 1, missing: 0 })
  })

  it('uses the checklist when no progress is recorded, and flags missing otherwise', () => {
    const stages = [st('a', { status: 'in_progress' }), st('b', { status: 'blocked' })]
    const tasks = [
      { stage_id: 'a', kind: 'checklist', status: 'done' },
      { stage_id: 'a', kind: 'checklist', status: 'open' },
      { stage_id: 'a', kind: 'checklist', status: 'cancelled' },
      { stage_id: 'a', kind: 'task', status: 'done' },
    ]
    expect(stageCompletion(stages[0], [], tasks)).toEqual({ value: 0.5, source: 'checklist' })
    expect(stageCompletion(stages[1], [], tasks)).toEqual({ value: 0, source: 'missing' })
    expect(worksProgress(stages, tasks)).toMatchObject({ pct: 25, missing: 1 })
  })

  it('a stage with substages averages them, unless itself complete', () => {
    const stages = [st('a', { status: 'in_progress' }), st('a1', { parent_id: 'a', status: 'complete' }), st('a2', { parent_id: 'a', status: 'not_started', weight: 3 })]
    expect(worksProgress(stages).pct).toBe(25)
    stages[0].status = 'complete'
    expect(worksProgress(stages).pct).toBe(100)
  })
})

describe('current stage', () => {
  it('is the first stage under way, else the first not started', () => {
    expect(currentStage([st('a', { status: 'complete', sort_order: 1 }), st('b', { sort_order: 2 }), st('c', { status: 'blocked', sort_order: 3 })]).id).toBe('c')
    expect(currentStage([st('a', { status: 'complete', sort_order: 1 }), st('b', { status: 'skipped', sort_order: 2 }), st('c', { sort_order: 3 })]).id).toBe('c')
    expect(currentStage([st('a', { status: 'complete' })])).toBeNull()
  })
})

describe('dates', () => {
  const today = new Date('2026-10-10T12:00:00')
  it('flags overdue and slipped stages', () => {
    expect(stageDelay(st('a', { planned_end: '2026-10-05' }), today)).toEqual({ overdue: true, slippedDays: 0, overdueDays: 5 })
    expect(stageDelay(st('a', { planned_end: '2026-10-05', forecast_end: '2026-10-20' }), today)).toEqual({ overdue: false, slippedDays: 15, overdueDays: 0 })
    expect(stageDelay(st('a', { status: 'complete', planned_end: '2026-10-01', actual_end: '2026-10-03' }), today)).toEqual({ overdue: false, slippedDays: 2, overdueDays: 0 })
  })
  it('programme end is the latest best-known finish of counted stages', () => {
    expect(programmeEnd([st('a', { planned_end: '2026-11-01' }), st('b', { forecast_end: '2026-12-01', planned_end: '2026-11-15' }), st('c', { status: 'skipped', planned_end: '2027-01-01' })])).toBe('2026-12-01')
  })
  it('task overdue only while open', () => {
    expect(isTaskOverdue({ status: 'open', due_date: '2026-10-09' }, today)).toBe(true)
    expect(isTaskOverdue({ status: 'done', due_date: '2026-10-09' }, today)).toBe(false)
    expect(isTaskOverdue({ status: 'open', due_date: '2026-10-10' }, today)).toBe(false)
  })
  it('date arithmetic', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14)
  })
})

describe('dependencies', () => {
  it('detects cycles', () => {
    const deps = [{ stage_id: 'b', depends_on_id: 'a' }, { stage_id: 'c', depends_on_id: 'b' }]
    expect(wouldCreateCycle(deps, 'a', 'c')).toBe(true)
    expect(wouldCreateCycle(deps, 'c', 'a')).toBe(false)
    expect(wouldCreateCycle(deps, 'a', 'a')).toBe(true)
  })

  it('pushes a chain later keeping durations, and never pulls earlier', () => {
    const stages = [
      st('a', { name: 'Strip out', planned_start: '2026-10-01', planned_end: '2026-10-10', forecast_end: '2026-10-15' }),
      st('b', { name: 'First fix', planned_start: '2026-10-11', planned_end: '2026-10-20' }),
      st('c', { name: 'Plaster', planned_start: '2026-10-21', planned_end: '2026-10-25' }),
      st('d', { name: 'Late anyway', planned_start: '2026-12-01', planned_end: '2026-12-05' }),
    ]
    const deps = [{ stage_id: 'b', depends_on_id: 'a' }, { stage_id: 'c', depends_on_id: 'b', lag_days: 2 }, { stage_id: 'd', depends_on_id: 'c' }]
    const moves = cascadeDates(stages, deps)
    expect(moves).toEqual([
      { stage_id: 'b', name: 'First fix', from_start: '2026-10-11', to_start: '2026-10-16', from_end: '2026-10-20', to_end: '2026-10-25', because: 'Strip out', days: 5 },
      { stage_id: 'c', name: 'Plaster', from_start: '2026-10-21', to_start: '2026-10-28', from_end: '2026-10-25', to_end: '2026-11-01', because: 'First fix', days: 7 },
    ])
  })

  it('leaves started, complete and skipped stages alone', () => {
    const stages = [st('a', { forecast_end: '2026-10-15' }), st('b', { planned_start: '2026-10-11', planned_end: '2026-10-20', actual_start: '2026-10-11' }), st('c', { planned_start: '2026-10-11', status: 'skipped' })]
    expect(cascadeDates(stages, [{ stage_id: 'b', depends_on_id: 'a' }, { stage_id: 'c', depends_on_id: 'a' }])).toEqual([])
  })

  it('takes the later of two predecessors', () => {
    const stages = [st('a', { forecast_end: '2026-10-10' }), st('b', { forecast_end: '2026-10-20' }), st('c', { planned_start: '2026-10-05', planned_end: '2026-10-06' })]
    const moves = cascadeDates(stages, [{ stage_id: 'c', depends_on_id: 'a' }, { stage_id: 'c', depends_on_id: 'b' }])
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ to_start: '2026-10-21', to_end: '2026-10-22', from_start: '2026-10-05' })
  })
})

describe('forecast final cost', () => {
  it('is the larger of revised budget and invoiced + committed', () => {
    expect(forecastFinalCost({ agreed: 30000, invoiced: 10000, committed: 5000 })).toEqual({ value: 30000, calculated: 30000, overridden: false, variance: 0 })
    expect(forecastFinalCost({ agreed: 30000, invoiced: 28000, committed: 5000 })).toEqual({ value: 33000, calculated: 33000, overridden: false, variance: 3000 })
  })
  it('a PM override wins, including zero', () => {
    expect(forecastFinalCost({ agreed: 30000, override: 35000 })).toMatchObject({ value: 35000, calculated: 30000, overridden: true, variance: 5000 })
    expect(forecastFinalCost({ agreed: 30000, override: 0 })).toMatchObject({ value: 0, overridden: true })
    expect(forecastFinalCost({ agreed: 30000, override: '' })).toMatchObject({ value: 30000, overridden: false })
  })
})

describe('portfolio filters', () => {
  const projects = [
    { id: '1', project_type: 'residential', stage: 'in_progress', contractor_name: 'GLB', project_manager_name: 'Sam', target_end_date: '2026-11-01', property: { company_id: 'c1', name: '12 Douro Terrace', address: 'Sunderland' } },
    { id: '2', project_type: 'commercial', stage: 'planned', contractor_name: 'Acme', property: { company_id: 'c2', name: 'Unit 4' } },
    { id: '3', stage: 'complete', archived_at: '2026-09-01', property: { company_id: 'c1', name: 'Old job' } },
    { id: '4', stage: 'complete', property: { company_id: 'c1', name: 'Done job' }, start_date: '2026-01-01' },
  ]
  const ids = f => filterProjects(projects, f).map(p => p.id)
  it('filters by type (missing = residential), company, status, people and search', () => {
    expect(ids({ type: 'residential' })).toEqual(['1', '4'])
    expect(ids({ type: 'commercial' })).toEqual(['2'])
    expect(ids({ companyId: 'c1' })).toEqual(['1', '4'])
    expect(ids({ status: 'active' })).toEqual(['1', '2'])
    expect(ids({ contractor: 'glb' })).toEqual(['1'])
    expect(ids({ manager: 'Sam' })).toEqual(['1'])
    expect(ids({ q: 'douro' })).toEqual(['1'])
  })
  it('archived projects only show in the archive', () => {
    expect(ids({ archived: true })).toEqual(['3'])
  })
  it('date range uses forecast completion, else start', () => {
    expect(ids({ from: '2026-10-15', to: '2026-12-31' })).toEqual(['1'])
    expect(ids({ to: '2026-02-01' })).toEqual(['4'])
  })
})

describe('journey summary', () => {
  it('collects progress, current stage, overdue tasks, blockers and delays for one project', () => {
    const stages = [st('a', { status: 'complete', sort_order: 1 }), st('b', { status: 'blocked', sort_order: 2, planned_end: '2026-10-01' }), { ...st('z'), project_id: 'other' }]
    const tasks = [{ project_id: 'p1', status: 'open', due_date: '2026-10-01' }, { project_id: 'p1', status: 'open' }, { project_id: 'other', status: 'open', due_date: '2026-01-01' }]
    const s = journeySummary({ id: 'p1' }, stages, tasks, new Date('2026-10-10T12:00:00'))
    expect(s.progress.pct).toBe(50)
    expect(s.current.id).toBe('b')
    expect(s.overdueTasks).toHaveLength(1)
    expect(s.openTasks).toHaveLength(2)
    expect(s.blocked.map(x => x.id)).toEqual(['b'])
    expect(s.delayed.map(x => x.id)).toEqual(['b'])
    expect(s.stageCount).toBe(2)
  })
})
