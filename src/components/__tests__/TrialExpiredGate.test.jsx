import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import TrialExpiredGate from '../TrialExpiredGate'

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
})
