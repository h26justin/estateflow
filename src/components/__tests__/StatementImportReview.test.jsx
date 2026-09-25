import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import StatementImportReview from '../StatementImportReview'
import { readStatementText } from '../StatementImporter'

const commitStatementImport = vi.fn(async () => ({ receipts: 1, bridges: 0, periodsCreated: 0, periodsUpdated: 1, expenses: 1, skipped: 0, errors: [], batchId: 'b1', importId: 'i1' }))
const findPreviousStatementImports = vi.fn(async () => [])
vi.mock('../../lib/api', () => ({
  fetchStatementImportContext: vi.fn(async () => ({ knownRefs: new Set(), existingFees: [] })),
  findPreviousStatementImports: (...a) => findPreviousStatementImports(...a),
  commitStatementImport: (...a) => commitStatementImport(...a),
  uploadStatementPdf: vi.fn(async () => ({ id: 'doc1' })),
  saveStatementAlias: vi.fn(), markStatementImported: vi.fn(),
}))

const text = readFileSync(resolve(process.cwd(), 'src/lib/__tests__/fixtures/rms-statement-invoice-2026.txt'), 'utf8')
const companies = [{ id: 'vale', name: 'Vale Property Group' }]
const months = [8, 9].map(m => ({ id: `m${m}`, year: 2026, month: m, month_label: m === 8 ? 'Aug 2026' : 'Sep 2026', period_start: `2026-0${m}-01`, period_end: `2026-0${m}-${m === 8 ? 31 : 30}`, status: 'void', amount: null }))
const properties = [{ id: 'jub', name: '5 Jubilee Road', address: '', company_id: 'vale', status: 'rented', rent_pcm: 600, rent_due_day: '1st', tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], rent_payments: months }]

function renderReview(extra = {}) {
  const parsed = readStatementText(text)
  const onDone = vi.fn()
  render(<ThemeProvider><StatementImportReview parsed={parsed} file={new File(['x'], 's.pdf', { type: 'application/pdf' })} fileName="s.pdf" sourceDoc={null}
    properties={properties} companies={companies} aliases={[]} canWriteProperty={() => true} showToast={vi.fn()} onBack={vi.fn()} onDone={onDone} {...extra} /></ThemeProvider>)
  return { onDone }
}

beforeEach(() => { commitStatementImport.mockClear(); findPreviousStatementImports.mockReset(); findPreviousStatementImports.mockResolvedValue([]) })

describe('Import review', () => {
  it('shows the statement, matches the lines and approves into the Rent Tracker', async () => {
    const { onDone } = renderReview()
    expect(screen.getByText('Rook Matthews Sayer')).toBeTruthy()
    expect(screen.getByText('BYHS-RMS-P600298')).toBeTruthy()
    expect(screen.getAllByText('Ready to import').length).toBe(2)
    const approve = await screen.findByText('Approve import (2 lines)')
    await waitFor(() => expect(approve.disabled).toBe(false))
    fireEvent.click(approve)
    await waitFor(() => expect(commitStatementImport).toHaveBeenCalled())
    const arg = commitStatementImport.mock.calls[0][0]
    expect(arg.plan.receipts).toHaveLength(1)
    expect(arg.plan.receipts[0].receipt).toMatchObject({ amount: 600, property_id: 'jub', source: 'statement' })
    expect(arg.plan.periodUpdates[0]).toMatchObject({ rent_payment_id: 'm9', status: 'paid' })
    expect(arg.plan.expenses[0]).toMatchObject({ category: 'agent_fees', amount: 50.4 })
    expect(arg.companyDocumentId).toBe('doc1')
    expect(arg.auditLines).toHaveLength(2)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('warns when the same statement was imported before', async () => {
    findPreviousStatementImports.mockResolvedValue([{ id: 'old', created_at: '2026-09-03T10:00:00Z', filename: 'Statement.pdf', import_batch_id: 'b0' }])
    renderReview()
    expect((await screen.findByRole('alert')).textContent).toMatch(/already been imported/)
  })

  it('unticking a line leaves it out of the plan', async () => {
    renderReview()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[1])   // the fee line
    const approve = await screen.findByText('Approve import (1 line)')
    await waitFor(() => expect(approve.disabled).toBe(false))
    fireEvent.click(approve)
    await waitFor(() => expect(commitStatementImport).toHaveBeenCalled())
    expect(commitStatementImport.mock.calls[0][0].plan.expenses).toHaveLength(0)
  })
})
