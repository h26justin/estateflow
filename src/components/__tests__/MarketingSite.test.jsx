import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MarketingSite from '../MarketingSite'

beforeAll(() => {
  // jsdom has no layout; scrollTo() on nav buttons calls scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('MarketingSite accessibility', () => {
  it('keeps a space between the two lines of the hero heading', () => {
    render(<MarketingSite onSignIn={() => {}} onSignUp={() => {}} onPrivacy={() => {}} />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toMatch(/that doesn't feel/)
  })

  it('renders the mobile menu from the hamburger toggle and closes on Escape', () => {
    const onSignIn = vi.fn()
    render(<MarketingSite onSignIn={onSignIn} onSignUp={() => {}} onPrivacy={() => {}} />)
    const burger = document.querySelector('.mkt-burger')
    expect(burger).toHaveAttribute('aria-label', 'Open menu')
    expect(burger).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('mkt-mobile-menu')).toBeNull()

    fireEvent.click(burger)
    const menu = document.getElementById('mkt-mobile-menu')
    expect(menu).not.toBeNull()
    expect(burger).toHaveAttribute('aria-expanded', 'true')
    expect(burger).toHaveAttribute('aria-label', 'Close menu')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.getElementById('mkt-mobile-menu')).toBeNull()
  })

  it('implements the tabs pattern: one tab stop, arrow keys move selection, panel labelled by tab', () => {
    render(<MarketingSite onSignIn={() => {}} onSignUp={() => {}} onPrivacy={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs.filter(t => t.tabIndex === 0)).toHaveLength(1)

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    const after = screen.getAllByRole('tab')
    expect(after[1]).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(after[1])
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', after[1].id)

    fireEvent.keyDown(after[1], { key: 'End' })
    const last = screen.getAllByRole('tab').at(-1)
    expect(last).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
  })
})
