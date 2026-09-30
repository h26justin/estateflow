import { describe, it, expect } from 'vitest'
import { fitBox, isNumericColumn, clean, hexToRgb, mix } from '../reportPdfKit'

describe('reportPdfKit helpers', () => {
  it('fits a logo inside its box without stretching it', () => {
    // The bug: a square 3000x3000 logo was drawn into a fixed 22x11 box.
    expect(fitBox(3000, 3000, 34, 22)).toEqual({ w: 22, h: 22 })
    expect(fitBox(1200, 300, 34, 22)).toEqual({ w: 34, h: 8.5 })
    expect(fitBox(300, 1200, 34, 22)).toEqual({ w: 5.5, h: 22 })
  })

  it('right-aligns money / number / percentage columns only', () => {
    expect(isNumericColumn(['£500', '£0', '-£120', '£1,250.00'])).toBe(true)
    expect(isNumericColumn(['7.1%', '6.7%', '—'])).toBe(true)
    expect(isNumericColumn(['Gas Safety', 'EICR', 'EPC'])).toBe(false)
    expect(isNumericColumn(['12 Mar 2027', '2 Oct 2026'])).toBe(false)
    expect(isNumericColumn(['', null])).toBe(false)
  })

  it('keeps text printable in Helvetica (Latin-1)', () => {
    expect(clean('Rent — due… “now”')).toBe('Rent - due... "now"')
    expect(clean('£1,000 · 5%')).toBe('£1,000 - 5%')
    expect(clean('Flat 2 🏠')).toBe('Flat 2')
  })

  it('parses brand colours and tints them', () => {
    expect(hexToRgb('#4b4238')).toEqual([75, 66, 56])
    expect(hexToRgb('nope')).toBeUndefined()
    expect(mix([0, 0, 0], [255, 255, 255], 0.1)).toEqual([230, 230, 230])
  })
})
