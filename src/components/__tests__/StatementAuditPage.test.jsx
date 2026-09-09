import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import StatementAuditPage from '../StatementAuditPage'

// The page reads and writes only the statement_audit_* API; a thin mock of
// that surface is enough to exercise the register, the missing-number list,
// the review fields and the per-statement balance check.
const updateAuditStatement = vi.fn(async (id, patch) => ({ ...STATEMENTS.find(s => s.id === id), ...patch }))
vi.mock('../../lib/api', () => ({
  fetchAuditSeries: vi.fn(async () => [{ id: 'ser1', series_key: 'exh-property-group', landlord_company: 'EXH Property Group Limited', agent: 'PNE', start_number: 71 }]),
  fetchAuditStatements: vi.fn(async () => STATEMENTS),
  fetchAuditLinesForSeries: vi.fn(async () => LINES),
  updateAuditStatement: (...a) => updateAuditStatement(...a),
  updateAuditSeries: vi.fn(async () => ({})),
  ensureAuditPlaceholders: vi.fn(async () => 0),
  upsertAuditSeries: vi.fn(async () => ({})),
  saveAuditImport: vi.fn(), finaliseAuditImport: vi.fn(), insertAuditLine: vi.fn(), updateAuditLine: vi.fn(), deleteAuditLine: vi.fn(), resolveAuditImportError: vi.fn(),
}))

const STATEMENTS = [
  { id: 's71', series_key: 'exh-property-group', statement_number: 71, statement_date: '2026-01-05', status: 'imported_awaiting_review', statement_checked: false,
    landlord_company: 'EXH Property Group Limited', agent: 'PNE', previous_balance: 0, new_balance: 5823, payment_amount: 5823,
    stated_income_total: 6470, stated_expenditure_total: 647, invoice_number: 'INV3494', invoice_fees: 647, import_errors: [] },
  { id: 's72', series_key: 'exh-property-group', statement_number: 72, status: 'not_uploaded', import_errors: [] },
  { id: 's73', series_key: 'exh-property-group', statement_number: 73, statement_date: '2026-01-19', status: 'discrepancy_found', statement_checked: true, checked_by: 'JH', checked_at: '2026-09-09',
    previous_balance: 0, new_balance: 1000, payment_amount: 1000, import_errors: [{ property_address: '5, Thomas Street', tenant_name: '', amount: null, reason: 'No amount cell found for this entry' }] },
]
const LINES = [
  { id: 'l1', statement_id: 's71', statement_number: 71, statement_date: '2026-01-05', line_no: 1, section: 'income', line_type: 'rent', property_address: '29, Briardene', tenant_name: 'Tenant A1', period_start: '2025-12-29', period_end: '2026-01-28', gross_rent: 6470, fee_amount: 0, vat_amount: 0, deduction_amount: 0, credit_amount: 0, net_amount: 6470, review_status: 'imported', flags: [] },
  { id: 'l2', statement_id: 's71', statement_number: 71, statement_date: '2026-01-05', line_no: 2, section: 'expenditure', line_type: 'management_fee', property_address: '29, Briardene', fee_pct: 10, fee_basis: 6470, gross_rent: 0, fee_amount: 647, vat_amount: 0, deduction_amount: 0, credit_amount: 0, net_amount: -647, review_status: 'imported', flags: [] },
  { id: 'l3', statement_id: 's73', statement_number: 73, statement_date: '2026-01-19', line_no: 1, section: 'income', line_type: 'rent', property_address: '5, Thomas Street', tenant_name: 'Tenant B', period_start: '2026-01-01', period_end: '2026-01-31', gross_rent: 1200, fee_amount: 0, vat_amount: 0, deduction_amount: 0, credit_amount: 0, net_amount: 1200, review_status: 'imported', flags: [] },
]

function renderPage() {
  return render(<ThemeProvider><ConfirmProvider><StatementAuditPage user={{ id: 'u', email: 'justin@example.com' }} showToast={vi.fn()} onClose={vi.fn()} /></ConfirmProvider></ThemeProvider>)
}

beforeEach(() => { updateAuditStatement.mockClear() })

describe('StatementAuditPage', () => {
  it('lists the register, flags the missing statement and the import error', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Statement register/)).toBeInTheDocument())
    expect(screen.getByText('1 missing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Statement 72' })).toBeInTheDocument()
    expect(screen.getByText(/Import errors/)).toBeInTheDocument()
    expect(screen.getByText(/No amount cell found/)).toBeInTheDocument()
    // Statuses are shown as editable selects on every row.
    const selects = screen.getAllByDisplayValue('Imported - Awaiting Review')
    expect(selects.length).toBeGreaterThan(0)
  })

  it('lets the status and the Statement checked? flag be changed by hand', async () => {
    renderPage()
    await waitFor(() => screen.getByText(/Statement register/))
    const select = screen.getAllByDisplayValue('Imported - Awaiting Review')[0]
    fireEvent.change(select, { target: { value: 'ready_for_bank_check' } })
    await waitFor(() => expect(updateAuditStatement).toHaveBeenCalledWith('s71', { status: 'ready_for_bank_check' }))
    // First "Yes" toggle in the register belongs to statement 71.
    const yes = screen.getAllByRole('button', { name: 'Yes' })[0]
    fireEvent.click(yes)
    await waitFor(() => expect(updateAuditStatement).toHaveBeenCalledWith('s71', expect.objectContaining({ statement_checked: true, checked_by: 'justin@example.com' })))
  })

  it('opens a statement and shows its totals, balance check and verbatim lines', async () => {
    renderPage()
    await waitFor(() => screen.getByText(/Statement register/))
    fireEvent.click(screen.getByText('71'))
    await waitFor(() => expect(screen.getByText(/Statement balances/)).toBeInTheDocument())
    expect(screen.getByText('Gross rent received')).toBeInTheDocument()
    expect(screen.getAllByText('£6,470.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/Transactions \(2\)/)).toBeInTheDocument()
    expect(screen.getAllByText('29, Briardene').length).toBe(2)
    expect(screen.getByText('£647.00 (10%)')).toBeInTheDocument()
  })

  it('reports a discrepancy with expected, stated and the difference', async () => {
    renderPage()
    await waitFor(() => screen.getByText(/Statement register/))
    fireEvent.click(screen.getByText('73'))
    await waitFor(() => expect(screen.getByText(/Discrepancy found/)).toBeInTheDocument())
    expect(screen.getByText(/Expected net:/).textContent).toContain('£1,200.00')
    expect(screen.getByText(/Stated on document:/).textContent).toContain('£1,000.00')
    expect(screen.getByText(/Difference:/).textContent).toContain('£200.00')
    expect(screen.getByText(/cannot be marked complete until these are resolved/)).toBeInTheDocument()
  })
})
