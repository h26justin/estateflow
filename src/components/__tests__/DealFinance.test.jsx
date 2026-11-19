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
