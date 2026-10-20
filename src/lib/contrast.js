// WCAG 2.1 colour-contrast helpers.
//
// Company brand colours are user-chosen (CompanyModal / Branding settings) and
// then painted onto surfaces we do not control the colour of — the tenant
// portal's dark header, white cards, button fills. These helpers let a caller
// keep the brand colour where it is readable and fall back to a neutral where
// it is not, instead of shipping, say, navy text on a slate header.
//
// Formula: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio (sRGB relative
// luminance). AA thresholds: 4.5:1 normal text, 3:1 large text / UI parts.

export const AA_TEXT = 4.5
export const AA_LARGE = 3

// Parse #RGB, #RRGGBB or #RRGGBBAA (alpha ignored). Returns {r,g,b} 0–255, or
// null for anything unparseable (callers then take their fallback).
export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('')
  else if (/^[0-9a-f]{8}$/i.test(h)) h = h.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function isHexColor(hex) {
  return parseHex(hex) !== null
}

// '#RRGGBB' (upper-case) for any parseable hex, else null — so callers can
// safely append a two-digit alpha suffix (`${c}22`).
export function normalizeHex(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return '#' + [rgb.r, rgb.g, rgb.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function channel(v) {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

// Relative luminance 0 (black) … 1 (white); null if unparseable.
export function luminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

// Contrast ratio 1 … 21; null if either colour is unparseable.
export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export function meetsContrast(fg, bg, min = AA_TEXT) {
  const r = contrastRatio(fg, bg)
  return r !== null && r >= min
}

// `color` when it reaches `min` against `bg`, otherwise `fallback`. Use for a
// brand colour painted as text (or an icon / underline) on a known surface.
export function readableOr(color, bg, fallback, min = AA_TEXT) {
  return meetsContrast(color, bg, min) ? color : fallback
}

// Whichever of `light` / `dark` contrasts better with `bg` — the text colour
// for a label sitting on a brand-colour fill. Defaults are the redesign's
// paper and ink.
export function textOn(bg, light = '#FFFFFF', dark = '#1C2830') {
  const rl = contrastRatio(light, bg)
  const rd = contrastRatio(dark, bg)
  if (rl === null || rd === null) return dark
  return rl >= rd ? light : dark
}
