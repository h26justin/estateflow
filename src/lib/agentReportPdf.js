// ── AGENT WEEKLY REPORT PDF ─────────────────────────────────────────────────
// Draws the agent weekly report (agentReport.js) as the Rent Tracker page on
// paper: a heading, then for each company its logo and name with the year's
// totals, then a card per property (grouped under a building header where
// units share a building) with its rent, due day, the twelve month tiles,
// its status pill, the paid / due / missed / n/c counts, what came in this
// year and anything owed.
//
// drawAgentReportPdf() takes the jsPDF constructor and pre-loaded images, so
// the browser (jsPDF from the CDN) and the agent-weekly-report edge function
// (jsPDF from esm.sh) draw exactly the same document. White paper and the
// report kit palette, built-in Helvetica only.

import { loadCdnScript } from './loadCdnScript'
import { PALETTE as P, fitBox, hexToRgb, mix, loadPdfImage } from './reportPdfKit'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

const WHITE = [255, 255, 255]
const hex = h => hexToRgb(h)
// Month tile colours: the light-theme status pairs the Rent Tracker uses
// (styles.js STATUS, App.jsx STL_PAIR), as [text, fill].
const TILE = {
  paid:            [hex('#147A49'), hex('#E8F4EC')],
  due:             [hex('#8A5600'), hex('#FBF1E2')],
  part_paid:       [hex('#8A5600'), hex('#FBF1E2')],
  missed:          [hex('#A83328'), hex('#FAEAE8')],
  not_collectible: [hex('#5C6168'), hex('#F1F0EC')],
  stl:             [hex('#6E44B8'), hex('#F0EAFB')],
}
// Legacy (pre go-live) months keep their old status colour.
const LEGACY_KEY = { paid: 'paid', overdue: 'missed', missed: 'missed', late: 'due', partial: 'due' }
// Status pills, light versions of the tracker's STATUS_CFG.
const PILL = {
  rented:           hex('#147A49'),
  short_term_let:   hex('#6E44B8'),
  notice_given:     hex('#8A5600'),
  let_agreed:       hex('#8A6A12'),
  on_rental_market: hex('#1F7F8C'),
  vacant:           hex('#A83328'),
  refurb:           hex('#2D6FA8'),
}
const ORANGE = hex('#E0943A')
const CURRENT = hex('#B8902F')
const COUNT_COLOR = { paid: TILE.paid[0], due: TILE.due[0], missed: TILE.missed[0], nc: P.faint, backfill: ORANGE }
// A company's brand colour for its pages. Very light colours would vanish on
// white paper, so they fall back to Properly gold.
function brandColour(h) {
  const c = hexToRgb(h)
  if (!c) return P.gold
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
  return lum > 0.8 ? P.gold : c
}

