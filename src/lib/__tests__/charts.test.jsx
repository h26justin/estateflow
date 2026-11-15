import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart, RankedBar, AreaChart, DonutChart } from '../charts'
import { LIGHT, DARK } from '../ThemeContext'
import { contrastRatio, AA_TEXT } from '../contrast'

const fmt = v => `£${v}`

describe('charts accessibility', () => {
  it('are role="img" with a generated summary of the series', () => {
    render(<BarChart T={LIGHT} accent={LIGHT.gold} fmt={fmt} data={[{ label: 'Flat 1', value: 100 }, { label: 'Flat 2', value: 50 }]} />)
    expect(screen.getByRole('img', { name: 'Bar chart: Flat 1 £100, Flat 2 £50' })).toBeInTheDocument()
  })

  it('accept an ariaLabel override', () => {
    render(<AreaChart T={LIGHT} accent={LIGHT.gold} ariaLabel="Net cash flow by month" data={[{ label: 'Jan', value: 1 }, { label: 'Feb', value: 2 }]} />)
    expect(screen.getByRole('img', { name: 'Net cash flow by month' })).toBeInTheDocument()
  })

  it('labels the donut with its caption, value and percentage', () => {
    render(<DonutChart T={LIGHT} accent={LIGHT.gold} value="8/10" percent={80} label="Occupancy" />)
    expect(screen.getByRole('img', { name: 'Occupancy: 8/10: 80%' })).toBeInTheDocument()
  })
})

describe('chart label contrast', () => {
  it('draws a short ranked bar\'s label outside the bar in the text colour', () => {
    const { container } = render(<RankedBar T={LIGHT} accent={LIGHT.gold} fmt={fmt}
      data={[{ label: 'Long enough property name', value: 100 }, { label: 'Tiny bar property', value: 1 }]} />)
    const labels = [...container.querySelectorAll('text')].filter(t => /property/.test(t.textContent))
    const tiny = labels.find(t => t.textContent.startsWith('Tiny'))
    expect(tiny.getAttribute('fill')).toBe(LIGHT.text)
    expect(Number(tiny.getAttribute('x'))).toBeGreaterThan(8 + 6)
  })

  it('picks a readable value colour on a dark-theme green bar (white was 2.3:1)', () => {
    const { container } = render(<BarChart T={DARK} accent={DARK.gold} fmt={fmt} data={[{ label: 'A', value: 100, color: DARK.green }]} />)
    const value = [...container.querySelectorAll('text')].find(t => t.textContent === '£100')
    const fill = value.getAttribute('fill')
    expect(fill).not.toBe('white')
    expect(contrastRatio(fill, DARK.green)).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

describe('chart sizing', () => {
  afterEach(() => vi.restoreAllMocks())
  it('sizes the viewBox to the measured width so labels render at their true size', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 320, height: 220, top: 0, left: 0, right: 320, bottom: 220, x: 0, y: 0 })
    render(<BarChart T={LIGHT} accent={LIGHT.gold} data={[{ label: 'A', value: 1 }]} />)
    expect(screen.getByRole('img').getAttribute('viewBox')).toBe('0 0 320 220')
  })
  it('falls back to an 800-unit viewBox before it can measure', () => {
    render(<BarChart T={LIGHT} accent={LIGHT.gold} data={[{ label: 'A', value: 1 }]} />)
    expect(screen.getByRole('img').getAttribute('viewBox')).toBe('0 0 800 220')
  })
})
