import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import ReportsPage from '../ReportsPage'

// The ownership register needs only the shareholder feed from the api
// layer — everything else is fed in as props.
vi.mock('../../lib/api', () => ({
  fetchAllComplianceItems: vi.fn().mockResolvedValue([]),
  fetchAllMaintenanceJobs: vi.fn().mockResolvedValue([]),
  fetchAllTenancies: vi.fn().mockResolvedValue([]),
  fetchAllRentPayments: vi.fn().mockResolvedValue([]),
  fetchAllExpenses: vi.fn().mockResolvedValue([]),
  fetchAllShareholders: vi.fn().mockResolvedValue([
    { id: 's1', company_id: 'cA', name: 'Justin', user_id: 'u1', percentage: 50 },
    { id: 's2', company_id: 'cA', name: 'Partner', percentage: 50 },
    // Beta is wholly owned by the holding company the viewer owns 60% of.
    { id: 's3', company_id: 'cB', name: 'Group Holdings Ltd', percentage: 100, shareholder_type: 'company', shareholder_company_id: 'cH' },
    { id: 's4', company_id: 'cH', name: 'Justin', user_id: 'u1', percentage: 60 },
  ]),
  fetchEstateAgents: vi.fn().mockResolvedValue([]),
  fetchAllEpcCertificates: vi.fn().mockResolvedValue([]),
}))

const properties = [
  { id: 'p1', name: 'Flat 1', address: '1 High St', company_id: 'cA', status: 'rented', current_value: 200000 },
  { id: 'p2', name: 'House 2', address: '2 Low Rd', company_id: 'cB', status: 'sold', est_value: 300000 },
  { id: 'p3', name: 'My Own Place', address: '3 Home Ln', company_id: null, status: 'rented', est_value: 400000 },
]
const companies = [
  { id: 'cA', name: 'Alpha Ltd' },
  { id: 'cB', name: 'Beta Ltd' },
  { id: 'cH', name: 'Group Holdings Ltd', company_type: 'holding' },
]

function renderReport() {
  return render(
    <ThemeProvider>
      <ReportsPage
        properties={properties}
        companies={companies}
        companySettings={{}}
        user={{ id: 'u1', email: 'justin@example.com' }}
        selectedReportId="ownership"
        onSelectReport={() => {}}
      />
    </ThemeProvider>
  )
}

describe('Property ownership report', () => {
  it('lists every property under the company that holds it', async () => {
    renderReport()
    expect(await screen.findByText('Alpha Ltd — 1 property')).toBeInTheDocument()
    expect(screen.getByText('Beta Ltd — 1 property')).toBeInTheDocument()
    expect(screen.getByText('Personally held (no company) — 1 property')).toBeInTheDocument()
    for (const name of ['Flat 1', 'House 2', 'My Own Place']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('1 High St')).toBeInTheDocument()
  })

  it('shows the effective share, looking through a holding company', async () => {
    renderReport()
    expect(await screen.findByText('Your share 50.00%')).toBeInTheDocument()
    expect(screen.getByText('Your share 60.00% (via Group Holdings Ltd)')).toBeInTheDocument()
    expect(screen.getByText('Held in your own name')).toBeInTheDocument()
  })

  it('flags a disposal rather than dropping it', async () => {
    renderReport()
    expect(await screen.findByText('Sold')).toBeInTheDocument()
  })

  it('lists a holding company separately, with what it holds', async () => {
    renderReport()
    expect(await screen.findByText('Companies holding no property directly')).toBeInTheDocument()
    expect(screen.getByText('Beta Ltd 100.00%')).toBeInTheDocument()
  })

  it('exports one flat CSV row per property, owner columns repeated', async () => {
    // Capture the Blob the download path builds instead of hitting jsdom's
    // missing URL/anchor plumbing.
    const blobs = []
    const origBlob = globalThis.Blob
    globalThis.Blob = class { constructor(parts) { blobs.push(String(parts.join(''))) } }
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderReport()
      fireEvent.click(await screen.findByText('↓ CSV'))
      const lines = blobs[0].split('\n')
      expect(lines[0]).toContain('"Your effective share %"')
      expect(lines).toHaveLength(4) // header + 3 properties
      expect(lines[2]).toContain('"House 2"')
      expect(lines[2]).toContain('"Beta Ltd"')
      expect(lines[2]).toContain('"60"')   // effective share via the holdco
      expect(lines[2]).toContain('"Yes"')  // sold
      expect(lines[3]).toContain('"Personally held (no company)"')
    } finally {
      globalThis.Blob = origBlob
      click.mockRestore()
    }
  })
})
