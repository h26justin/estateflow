// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildAgentReport } from '../agentReport'
import {
  snapshotFromAgentReport, diffSnapshots, currentSnapshotFor, supersededIds, reportCompanyId, periodOf,
  FORMULA_VERSION, HEADLINE_TOTALS,
} from '../reportSnapshots'

const AGENT = { id: 'ag1', name: 'Propertunity' }
function prop(id, over = {}) {
  return {
    id, name: `Flat ${id}`, company_id: 'c1', company: { name: 'ExH Property Group' },
    status: 'rented', rent_pcm: 500, rent_due_day: 1, managed_by_agent_id: AGENT.id, tenant_name: `Tenant Person ${id}`,
    rent_payments: [], tenancies: [{ id: `t${id}`, tenant_name: `Tenant Person ${id}`, tenancy_start: '2026-01-01', rent_amount: 500, rent_frequency: 'monthly', status: 'active' }],
    rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
    ...over,
  }
}
const month = (id, m, status, amount = null) => ({ id: `${id}-${m}`, year: 2026, month: m, status, amount })
const asOf = '2026-10-31'
const props = [
  prop('1', { rent_payments: [month('1', 8, 'paid', 500), month('1', 9, 'paid', 500), month('1', 10, 'paid', 500)] }),
  prop('2', { rent_payments: [month('2', 8, 'paid', 500), month('2', 9, 'unpaid'), month('2', 10, 'unpaid')] }),
  prop('3', { status: 'vacant', vacant_since: '2026-08-01' }),
]
const model = buildAgentReport(props, { agent: AGENT, asOf })

describe('snapshotFromAgentReport', () => {
  const snap = snapshotFromAgentReport(model)

  it('records the scope, period and formula version', () => {
    expect(snap).toMatchObject({ kind: 'agent_rent_report', agent_id: 'ag1', company_id: null, as_of: asOf, period: '2026-10', formula_version: FORMULA_VERSION })
    expect(FORMULA_VERSION).toBe('rent-engine-2026-11-19')
    expect(snapshotFromAgentReport(model, { period: '2026-09', companyId: 'c1' })).toMatchObject({ period: '2026-09', company_id: 'c1' })
  })

  it('keeps the summary totals and aged totals as the report has them', () => {
    const s = model.summary
    expect(snap.summary).toMatchObject({
      units: s.units, owed: s.owed, arrears: s.arrears, owingCount: s.owingCount, missedMonths: s.missedMonths,
      yearDue: s.yearDue, yearCollected: s.yearCollected, shortfallYear: s.shortfallYear, agentName: 'Propertunity',
    })
    expect(snap.summary.totalOwed).toBe(Math.round((s.owed + s.arrears) * 100) / 100)
    expect(snap.summary.aged).toEqual({ '0-30': s.aged['0-30'], '31-60': s.aged['31-60'], '61-90': s.aged['61-90'], '90+': s.aged['90+'], historic: s.aged.historic, total: s.aged.total })
    expect(snap.summary.owed).toBeGreaterThan(0)
  })

  it('keeps one compact line per property, with the fields a restatement moves', () => {
    expect(snap.lines).toHaveLength(model.lines.length)
    const f2 = snap.lines.find(l => l.id === '2')
    const card = model.lines.find(c => c.id === '2')
    expect(Object.keys(f2).sort()).toEqual(['aged', 'arrears', 'company', 'companyId', 'id', 'missedMonths', 'name', 'owed', 'yearCollected', 'yearDue'])
    expect(f2).toMatchObject({ name: 'Flat 2', company: 'ExH Property Group', owed: card.owed, arrears: card.arrears, missedMonths: card.missedMonths, yearDue: card.yearDue, yearCollected: card.yearCollected })
  })

  it('never carries tenant names', () => {
    expect(JSON.stringify(snap)).not.toMatch(/Tenant Person/)
  })

  it('needs a report', () => {
    expect(() => snapshotFromAgentReport(null)).toThrow()
  })
})

describe('reportCompanyId / periodOf', () => {
  it('is the one company a report covers, else null', () => {
    expect(reportCompanyId(model)).toBe('c1')
    const two = buildAgentReport([...props, prop('9', { company_id: 'c2', company: { name: 'Other' } })], { agent: AGENT, asOf })
    expect(reportCompanyId(two)).toBe(null)
    expect(reportCompanyId(null)).toBe(null)
  })
  it('periods are the as-of month', () => { expect(periodOf('2026-11-19')).toBe('2026-11') })
})

