import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import ArrearsNotesPanel from '../ArrearsNotesPanel'

const fetchArrearsNotes = vi.fn()
const addArrearsNote = vi.fn(async f => ({ id: 'new', ...f }))
vi.mock('../../lib/api', () => ({
  fetchArrearsNotes: (...a) => fetchArrearsNotes(...a),
  addArrearsNote: (...a) => addArrearsNote(...a),
}))

const month = (id, y, m) => {
  const mm = String(m).padStart(2, '0'), last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { id, year: y, month: m, month_label: `${m}/${y}`, period_start: `${y}-${mm}-01`, period_end: `${y}-${mm}-${last}`, status: 'void', amount: null }
}
const property = {
  id: 'p1', name: 'Flat 1', status: 'rented', rent_pcm: 500, company_id: 'c1',
  tenancies: [{ id: 't1', tenancy_start: '2026-01-01', rent_amount: 500, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant' }],
  rent_payments: [month('oct', 2026, 10)], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
}
const older = { id: 'n1', property_id: 'p1', period: '2026-09', reason: 'First reason', status: 'open', supersedes: null, created_at: '2026-09-30T10:00:00Z' }
const last = { id: 'n2', property_id: 'p1', tenancy_id: 't1', period: '2026-10', reason: 'Lost job', response: 'Paying £50 a week', owner: 'Tiffany', status: 'open', supersedes: 'n1', created_at: '2026-10-30T10:00:00Z' }
const wrap = ui => render(<ThemeProvider>{ui}</ThemeProvider>)

beforeEach(() => { fetchArrearsNotes.mockReset(); addArrearsNote.mockClear(); fetchArrearsNotes.mockResolvedValue([last, older]) })

describe('ArrearsNotesPanel', () => {
  it('shows the current note, outstanding periods, and keeps earlier versions behind a toggle', async () => {
    wrap(<ArrearsNotesPanel property={property} canEdit asOf="2026-11-19" />)
    expect(await screen.findByText('Lost job')).toBeTruthy()
    expect(screen.getByText(/Last written for Oct 2026/)).toBeTruthy()
    expect(screen.getAllByText('£500.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('First reason')).toBeNull()
    fireEvent.click(screen.getByText(/Show earlier versions \(1\)/))
    expect(screen.getByText('First reason')).toBeTruthy()
  })

  it('"Keep last month\'s explanation" inserts a new version for this month superseding the last', async () => {
    wrap(<ArrearsNotesPanel property={property} canEdit asOf="2026-11-19" />)
    fireEvent.click(await screen.findByText("Keep last month's explanation"))
    await waitFor(() => expect(addArrearsNote).toHaveBeenCalled())
    expect(addArrearsNote.mock.calls[0][0]).toMatchObject({ property_id: 'p1', tenancy_id: 't1', period: '2026-11', supersedes: 'n2', reason: 'Lost job', response: 'Paying £50 a week', owner: 'Tiffany', status: 'open' })
  })

  it('"Needs investigation" writes a version with that status', async () => {
    wrap(<ArrearsNotesPanel property={property} canEdit asOf="2026-11-19" />)
    fireEvent.click(await screen.findByText('Needs investigation'))
    await waitFor(() => expect(addArrearsNote).toHaveBeenCalled())
    expect(addArrearsNote.mock.calls[0][0]).toMatchObject({ status: 'needs_investigation', supersedes: 'n2', period: '2026-11' })
  })

  it('"Replace with new reason" starts from blank fields and needs a reason', async () => {
    const showToast = vi.fn()
    wrap(<ArrearsNotesPanel property={property} canEdit asOf="2026-11-19" showToast={showToast} />)
    fireEvent.click(await screen.findByText('Replace with new reason'))
    expect(screen.getByLabelText('Reason').value).toBe('')
    fireEvent.click(screen.getByText('Save new version'))
    expect(addArrearsNote).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Benefit delayed' } })
    fireEvent.click(screen.getByText('Save new version'))
    await waitFor(() => expect(addArrearsNote).toHaveBeenCalled())
    expect(addArrearsNote.mock.calls[0][0]).toMatchObject({ reason: 'Benefit delayed', response: '', supersedes: 'n2', owner: 'Tiffany' })
  })

  it('says Awaiting review with no note, and offers no actions without rent edit rights', async () => {
    fetchArrearsNotes.mockResolvedValue([])
    wrap(<ArrearsNotesPanel property={property} canEdit={false} asOf="2026-11-19" />)
    expect(await screen.findByText(/No explanation written yet/)).toBeTruthy()
    expect(screen.queryByText('Add explanation')).toBeNull()
    expect(screen.queryByText('Needs investigation')).toBeNull()
  })
})
