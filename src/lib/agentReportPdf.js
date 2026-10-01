// ── AGENT WEEKLY REPORT PDF ─────────────────────────────────────────────────
// Draws the agent weekly report (agentReport.js) as an A4 PDF:
//
//   summary   (portrait) headline figures, then the two lists the agent acts
//             on: every property owing rent and every property not let
//   tracker   (landscape) the Rent Tracker for every property: status, rent,
//             one tile per month since go-live with what came in, and owed
//
// drawAgentReportPdf() takes the jsPDF constructor, so the browser (jsPDF from
// the CDN) and the agent-weekly-report edge function (jsPDF from esm.sh) draw
// exactly the same document. Same look as the Reports and loan PDFs: cream
// paper, white cards, gold accent, built-in Helvetica only.

import { loadCdnScript } from './loadCdnScript'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

const CREAM  = [244, 243, 239]
const WHITE  = [255, 255, 255]
const BORDER = [228, 225, 217]
const GOLD   = [184, 144, 47]
const DARK   = [28, 40, 48]
const SLATE  = [20, 32, 42]
const MUTED  = [92, 102, 112]
const FAINT  = [104, 109, 114]
const GREEN  = [31, 157, 99]
const AMBER  = [196, 126, 20]
const RED    = [184, 57, 45]
const PURPLE = [112, 84, 170]

// Rent Tracker tile colours: light fill, dark ink.
const TILE = {
  paid:      { fill: [217, 240, 227], ink: [22, 110, 70] },
  due:       { fill: [232, 231, 226], ink: MUTED },
  part_paid: { fill: [250, 232, 200], ink: [140, 88, 10] },
  missed:    { fill: [246, 218, 214], ink: RED },
  stl:       { fill: [231, 224, 246], ink: PURPLE },
}
const LET_COLOR = { rented: GREEN, notice_given: AMBER, short_term_let: PURPLE, let_agreed: AMBER, on_rental_market: AMBER, vacant: RED, refurb: MUTED }

