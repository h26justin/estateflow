// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildAgentReport, managedByAgent, dueDayLabel } from '../agentReport'
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

  it('groups by company with the company logo, and buildings within a company', () => {
    const withCo = buildAgentReport(props, { agent: AGENT, asOf, companies: [{ id: 'c1', name: 'ExH Property Group', color: '#3b4a3f', logo_url: 'https://x/logo.png' }] })
    expect(withCo.byCompany).toHaveLength(1)
    const g = withCo.byCompany[0]
    expect(g).toMatchObject({ company: 'ExH Property Group', color: '#3b4a3f', logoUrl: 'https://x/logo.png' })
    const piers = g.groups.find(gr => gr.building)
    expect(piers.name).toBe('Piers View')
    expect(piers.cards).toHaveLength(2)
    // Short-term lets stay out of the company's received total, as on the tracker.
    expect(g.received).toBe(1500)
  })

  it('reports missed rent as owed but not rent that is still in its window', () => {
    expect(r.owing.map(l => l.name)).toEqual(['Flat 2'])
    expect(r.summary.owed).toBe(500)
    const f1 = r.lines.find(l => l.name === 'Flat 1')
    expect(f1.thisMonth.state).toBe('due')
  })

  it('lists properties that are not let', () => {
    expect(r.notLet.map(l => l.name)).toEqual(['Flat 3'])
    expect(r.notLet[0].vacantSince).toBe('2026-08-01')
  })

  it('lays out Jan to Dec of this year with the tracker counts', () => {
    const f2 = r.lines.find(l => l.name === 'Flat 2')
    expect(f2.months.map(m => m.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    expect(f2.months[8]).toMatchObject({ state: 'missed' })
    expect(f2.months[9]).toMatchObject({ current: true, state: 'due' })
    expect(f2.months[10].future).toBe(true)
    expect(f2.counts).toMatchObject({ paid: 1, due: 1, missed: 1 })
    expect(f2.received).toBe(500)
    expect(f2.letLabel).toBe('Rented')
  })

  it('shows the last 4 months as due against collected, shortfall only once the window has closed', () => {
    const f2 = r.lines.find(l => l.name === 'Flat 2')
    expect(f2.recent.map(m => m.label)).toEqual(['Jul', 'Aug', 'Sep', 'Oct'])
    expect(f2.recent[1]).toMatchObject({ due: 500, collected: 500, shortfall: 0 })
    expect(f2.recent[2]).toMatchObject({ due: 500, collected: 0, shortfall: 500, stillDue: 0 })
    expect(f2.recent[3]).toMatchObject({ due: 500, collected: 0, shortfall: 0, stillDue: 500 })
    const g = r.byCompany[0]
    expect(g.recent[2].shortfall).toBe(500)
    expect(g.recent[3].stillDue).toBe(1000)
  })

  it('formats the due day like the tracker', () => {
    expect(dueDayLabel('28')).toBe('28th')
    expect(dueDayLabel(2)).toBe('2nd')
    expect(dueDayLabel(11)).toBe('11th')
    expect(dueDayLabel('1st')).toBe('1st')
    expect(dueDayLabel(null)).toBe(null)
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
