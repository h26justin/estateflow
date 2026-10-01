// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildAgentReport, managedByAgent } from '../agentReport'
import { bundleAgentReport, OUT } from '../../../scripts/build-agent-report.mjs'
import { readFileSync } from 'node:fs'

const AGENT = { id: 'ag1', name: 'Propertunity' }
const RMS = { id: 'ag2', name: 'RMS Letting' }

function prop(id, over = {}) {
  return {
    id, name: `Flat ${id}`, company_id: 'c1', company: { name: 'ExH Property Group' },
    status: 'rented', rent_pcm: 500, rent_due_day: 1, managed_by_agent_id: AGENT.id,
    rent_payments: [], tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
    ...over,
  }
}
const month = (id, m, status, amount = null) => ({ id: `${id}-${m}`, year: 2026, month: m, status, amount })

describe('managedByAgent', () => {
  it('uses the agent id, falling back to the managed_by text only when no agent is linked', () => {
    expect(managedByAgent(prop('a'), AGENT)).toBe(true)
    expect(managedByAgent(prop('b', { managed_by_agent_id: RMS.id, managed_by: 'Propertunity' }), AGENT)).toBe(false)
    expect(managedByAgent(prop('c', { managed_by_agent_id: null, managed_by: ' propertunity ' }), AGENT)).toBe(true)
    expect(managedByAgent(prop('d', { managed_by_agent_id: null, managed_by: null }), AGENT)).toBe(false)
  })
})

describe('buildAgentReport', () => {
  const asOf = '2026-10-05'
  const props = [
    // Paid through September, October due on the 1st, window still open on the 5th? default 5 days -> closes 6th
    prop('1', { rent_payments: [month('1', 8, 'paid', 500), month('1', 9, 'paid', 500), month('1', 10, 'unpaid')] }),
    // Missed September
    prop('2', { rent_payments: [month('2', 8, 'paid', 500), month('2', 9, 'unpaid'), month('2', 10, 'unpaid')] }),
    prop('3', { status: 'vacant', vacant_since: '2026-08-01', rent_payments: [month('3', 9, 'unpaid')] }),
    prop('4', { managed_by_agent_id: RMS.id }),                  // someone else's
    prop('5', { status: 'sold' }),                               // not reported
    prop('6', { status: 'short_term_let', name: 'Room 1, Piers View', rent_payments: [month('6', 10, 'paid', 120)] }),
    prop('7', { status: 'short_term_let', name: 'Room 2, Piers View', rent_payments: [month('7', 10, 'paid', 80)] }),
  ]
  const r = buildAgentReport(props, { agent: AGENT, asOf })

  it('scopes to the agent and counts units', () => {
    expect(r.summary.units).toBe(5)
    expect(r.summary.letUnits).toBe(4)
    expect(r.lines.map(l => l.name)).not.toContain('Flat 4')
    expect(r.lines.map(l => l.name)).not.toContain('Flat 5')
  })

  it('folds short-term-let rooms into one line per building', () => {
    const stl = r.lines.find(l => l.status === 'short_term_let')
    expect(stl.name).toBe('Piers View (2 rooms)')
    expect(stl.thisMonth.received).toBe(200)
    expect(stl.grid['2026-10'].received).toBe(200)
  })

  it('reports missed rent as owed but not rent that is still in its window', () => {
    expect(r.owing.map(l => l.name)).toEqual(['Flat 2'])
    expect(r.summary.owed).toBe(500)
    const f1 = r.lines.find(l => l.name === 'Flat 1')
    expect(f1.thisMonth.state).toBe('due')
    expect(f1.lastMonth.state).toBe('paid')
  })

  it('lists properties that are not let', () => {
    expect(r.notLet.map(l => l.name)).toEqual(['Flat 3'])
    expect(r.notLet[0].vacantSince).toBe('2026-08-01')
  })

  it('builds a tracker grid from go-live to this month', () => {
    expect(r.months[0]).toMatchObject({ year: 2026, month: 1 })
    expect(r.months.at(-1)).toMatchObject({ year: 2026, month: 10 })
    expect(r.lines.find(l => l.name === 'Flat 2').grid['2026-9'].state).toBe('missed')
  })

  it('never carries tenant names', () => {
    const withTenant = buildAgentReport([prop('9', { tenant_name: 'Jane Tenant' })], { agent: AGENT, asOf })
    expect(JSON.stringify(withTenant)).not.toContain('Jane Tenant')
  })
})

describe('agent-weekly-report edge function bundle', () => {
  it('is up to date with src/lib (run node scripts/build-agent-report.mjs)', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await bundleAgentReport())
  })
})
