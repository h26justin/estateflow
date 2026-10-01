import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import RefurbsPage, { RefurbPropertyTab } from '../RefurbsPage'

// Projects arrive embedded on properties; the workspace (stages, tasks,
// history, files) loads per project through lib/api, mocked here.
const wsStages = [
  { id: 's1', project_id: 'r1', name: 'Strip Out', sort_order: 1, status: 'complete', weight: 1, planned_start: '2026-08-18', planned_end: '2026-08-25' },
  { id: 's2', project_id: 'r1', name: 'First Fix', sort_order: 2, status: 'in_progress', weight: 1, progress_pct: 50, planned_start: '2026-08-26', planned_end: '2026-09-10' },
  { id: 's3', project_id: 'r1', name: 'Plastering', sort_order: 3, status: 'not_started', weight: 1, planned_start: '2026-09-11', planned_end: '2026-09-20' },
]
vi.mock('../../lib/api', () => ({
  fetchRefurbInvoices: vi.fn(async () => []),
  fetchRefurbMilestones: vi.fn(async () => [
    { id: 'm1', milestone_key: 'keys_received', label: 'Keys received', sort_order: 1, is_enabled: true, completed: true, completed_date: '2026-08-18' },
    { id: 'm2', milestone_key: 'strip_out', label: 'Strip out', sort_order: 2, is_enabled: true, completed: false },
  ]),
  initialiseRefurbMilestones: vi.fn(async () => {}),
  updateRefurbMilestone: vi.fn(async (id, fields) => ({ id, ...fields })),
  createRefurbProject: vi.fn(async fields => ({ id: 'new', refurb_lines: [], stage: 'planned', ...fields })),
  updateRefurbProject: vi.fn(async (id, fields) => ({ id, ...fields })),
  deleteRefurbProject: vi.fn(async () => {}),
  createRefurbLine: vi.fn(async (projectId, line) => ({ id: 'l-new', project_id: projectId, ...line })),
  updateRefurbLine: vi.fn(async (id, fields) => ({ id, ...fields })),
  deleteRefurbLine: vi.fn(async () => {}),
  fetchRefurbPortfolio: vi.fn(async () => ({ stages: wsStages, tasks: [{ id: 't1', project_id: 'r1', kind: 'task', title: 'Order boiler', status: 'open', due_date: '2026-01-01' }], covers: [] })),
  signRefurbPaths: vi.fn(async () => new Map()),
  fetchRefurbTemplates: vi.fn(async () => []),
  fetchRefurbWorkspace: vi.fn(async () => ({ stages: wsStages, deps: [], tasks: [], updates: [], events: [], files: [] })),
  currentRefurbActor: vi.fn(async () => ({ id: 'u', name: 'Test User' })),
  fetchContractors: vi.fn(async () => [{ id: 'k1', name: 'GLB Builders', company_id: 'c1' }]),
  logRefurbEvents: vi.fn(async (projectId, evs) => (Array.isArray(evs) ? evs : [evs]).map((e, i) => ({ id: 'e' + i + Math.random(), project_id: projectId, created_at: new Date().toISOString(), ...e }))),
  applyRefurbTemplate: vi.fn(async (projectId, tpl) => tpl.stages.map((s, i) => ({ id: 'n' + i, project_id: projectId, name: s.name, sort_order: i + 1, status: 'not_started', weight: 1 }))),
  createRefurbStage: vi.fn(async (projectId, f) => ({ id: 'ns', project_id: projectId, status: 'not_started', weight: 1, ...f })),
  updateRefurbStage: vi.fn(async (id, f) => ({ ...wsStages.find(s => s.id === id), ...f })),
  updateRefurbStages: vi.fn(async ups => ups.map(u => ({ ...wsStages.find(s => s.id === u.id), ...u.fields }))),
}))

const companies = [
  { id: 'c1', name: 'ExH Property Group', abbr: 'EXH', color: '#2ECC8A' },
  { id: 'c2', name: 'WXH', abbr: 'WXH', color: '#4B8FE0' },
]
const properties = [
  { id: 'p1', name: 'Flat 3 Douro Terrace', address: 'Flat 3, 4 Douro Terrace', company_id: 'c1', company: companies[0], status: 'refurb', refurb_projects: [
    { id: 'r1', property_id: 'p1', stage: 'in_progress', agreed_price: 30000, contractor_name: 'GLB Builders', target_end_date: '2099-10-14',
      refurb_lines: [
        { id: 'l1', kind: 'payment', amount: 7000, date: '2026-08-18', payee: 'GLB Builders', description: 'Deposit' },
        { id: 'l2', kind: 'payment', amount: 14000, date: '2026-09-01', payee: 'GLB Builders', description: 'Stage payments' },
        { id: 'l3', kind: 'extra', amount: 1800, date: '2026-08-27', payee: 'GLB Builders', description: 'Rewire' },
      ] },
  ] },
  { id: 'p2', name: '6 Garfield Street', address: '6 Garfield Street', company_id: 'c2', company: companies[1], status: 'rented', refurb_projects: [
    { id: 'r2', property_id: 'p2', stage: 'complete', agreed_price: 31500, completed_date: '2026-08-12',
      refurb_lines: [{ id: 'l4', kind: 'payment', amount: 31500, date: '2026-08-12', payee: 'GLB Builders' }] },
  ] },
]
const permissionsMap = { __owner: { c1: true, c2: true } }