const money0 = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// Locale-free date formatting: Deno's Intl data is not guaranteed to match
// the browser's, and the email must read the same as the download.
const parts = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() } }
export const dateShort = iso => { if (!iso) return '-'; const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]} ${p.y}` }
export const dateLong = iso => { const p = parts(iso); return `${DAYS[p.dow]} ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}` }

// Helvetica only has Latin-1 glyphs.
const clean = s => String(s ?? '')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[•·]/g, '-')
  .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/ {2,}/g, ' ').trim()

export function agentReportFilename(model) {
  const who = clean(model.agent?.name || 'Agent').replace(/[^A-Za-z0-9]+/g, ' ').trim()
  return `${who} rent report ${model.asOf}.pdf`
}

/**
 * Draw the report. Returns the jsPDF document.
 * @param {Function} JsPDF  the jsPDF constructor
 * @param {object}   model  buildAgentReport() output
 * @param {object}  [opts]
 * @param {object}  [opts.logos]  { [companyId]: { data, w, h } } PNG data URLs
 * @param {object}  [opts.mark]   the Properly icon, same shape
 */
export function drawAgentReportPdf(JsPDF, model, { logos = {}, mark = null } = {}) {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 12, CW = W - M * 2, BOTTOM = H - 16
  const s = model.summary
  let y = 0

  const font = (size, style = 'normal', color = P.ink) => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color) }
  const text = (str, x, yy, o) => doc.text(clean(str), x, yy, o)
  const fit = (str, w) => doc.splitTextToSize(clean(str), Math.max(w, 4))[0] || ''
  const width = str => doc.getTextWidth(clean(str))
  const img = (im, x, yy, w, h) => { try { doc.addImage(im.data, 'PNG', x, yy, w, h, undefined, 'FAST') } catch (_) { /* unreadable image */ } }
  // The page's brand colour: Properly gold on the cover, the company's own
  // colour on its pages.
  let brand = P.gold
  const paper = () => { doc.setFillColor(...WHITE); doc.rect(0, 0, W, H, 'F'); doc.setFillColor(...brand); doc.rect(0, 0, W, 3, 'F') }
  let onNewPage = null
  const newPage = () => { doc.addPage(); paper(); y = 10; if (onNewPage) onNewPage() }
  const ensure = h => { if (y + h > BOTTOM) newPage() }

  // Diagonal hatching inside a rectangle (the tracker's hatched tiles).
  function hatch(x, yy, w, h, color, step = 1.5) {
    doc.setDrawColor(...color); doc.setLineWidth(0.2)
    for (let k = -h; k < w; k += step) {
      let sx = x + k, sy = yy + h, ex = x + k + h, ey = yy
      if (sx < x) { sy -= (x - sx); sx = x }
      if (ex > x + w) { ey += (ex - (x + w)); ex = x + w }
      if (sx < ex) doc.line(sx, sy, ex, ey)
    }
  }

  // Right-to-left run of coloured "N label" items ending at xr.
  function countRun(items, xr, yy, size, gap = 3.2) {
    let x = xr
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      font(size, it.bold ? 'bold' : 'normal', it.color)
      text(it.t, x, yy, { align: 'right' })
      x -= width(it.t) + gap
    }
    return x
  }

  function tile(x, yy, w, h, m) {
    if (m.future) {
      hatch(x, yy, w, h, mix(P.faint, WHITE, 0.25))
      doc.setDrawColor(...mix(P.faint, WHITE, 0.55)); doc.setLineWidth(0.2)
      doc.setLineDashPattern([0.7, 0.6], 0); doc.roundedRect(x, yy, w, h, 1.2, 1.2, 'S'); doc.setLineDashPattern([], 0)
      font(5.8, 'bold', mix(P.faint, WHITE, 0.6)); text(m.label, x + w / 2, yy + h / 2 + 1, { align: 'center' })
      return
    }
    const key = m.state === 'legacy' ? (LEGACY_KEY[m.legacyStatus] || 'not_collectible') : m.state
    const pair = TILE[key]
    if (!pair) {
      // No rent row for the month: an empty outline keeps the row aligned.
      doc.setDrawColor(...P.rule); doc.setLineWidth(0.2); doc.roundedRect(x, yy, w, h, 1.2, 1.2, 'S')
      font(5.8, 'bold', mix(P.faint, WHITE, 0.6)); text(m.label, x + w / 2, yy + h / 2 + 1, { align: 'center' })
      return
    }
    const [ink, fill] = pair
    doc.setFillColor(...fill); doc.roundedRect(x, yy, w, h, 1.2, 1.2, 'F')
    if (key === 'not_collectible') hatch(x + 0.3, yy + 0.3, w - 0.6, h - 0.6, mix(ink, WHITE, 0.22))
    if (m.current) { doc.setDrawColor(...CURRENT); doc.setLineWidth(0.55) }
    else { doc.setDrawColor(...mix(ink, WHITE, 0.33)); doc.setLineWidth(0.2) }
    doc.roundedRect(x, yy, w, h, 1.2, 1.2, 'S')
    if (m.state === 'legacy') { doc.setDrawColor(...mix(ink, WHITE, 0.55)); doc.setLineWidth(0.3); doc.setLineDashPattern([0.4, 0.4], 0); doc.line(x + 1, yy + h - 0.4, x + w - 1, yy + h - 0.4); doc.setLineDashPattern([], 0) }
    if (m.label) { font(5.8, 'bold', ink); text(m.label, x + w / 2, yy + h / 2 + 1, { align: 'center' }) }
    if (m.needsBackfill) { doc.setFillColor(...ORANGE); doc.circle(x + w - 1.2, yy + 1.1, 0.65, 'F') }
    if (m.override) { doc.setDrawColor(...ink); doc.setLineWidth(0.25); doc.circle(x + w - 1.2, yy + h - 1.1, 0.6, 'S') }
  }

  function pill(label, color, xr, yy) {
    font(6.6, 'bold', color)
    const w = width(label) + 6.4, h = 4.4, x = xr - w
    doc.setFillColor(...mix(color, WHITE, 0.12)); doc.roundedRect(x, yy, w, h, 2.2, 2.2, 'F')
    doc.setDrawColor(...mix(color, WHITE, 0.3)); doc.setLineWidth(0.2); doc.roundedRect(x, yy, w, h, 2.2, 2.2, 'S')
    doc.setFillColor(...color); doc.circle(x + 2.3, yy + h / 2, 0.6, 'F')
    font(6.6, 'bold', color); text(label, x + 3.7, yy + 3.05)
  }

  // ── Heading ─────────────────────────────────────────────────────────
  paper()
  y = 9
  let tx = M
  if (mark) { const b = fitBox(mark.w, mark.h, 11, 11); img(mark, M, y + 1, b.w, b.h); tx = M + b.w + 4 }
  font(16, 'bold'); text('Rent tracker report', tx, y + 6.5)
  font(9.5, 'normal', P.muted)
  text(`${model.agent?.name || 'Agent'} - ${s.units} ${s.units === 1 ? 'property' : 'properties'} - ${model.year}`, tx, y + 11.5)
  font(8, 'normal', P.faint)
  text(dateLong(model.asOf), W - M, y + 5, { align: 'right' })
  text('Prepared by Properly', W - M, y + 9.4, { align: 'right' })
  y += 16
  doc.setDrawColor(...P.border); doc.setLineWidth(0.25); doc.line(M, y, W - M, y)
  doc.setFillColor(...P.gold); doc.rect(M, y - 0.5, 28, 1, 'F')
  y += 5

  // One line of headline figures.
  const head = [
    { t: `${s.letUnits} of ${s.units} let`, color: TILE.paid[0] },
    { t: `${s.notLetUnits} not let`, color: s.notLetUnits ? TILE.due[0] : P.faint },
    { t: `${model.thisMonth.label} rent in ${money0(s.received)} of ${money0(s.expected)}`, color: P.ink },
    { t: s.owed + s.arrears > 0 ? `Owed ${money0(s.owed + s.arrears)} across ${s.owingCount} ${s.owingCount === 1 ? 'property' : 'properties'}` : 'Nothing owed', color: s.owed + s.arrears > 0 ? TILE.missed[0] : TILE.paid[0] },
  ]
  let hx = M
  head.forEach(h => { font(8.2, 'bold', h.color); text(h.t, hx, y + 3.2); hx += width(h.t) + 7 })
  y += 7

  // Key, as on the tracker.
  let kx = M
  for (const [k, l] of [['paid', 'Paid'], ['due', 'Due / part paid'], ['missed', 'Missed'], ['not_collectible', 'Not collectible (hatched)'], ['stl', 'Short-term let']]) {
    tile(kx, y, 6, 3.6, { label: '', state: k })
    font(6.4, 'normal', P.muted); text(l, kx + 7.2, y + 2.7); kx += 7.2 + width(l) + 5
  }
  doc.setFillColor(...ORANGE); doc.circle(kx + 1, y + 1.8, 0.8, 'F')
  font(6.4, 'normal', P.muted); text('Paid, amount needed', kx + 2.8, y + 2.7); kx += 2.8 + width('Paid, amount needed') + 5
  doc.setDrawColor(...CURRENT); doc.setLineWidth(0.55); doc.roundedRect(kx, y, 6, 3.6, 0.8, 0.8, 'S')
  font(6.4, 'normal', P.muted); text('This month', kx + 7.2, y + 2.7)
  y += 6
  font(6.4, 'normal', P.muted)
  text('Under each property: the last 4 months, rent collected of rent due. Red = shortfall (window closed), amber = still in its window, * = paid, no amount entered.', M, y + 2.7)
  y += 8

  // ── Cover: one line per company ─────────────────────────────────────
  const coverRow = (cells, yy, bold, color) => {
    const xs = [M + 4, M + 92, M + 118, M + 140, M + 162, W - M - 4]
    cells.forEach((c, i) => {
      if (c == null) return
      const v = typeof c === 'object' ? c : { t: c }
      font(bold ? 6.6 : 8, bold ? 'bold' : (v.bold ? 'bold' : 'normal'), v.color || color || P.slate)
      text(i === 0 ? fit(v.t, 84) : v.t, xs[i], yy, i === 0 ? undefined : { align: 'right' })
    })
  }
  doc.setFillColor(...P.head); doc.rect(M, y, CW, 7, 'F')
  coverRow(['COMPANY', 'PROPERTIES', 'LET', 'NOT LET', `${model.year} IN`, 'OWED'], y + 4.6, true, P.muted)
  y += 7
  for (const g of model.byCompany) {
    const accent = brandColour(g.color)
    const let_ = g.cards.filter(c => c.let).length
    doc.setDrawColor(...P.rule); doc.setLineWidth(0.2); doc.line(M, y + 8, W - M, y + 8)
    doc.setFillColor(...accent); doc.rect(M, y + 1.6, 1.2, 4.8, 'F')
    coverRow([{ t: g.company, bold: true, color: P.ink }, String(g.cards.length), { t: String(let_), color: TILE.paid[0] },
      { t: String(g.cards.length - let_), color: g.cards.length - let_ ? TILE.due[0] : P.faint },
      { t: money0(g.received), color: P.gold, bold: true },
      { t: g.owed > 0 ? money0(g.owed) : '-', color: g.owed > 0 ? TILE.missed[0] : P.faint, bold: g.owed > 0 }], y + 5.2)
    y += 8
  }
  font(7, 'normal', P.faint)
  text('Each company starts on its own page.', M, y + 6)

  // ── Company pages ───────────────────────────────────────────────────
  const TW = 10.6, TH = 6.4, TG = 1.0          // month tiles
  const CARD_H = 29
  const RIGHT = W - M - 4
  let accent = P.gold, tint = P.tile, tintSoft = [251, 250, 247]

  // First page of a company: the logo large and centred, the name and the
  // year's totals under it, all in the company's colour.
  function companyTitle(g) {
    let yy = 14
    const logo = logos[g.companyId]
    if (logo) {
      const b = fitBox(logo.w, logo.h, 70, 38)
      img(logo, (W - b.w) / 2, yy, b.w, b.h)
      yy += b.h + 7
    } else yy += 4
    font(17, 'bold', P.ink); text(g.company, W / 2, yy + 4, { align: 'center' })
    font(8.5, 'normal', P.muted)
    const let_ = g.cards.filter(c => c.let).length
    text(`${g.cards.length} ${g.cards.length === 1 ? 'property' : 'properties'} - ${let_} let - rent tracker ${model.year}`, W / 2, yy + 10, { align: 'center' })
    yy += 16
    // Totals, centred.
    const items = [
      ...[['paid', 'paid'], ['due', 'due'], ['missed', 'missed'], ['nc', 'not collectible'], ['backfill', 'need amount']]
        .filter(([k]) => g.counts[k] > 0).map(([k, l]) => ({ t: `${g.counts[k]} ${l}`, color: COUNT_COLOR[k] })),
      { t: `${money0(g.received)} received`, color: P.gold },
      ...(g.owed > 0 ? [{ t: `${money0(g.owed)} owed`, color: TILE.missed[0] }] : []),
    ]
    font(8, 'bold'); const runW = items.reduce((w, it) => w + width(it.t), 0) + (items.length - 1) * 5
    doc.setFillColor(...tint); doc.roundedRect(M, yy, CW, 9, 2, 2, 'F')
    let x = (W - runW) / 2
    items.forEach(it => { font(8, 'bold', it.color); text(it.t, x, yy + 5.9); x += width(it.t) + 5 })
    yy += 13
    doc.setFillColor(...accent); doc.rect(M, yy, CW, 0.8, 'F')
    y = yy + 4
  }

  // Following pages: a slim running head so the reader knows whose page it is.
  function companyRunningHead(g) {
    const logo = logos[g.companyId]
    let x = M
    if (logo) { const b = fitBox(logo.w, logo.h, 16, 8); img(logo, M, 6.5 + (8 - b.h) / 2, b.w, b.h); x = M + b.w + 3 }
    font(9.5, 'bold', P.ink); text(g.company, x, 12)
    const cx = x + width(g.company) + 3
    font(7, 'normal', P.muted); text('continued', cx, 12)
    doc.setFillColor(...accent); doc.rect(M, 16, CW, 0.6, 'F')
    y = 19
  }

  // Last 4 months under a property's tiles: one box per month, each three
  // tiles wide, reading "Sep  \u00A3400 of \u00A3477" with any shortfall in red.
  function recentStrip(recent, x, yy) {
    const bw = 3 * (TW + TG) - TG, bh = 5.4
    recent.forEach((r, i) => {
      const bx = x + i * (bw + TG)
      const short = r.shortfall > 0, open = r.stillDue > 0
      doc.setFillColor(...(short ? TILE.missed[1] : open ? TILE.due[1] : r.due > 0 ? TILE.paid[1] : P.tile)); doc.roundedRect(bx, yy, bw, bh, 1, 1, 'F')
      font(5.9, 'bold', P.ink); text(r.label, bx + 1.6, yy + 3.7)
      font(5.9, 'normal', P.slate)
      text(r.due > 0 ? `${money0(r.collected)} of ${money0(r.due)}${r.assumed ? '*' : ''}` : (r.collected > 0 ? `${money0(r.collected)} in` : 'nothing due'), bx + 8, yy + 3.7)
      if (short) { font(5.9, 'bold', TILE.missed[0]); text(`-${money0(r.shortfall)}`, bx + bw - 1.4, yy + 3.7, { align: 'right' }) }
      else if (open) { font(5.9, 'bold', TILE.due[0]); text('due', bx + bw - 1.4, yy + 3.7, { align: 'right' }) }
    })
  }

  // Company box: due, collected and shortfall for each of the last 4 months.
  function recentTable(g) {
    const rows = [['Rent due', 'due', P.ink], ['Collected', 'collected', TILE.paid[0]], ['Still in window', 'stillDue', TILE.due[0]], ['Shortfall', 'shortfall', TILE.missed[0]]]
    const labelW = 34, colW = (CW - labelW - 8) / 5
    const h = 7 + rows.length * 6 + 2
    doc.setDrawColor(...mix(accent, WHITE, 0.4)); doc.setLineWidth(0.3); doc.roundedRect(M, y, CW, h, 2, 2, 'S')
    doc.setFillColor(...tint); doc.roundedRect(M, y, CW, 7, 2, 2, 'F'); doc.rect(M, y + 4, CW, 3, 'F')
    font(6.8, 'bold', P.muted); text('LAST 4 MONTHS', M + 4, y + 4.7)
    const totals = { due: 0, collected: 0, shortfall: 0, stillDue: 0 }
    g.recent.forEach(r => { for (const k in totals) totals[k] += r[k] })
    const cols = [...g.recent.map(r => ({ head: `${r.label} ${r.year}${r.month === model.thisMonth.month && r.year === model.thisMonth.year ? ' (this month)' : ''}`, v: r })), { head: 'Total', v: totals }]
    cols.forEach((c, i) => { font(6.6, 'bold', P.muted); text(c.head, M + labelW + 4 + (i + 1) * colW, y + 4.7, { align: 'right' }) })
    rows.forEach(([label, k, color], ri) => {
      const ry = y + 7 + ri * 6 + 4.3
      if (ri) { doc.setDrawColor(...P.rule); doc.setLineWidth(0.15); doc.line(M + 3, ry - 4.3, W - M - 3, ry - 4.3) }
      font(7.6, 'bold', color); text(label, M + 4, ry)
      cols.forEach((c, i) => {
        const v = c.v[k]
        const gapRow = k === 'shortfall' || k === 'stillDue'
        font(7.8, i === cols.length - 1 || (gapRow && v > 0) ? 'bold' : 'normal', gapRow && !(v > 0) ? P.faint : color)
        text(gapRow && !(v > 0) ? '-' : money0(v), M + labelW + 4 + (i + 1) * colW, ry, { align: 'right' })
      })
    })
    y += h + 5
  }

  function buildingHeader(gr) {
    ensure(7 + CARD_H)
    doc.setFillColor(...tint); doc.rect(M, y, CW, 6.6, 'F')
    doc.setFillColor(...accent); doc.rect(M, y, 1, 6.6, 'F')
    font(7.6, 'bold'); text(gr.name, M + 5, y + 4.4)
    const nx = M + 5 + width(gr.name) + 2
    font(6.8, 'normal', P.muted); text(`- ${gr.cards.length} units - ${money0(gr.rent)}/mo`, nx, y + 4.4)
    const items = []
    if (gr.missed) items.push({ t: `${gr.missed} missed`, color: TILE.missed[0], bold: true })
    if (gr.due) items.push({ t: `${gr.due} due`, color: TILE.due[0], bold: true })
    items.push({ t: `${model.year} revenue`, color: P.muted }, { t: money0(gr.received), color: P.gold, bold: true })
    countRun(items, W - M - 5, y + 4.4, 6.8)
    y += 6.6
  }

  let stripe = 0
  function card(c, indent) {
    ensure(CARD_H)
    const x0 = M + (indent ? 5 : 0), w0 = CW - (indent ? 5 : 0)
    doc.setFillColor(...(stripe++ % 2 === 0 ? WHITE : tintSoft)); doc.rect(x0, y, w0, CARD_H, 'F')
    if (indent) { doc.setFillColor(...mix(accent, WHITE, 0.35)); doc.rect(x0, y, 0.6, CARD_H, 'F') }
    doc.setDrawColor(...P.rule); doc.setLineWidth(0.2); doc.line(x0, y + CARD_H, x0 + w0, y + CARD_H)

    const lx = x0 + 4
    font(8.8, 'bold'); text(fit(indent ? (c.name.split(',')[0].trim() || c.name) : c.name, 135 - (indent ? 5 : 0)), lx, y + 5.4)
    font(6.8, 'normal', P.muted); text(`${money0(c.rent)}/mo  -  Due ${c.dueDay || '-'}`, lx, y + 9.4)
    c.months.forEach((m, i) => tile(lx + i * (TW + TG), y + 11.8, TW, TH, m))
    if (!c.stl) recentStrip(c.recent, lx, y + 20.4)

    pill(c.letLabel, PILL[c.status] || P.muted, RIGHT, y + 2.4)
    const cnt = [['paid', 'paid'], ['due', 'due'], ['missed', 'missed'], ['nc', 'n/c']]
      .map(([k, l]) => ({ t: `${c.counts[k]} ${l}`, color: c.counts[k] > 0 ? COUNT_COLOR[k] : P.faint }))
    countRun(cnt, RIGHT, y + 10.6, 6.6, 2.6)
    font(9, 'bold', P.gold); text(money0(c.received), RIGHT, y + 15.6, { align: 'right' })
    const owed = c.owed + c.arrears
    if (owed > 0) {
      const bits = []
      if (c.owed > 0) bits.push(`${money0(c.owed)} owed (${c.missedMonths} ${c.missedMonths === 1 ? 'month' : 'months'})`)
      if (c.arrears > 0) bits.push(`${money0(c.arrears)} older arrears`)
      font(6.8, 'bold', TILE.missed[0]); text(bits.join('  -  '), RIGHT, y + 20, { align: 'right' })
    }
    y += CARD_H
  }

  for (const g of model.byCompany) {
    accent = brandColour(g.color)
    tint = mix(accent, WHITE, 0.08)
    tintSoft = mix(accent, WHITE, 0.035)
    brand = accent
    onNewPage = null
    newPage()
    companyTitle(g)
    recentTable(g)
    onNewPage = () => companyRunningHead(g)
    stripe = 0
    for (const gr of g.groups) {
      if (gr.building) buildingHeader(gr)
      for (const c of gr.cards) card(c, gr.building)
    }
    onNewPage = null
  }
  if (!model.byCompany.length) { font(9, 'normal', P.muted); text('No properties are managed by this agent.', M, y + 5) }

  // Footers.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    font(6.8, 'normal', P.faint)
    text(`Prepared for ${model.agent?.name || 'the agent'} by Properly - ownproperly.com - ${dateShort(model.asOf)}`, M, H - 7)
    text(`Page ${i} of ${pages}`, W - M, H - 7, { align: 'right' })
  }
  return doc
}

// Browser: load jsPDF and the logos, build and download.
// companyLogos: { [companyId]: logo_url }
export async function downloadAgentReportPdf(model, companyLogos = {}) {
  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const ids = [...new Set(model.byCompany.map(g => g.companyId).filter(id => companyLogos[id]))]
  const [mark, ...imgs] = await Promise.all([loadPdfImage('/icon-512.png', 256), ...ids.map(id => loadPdfImage(companyLogos[id], 600))])
  const logos = {}
  ids.forEach((id, i) => { if (imgs[i]) logos[id] = imgs[i] })
  const doc = drawAgentReportPdf(window.jspdf.jsPDF, model, { logos, mark })
  doc.save(agentReportFilename(model))
}
