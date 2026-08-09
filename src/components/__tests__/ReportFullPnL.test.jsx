import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import ReportsPage from '../ReportsPage'

// ReportsPage fetches its datasets through the api layer on mount — feed it
// deterministic fixtures so the Full Portfolio P&L renders real rows.
// Dates sit inside the 2026/27 tax year (the default period when "today"
// is between Apr 2026 and Apr 2027); year/month columns are what the
// month bucketing reads.
vi.mock('../../lib/api', () => ({
  fetchAllComplianceItems: vi.fn().mockResolvedValue([]),
  fetchAllMaintenanceJobs: vi.fn().mockResolvedValue([]),
  fetchAllTenancies: vi.fn().mockResolvedValue([]),
  fetchAllRentPayments: vi.fn().mockResolvedValue([
    { id: 'r1', property_id: 'p1', status: 'paid', amount: 1000, year: 2026, month: 5, property: { company_id: 'cA' } },
    { id: 'r2', property_id: 'p2', status: 'paid', amount: 2000, year: 2026, month: 5, property: { company_id: 'cB' } },
  ]),
  fetchAllExpenses: vi.fn().mockResolvedValue([
    { id: 'e1', property_id: 'p1', category: 'repairs', amount: 200, date: '2026-06-10', property: { company_id: 'cA' } },
  ]),
  fetchAllShareholders: vi.fn().mockResolvedValue([
    // Viewer (u1) holds 50% of Alpha; someone else owns Beta outright.
    { id: 's1', company_id: 'cA', name: 'Justin', user_id: 'u1', percentage: 50, tax_band: 'higher' },
    { id: 's2', company_id: 'cA', name: 'Partner', percentage: 50 },
    { id: 's3', company_id: 'cB', name: 'Someone Else', percentage: 100 },
  ]),
  fetchEstateAgents: vi.fn().mockResolvedValue([]),
}))

const properties = [
  { id: 'p1', name: 'Flat 1', company_id: 'cA', status: 'rented', rent_pcm: 1000, company: { name: 'Alpha Ltd' } },
  { id: 'p2', name: 'House 2', company_id: 'cB', status: 'rented', rent_pcm: 2000, company: { name: 'Beta Ltd' } },
]
const companies = [
  { id: 'cA', name: 'Alpha Ltd' },
  { id: 'cB', name: 'Beta Ltd' },
]

function renderReport() {
  return render(
    <ThemeProvider>
      <ReportsPage
        properties={properties}
        companies={companies}
        companySettings={{}}
        user={{ id: 'u1', email: 'justin@example.com' }}
        selectedReportId="full_pnl"
        onSelectReport={() => {}}
      />
    </ThemeProvider>
  )
}