describe('currentSnapshotFor / supersededIds', () => {
  const scope = { kind: 'agent_rent_report', agent_id: 'ag1', company_id: 'c1', period: '2026-10' }
  const rows = [
    { id: 's1', ...scope, created_at: '2026-11-01T09:00:00Z' },
    { id: 's2', ...scope, supersedes: 's1', note: 'Receipt posted late', created_at: '2026-11-03T09:00:00Z' },
    { id: 's3', ...scope, period: '2026-09', created_at: '2026-10-01T09:00:00Z' },
    { id: 's4', ...scope, agent_id: 'ag2', created_at: '2026-11-04T09:00:00Z' },
  ]
  it('finds the live snapshot for the same agent, company and period', () => {
    expect(supersededIds(rows)).toEqual(new Set(['s1']))
    expect(currentSnapshotFor(rows, scope).id).toBe('s2')
    expect(currentSnapshotFor(rows, { ...scope, period: '2026-11' })).toBe(null)
    expect(currentSnapshotFor(rows, { ...scope, company_id: null })).toBe(null)
    expect(currentSnapshotFor(rows, { ...scope, agent_id: 'ag2' }).id).toBe('s4')
  })
})

describe('diffSnapshots', () => {
  const before = snapshotFromAgentReport(model)
  // Flat 2 pays September late; a new property joins.
  const later = buildAgentReport([
    props[0],
    prop('2', { rent_payments: [month('2', 8, 'paid', 500), month('2', 9, 'paid', 500), month('2', 10, 'unpaid')] }),
    props[2],
    prop('4', { rent_payments: [month('4', 9, 'unpaid'), month('4', 10, 'unpaid')] }),
  ], { agent: AGENT, asOf })
  const after = snapshotFromAgentReport(later)

  it('is empty for identical snapshots', () => {
    const d = diffSnapshots(before, snapshotFromAgentReport(model))
    expect(d.changed).toBe(false)
    expect(d.properties).toEqual([])
    expect(d.totals.every(t => t.delta === 0)).toBe(true)
    expect(d.totals.map(t => t.key)).toEqual(HEADLINE_TOTALS.map(t => t.key))
  })

  it('gives the change in each headline total and per-property owed and arrears', () => {
    const d = diffSnapshots(before, after)
    expect(d.changed).toBe(true)
    const owed = d.totals.find(t => t.key === 'owed')
    expect(owed).toMatchObject({ old: model.summary.owed, new: later.summary.owed })
    expect(owed.delta).toBe(Math.round((later.summary.owed - model.summary.owed) * 100) / 100)
    expect(d.totals.find(t => t.key === 'units').delta).toBe(1)
    const f2 = d.properties.find(p => p.id === '2')
    const f2old = before.lines.find(l => l.id === '2'), f2new = after.lines.find(l => l.id === '2')
    expect(f2.change).toBe('changed')
    expect(f2.owed).toEqual({ old: f2old.owed, new: f2new.owed, delta: Math.round((f2new.owed - f2old.owed) * 100) / 100 })
    expect(d.properties.find(p => p.id === '4').change).toBe('added')
    expect(d.properties.find(p => p.id === '1')).toBeUndefined()
    // Aged total moves by the change in total owed.
    const agedTotal = d.aged.find(a => a.bucket === 'total')
    expect(agedTotal.delta).toBe(d.totals.find(t => t.key === 'totalOwed').delta)
  })

  it('lists removed properties and flags a formula change', () => {
    const d = diffSnapshots({ ...after, formula_version: 'rent-engine-old' }, before)
    expect(d.properties.find(p => p.id === '4').change).toBe('removed')
    expect(d.formulaChanged).toBe(true)
  })

  it('adds in pence (no float drift)', () => {
    const a = { summary: { owed: 0.1 }, lines: [{ id: 'x', name: 'X', owed: 0.1, arrears: 0 }] }
    const b = { summary: { owed: 0.3 }, lines: [{ id: 'x', name: 'X', owed: 0.3, arrears: 0 }] }
    const d = diffSnapshots(a, b)
    expect(d.totals.find(t => t.key === 'owed').delta).toBe(0.2)
    expect(d.properties[0].owed.delta).toBe(0.2)
  })
})
