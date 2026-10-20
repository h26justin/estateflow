import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../lib/ThemeContext'
import { StatCard } from '../app/StatCard'

const renderCard = props => render(<ThemeProvider><StatCard icon="home" label="Portfolio Value" value="£1,000" {...props}/></ThemeProvider>)

describe('StatCard', () => {
  it('drops the "PORTFOLIO → DETAIL" header text', () => {
    renderCard({ breakdown: [{ label: 'Row', value: '1' }], onNavigate: vi.fn(), navLabel: 'Portfolio' })
    expect(screen.queryByText(/^detail$/i)).toBeNull()
    expect(screen.queryByText(/^portfolio$/i)).toBeNull()
  })

  it('the whole card toggles its breakdown by click, Enter and Space', () => {
    const nav = vi.fn()
    renderCard({ breakdown: [{ label: 'Purchase prices', value: '£900' }], onNavigate: nav, navLabel: 'Portfolio' })
    const card = screen.getByRole('button', { name: /Portfolio Value: £1,000\. Show breakdown/ })
    expect(card).toHaveAttribute('tabindex', '0')
    expect(card).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(card).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Purchase prices')).toBeInTheDocument()
    // The navigation link lives inside the open panel.
    fireEvent.click(screen.getByRole('button', { name: /Open Portfolio/ }))
    expect(nav).toHaveBeenCalledTimes(1)
    // Following the link closes the panel; Space reopens it, a click closes.
    expect(screen.queryByText('Purchase prices')).toBeNull()
    fireEvent.keyDown(card, { key: ' ' })
    expect(card).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(card)
    expect(screen.queryByText('Purchase prices')).toBeNull()
  })

  it('a card without a breakdown is a link that navigates', () => {
    const nav = vi.fn()
    renderCard({ onNavigate: nav, navLabel: 'Rent' })
    const card = screen.getByRole('link', { name: /Open Rent/ })
    fireEvent.click(card)
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(nav).toHaveBeenCalledTimes(2)
  })
})
