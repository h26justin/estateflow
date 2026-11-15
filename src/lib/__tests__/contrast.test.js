import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHex, isHexColor, normalizeHex, luminance, contrastRatio, meetsContrast, readableOr, textOn, readableOn, AA_TEXT, AA_LARGE } from '../contrast'
import { EPC_BAND_COLOR } from '../complianceCatalogue'

describe('parseHex', () => {
  it('parses 3, 6 and 8 digit hex, with or without #', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('1C2830')).toEqual({ r: 28, g: 40, b: 48 })
    expect(parseHex('#B8902F55')).toEqual({ r: 184, g: 144, b: 47 })
  })
  it('rejects garbage', () => {
    expect(parseHex('')).toBeNull()
    expect(parseHex('red')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    expect(parseHex(null)).toBeNull()
    expect(isHexColor('#zzzzzz')).toBe(false)
  })
})

describe('normalizeHex', () => {
  it('expands to upper-case #RRGGBB and drops alpha', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC')
    expect(normalizeHex('b8902f')).toBe('#B8902F')
    expect(normalizeHex('#B8902F80')).toBe('#B8902F')
    expect(normalizeHex('rgb(0,0,0)')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#FFFFFF')).toBe(1)
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
    // Order independent.
    expect(contrastRatio('#1C2830', '#F4F3EF')).toBeCloseTo(contrastRatio('#F4F3EF', '#1C2830'), 10)
  })
  it('agrees with the token audit in ThemeContext', () => {
    // ink on paper ≈ 13.6:1, muted on paper ≈ 5.3:1
    expect(contrastRatio('#1C2830', '#F4F3EF')).toBeGreaterThan(13.4)
    expect(contrastRatio('#5C6670', '#F4F3EF')).toBeGreaterThan(5.2)
  })
  it('returns null when a colour is unparseable', () => {
    expect(contrastRatio('nope', '#fff')).toBeNull()
    expect(meetsContrast('nope', '#fff')).toBe(false)
  })
})

describe('readableOr', () => {
  const HEADER = '#1C2830'
  it('keeps a brand colour that is readable on the surface', () => {
    expect(readableOr('#CBA64E', HEADER, '#E8E5DD')).toBe('#CBA64E')
  })
  it('falls back when the brand colour is too dark for a dark header', () => {
    // Navy on ink — illegible.
    expect(contrastRatio('#1F3A5F', HEADER)).toBeLessThan(AA_TEXT)
    expect(readableOr('#1F3A5F', HEADER, '#E8E5DD')).toBe('#E8E5DD')
  })
  it('falls back for an unparseable colour', () => {
    expect(readableOr(undefined, HEADER, '#E8E5DD')).toBe('#E8E5DD')
  })
  it('honours a custom threshold', () => {
    const r = contrastRatio('#B8902F', '#FFFFFF') // ≈ 2.9
    expect(readableOr('#B8902F', '#FFFFFF', '#1C2830')).toBe('#1C2830')
    expect(readableOr('#B8902F', '#FFFFFF', '#1C2830', r - 0.01)).toBe('#B8902F')
  })
})

describe('textOn', () => {
  it('picks dark text on light fills and light text on dark fills', () => {
    expect(textOn('#B8902F')).toBe('#1C2830')
    expect(textOn('#F4F3EF')).toBe('#1C2830')
    expect(textOn('#1F3A5F')).toBe('#FFFFFF')
    expect(textOn('#1C2830')).toBe('#FFFFFF')
  })
  it('defaults to dark text for an unparseable fill', () => {
    expect(textOn('not-a-colour')).toBe('#1C2830')
  })
})

describe('readableOn', () => {
  it('gives every EPC band a label colour that reaches 4.5:1', () => {
    for (const [band, bg] of Object.entries(EPC_BAND_COLOR)) {
      const ink = readableOn(bg)
      expect(contrastRatio(ink, bg), `band ${band}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })
  it('prefers paper / ink and only falls back to black or white when both fail', () => {
    expect(readableOn('#B8392D')).toBe('#FFFFFF')
    expect(readableOn('#f0c419')).toBe('#1C2830')
    // Band A green: white 4.43, ink 3.4 — pure black is the only pass.
    expect(readableOn('#1a8a3c')).toBe('#000000')
  })
  it('returns ink for an unparseable fill', () => {
    expect(readableOn('nope')).toBe('#1C2830')
  })
})

// The theme tokens in app.css that are painted as text-on-fill or as an input
// boundary. Read from disk: Vitest stubs CSS imports.
describe('app.css token contrast', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8')
  const block = (sel) => {
    const i = css.indexOf(sel + ' {')
    expect(i, sel).toBeGreaterThan(-1)
    const out = {}
    for (const m of css.slice(i, css.indexOf('}', i)).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
    return out
  }
  it.each([['light', ':root[data-theme="light"]'], ['dark', ':root[data-theme="dark"]']])(
    '%s: danger button label reaches 4.5:1 and input borders 3:1', (_n, sel) => {
      const v = block(sel)
      expect(contrastRatio(v['--on-danger'], v['--danger-fill'])).toBeGreaterThanOrEqual(AA_TEXT)
      for (const bg of [v['--surface'], v['--card'], v['--bg']]) {
        expect(contrastRatio(v['--input-border'], bg)).toBeGreaterThanOrEqual(AA_LARGE)
      }
    })
})
