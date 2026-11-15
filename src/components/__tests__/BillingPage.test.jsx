import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import BillingPage from '../BillingPage'

const state = vi.hoisted(() => ({ subs: [] }))
vi.mock('../../lib/api', () => ({
  fetchSubscriptions: vi.fn(async () => state.subs),
  fetchBillablePropertyCounts: vi.fn(async () => ({ c1: 2 })),
  fetchAllCompaniesAdmin: vi.fn(async () => []),
  createCheckoutSession: vi.fn(async () => { throw new Error('stop') }),
  setCompanyFreeTier: vi.fn(),
}))

const companies = [{ id: 'c1', name: 'Alpha Lettings', abbr: 'AL' }]
const renderPage = () => render(<ThemeProvider><BillingPage companies={companies} user={{ id: 'u1' }} isPlatformAdmin={false}/></ThemeProvider>)

beforeEach(() => { vi.clearAllMocks(); state.subs = [] })

describe('BillingPage', () => {
  it('prices a trial on the live billable count with the £10 minimum', async () => {
    renderPage()
    expect(await screen.findByText(/2 properties × £2\/mo/)).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'DIV' && el.textContent === 'from £10/mo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add payment method' }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'checkout', undefined))
  })

  it('sends past_due to the portal, not a second checkout', async () => {
    state.subs = [{ company_id: 'c1', status: 'past_due', tier: 'starter', stripe_subscription_id: 'sub_1', property_count: 2 }]
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Update payment method' }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'portal', undefined))
  })

  it('an Investor upgrade with a live subscription goes to the portal', async () => {
    state.subs = [{ company_id: 'c1', status: 'active', tier: 'starter', stripe_subscription_id: 'sub_1', property_count: 2 }]
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Upgrade to Investor/ }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'portal', undefined))
  })

  it('an Investor upgrade during an in-app trial opens Investor checkout', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Upgrade to Investor/ }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'subscribe', 'investor'))
  })
})
