import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({ supabase: { storage: { from: () => ({}) } } }))
vi.mock('../../lib/api', () => ({
  fetchTenantProperty: vi.fn(),
  fetchTenancyDetails: vi.fn(() => Promise.resolve(null)),
  fetchTenantMaintenance: vi.fn(() => Promise.resolve([])),
  fetchTenantPaymentTracker: vi.fn(() => Promise.resolve([])),
}))

import * as api from '../../lib/api'
import TenantPortal from '../TenantPortal'

function payload(color) {
  return {
    property: { id: 'p1', address: '12 Example Road', rent_pcm: 950, company: { name: 'A Very Long Lettings Company Name Ltd', abbr: 'AVL', color } },
    bank_details: {}, features: {}, properties: [],
  }
}

const rgb = hex => {
  const h = hex.replace('#', '')
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`
}

describe('TenantPortal branded header', () => {
  beforeEach(() => { window.location.hash = '' })

  it('falls back to a light neutral when the brand colour is unreadable on the ink header', async () => {
    api.fetchTenantProperty.mockResolvedValue(payload('#1F3A5F')) // navy on ink ≈ 1.5:1
    render(<TenantPortal user={{ id: 'u1', email: 't@example.com' }} onSignOut={() => {}} onSwitchToLandlord={() => {}} />)
    const name = await screen.findByTitle('A Very Long Lettings Company Name Ltd')
    expect(name.style.color).toBe(rgb('#E8E5DD'))
    // The brand colour survives as the header accent bar.
    expect(name.closest('header').style.borderBottom).toContain(rgb('#1F3A5F'))
    // Ellipsis instead of wrapping on narrow screens.
    expect(name.style.textOverflow).toBe('ellipsis')
    expect(name.style.whiteSpace).toBe('nowrap')
  })

  it('keeps a brand colour that reads on the header', async () => {
    api.fetchTenantProperty.mockResolvedValue(payload('#CBA64E'))
    render(<TenantPortal user={{ id: 'u1', email: 't@example.com' }} onSignOut={() => {}} />)
    const name = await screen.findByTitle('A Very Long Lettings Company Name Ltd')
    expect(name.style.color).toBe(rgb('#CBA64E'))
  })

  it('labels the header actions for when they collapse to icons, and marks the active tab', async () => {
    api.fetchTenantProperty.mockResolvedValue(payload('#2D6FA8'))
    render(<TenantPortal user={{ id: 'u1', email: 't@example.com' }} onSignOut={() => {}} onSwitchToLandlord={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to landlord view' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Tenant portal' })
    expect(nav.querySelector('[aria-current="page"]').textContent).toMatch(/Home/)
  })
})