describe('Full Portfolio P&L report', () => {
  it('renders company blocks with property rows, totals, and tax columns', async () => {
    renderReport()
    // Company blocks appear once data loads ("Alpha Ltd" also exists as a
    // dropdown option, hence findAll).
    expect(await screen.findByText('Alpha Ltd — total')).toBeInTheDocument()
    expect(screen.getByText('Beta Ltd — total')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha Ltd').length).toBeGreaterThan(1)
    expect(screen.getByText('Flat 1')).toBeInTheDocument()
    expect(screen.getByText('House 2')).toBeInTheDocument()
    // Summary column set.
    expect(screen.getAllByText('Pre-tax profit').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Post-tax').length).toBeGreaterThan(0)
    expect(screen.getByText('Per month')).toBeInTheDocument()
    // Flat 1: £1,000 paid − £200 expenses = £800 pre-tax (row + company total).
    expect(screen.getAllByText('£800').length).toBeGreaterThan(0)
  })

  it('switches to month-by-month columns via the toggle', async () => {
    renderReport()
    await screen.findByText('Alpha Ltd — total')
    fireEvent.click(screen.getByText('Month by month'))
    // Tax-year grid runs Apr → Mar.
    expect(await screen.findByText('Apr')).toBeInTheDocument()
    expect(screen.getByText('Mar')).toBeInTheDocument()
    // Monthly cells: May 2026 collected £1,000 on Flat 1, June −£200.
    expect(screen.getAllByText('£1,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-£200').length).toBeGreaterThan(0)
    // Right-hand totals columns.
    expect(screen.getByText('Pre-tax')).toBeInTheDocument()
    // Back to summary.
    fireEvent.click(screen.getByText('Summary'))
    expect((await screen.findAllByText('Tax (est.)')).length).toBeGreaterThan(0)
  })

  it('forecasts to year end via the toggle, starring forecast months in the grid', async () => {
    renderReport()
    await screen.findByText('Alpha Ltd — total')
    fireEvent.click(screen.getByText('Forecast to year end'))
    // Forecast-specific stat card + methodology note appear.
    expect(await screen.findByText('Post-tax position at year end')).toBeInTheDocument()
    expect(screen.getByText(/Forecast mode:/)).toBeInTheDocument()
    // The month grid stars the current-and-later (forecast) columns. The
    // default period always contains today, so at least one column is
    // forecast whenever this runs.
    fireEvent.click(screen.getByText('Month by month'))
    const starred = await screen.findAllByText(/^[A-Z][a-z]{2}\*$/)
    expect(starred.length).toBeGreaterThan(0)
    expect(screen.getByText(/Columns marked/)).toBeInTheDocument()
    // Toggling back to actuals removes the forecast card.
    fireEvent.click(screen.getByText('Actuals'))
    expect(screen.queryByText('Post-tax position at year end')).not.toBeInTheDocument()
  })

  it('scales to the viewer\'s shareholding via the My share toggle', async () => {
    renderReport()
    await screen.findByText('Alpha Ltd — total')
    fireEvent.click(screen.getByText('My share'))
    // Viewer holds 50% of Alpha: Flat 1's £800 pre-tax halves to £400.
    expect(await screen.findByText('· your 50%')).toBeInTheDocument()
    expect(screen.getAllByText('£400').length).toBeGreaterThan(0)
    // No holding in Beta → the whole block is hidden, with a note.
    expect(screen.queryByText('Beta Ltd — total')).not.toBeInTheDocument()
    expect(screen.getByText(/1 company where you hold no shares is hidden/)).toBeInTheDocument()
    // Stat cards switch to "your" labels.
    expect(screen.getByText('Your income')).toBeInTheDocument()
    // Back to whole portfolio.
    fireEvent.click(screen.getByText('Whole portfolio'))
    expect(await screen.findByText('Beta Ltd — total')).toBeInTheDocument()
  })

  it('strips costs via the Include chips and applies dividend tax in My share mode', async () => {
    renderReport()
    await screen.findByText('Alpha Ltd — total')
    // Dividend tax chip is disabled outside My share mode.
    expect(screen.getByText('Dividend tax')).toBeDisabled()
    // Untick corporation tax → exclusion note appears.
    fireEvent.click(screen.getByText('✓ Corporation tax'))
    expect(await screen.findByText(/Excluded from this view: corporation tax/)).toBeInTheDocument()
    // Untick management fees too — both listed.
    fireEvent.click(screen.getByText('✓ Management fees'))
    expect(await screen.findByText(/Excluded from this view: management fees, corporation tax/)).toBeInTheDocument()
    // Re-tick CT, switch to My share, tick dividend tax (band = higher on
    // the viewer's Alpha entry) → dividend note + combined tax label.
    fireEvent.click(screen.getByText('Corporation tax'))
    fireEvent.click(screen.getByText('My share'))
    const divChip = screen.getByText('Dividend tax')
    expect(divChip).not.toBeDisabled()
    fireEvent.click(divChip)
    expect(await screen.findByText(/Dividend tax is estimated from the tax band/)).toBeInTheDocument()
    expect(screen.getByText('Your tax (CT + dividend, est.)')).toBeInTheDocument()
  })
})
