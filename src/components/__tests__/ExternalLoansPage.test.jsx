import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import ExternalLoansPage from '../ExternalLoansPage'

const loan = {
  id: 'L1', company_id: 'c1', lender_name: 'A Private Lender', lender_type: 'private',
  principal: 50000, received_date: '2099-01-15', term_months: 24, annual_rate: 8, repayment_type: 'repayment',
  external_loan_payments: [],
}

vi.mock('../../lib/api', () => ({
  fetchExternalLoans: vi.fn(async () => []),
  createExternalLoan: vi.fn(async fields => ({ id: 'new', external_loan_payments: [], ...fields })),
  updateExternalLoan: vi.fn(async (id, fields) => ({ id, external_loan_payments: [], ...fields })),
  deleteExternalLoan: vi.fn(async () => true),
  tickExternalLoanPayment: vi.fn(async (loanId, t) => ({ id: 't-' + t.period, loan_id: loanId, ...t })),
  untickExternalLoanPayment: vi.fn(async () => true),
  updateExternalLoanPayment: vi.fn(async (id, f) => ({ id, ...f })),
}))

const companies = [{ id: 'c1', name: 'ExH Property Group', abbr: 'EXH', color: '#2ECC8A' }]
const permissionsMap = { __owner: { c1: true } }

function renderPage() {
  return render(<ThemeProvider><ExternalLoansPage companies={companies} properties={[]} permissionsMap={permissionsMap} showToast={vi.fn()} /></ThemeProvider>)
}

beforeEach(() => { window.location.hash = '#/loans'; vi.clearAllMocks() })

describe('ExternalLoansPage', () => {
  it('shows the empty state and works out the monthly payment while typing', async () => {
    api.fetchExternalLoans.mockResolvedValueOnce([])
    renderPage()
    expect(await screen.findByText('No external loans yet')).toBeInTheDocument()
    fireEvent.click(screen.getByText('+ New loan'))
    fireEvent.change(screen.getByPlaceholderText('Lender name'), { target: { value: 'A Private Lender' } })
    const [amount, rate] = screen.getAllByPlaceholderText('0')
    fireEvent.change(amount, { target: { value: '50000' } })
    fireEvent.change(rate, { target: { value: '8' } })
    // 12 months by default is 1 year; switch to 24 months.
    fireEvent.change(screen.getByDisplayValue('years'), { target: { value: 'months' } })
    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '24' } })
    expect(screen.getByText('£2,261.36')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Add loan'))
    await waitFor(() => expect(api.createExternalLoan).toHaveBeenCalled())
    expect(api.createExternalLoan.mock.calls[0][0]).toMatchObject({ company_id: 'c1', lender_name: 'A Private Lender', principal: 50000, annual_rate: 8, term_months: 24 })
  })

  it('offers capital + interest or interest only, each with its monthly payment', async () => {
    api.fetchExternalLoans.mockResolvedValueOnce([])
    renderPage()
    fireEvent.click(await screen.findByText('+ New loan'))
    fireEvent.change(screen.getByPlaceholderText('Lender name'), { target: { value: 'A Lender' } })
    const [amount, rate] = screen.getAllByPlaceholderText('0')
    fireEvent.change(amount, { target: { value: '500000' } })
    fireEvent.change(rate, { target: { value: '3' } })
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '6' } }) // 6 years
    const radios = screen.getAllByRole('radio')
    expect(radios.map(r => r.textContent)).toEqual([
      expect.stringContaining('Capital + interest'), expect.stringContaining('Interest only'),
    ])
    expect(radios[0]).toHaveTextContent('£7,596.84 a month')
    expect(radios[1]).toHaveTextContent('£1,250.00 a month')
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(radios[1])
    expect(screen.getByRole('radio', { name: /Interest only/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByText('Add loan'))
    await waitFor(() => expect(api.createExternalLoan).toHaveBeenCalled())
    expect(api.createExternalLoan.mock.calls[0][0]).toMatchObject({ repayment_type: 'interest_only', term_months: 72, principal: 500000 })
  })

  it('ticks a month off from the schedule', async () => {
    api.fetchExternalLoans.mockResolvedValueOnce([loan])
    window.location.hash = '#/loans/L1'
    renderPage()
    expect(await screen.findByText('Payment schedule')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Tick off payment 1 as paid'))
    await waitFor(() => expect(api.tickExternalLoanPayment).toHaveBeenCalledWith('L1', expect.objectContaining({ period: 1, amount: 2261.36, due_date: '2099-02-15' })))
    expect(await screen.findByLabelText('Untick payment 1')).toBeChecked()
  })
})
