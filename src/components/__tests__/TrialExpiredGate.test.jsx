import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import TrialExpiredGate, { getOverdueCompanies } from '../TrialExpiredGate'

vi.mock('../../lib/api', () => ({
  createCheckoutSession: vi.fn(async () => { throw new Error('stop') }),
}))

const companies = [{ id: 'c1', name: 'Alpha Lettings', abbr: 'AL' }]
const twoProps = [{ id: 'p1', company_id: 'c1' }, { id: 'p2', company_id: 'c1' }, { id: 'p3', company_id: 'c1', deleted_at: '2026-01-01' }]

function renderGate(props) {
  return render(<ThemeProvider><TrialExpiredGate companies={companies} subs={[]} properties={twoProps} user={{ id: 'u1' }} onSignOut={vi.fn()} {...props}/></ThemeProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('TrialExpiredGate', () => {
  it('shows the £10 minimum for 2 Starter properties, as checkout charges', () => {
    renderGate()
    expect(screen.getByText(/2 properties · £10\/month/)).toBeInTheDocument()
  })

  it('opens checkout for an expired trial', async () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'checkout'))
  })

  it('sends past_due to the billing portal, never a second checkout', async () => {
    renderGate({ subs: [{ company_id: 'c1', status: 'past_due', tier: 'investor', stripe_subscription_id: 'sub_1' }] })
    expect(screen.getByText(/2 properties · £10\/month/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'portal'))
  })

  it('a company with no trial at all says subscribe to activate and still offers checkout', async () => {
    renderGate({ companies: [{ id: 'c1', name: 'Alpha Lettings', abbr: 'AL', trial_ends_at: null }] })
    expect(screen.getByText('Subscribe to activate this company')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }))
    await waitFor(() => expect(api.createCheckoutSession).toHaveBeenCalledWith('c1', 'checkout'))
  })
})

describe('getOverdueCompanies', () => {
  const past = new Date(Date.now() - 86400000).toISOString()
  const future = new Date(Date.now() + 10 * 86400000).toISOString()
  const co = (id, over = {}) => ({ id, owner_id: 'u1', is_free_tier: false, trial_ends_at: null, ...over })
  it('gates an owned company with a NULL trial and no live subscription (an owner\'s second company)', () => {
    expect(getOverdueCompanies({ companies: [co('a')], subs: [], userId: 'u1' }).map(c => c.id)).toEqual(['a'])
  })
  it('does not gate a free-tier, in-trial, paying, Stripe-trialing or not-owned company', () => {
    const companies = [
      co('free', { is_free_tier: true }),
      co('trial', { trial_ends_at: future }),
      co('paid'),
      co('stripeTrial'),
      co('theirs', { owner_id: 'someone-else' }),
    ]
    const subs = [{ company_id: 'paid', status: 'active' }, { company_id: 'stripeTrial', status: 'trialing', stripe_subscription_id: 'sub_1' }]
    expect(getOverdueCompanies({ companies, subs, userId: 'u1' })).toEqual([])
  })
  it('still gates an expired trial and past_due', () => {
    const companies = [co('expired', { trial_ends_at: past }), co('late', { trial_ends_at: future })]
    const subs = [{ company_id: 'late', status: 'past_due', stripe_subscription_id: 'sub_2' }]
    expect(getOverdueCompanies({ companies, subs, userId: 'u1' }).map(c => c.id)).toEqual(['expired', 'late'])
  })
})
