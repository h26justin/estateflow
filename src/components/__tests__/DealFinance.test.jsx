import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { ConfirmProvider } from '../../lib/ConfirmContext'
import { CostsFundingTab, CompanyFundingDashboard } from '../DealFinance'
import * as api from '../../lib/api'

vi.mock('../../lib/api', () => ({
  fetchDealCostLines: vi.fn(async () => []),
  fetchDealFunding: vi.fn(async () => []),
  upsertDealCostLine: vi.fn(async (dealId, row) => ({ id: 'new-line', deal_id: dealId, ...row })),
  upsertDealFunding: vi.fn(async (dealId, row) => ({ id: 'new-fund', deal_id: dealId, ...row })),
  deleteDealCostLine: vi.fn(async () => {}),
  deleteDealFunding: vi.fn(async () => {}),
  fetchCostLinesForDeals: vi.fn(async () => ({})),
  fetchFundingForDeals: vi.fn(async () => ({})),
  fetchCompanyCashPositions: vi.fn(async () => []),
  addCompanyCashPosition: vi.fn(async row => ({ id: 'cp', ...row })),
  deleteCompanyCashPosition: vi.fn(async () => {}),
}))

const wrap = ui => render(<ThemeProvider><ConfirmProvider>{ui}</ConfirmProvider></ThemeProvider>)

beforeEach(() => { vi.clearAllMocks() })

describe('CostsFundingTab', () => {
  it('shows the Park Row balance due from cost lines', async () => {
    api.fetchDealCostLines.mockResolvedValueOnce([
      { id: 'l1', category: 'purchase_price', amount: 15000, state: 'confirmed' },
      { id: 'l2', category: 'legal_fee', amount: 2039, state: 'quoted' },
      { id: 'l3', category: 'on_account', amount: 300, state: 'paid' },
    ])
    wrap(<CostsFundingTab deal={{ id: 'd1', purchase_price: 15000 }} showToast={() => {}}/>)
    expect((await screen.findAllByText('£16,739', { selector: 'div' })).length).toBe(2) // balance due and cash from company
    expect(screen.queryByText('Estimate from deal fields')).toBeNull()
  })

  it('warns when the figures are an estimate and adds a cost line', async () => {
    wrap(<CostsFundingTab deal={{ id: 'd1', purchase_price: 100000 }} showToast={() => {}}/>)
    expect(await screen.findByText('Estimate from deal fields')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add cost line/ }))
    await waitFor(() => expect(api.upsertDealCostLine).toHaveBeenCalledWith('d1', expect.objectContaining({ category: 'purchase_price', state: 'estimate' })))
    fireEvent.click(screen.getByRole('button', { name: /How calculated/ }))
    expect(screen.getByText(/Balance due =/)).toBeTruthy()
  })
  it('saves only changed fields, one save at a time per row', async () => {
    api.fetchDealCostLines.mockResolvedValueOnce([
      { id: 'l1', category: 'purchase_price', label: '', amount: 0, state: 'estimate' },
    ])
    let releaseFirst
    const order = []
    api.upsertDealCostLine
      .mockImplementationOnce((dealId, row) => new Promise(res => {
        order.push('first-start')
        releaseFirst = () => { order.push('first-end'); res({ id: 'l1', category: 'purchase_price', amount: 0, state: 'estimate', label: 'Completion' }) }
      }))
      .mockImplementationOnce(async (dealId, row) => {
        order.push('second-start')
        return { id: 'l1', category: 'purchase_price', state: 'estimate', label: 'Completion', amount: 1234 }
      })
    wrap(<CostsFundingTab deal={{ id: 'd1', purchase_price: 100000 }} showToast={() => {}}/>)
    const label = await screen.findByPlaceholderText('e.g. Completion statement')
    fireEvent.change(label, { target: { value: 'Completion' } })
    fireEvent.blur(label)
    const amount = screen.getByLabelText('Amount')
    fireEvent.change(amount, { target: { value: '1234' } })
    fireEvent.blur(amount)

    await waitFor(() => expect(api.upsertDealCostLine).toHaveBeenCalledTimes(1))
    // The label save carries no amount, so it can never reset the amount.
    expect(api.upsertDealCostLine.mock.calls[0][1]).toEqual({ id: 'l1', label: 'Completion' })
    expect(order).toEqual(['first-start'])  // the amount save waits its turn
    releaseFirst()
    await waitFor(() => expect(api.upsertDealCostLine).toHaveBeenCalledTimes(2))
    expect(api.upsertDealCostLine.mock.calls[1][1]).toMatchObject({ id: 'l1', amount: 1234 })
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })
})

describe('CompanyFundingDashboard', () => {
  const companies = [{ id: 'c1', name: 'WXH', abbr: 'WXH', color: '#4B8FE0' }]
  const deals = [
    { id: 'a', name: 'A', status: 'conveyancing', company_id: 'c1', expected_completion_date: '2099-01-05' },
    { id: 'u', name: 'U', status: 'analysing', company_id: null },
  ]

  it('loads once for all cards, shows Unassigned, and opens the panel for the selected company', async () => {
    api.fetchCostLinesForDeals.mockResolvedValue({ a: [{ category: 'other_purchase', amount: 325400, state: 'estimate' }] })
    api.fetchCompanyCashPositions.mockResolvedValue([{ id: 'p1', company_id: 'c1', as_of: '2026-11-18', amount: 130000, created_at: '2026-11-18T10:00:00Z' }])
    const setCoFilter = vi.fn()
    wrap(<CompanyFundingDashboard deals={deals} companies={companies} coFilter="c1" setCoFilter={setCoFilter} showToast={() => {}}/>)
    expect(await screen.findByText(/funding schedule/)).toBeTruthy()
    expect(screen.getByText('Unassigned')).toBeTruthy()
    expect(api.fetchCostLinesForDeals).toHaveBeenCalledTimes(1)
    expect(api.fetchCostLinesForDeals.mock.calls[0][0].sort()).toEqual(['a', 'u'])
    expect(await screen.findByText(/max\(0, £325,400 − £130,000\) = £195,400/)).toBeTruthy()
    fireEvent.click(screen.getByText('WXH'))
    expect(setCoFilter).toHaveBeenCalledWith('all')
  })
})
