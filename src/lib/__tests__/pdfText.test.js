import { describe, it, expect } from 'vitest'
import { linesFromTextItems, textFromPages } from '../pdfText'

// pdf.js text items: transform [a,b,c,d,x,y] in PDF user space (y up).
const item = (str, x, y, width = str.length * 5, size = 10) => ({ str, width, transform: [size, 0, 0, size, x, y] })
// Portrait page 200pt tall, no rotation: device y = 200 - y.
const PORTRAIT = [1, 0, 0, -1, 0, 200]
// Landscape page saved with /Rotate 90 (what the RMS statement does): pdf.js
// gives a viewport transform that swaps the axes.
const ROTATED = [0, 1, 1, 0, 0, 0]

describe('linesFromTextItems', () => {
  it('groups items on one baseline into a line, left to right', () => {
    const lines = linesFromTextItems([item('World', 40, 100), item('Hello', 10, 100), item('Below', 10, 80)], PORTRAIT)
    expect(lines).toEqual(['Hello World', 'Below'])
  })
  it('keeps a cell whose baseline differs by less than half a glyph together', () => {
    const lines = linesFromTextItems([item('Rent', 10, 100), item('600.00', 150, 102)], PORTRAIT)
    expect(lines).toEqual(['Rent  600.00'])
  })
  it('separates columns with two spaces so parsers can split cells', () => {
    const lines = linesFromTextItems([item('02/09/2026', 10, 100), item('5 Jubilee Road', 120, 100), item('600.00', 400, 100)], PORTRAIT)
    expect(lines[0]).toBe('02/09/2026  5 Jubilee Road  600.00')
  })
  it('reads a rotated page in visual order instead of raw y order', () => {
    // On the rotated page the raw transform[5] (y) is really the horizontal
    // position; the true top-to-bottom order is carried by x.
    const items = [item('Totals', 300, 50), item('STATEMENT/INVOICE', 20, 50), item('Rent Receipt', 150, 50), item('600.00', 150, 400)]
    const lines = linesFromTextItems(items, ROTATED)
    expect(lines).toEqual(['STATEMENT/INVOICE', 'Rent Receipt  600.00', 'Totals'])
  })
  it('drops empty items and joins pages with a marker', () => {
    const lines = linesFromTextItems([item(' ', 0, 0), item('A', 0, 0)], PORTRAIT)
    expect(lines).toEqual(['A'])
    expect(textFromPages([['A'], ['B']])).toBe('A\n\n--- PAGE BREAK ---\n\nB')
  })
})
