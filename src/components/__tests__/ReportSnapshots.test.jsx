import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ReportSnapshots from '../ReportSnapshots'
import { buildAgentReport } from '../../lib/agentReport'
import { snapshotFromAgentReport } from '../../lib/reportSnapshots'

const fetchReportSnapshots = vi.fn()
const addReportSnapshot = vi.fn(async f => ({ id: 'new', ...f }))
vi.mock('../../lib/api', () => ({
  fetchReportSnapshots: (...a) => fetchReportSnapshots(...a),
  addReportSnapshot: (...a) => addReportSnapshot(...a),
}))
vi.mock('../../lib/toast', () => ({ showAppToast: vi.fn() }))

const T = { text: '#111', muted: '#666', faint: '#999', card: '#fff', bg: '#fafafa', surface: '#fff', border: '#ddd', red: '#c00', green: '#080', amber: '#a60', gold: '#b90', goldText: '#850' }
const AGENT = { id: 'ag1', name: 'Propertunity' }
const prop = (id, over = {}) => ({
  id, name: `Flat ${id}`, company_id: 'c1', company: { name: 'ExH Property Group' }, status: 'rented', rent_pcm: 500, rent_due_day: 1,
  managed_by_agent_id: AGENT.id, tenant_name: 'Tenant Person', rent_payments: [], tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
  ...over,
})
const month = (id, m, status, amount = null) => ({ id: `${id}-${m}`, year: 2026, month: m, status, amount })
const asOf = '2026-10-31'
const model = buildAgentReport([prop('1', { rent_payments: [month('1', 9, 'unpaid'), month('1', 10, 'paid', 500)] })], { agent: AGENT, asOf })
const earlier = buildAgentReport([prop('1', { rent_payments: [month('1', 9, 'unpaid'), month('1', 10, 'unpaid')] })], { agent: AGENT, asOf: '2026-10-20' })
const user = { id: 'u1' }

beforeEach(() => { fetchReportSnapshots.mockReset(); addReportSnapshot.mockClear() })

describe('ReportSnapshots', () => {
  it('freezes the first snapshot for a period without a note', async () => {
    fetchReportSnapshots.mockResolvedValue([])
    render(<ReportSnapshots model={model} user={user} T={T}/>)
    expect(await screen.findByText('No snapshots yet for this agent.')).toBeTruthy()
    expect(fetchReportSnapshots).toHaveBeenCalledWith({ kind: 'agent_rent_report', agentId: 'ag1' })
    fireEvent.click(screen.getByText('Freeze month-end snapshot'))
    fireEvent.click(screen.getByText('Freeze snapshot'))
    await waitFor(() => expect(addReportSnapshot).toHaveBeenCalled())
    const sent = addReportSnapshot.mock.calls[0][0]
    expect(sent).toMatchObject({ kind: 'agent_rent_report', agent_id: 'ag1', company_id: 'c1', as_of: asOf, period: '2026-10', supersedes: null, note: null })
    expect('created_by' in sent).toBe(false)
    expect(JSON.stringify(sent)).not.toMatch(/Tenant Person/)
  })

  it('a second snapshot for the same agent and period is a restatement that needs a note', async () => {
    const first = { id: 's1', ...snapshotFromAgentReport(earlier, { companyId: 'c1', period: '2026-10' }), created_by: 'u1', created_at: '2026-10-31T18:00:00Z' }
    fetchReportSnapshots.mockResolvedValue([first])
    render(<ReportSnapshots model={model} user={user} T={T}/>)
    expect(await screen.findByText('Current')).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
    fireEvent.click(screen.getByText('Freeze month-end snapshot'))
    expect(screen.getByText(/This will be a restatement/)).toBeTruthy()
    const save = screen.getByText('Save restatement').closest('button')
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Why is this being restated/), { target: { value: 'October receipt posted late' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(addReportSnapshot).toHaveBeenCalled())
    expect(addReportSnapshot.mock.calls[0][0]).toMatchObject({ supersedes: 's1', note: 'October receipt posted late', period: '2026-10' })
  })

  it('marks superseded snapshots and compares a snapshot with the current report', async () => {
    const s1 = { id: 's1', ...snapshotFromAgentReport(earlier, { companyId: 'c1', period: '2026-10' }), created_by: 'u2', created_at: '2026-10-21T09:00:00Z' }
    const s2 = { ...s1, id: 's2', supersedes: 's1', note: 'Corrected', created_at: '2026-10-22T09:00:00Z' }
    fetchReportSnapshots.mockResolvedValue([s2, s1])
    render(<ReportSnapshots model={model} user={user} T={T}/>)
    expect(await screen.findByText('Superseded')).toBeTruthy()
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getAllByText('Another member')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Compare with current')[0])
    const region = screen.getByRole('region', { name: /Comparison with the current report/ })
    expect(within(region).getByText('Owed (missed months)')).toBeTruthy()
    expect(within(region).getByText('Flat 1')).toBeTruthy()
    // £500 less owed now that October is paid.
    expect(within(region).getAllByText(/−£500\.00/).length).toBeGreaterThan(0)
  })
})