function renderPage(extra = {}) {
  const props = { user: { id: 'u' }, companies, properties, permissionsMap, showToast: vi.fn(), onPropertyPatch: vi.fn(), ...extra }
  return render(<ThemeProvider><RefurbsPage {...props} /></ThemeProvider>)
}

beforeEach(() => { window.location.hash = '#/refurbs'; sessionStorage.clear() })

describe('RefurbsPage', () => {
  it('shows active refurbs as cards with journey progress, completed ones on request', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Refurbs' })).toBeInTheDocument()
    // Header line: 1 active, 1 over budget (extras), £10,800 remaining (31,800 - 21,000)
    expect(screen.getByText(/1 active · 1 over budget · £10,800 remaining to pay/)).toBeInTheDocument()
    expect(screen.getByText('Flat 3 Douro Terrace')).toBeInTheDocument()
    // Current stage + works progress come from the journey: (1 + 0.5 + 0) / 3 = 50%
    expect(await screen.findByText('First Fix')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('1 overdue')).toBeInTheDocument()
    expect(screen.queryByText('6 Garfield Street')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })
    expect(screen.getByText('6 Garfield Street')).toBeInTheDocument()
  })

  it('splits Residential and Commercial projects', () => {
    renderPage()
    expect(screen.getByText('Flat 3 Douro Terrace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Commercial' }))
    expect(screen.queryByText('Flat 3 Douro Terrace')).not.toBeInTheDocument()
    expect(screen.getByText(/No commercial refurbs on the go/)).toBeInTheDocument()
  })

  it('opens the workspace on a card and keeps the section in the URL', async () => {
    renderPage()
    fireEvent.click(screen.getByText('Flat 3 Douro Terrace'))
    expect(await screen.findByRole('tab', { name: 'Journey & Timeline' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/refurbs/project/r1/overview')
    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Costs' }))
    expect(window.location.hash).toBe('#/refurbs/project/r1/costs')
    expect(await screen.findByText('Original quote')).toBeInTheDocument()
    expect(screen.getByText('Rewire')).toBeInTheDocument()
    expect(screen.getByText('Deposit')).toBeInTheDocument()
    expect(screen.getByText('Revised approved budget')).toBeInTheDocument()
  })

  it('restores the project and section from the URL', async () => {
    window.location.hash = '#/refurbs/project/r1/journey'
    renderPage()
    expect(await screen.findByText('Stages')).toBeInTheDocument()
    expect(screen.getByText(/How works progress is worked out/)).toBeInTheDocument()
    // Legacy checklist with a ticked item is still visible
    expect(await screen.findByText('Earlier checklist')).toBeInTheDocument()
  })

  it('logs a payment through the quick-add on Costs and patches the property', async () => {
    const onPropertyPatch = vi.fn()
    const api = await import('../../lib/api')
    window.location.hash = '#/refurbs/project/r1/costs'
    renderPage({ onPropertyPatch })
    await screen.findByText('Original quote')
    const block = screen.getByText('Log a payment').parentElement
    const inputs = block.querySelectorAll('input')
    fireEvent.change(inputs[0], { target: { value: '5000' } })
    fireEvent.click(block.querySelector('button'))
    await waitFor(() => expect(api.createRefurbLine).toHaveBeenCalled())
    expect(api.createRefurbLine.mock.calls[0][0]).toBe('r1')
    expect(api.createRefurbLine.mock.calls[0][1]).toMatchObject({ kind: 'payment', amount: 5000 })
    await waitFor(() => expect(onPropertyPatch).toHaveBeenCalled())
    const [pid, patch] = onPropertyPatch.mock.calls[0]
    expect(pid).toBe('p1')
    // Mirror: refurb_cost tracks paid (21,000 + 5,000), not agreed
    expect(patch.refurb_cost).toBe(26000)
    expect(patch.refurb_projects[0].refurb_lines).toHaveLength(4)
  })

  it('renders the board and payments views', () => {
    renderPage()
    fireEvent.click(screen.getByText('Board'))
    expect(screen.getAllByText('Nothing here')).toHaveLength(3) // planned, snagging, on hold are empty
    fireEvent.click(screen.getByText('Payments'))
    expect(screen.getByText('Export CSV')).toBeInTheDocument()
    expect(screen.queryByText('Rewire')).not.toBeInTheDocument()
    expect(screen.getByText('Stage payments')).toBeInTheDocument()
  })

  it('hides write controls for a read-only collaborator', () => {
    renderPage({ permissionsMap: { c1: { view_financial: true }, c2: { view_financial: true } } })
    fireEvent.click(screen.getByText('List'))
    expect(screen.queryByText('+ Payment')).not.toBeInTheDocument()
  })

  it('creates a refurb with the residential journey', async () => {
    const api = await import('../../lib/api')
    renderPage()
    fireEvent.click(screen.getAllByText('+ New Refurb')[0])
    const form = screen.getByText('Create refurb').closest('div').parentElement
    fireEvent.change(form.querySelector('select'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByText('Create refurb'))
    await waitFor(() => expect(api.applyRefurbTemplate).toHaveBeenCalled())
    expect(api.createRefurbProject.mock.calls.at(-1)[0]).toMatchObject({ property_id: 'p2', project_type: 'residential', stage: 'planned' })
    expect(api.createRefurbProject.mock.calls.at(-1)[1]).toEqual({ seedMilestones: false })
    const tpl = api.applyRefurbTemplate.mock.calls.at(-1)[1]
    expect(tpl.stages.map(s => s.name)[0]).toBe('Scope & Survey')
    expect(tpl.stages).toHaveLength(12)
  })

  it('moving a stage finish asks before moving the stages that wait for it', async () => {
    const api = await import('../../lib/api')
    api.fetchRefurbWorkspace.mockResolvedValueOnce({
      stages: wsStages.map(x => ({ ...x })),
      deps: [{ id: 'd1', project_id: 'r1', stage_id: 's3', depends_on_id: 's2', lag_days: 0 }],
      tasks: [], updates: [], events: [], files: [],
    })
    window.location.hash = '#/refurbs/project/r1/journey/s2'
    renderPage()
    const finish = await screen.findByLabelText('Forecast finish')
    fireEvent.change(finish, { target: { value: '2026-09-20' } })
    fireEvent.blur(finish)
    await waitFor(() => expect(api.updateRefurbStage).toHaveBeenCalledWith('s2', { forecast_end: '2026-09-20' }))
    // Plastering (11-20 Sep) must now start 21 Sep: 9-day duration kept
    expect(await screen.findByText('This change affects later work')).toBeInTheDocument()
    expect(screen.getByText(/21 Sept? – 30 Sept?/)).toBeInTheDocument()
    // 30 Sep 2026 is before the 2099 forecast completion, so no reason is asked for
    fireEvent.click(screen.getByText('Apply revised dates'))
    await waitFor(() => expect(api.updateRefurbStages).toHaveBeenCalledWith([{ id: 's3', fields: { forecast_start: '2026-09-21', forecast_end: '2026-09-30' } }]))
    const logged = api.logRefurbEvents.mock.calls.flatMap(c => c[1])
    expect(logged.some(e => e.action === 'dates_cascaded' && e.new_value === '2026-09-30')).toBe(true)
    expect(logged.some(e => e.field === 'forecast_end' && e.new_value === '2026-09-20' && e.stage_id === 's2')).toBe(true)
  })
})

describe('RefurbPropertyTab', () => {
  it('shows the property refurb inline with a link to the page', async () => {
    const openRefurbs = vi.fn()
    render(<ThemeProvider>
      <RefurbPropertyTab property={properties[0]} companies={companies} properties={properties} permissionsMap={permissionsMap} showToast={vi.fn()} onPropertyPatch={vi.fn()} openRefurbs={openRefurbs} />
    </ThemeProvider>)
    expect(await screen.findByText('Original quote')).toBeInTheDocument()
    fireEvent.click(screen.getByText('All refurbs →'))
    expect(openRefurbs).toHaveBeenCalled()
  })

  it('offers to start a refurb when the property has none', () => {
    render(<ThemeProvider>
      <RefurbPropertyTab property={{ id: 'p9', name: 'Empty', company_id: 'c1', refurb_cost: 4000, refurb_projects: [] }} companies={companies} properties={[]} permissionsMap={permissionsMap} showToast={vi.fn()} onPropertyPatch={vi.fn()} />
    </ThemeProvider>)
    expect(screen.getByText('No refurb on this property')).toBeInTheDocument()
    expect(screen.getByText(/£4,000 of historic refurb spend/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('+ New refurb'))
    expect(screen.getByText('Create refurb')).toBeInTheDocument()
  })
})
