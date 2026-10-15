import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LIGHT, DARK } from '../ThemeContext'
import { FS, R, SP } from '../styles'

// The CSS custom properties in src/styles/app.css must mirror the JS `T`
// palettes; components mix both while call sites migrate.
// Read from disk: Vitest stubs CSS imports (even ?raw) to empty strings.
const css = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8')

const kebab = (k) => '--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

function block(selector) {
  const i = css.indexOf(selector + ' {')
  expect(i, `missing ${selector} block`).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf('}', i))
}

function vars(text) {
  const out = {}
  for (const m of text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

describe('theme tokens', () => {
  it.each([
    ['light', LIGHT, ':root[data-theme="light"]'],
    ['dark', DARK, ':root[data-theme="dark"]'],
  ])('%s CSS vars match the JS palette', (_name, palette, selector) => {
    const v = vars(block(selector))
    for (const [k, hex] of Object.entries(palette)) {
      expect(v[kebab(k)]?.toUpperCase(), kebab(k)).toBe(hex.toUpperCase())
    }
  })

  it('type, radius and spacing vars match FS / R / SP', () => {
    const v = vars(css)
    for (const [k, n] of Object.entries(FS)) expect(v[`--fs-${k}`]).toBe(`${n}px`)
    for (const [k, n] of Object.entries(R)) expect(v[`--r-${k}`]).toBe(`${n}px`)
    for (const [k, n] of Object.entries(SP)) expect(v[`--sp-${k}`]).toBe(`${n}px`)
  })

  it('no type size below 11px', () => {
    expect(Math.min(...Object.values(FS))).toBeGreaterThanOrEqual(11)
  })
})
