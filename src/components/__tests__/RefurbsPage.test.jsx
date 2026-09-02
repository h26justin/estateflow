import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import RefurbsPage, { RefurbPropertyTab } from '../RefurbsPage'

// Writes go through lib/api; the page never reads from it (projects arrive
// embedded on properties), so a thin mock is enough to exercise the UI.
vi.mock('../../lib/api', () => ({
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

beforeEach(() => { window.location.hash = '#/refurbs' })

describe('RefurbsPage', () => {
  it('shows the programme numbers for active refurbs only', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Refurbs' })).toBeInTheDocument()
    // Header line: 1 active, 1 over budget (extras), £10,800 remaining (31,800 - 21,000)
    expect(screen.getByText(/1 active · 1 over budget · £10,800 remaining to pay/)).toBeInTheDocument()
    expect(screen.getByText('Flat 3 Douro Terrace')).toBeInTheDocument()
    // Completed refurbs are hidden until asked for
    expect(screen.queryByText('6 Garfield Street')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Show completed/))
    expect(screen.getByText('6 Garfield Street')).toBeInTheDocument()
  })

  it('opens a refurb and shows agreed price, extras, payments and milestones', async () => {
    renderPage()
    fireEvent.click(screen.getByText('Open →'))
    expect(await screen.findByText('Original quote')).toBeInTheDocument()
    expect(screen.getByText('Rewire')).toBeInTheDocument()
    expect(screen.getByText('Deposit')).toBeInTheDocument()
    expect(screen.getByText('Total agreed')).toBeInTheDocument()
    expect(await screen.findByText('Keys received')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/refurbs/project/r1')
  })

  it('logs a payment through the quick-add and patches the property', async () => {
    const onPropertyPatch = vi.fn()
    const api = await import('../../lib/api')
    renderPage({ onPropertyPatch })
    fireEvent.click(screen.getByText('Open →'))
    await screen.findByText('Original quote')
    // The payment quick-add is the block titled "Log a payment"
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
    // Extras are hidden from the money view by default
    expect(screen.queryByText('Rewire')).not.toBeInTheDocument()
    expect(screen.getByText('Stage payments')).toBeInTheDocument()
  })

  it('hides write controls for a read-only collaborator', () => {
    renderPage({ permissionsMap: { c1: { view_financial: true }, c2: { view_financial: true } } })
    expect(screen.queryByText('+ Payment')).not.toBeInTheDocument()
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
