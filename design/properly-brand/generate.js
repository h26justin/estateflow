// Properly brand asset generator — outlines Archivo/IBM Plex Mono type to
// paths (per handoff spec) and derives SVG + PNG assets.
const opentype = require('opentype.js')
const sharp = require('sharp')
const fs = require('fs')

function loadFont(p) {
  const b = fs.readFileSync(p)
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
const archivo700 = loadFont('archivo/archivo-v25-latin-700.ttf')
const archivo600 = loadFont('archivo/archivo-v25-latin-600.ttf')
const plex400 = loadFont('plexmono/ibm-plex-mono-v20-latin-regular.ttf')

const INK = '#14202A', SIGNAL = '#67AAED', PAPER = '#FAF9F7', RULE = '#C3BDB2'
const MUTED = '#7A8590', MUTED_DK = '#96A0AA', RULE_DK = '#47535F'

fs.mkdirSync('out', { recursive: true })

// Outlined text run with tracking (em). Anchored at (x0, baseline).
// Returns { d, advance, bbox } where bbox is relative to (0, baseline=0).
function run(font, text, fontSize, trackingEm = 0) {
  const scale = fontSize / font.unitsPerEm
  const tracking = trackingEm * fontSize
  let x = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const segs = []
  for (const ch of text) {
    const glyph = font.charToGlyph(ch)
    const p = glyph.getPath(x, 0, fontSize)
    const b = p.getBoundingBox()
    if (isFinite(b.x1) && (b.x1 !== 0 || b.x2 !== 0 || ch !== ' ')) {
      minX = Math.min(minX, b.x1); maxX = Math.max(maxX, b.x2)
      minY = Math.min(minY, b.y1); maxY = Math.max(maxY, b.y2)
    }
    segs.push({ glyph, x })
    x += glyph.advanceWidth * scale + tracking
  }
  const advance = x - tracking
  return {
    advance,
    bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
    at(x0, baseline) {
      // Serialise commands ourselves — this opentype.js build's toPathData
      // can emit NaN coordinates via its optimise pass.
      const fmt = v => (Math.round(v * 1000) / 1000).toString()
      return segs.map(s => s.glyph.getPath(x0 + s.x, baseline, fontSize).commands.map(c => {
        if (c.type === 'M') return `M${fmt(c.x)} ${fmt(c.y)}`
        if (c.type === 'L') return `L${fmt(c.x)} ${fmt(c.y)}`
        if (c.type === 'C') return `C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`
        if (c.type === 'Q') return `Q${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x)} ${fmt(c.y)}`
        return 'Z'
      }).join('')).join(' ')
    },
  }
}

// Place a run so its ink bbox is vertically centred inside a box.
function baselineFor(runObj, boxTop, boxH) {
  const { minY, h } = runObj.bbox
  return boxTop + (boxH - h) / 2 - minY
}

// ── Icon tile ──────────────────────────────────────────────────────────────
function iconSvg(size, radius, glyphSize, { circle = false, mono = false } = {}) {
  const r = run(archivo700, 'P', glyphSize, -0.04)
  const nudge = size <= 64 ? 0.5 : size * 0.008
  const x0 = (size - r.bbox.w) / 2 - r.bbox.minX + nudge
  const baseline = baselineFor(r, 0, size)
  const shape = circle
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${INK}"/>`
    : `<rect width="${size}" height="${size}" rx="${radius}" fill="${INK}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${shape}<path d="${r.at(x0, baseline)}" fill="${mono ? PAPER : SIGNAL}"/></svg>`
}

// ── Horizontal lockups ────────────────────────────────────────────────────
function lockupSvg(H, { reversed = false, mono = false, descriptor = false, short = false } = {}) {
  const radius = 0.23 * H
  const glyphSize = 0.625 * H
  const wordSize = 0.625 * H
  const gap = short ? (11 / 34) * H : 0.30 * H
  const stackGap = 0.125 * H
  const endSize = descriptor ? (8.5 / 25) * wordSize : 0.36 * wordSize
  const endTracking = descriptor ? 0.14 : 0.12
  const endText = descriptor ? 'PROPERTY PORTFOLIOS, PROPERLY' : 'ownproperly.com'
  const wordColor = reversed ? PAPER : INK
  const pColor = mono ? PAPER : SIGNAL
  const ruleColor = reversed ? RULE_DK : RULE
  const endColor = reversed ? MUTED_DK : MUTED
  const ruleH = Math.max(1, H / 40)

  const glyphRun = run(archivo700, 'P', glyphSize, -0.04)
  const wordRun = run(archivo600, 'Properly', wordSize, -0.03)
  const endRun = short ? null : run(plex400, endText, endSize, endTracking)

  const stackH = short ? wordSize : wordSize + stackGap + ruleH + stackGap + endSize
  const svgH = Math.ceil(Math.max(H, stackH))
  const tileTop = (svgH - H) / 2
  const stackTop = (svgH - stackH) / 2
  const textX = H + gap

  const gx = tileTop /*0 for x*/ , _ = 0
  const glyphX = (H - glyphRun.bbox.w) / 2 - glyphRun.bbox.minX + (H <= 64 ? 0.5 : H * 0.008)
  const glyphBaseline = baselineFor(glyphRun, tileTop, H)

  const tileShape = reversed
    ? `<rect x="0.75" y="${tileTop + 0.75}" width="${H - 1.5}" height="${H - 1.5}" rx="${radius}" fill="${INK}" stroke="${SIGNAL}" stroke-width="1.25"/>`
    : `<rect y="${tileTop}" width="${H}" height="${H}" rx="${radius}" fill="${INK}"/>`

  let inner = `${tileShape}<path d="${glyphRun.at(glyphX, glyphBaseline)}" fill="${pColor}"/>`
  let svgW

  if (short) {
    const wBaseline = baselineFor(wordRun, stackTop, wordSize)
    inner += `<path d="${wordRun.at(textX, wBaseline)}" fill="${wordColor}"/>`
    svgW = Math.ceil(textX + wordRun.advance)
  } else {
    const wBaseline = baselineFor(wordRun, stackTop, wordSize)
    const ruleY = stackTop + wordSize + stackGap
    const eBaseline = baselineFor(endRun, ruleY + ruleH + stackGap, endSize)
    inner += `<path d="${wordRun.at(textX, wBaseline)}" fill="${wordColor}"/>`
    inner += `<rect x="${textX}" y="${ruleY}" width="${wordRun.advance}" height="${ruleH}" fill="${ruleColor}"/>`
    inner += `<path d="${endRun.at(textX, eBaseline)}" fill="${endColor}"/>`
    svgW = Math.ceil(textX + Math.max(wordRun.advance, endRun.advance)) + 1
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">${inner}</svg>`, w: svgW, h: svgH }
}

// ── Stacked lockup (OG image) ─────────────────────────────────────────────
function stackedSvg(tile, { reversed = true } = {}) {
  const radius = 0.23 * tile
  const glyphSize = 0.625 * tile
  const wordSize = 0.5 * tile      // stacked spec: 46 tile → 23 wordmark
  const endSize = (8.5 / 23) * wordSize
  const gapBelowTile = (12 / 46) * tile
  const stackGap = 5 * (tile / 46)
  const ruleH = Math.max(1, tile / 46)

  const glyphRun = run(archivo700, 'P', glyphSize, -0.04)
  const wordRun = run(archivo600, 'Properly', wordSize, -0.03)
  const endRun = run(plex400, 'ownproperly.com', endSize, 0.12)

  const totalW = Math.ceil(Math.max(tile, wordRun.advance, endRun.advance)) + 4
  const cx = totalW / 2
  const tileX = cx - tile / 2

  const glyphX = tileX + (tile - glyphRun.bbox.w) / 2 - glyphRun.bbox.minX + tile * 0.008
  const glyphBaseline = baselineFor(glyphRun, 0, tile)

  const wordTop = tile + gapBelowTile
  const wBaseline = baselineFor(wordRun, wordTop, wordSize)
  const ruleY = wordTop + wordSize + stackGap
  const eBaseline = baselineFor(endRun, ruleY + ruleH + stackGap, endSize)
  const totalH = Math.ceil(ruleY + ruleH + stackGap + endSize) + 2

  const border = Math.max(1.25, tile / 36)
  const tileShape = reversed
    ? `<rect x="${tileX + border / 2}" y="${border / 2}" width="${tile - border}" height="${tile - border}" rx="${radius}" fill="${INK}" stroke="${SIGNAL}" stroke-width="${border}"/>`
    : `<rect x="${tileX}" width="${tile}" height="${tile}" rx="${radius}" fill="${INK}"/>`

  const inner = `${tileShape}<path d="${glyphRun.at(glyphX, glyphBaseline)}" fill="${SIGNAL}"/>` +
    `<path d="${wordRun.at(cx - wordRun.advance / 2, wBaseline)}" fill="${reversed ? PAPER : INK}"/>` +
    `<rect x="${cx - wordRun.advance / 2}" y="${ruleY}" width="${wordRun.advance}" height="${ruleH}" fill="${reversed ? RULE_DK : RULE}"/>` +
    `<path d="${endRun.at(cx - endRun.advance / 2, eBaseline)}" fill="${reversed ? MUTED_DK : MUTED}"/>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">${inner}</svg>`, w: totalW, h: totalH }
}

async function main() {
  const iconSpecs = [
    [512, 118, 320, 'icon-512.png'],
    [192, 44, 120, 'icon-192.png'],
    [180, 41, 112, 'apple-touch-icon.png'],
    [64, 15, 40, 'icon-64.png'],
    [32, 8, 20, 'favicon-32.png'],
    [16, 4, 11, 'favicon-16.png'],
  ]
  for (const [size, radius, glyphSize, file] of iconSpecs) {
    await sharp(Buffer.from(iconSvg(size, radius, glyphSize))).png().toFile('out/' + file)
  }
  fs.writeFileSync('out/favicon.svg', iconSvg(32, 8, 20))
  await sharp(Buffer.from(iconSvg(512, 0, 320, { circle: true }))).png().toFile('out/avatar-512.png')

  fs.writeFileSync('out/lockup-primary.svg', lockupSvg(40).svg)
  fs.writeFileSync('out/lockup-reversed.svg', lockupSvg(40, { reversed: true }).svg)
  fs.writeFileSync('out/lockup-short.svg', lockupSvg(34, { short: true }).svg)

  // Email header PNG — primary lockup at 3x (tile 120), displayed ~40px tall
  await sharp(Buffer.from(lockupSvg(120).svg)).png().toFile('out/email-lockup@3x.png')

  // OG image 1200x630: navy ground, stacked reversed lockup, margins ≥ 12%
  const stack = stackedSvg(150, { reversed: true })
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${INK}"/><g transform="translate(${(1200 - stack.w) / 2}, ${(630 - stack.h) / 2})">${stack.svg.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g></svg>`
  await sharp(Buffer.from(og)).png().toFile('out/og-image.png')

  console.log('done')
}

module.exports = { iconSvg, lockupSvg, stackedSvg }
if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
