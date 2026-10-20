import { describe, it, expect } from 'vitest'
import { COMPANY_COLORS, DEFAULT_COMPANY_COLOR, companyColorName } from '../companyColors'
import { contrastRatio, textOn, AA_TEXT } from '../contrast'

describe('company colour presets', () => {
  it('every preset clears WCAG AA as text on white and on paper', () => {
    for (const { name, hex } of COMPANY_COLORS) {
      expect(contrastRatio(hex, '#FFFFFF'), `${name} on white`).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio(hex, '#F4F3EF'), `${name} on paper`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('every preset takes white labels when used as a fill', () => {
    for (const { hex } of COMPANY_COLORS) expect(textOn(hex)).toBe('#FFFFFF')
  })

  it('has unique, valid hex values and no legacy dark-theme hues', () => {
    const hexes = COMPANY_COLORS.map(c => c.hex.toUpperCase())
    expect(new Set(hexes).size).toBe(hexes.length)
    for (const h of hexes) expect(h).toMatch(/^#[0-9A-F]{6}$/)
    for (const legacy of ['#C8A84B', '#4B8FE0', '#2ECC8A', '#E05555', '#E0943A']) expect(hexes).not.toContain(legacy)
  })

  it('defaults to the first preset and names presets case-insensitively', () => {
    expect(DEFAULT_COMPANY_COLOR).toBe(COMPANY_COLORS[0].hex)
    expect(companyColorName(COMPANY_COLORS[1].hex.toLowerCase())).toBe(COMPANY_COLORS[1].name)
    expect(companyColorName('#123456')).toBeNull()
  })
})