const money0 = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// Locale-free date formatting: Deno's Intl data is not guaranteed to match
// the browser's, and the email must read the same as the download.
const parts = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() } }
export const dateShort = iso => { if (!iso) return '-'; const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]} ${p.y}` }
export const dateLong = iso => { const p = parts(iso); return `${DAYS[p.dow]} ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}` }
const daysSince = (iso, asOf) => Math.round((Date.parse(String(asOf).slice(0, 10)) - Date.parse(String(iso).slice(0, 10))) / 86400000)

// Helvetica only has Latin-1 glyphs.
const clean = s => String(s ?? '')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[•·]/g, '-')
  .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/ {2,}/g, ' ').trim()

export function agentReportFilename(model) {
  const who = clean(model.agent?.name || 'Agent').replace(/[^A-Za-z0-9]+/g, ' ').trim()
  return `${who} weekly report ${model.asOf}.pdf`
}

// Short "since" text for a property that is not let.
function notLetSince(l, asOf) {
  if (l.vacantSince) { const d = daysSince(l.vacantSince, asOf); return d >= 0 ? `${dateShort(l.vacantSince)} (${d}d)` : dateShort(l.vacantSince) }
  return '-'
}

/**
 * Draw the report. Returns the jsPDF document.
 * @param {Function} JsPDF  the jsPDF constructor
 * @param {object}   model  buildAgentReport() output
 * @param {object}  [opts]
 * @param {string}  [opts.logo]  data URL of a PNG to put in the header
 */
export function drawAgentReportPdf(JsPDF, model, { logo = null } = {}) {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const s = model.summary
  let W = 210, H = 297
  const M = 12
  let CW = W - M * 2, BOTTOM = H - 16
  let y = 0

  const setFont = (size, style = 'normal', color = DARK) => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color) }
  const text = (str, x, yy, o) => doc.text(clean(str), x, yy, o)
  const fit = (str, w) => doc.splitTextToSize(clean(str), w)[0] || ''
  const card = (x, yy, w, h) => {
    doc.setFillColor(...WHITE); doc.roundedRect(x, yy, w, h, 2.5, 2.5, 'F')
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.roundedRect(x, yy, w, h, 2.5, 2.5, 'S')
  }
  const paper = () => { doc.setFillColor(...CREAM); doc.rect(0, 0, W, H, 'F'); doc.setFillColor(...GOLD); doc.rect(0, 0, W, 2.5, 'F') }
  const newPage = (orientation = 'portrait') => {
    doc.addPage('a4', orientation)
    W = orientation === 'landscape' ? 297 : 210; H = orientation === 'landscape' ? 210 : 297
    CW = W - M * 2; BOTTOM = H - 16
    paper(); y = 10
  }

  // ── Summary ───────────────────────────────────────────────────────────
  paper()
  card(M, 7, CW, 26)
  let tx = M + 7
  if (logo) { try { doc.addImage(logo, 'PNG', M + 5, 12, 11, 11); tx = M + 21 } catch (_) { /* bad image */ } }
  setFont(15, 'bold'); text('Weekly rent and lettings report', tx, 17)
  setFont(9.5, 'normal', MUTED)
  text(`${model.agent?.name || 'Agent'} - ${s.units} ${s.units === 1 ? 'property' : 'properties'}`, tx, 23.5)
  setFont(8, 'normal', FAINT)
  text(dateLong(model.asOf), W - M - 6, 16.5, { align: 'right' })
  text(`Rent tracker position for ${model.thisMonth.label}`, W - M - 6, 22.5, { align: 'right' })
  doc.setFillColor(...GOLD); doc.rect(M, 31.5, CW, 0.9, 'F')
  y = 39

  const kpis = [
    { label: 'Let', value: `${s.letUnits} of ${s.units}`, sub: s.occupancy == null ? '' : `${s.occupancy}% occupancy`, color: GREEN },
    { label: `${model.thisMonth.label} rent in`, value: `${money0(s.received)} of ${money0(s.expected)}`, sub: s.rate == null ? 'nothing due yet' : `${s.rate}% of the month's rent`, color: DARK },
    { label: 'Rent owed', value: money0(s.owed + s.arrears), sub: s.owingCount ? `${s.owingCount} ${s.owingCount === 1 ? 'property' : 'properties'} overdue` : 'nothing overdue', color: s.owed + s.arrears > 0 ? RED : GREEN },
    { label: 'Not let', value: String(s.notLetUnits), sub: notLetBreakdown(model.notLet), color: s.notLetUnits > 0 ? AMBER : GREEN },
  ]
  const gap = 4, kw = (CW - gap * 3) / 4
  kpis.forEach((k, j) => {
    const x = M + j * (kw + gap)
    card(x, y, kw, 19)
    doc.setFillColor(...k.color); doc.rect(x, y + 3, 1.2, 13, 'F')
    setFont(6.3, 'normal', MUTED); text(k.label.toUpperCase(), x + 4.5, y + 6.2)
    setFont(11.5, 'bold', k.color); text(fit(k.value, kw - 7), x + 4.5, y + 12.2)
    if (k.sub) { setFont(6.3, 'normal', FAINT); text(fit(k.sub, kw - 7), x + 4.5, y + 16.3) }
  })
  y += 25

  function heading(str, sub) {
    if (y + 30 > BOTTOM) newPage()
    setFont(10, 'bold'); text(str, M, y + 4)
    if (sub) { setFont(7.5, 'normal', MUTED); text(sub, W - M, y + 4, { align: 'right' }) }
    doc.setFillColor(...GOLD); doc.rect(M, y + 6.2, 24, 0.8, 'F')
    y += 10
  }

  // Full-width table that carries on over pages: cols [{label, w, align}],
  // rows [[cell | {v, color, bold}]]
  function table(cols, rows, { rh = 5.6, emptyText = '' } = {}) {
    const cellX = (xs, i, align) => align === 'right' ? xs[i] + cols[i].w * CW - 3 : xs[i] + 3
    const head = () => {
      const xs = []; let acc = M
      cols.forEach(c => { xs.push(acc); acc += c.w * CW })
      card(M, y, CW, 7)
      setFont(6.5, 'bold', MUTED)
      cols.forEach((c, i) => text(c.label.toUpperCase(), cellX(xs, i, c.align), y + 4.7, c.align === 'right' ? { align: 'right' } : undefined))
      y += 8.6
      return xs
    }
    let xs = head()
    if (!rows.length) { setFont(8, 'normal', MUTED); text(emptyText, M + 3, y + 3); y += 9; return }
    rows.forEach((r, ri) => {
      if (y + rh > BOTTOM) { newPage(); xs = head() }
      if (ri % 2 === 0) { doc.setFillColor(...WHITE); doc.rect(M, y - 1.3, CW, rh, 'F') }
      r.forEach((cell, i) => {
        const c = typeof cell === 'object' && cell !== null ? cell : { v: cell }
        setFont(7.8, c.bold ? 'bold' : 'normal', c.color || SLATE)
        text(fit(c.v ?? '', cols[i].w * CW - 5), cellX(xs, i, cols[i].align), y + 2.9, cols[i].align === 'right' ? { align: 'right' } : undefined)
      })
      y += rh
    })
    y += 6
  }

  heading('Rent owed', 'collectible rent still unpaid after its payment window')
  table([
    { label: 'Property', w: 0.33 }, { label: 'Company', w: 0.24 }, { label: 'Rent pcm', w: 0.10, align: 'right' },
    { label: 'Months missed', w: 0.11, align: 'right' }, { label: 'Owed', w: 0.10, align: 'right' }, { label: 'Older arrears', w: 0.12, align: 'right' },
  ], model.owing.map(l => [
    { v: l.name, bold: true }, l.company,
    { v: l.rent > 0 ? money0(l.rent) : '-', color: MUTED },
    l.missedMonths ? String(l.missedMonths) : '-',
    { v: l.owed > 0 ? money0(l.owed) : '-', color: l.owed > 0 ? RED : MUTED, bold: l.owed > 0 },
    { v: l.arrears > 0 ? money0(l.arrears) : '-', color: l.arrears > 0 ? AMBER : MUTED },
  ]), { emptyText: 'Nothing overdue. Every collectible month is paid.' })

  heading('Not let', 'vacant, on the market, let agreed or in refurb')
  table([
    { label: 'Property', w: 0.33 }, { label: 'Company', w: 0.24 },
    { label: 'Status', w: 0.15 }, { label: 'Empty since', w: 0.17 }, { label: 'Rent pcm', w: 0.11, align: 'right' },
  ], model.notLet.map(l => [
    { v: l.name, bold: true }, l.company,
    { v: l.letLabel, color: LET_COLOR[l.status] || MUTED, bold: true },
    notLetSince(l, model.asOf),
    { v: l.rent > 0 ? money0(l.rent) : '-', color: MUTED },
  ]), { emptyText: 'Every property is let.' })

  const notice = model.lines.filter(l => l.status === 'notice_given')
  if (notice.length) {
    heading('Notice given', 'still let, tenant leaving')
    table([
      { label: 'Property', w: 0.33 }, { label: 'Company', w: 0.24 }, { label: 'Leaving', w: 0.28 }, { label: 'Rent pcm', w: 0.15, align: 'right' },
    ], notice.map(l => [{ v: l.name, bold: true }, l.company, l.tenancyEnd ? dateShort(l.tenancyEnd) : 'date not recorded', { v: l.rent > 0 ? money0(l.rent) : '-', color: MUTED }]))
  }

  // ── Tracker (landscape) ──────────────────────────────────────────────
  const months = model.months || []
  const fixed = [{ key: 'name', label: 'Property', w: 64 }, { key: 'let', label: 'Status', w: 24 }, { key: 'rent', label: 'Rent pcm', w: 17, align: 'right' }]
  const owedW = 20
  const RH = 5.2
  let cellW = 0
  const trackerHead = () => {
    setFont(11, 'bold'); text('Rent tracker', M, y + 4)
    setFont(7.5, 'normal', MUTED)
    text('Each tile is the month the rent is for, showing what came in. Owed = unpaid after the payment window, plus older arrears.', W - M, y + 4, { align: 'right' })
    doc.setFillColor(...GOLD); doc.rect(M, y + 6.2, 24, 0.8, 'F')
    y += 10
    cellW = (CW - fixed.reduce((a, c) => a + c.w, 0) - owedW) / Math.max(1, months.length)
    card(M, y, CW, 6.5)
    setFont(6.2, 'bold', MUTED)
    let x = M
    for (const c of fixed) { text(c.label.toUpperCase(), c.align === 'right' ? x + c.w - 2.5 : x + 2.5, y + 4.3, c.align === 'right' ? { align: 'right' } : undefined); x += c.w }
    for (const mo of months) { text(`${mo.label}${mo.month === 1 || mo === months[0] ? ` ${String(mo.year).slice(2)}` : ''}`.toUpperCase(), x + cellW / 2, y + 4.3, { align: 'center' }); x += cellW }
    text('OWED', x + owedW - 2.5, y + 4.3, { align: 'right' })
    y += 8
  }
  const tileText = t => {
    if (!t) return ''
    const amt = t.received > 0 ? money0(t.received) : ''
    switch (t.state) {
      case 'paid': return t.needsBackfill ? 'Paid' : (amt || 'Paid')
      case 'part_paid': return amt || 'Part'
      case 'missed': return amt || 'Missed'
      case 'due': return 'Due'
      case 'stl': return amt || '-'
      default: return '-'
    }
  }
  newPage('landscape')
  trackerHead()
  let ri = 0
  for (const g of model.byCompany) {
    if (y + RH * 2 > BOTTOM) { newPage('landscape'); trackerHead() }
    setFont(7, 'bold', GOLD); text(`${(g.company || 'No company').toUpperCase()}  (${g.lines.reduce((n, l) => n + l.rooms, 0)})`, M + 2.5, y + 2.6)
    y += RH
    for (const l of g.lines) {
      if (y + RH > BOTTOM) { newPage('landscape'); trackerHead() }
      if (ri++ % 2 === 0) { doc.setFillColor(...WHITE); doc.rect(M, y - 1.2, CW, RH, 'F') }
      let x = M
      setFont(6.8, 'bold', SLATE); text(fit(l.name, fixed[0].w - 4), x + 2.5, y + 2.4); x += fixed[0].w
      setFont(6.6, 'normal', LET_COLOR[l.status] || MUTED); text(fit(l.letLabel, fixed[1].w - 4), x + 2.5, y + 2.4); x += fixed[1].w
      setFont(6.6, 'normal', MUTED); text(l.rent > 0 ? money0(l.rent) : '-', x + fixed[2].w - 2.5, y + 2.4, { align: 'right' }); x += fixed[2].w
      for (const mo of months) {
        const t = l.grid?.[mo.key]
        const st = t && TILE[t.state]
        if (st) { doc.setFillColor(...st.fill); doc.roundedRect(x + 0.5, y - 0.9, cellW - 1, RH - 0.6, 0.8, 0.8, 'F') }
        setFont(5.9, t?.state === 'missed' ? 'bold' : 'normal', st ? st.ink : FAINT)
        text(fit(tileText(t) || '-', cellW - 1.5), x + cellW / 2, y + 2.4, { align: 'center' })
        x += cellW
      }
      const owed = l.owed + l.arrears
      setFont(6.8, owed > 0 ? 'bold' : 'normal', owed > 0 ? RED : FAINT)
      text(owed > 0 ? money0(owed) : '-', x + owedW - 2.5, y + 2.4, { align: 'right' })
      y += RH
    }
  }

  // Key under the tracker.
  if (y + 8 > BOTTOM + 6) { newPage('landscape') }
  y += 2
  let kx = M
  setFont(6.5, 'normal', MUTED)
  for (const [state, label] of [['paid', 'Paid in full'], ['due', 'Due, window still open'], ['part_paid', 'Part paid'], ['missed', 'Missed, window closed'], ['stl', 'Short-term let bookings']]) {
    doc.setFillColor(...TILE[state].fill); doc.roundedRect(kx, y - 2.2, 6, 3.2, 0.6, 0.6, 'F')
    text(label, kx + 7.5, y + 0.2); kx += 8 + doc.getTextWidth(label) + 6
  }
  text('- = nothing collectible (vacant, refurb, between tenancies)', kx, y + 0.2)

  // Footers.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight()
    setFont(6.8, 'normal', FAINT)
    text(`Prepared for ${model.agent?.name || 'the agent'} by Properly - ownproperly.com - ${dateShort(model.asOf)}`, M, ph - 7)
    text(`Page ${i} of ${pages}`, pw - M, ph - 7, { align: 'right' })
  }
  return doc
}

function notLetBreakdown(notLet) {
  const n = k => notLet.filter(l => l.status === k).reduce((s, l) => s + l.rooms, 0)
  const parts = [[n('vacant'), 'vacant'], [n('on_rental_market'), 'on market'], [n('let_agreed'), 'let agreed'], [n('refurb'), 'refurb']]
    .filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}`)
  return parts.join(', ') || 'all let'
}

// Browser: build and download.
export async function downloadAgentReportPdf(model) {
  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  let logo = null
  try {
    const r = await fetch('/icon-512.png')
    if (r.ok) {
      const b = await r.blob()
      logo = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b) })
    }
  } catch (_) { /* no logo */ }
  const doc = drawAgentReportPdf(window.jspdf.jsPDF, model, { logo })
  doc.save(agentReportFilename(model))
}
