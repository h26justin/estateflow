import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MarketingSite, { Testimonials } from '../MarketingSite'

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

describe('MarketingSite content', () => {
  it('renders no testimonials section while there are no real quotes', () => {
    render(<MarketingSite onSignIn={() => {}} onSignUp={() => {}} onPrivacy={() => {}} />)
    expect(screen.queryByRole('heading', { name: 'What landlords say' })).toBeNull()
    expect(document.querySelector('blockquote')).toBeNull()
  })

  it('renders testimonials when real ones are supplied', () => {
    render(<Testimonials items={[{ quote: 'Example quote.', name: 'A. Person', detail: '3 properties' }]} />)
    expect(screen.getByRole('heading', { name: 'What landlords say' })).toBeInTheDocument()
    expect(screen.getByText('Example quote.')).toBeInTheDocument()
  })

  it('does not claim live HMRC filing', () => {
    render(<MarketingSite onSignIn={() => {}} onSignUp={() => {}} onPrivacy={() => {}} />)
    const text = document.body.textContent
    expect(text).not.toMatch(/MTD ITSA submissions built in/)
    expect(text).toMatch(/as soon as HMRC approves/)
  })
})

describe('MarketingSite feature accordions', () => {
  it('shows every feature category open on desktop, with no disclosure buttons', () => {
    render(<MarketingSite onSignIn={() => {}} onSignUp={() => {}} onPrivacy={() => {}} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Rent & Finance' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rent & Finance/ })).toBeNull()
    expect(screen.getByText('Full Portfolio P&L')).toBeVisible()
  })

  it('collapses categories into disclosure buttons on narrow screens, content kept in the DOM', () => {
    const orig = window.matchMedia
    window.matchMedia = (q) => ({ matches: q.includes('max-width: 768px'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      render(<MarketingSite onSignIn={() => {}} onSignUp={() => {}} onPrivacy={() => {}} />)
      const first = screen.getByRole('button', { name: /Portfolio Management/ })
      expect(first).toHaveAttribute('aria-expanded', 'true')
      const btn = screen.getByRole('button', { name: /Rent & Finance/ })
      expect(btn).toHaveAttribute('aria-expanded', 'false')
      const panel = document.getElementById(btn.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('hidden')
      expect(panel.textContent).toMatch(/Full Portfolio P&L/)
      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'true')
      expect(panel).not.toHaveAttribute('hidden')
    } finally {
      window.matchMedia = orig
    }
  })
})
