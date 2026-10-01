// ── AGENT RENT REPORT PDF ───────────────────────────────────────────────────
// The weekly report for a letting agent (agentReport.js), built to be read in
// a minute and acted on:
//
//   page 1   the position: 2026 rent due vs collected, this month, the rent
//            roll and what empty properties cost, every status, and one line
//            per company
//   page 2+  what needs doing: rent owed (with the tenant to chase), every
//            property not let, notices given
//   then     each company on its own page in its brand colours: logo, its
//            figures, its statuses, and a one-line-per-property register
//            with the year's months as coloured squares
//   then     short-term lets: nights, occupancy, average nightly rate, income
//            after platform fees and after the manager's fee, month by month
//
// drawAgentReportPdf() takes the jsPDF constructor and pre-loaded images, so
// the browser (jsPDF from the CDN) and the agent-weekly-report edge function
// (jsPDF from esm.sh) draw exactly the same document. Built-in Helvetica only.

import { loadCdnScript } from './loadCdnScript'
import { PALETTE as P, fitBox, hexToRgb, mix, loadPdfImage } from './reportPdfKit'
import { GO_LIVE } from './rentEngine'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

const WHITE = [255, 255, 255]
const hex = h => hexToRgb(h)
// Month colours: the Rent Tracker's light-theme status pairs, [ink, fill].
const TILE = {
  paid:            [hex('#147A49'), hex('#CFEBDB')],
  due:             [hex('#8A5600'), hex('#F6E2BF')],
  part_paid:       [hex('#8A5600'), hex('#F6E2BF')],
  missed:          [hex('#A83328'), hex('#F2C9C3')],
  not_collectible: [hex('#5C6168'), hex('#E6E4DE')],
  stl:             [hex('#6E44B8'), hex('#E2D7F6')],
}
const LEGACY_KEY = { paid: 'paid', overdue: 'missed', missed: 'missed', late: 'due', partial: 'due' }
// Status colours, light versions of the tracker's STATUS_CFG.
const PILL = {
  rented:           hex('#147A49'),
  short_term_let:   hex('#6E44B8'),
  notice_given:     hex('#8A5600'),
  let_agreed:       hex('#8A6A12'),
  on_rental_market: hex('#1F7F8C'),
  vacant:           hex('#A83328'),
  refurb:           hex('#2D6FA8'),
}
const RED = TILE.missed[0], GREEN = TILE.paid[0], AMBER = TILE.due[0]
const CURRENT = hex('#B8902F')
const GO_LIVE_YEAR = GO_LIVE.slice(0, 4)

// A company's brand colour. Very light colours would vanish on white paper,
// so they fall back to Properly gold.
function brandColour(h) {
  const c = hexToRgb(h)
  if (!c) return P.gold
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
  return lum > 0.8 ? P.gold : c
}

const money0 = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const pct = n => (n == null ? '-' : `${Math.round(n)}%`)
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
  const monthLong = MONTHS_LONG[model.thisMonth.month - 1]
  let y = 0

  const font = (size, style = 'normal', color = P.ink) => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color) }
  const text = (str, x, yy, o) => doc.text(clean(str), x, yy, o)
  const fit = (str, w) => doc.splitTextToSize(clean(str), Math.max(w, 4))[0] || ''
  const width = str => doc.getTextWidth(clean(str))
  const img = (im, x, yy, w, h) => { try { doc.addImage(im.data, 'PNG', x, yy, w, h, im.alias || undefined, 'FAST') } catch (_) { /* unreadable image */ } }
  // One alias per image so a logo repeated on every page is embedded once.
  Object.entries(logos).forEach(([id, im]) => { if (im) im.alias = `logo-${id}` })
  if (mark) mark.alias = 'properly-mark'

  let brand = P.gold
  const paper = () => { doc.setFillColor(...WHITE); doc.rect(0, 0, W, H, 'F'); doc.setFillColor(...brand); doc.rect(0, 0, W, 3, 'F') }
  let onNewPage = null
  const newPage = () => { doc.addPage(); paper(); y = 10; if (onNewPage) onNewPage() }
  const ensure = h => { if (y + h > BOTTOM) newPage() }

  function sectionTitle(title, sub, accent = P.gold) {
    ensure(22)
    font(12, 'bold'); text(title, M, y + 5)
    if (sub) { font(7.6, 'normal', P.muted); text(sub, W - M, y + 5, { align: 'right' }) }
    doc.setFillColor(...accent); doc.rect(M, y + 7.4, 22, 0.9, 'F')
    y += 12
  }

  // A row of figure tiles. items: { label, value, sub, color }
  function tiles(items, h = 21) {
    ensure(h + 4)
    const gap = 4, kw = (CW - gap * (items.length - 1)) / items.length
    items.forEach((k, j) => {
      const x = M + j * (kw + gap), col = k.color || P.ink
      doc.setFillColor(...mix(col === P.ink ? P.faint : col, WHITE, 0.08)); doc.roundedRect(x, y, kw, h, 2, 2, 'F')
      doc.setFillColor(...col); doc.rect(x, y + 3, 1.1, h - 6, 'F')
      font(6.6, 'bold', P.muted); text(k.label.toUpperCase(), x + 4.5, y + 6.2)
      font(15, 'bold', col); text(fit(k.value, kw - 7), x + 4.5, y + 13.4)
      if (k.sub) { font(6.4, 'normal', P.faint); text(fit(k.sub, kw - 7), x + 4.5, y + 18) }
    })
    y += h + 5
  }

  // Status guide: one tile per status, every status always shown.
  const STATUS_ORDER = [['rented', 'Rented'], ['notice_given', 'Notice given'], ['let_agreed', 'Let agreed'], ['on_rental_market', 'On the market'], ['vacant', 'Vacant'], ['refurb', 'Refurbing'], ['short_term_let', 'Short-term let']]
  function statusGuide(cards, title) {
    ensure(26)
    font(6.8, 'bold', P.muted); text(title, M, y + 3); y += 5
    const gap = 2.6, n = STATUS_ORDER.length, tw = (CW - gap * (n - 1)) / n, th = 15
    STATUS_ORDER.forEach(([k, label], i) => {
      const count = cards.filter(c => c.status === k).length
      const col = count ? PILL[k] : mix(P.faint, WHITE, 0.6)
      const x = M + i * (tw + gap)
      doc.setFillColor(...mix(count ? col : P.faint, WHITE, count ? 0.1 : 0.05)); doc.roundedRect(x, y, tw, th, 1.8, 1.8, 'F')
      doc.setFillColor(...col); doc.rect(x, y + 2, 0.9, th - 4, 'F')
      font(14, 'bold', col); text(String(count), x + tw / 2, y + 8.2, { align: 'center' })
      font(6.2, 'bold', count ? col : mix(P.faint, WHITE, 0.7)); text(fit(label, tw - 2), x + tw / 2, y + 12.4, { align: 'center' })
    })
    y += th + 6
  }

  // A table that carries on over pages, repeating its header. cols:
  // [{ label, w (mm), align }]; rows: [{ cells, bar, tint }]; totals: cells.
  function table(cols, rows, { emptyText = '', totals = null, rh = 6.4, size = 7.6 } = {}) {
    const xs = []; let acc = M
    cols.forEach(c => { xs.push(acc); acc += c.w })
    const cx = (i, a) => a === 'right' ? xs[i] + cols[i].w - 2.5 : xs[i] + 2.5
    const head = () => {
      doc.setFillColor(...P.head); doc.rect(M, y, CW, 6.6, 'F')
      cols.forEach((c, i) => { font(6.2, 'bold', P.muted); text(c.label.toUpperCase(), cx(i, c.align), y + 4.4, c.align === 'right' ? { align: 'right' } : undefined) })
      y += 6.6
    }
    ensure(16); head()
    if (!rows.length) { font(8, 'normal', GREEN); text(emptyText, M + 3, y + 5); y += 11; return }
    const cell = (c, i, yy, bold) => {
      const v = typeof c === 'object' && c !== null ? c : { t: c }
      font(v.size || size, v.bold || bold ? 'bold' : 'normal', v.color || P.slate)
      text(fit(v.t ?? '', cols[i].w - 4), cx(i, cols[i].align), yy, cols[i].align === 'right' ? { align: 'right' } : undefined)
    }
    rows.forEach(r => {
      if (y + rh > BOTTOM) { newPage(); head() }
      if (r.tint) { doc.setFillColor(...r.tint); doc.rect(M, y, CW, rh, 'F') }
      if (r.bar) { doc.setFillColor(...r.bar); doc.rect(M, y + 1.2, 1, rh - 2.4, 'F') }
      r.cells.forEach((c, i) => cell(c, i, y + rh / 2 + 1.3))
      doc.setDrawColor(...P.rule); doc.setLineWidth(0.15); doc.line(M, y + rh, W - M, y + rh)
      y += rh
    })
    if (totals) {
      if (y + 7 > BOTTOM) { newPage(); head() }
      doc.setFillColor(...P.tile); doc.rect(M, y, CW, 7, 'F')
      totals.forEach((c, i) => { if (c != null && c !== '') cell(c, i, y + 4.7, true) })
      y += 7
    }
    y += 6
  }
  const red = v => ({ t: v > 0 ? money0(v) : '-', color: v > 0 ? RED : P.faint, bold: v > 0 })
  const rateColour = r => (r == null ? P.faint : r >= 95 ? GREEN : r >= 85 ? AMBER : RED)

  // ── Page 1: the position ──────────────────────────────────────────────
  paper()
  y = 9
  let tx = M
  if (mark) { const b = fitBox(mark.w, mark.h, 12, 12); img(mark, M, y, b.w, b.h); tx = M + b.w + 4 }
  font(18, 'bold'); text('Rent report', tx, y + 6.5)
  font(9.5, 'normal', P.muted)
  text(`${model.agent?.name || 'Agent'} - ${s.units} properties - ${dateLong(model.asOf)}`, tx, y + 12)
  y += 17
  doc.setDrawColor(...P.border); doc.setLineWidth(0.25); doc.line(M, y, W - M, y)
  doc.setFillColor(...P.gold); doc.rect(M, y - 0.5, 28, 1, 'F')
  y += 6

  sectionTitle(`Rent in ${model.year} so far`, 'long-term lets, every month whose payment window has closed')
  tiles([
    { label: 'Rent due', value: money0(s.yearDue), sub: `1 Jan to ${dateShort(model.asOf)}, window closed` },
    { label: 'Collected', value: money0(s.yearCollected), color: GREEN, sub: 'received against that rent' },
    { label: 'Collected %', value: pct(s.yearRate), color: rateColour(s.yearRate), sub: 'of the rent due' },
    { label: 'Owed', value: money0(s.shortfallYear + s.arrears), color: s.shortfallYear + s.arrears > 0 ? RED : GREEN, sub: `${s.missedMonths} missed months, ${s.owingCount} properties` },
  ])

  sectionTitle(`${monthLong} ${model.year}`, 'this month so far')
  tiles([
    { label: `Due in ${monthLong}`, value: money0(s.monthDue), sub: 'rent for this month' },
    { label: 'Collected so far', value: money0(s.monthCollected), color: GREEN, sub: s.monthDue ? `${Math.round((s.monthCollected / s.monthDue) * 100)}% of the month` : '' },
    { label: 'Still to come', value: money0(s.monthStill), color: s.monthStill > 0 ? AMBER : GREEN, sub: 'due later this month' },
    { label: 'Rent roll', value: `${money0(s.rentRoll)}/mo`, sub: 'monthly rent of the long-term lets' },
  ])
  // What empty properties cost.
  font(8, 'normal', P.slate)
  const emptyBits = [`Empty and ready to let: ${money0(s.emptyCost)}/mo of rent not coming in`]
  if (s.refurbRent > 0) emptyBits.push(`in refurb: ${money0(s.refurbRent)}/mo once let`)
  text(emptyBits.join('   -   '), M, y + 1); y += 7

  statusGuide(model.lines, `STATUS OF ALL ${s.units} PROPERTIES`)

  sectionTitle('By company', 'worst collection first')
  table([
    { label: 'Company', w: 46 }, { label: 'Let', w: 16, align: 'right' }, { label: 'Rent roll', w: 22, align: 'right' },
    { label: `Due ${model.year}`, w: 24, align: 'right' }, { label: 'Collected', w: 24, align: 'right' },
    { label: '%', w: 14, align: 'right' }, { label: 'Owed', w: 20, align: 'right' }, { label: 'Empty /mo', w: 20, align: 'right' },
  ], [...model.byCompany].sort((a, b) => (a.yearRate ?? 101) - (b.yearRate ?? 101)).map(g => ({
    bar: brandColour(g.color),
    cells: [{ t: g.company, bold: true, color: P.ink }, `${g.cards.filter(c => c.let).length} of ${g.cards.length}`,
      money0(g.rentRoll), money0(g.yearDue), { t: money0(g.yearCollected), color: GREEN },
      { t: pct(g.yearRate), color: rateColour(g.yearRate), bold: true }, red(g.owed), { t: g.emptyCost ? money0(g.emptyCost) : '-', color: g.emptyCost ? AMBER : P.faint }],
  })), { totals: [{ t: 'All companies' }, `${s.letUnits} of ${s.units}`, money0(s.rentRoll), money0(s.yearDue), { t: money0(s.yearCollected), color: GREEN }, { t: pct(s.yearRate), color: rateColour(s.yearRate) }, red(s.shortfallYear + s.arrears), { t: money0(s.emptyCost), color: AMBER }] })

  if (model.stl?.length) {
    sectionTitle('Short-term lets', `after platform fees and the manager's fee`)
    table([
      { label: 'Building', w: 46 }, { label: 'Rooms open', w: 20, align: 'right' }, { label: `${MONTHS[model.thisMonth.month - 1]} occupancy`, w: 26, align: 'right' },
      { label: 'Avg per night', w: 24, align: 'right' }, { label: `${MONTHS[model.thisMonth.month - 1]} to owner`, w: 24, align: 'right' },
      { label: `${model.year} occupancy`, w: 22, align: 'right' }, { label: `${model.year} to owner`, w: 24, align: 'right' },
    ], model.stl.map(b => ({
      bar: PILL.short_term_let,
      cells: [{ t: b.name, bold: true, color: P.ink }, `${b.rooms} of ${b.totalRooms}`, pct(b.month.occupancy), b.year.adr ? money0(b.year.adr) : '-',
        { t: money0(b.month.toOwner), color: GREEN }, pct(b.year.occupancy), { t: money0(b.year.toOwner), color: GREEN, bold: true }],
    })))
  }

  font(6.6, 'normal', P.muted)
  const notes = [
    'Owed = rent still unpaid after its payment window. Due = collected + owed; rent still inside its window is shown under this month.',
    `Rent tracking starts 1 Jan ${GO_LIVE_YEAR}. Months marked paid without an amount are counted as paid in full.`,
  ]
  if (s.noTenancyStart) notes.push(`${s.noTenancyStart} let properties have no tenancy start date recorded yet.`)
  ensure(notes.length * 3.6 + 4)
  notes.forEach(n => { text(n, M, y + 2); y += 3.6 })

  // ── What needs doing ─────────────────────────────────────────────────
  newPage()
  font(16, 'bold'); text('What needs doing', M, y + 6); y += 12

  const owing = model.owing
  sectionTitle('Rent owed', `${owing.length} ${owing.length === 1 ? 'property' : 'properties'}, largest first`, RED)
  table([
    { label: 'Property', w: 44 }, { label: 'Company', w: 26 }, { label: 'Tenant', w: 32 },
    { label: 'Missed', w: 13, align: 'right' }, { label: 'Since', w: 17, align: 'right' },
    { label: `Owed ${model.year}`, w: 22, align: 'right' }, { label: 'This tenancy', w: 32, align: 'right' },
  ], owing.map(c => ({
    bar: brandColour(model.byCompany.find(g => g.companyId === c.companyId)?.color),
    cells: [{ t: c.name, bold: true, color: P.ink }, shortCo(c.company), c.tenant || { t: 'not recorded', color: P.faint },
      String(c.missedMonths || '-'), c.oldestMissed || '-', red(c.shortfallYear + c.arrears),
      c.shortfallTenancy == null ? { t: 'start unknown', color: P.faint } : { t: `${money0(c.shortfallTenancy)} since ${dateShort(c.tenancyStart)}`, color: c.shortfallTenancy > 0 ? RED : P.faint, size: 6.8 }],
  })), { emptyText: 'Nothing owed: every collectible month is paid.', totals: owing.length ? ['Total', '', '', String(s.missedMonths), '', red(s.shortfallYear + s.arrears), ''] : null })

  const daysEmpty = c => (c.vacantSince ? Math.max(0, Math.round((Date.parse(model.asOf) - Date.parse(c.vacantSince)) / 864e5)) : null)
  const notLet = [...model.notLet].filter(c => !c.stl).sort((a, b) => (a.lettable === b.lettable ? (daysEmpty(b) ?? -1) - (daysEmpty(a) ?? -1) : a.lettable ? -1 : 1))
  sectionTitle('Not let', 'ready to let first, then refurbs', AMBER)
  table([
    { label: 'Property', w: 52 }, { label: 'Company', w: 30 }, { label: 'Status', w: 30 },
    { label: 'Empty since', w: 30, align: 'right' }, { label: 'Rent /mo', w: 22, align: 'right' }, { label: 'Lost to date', w: 22, align: 'right' },
  ], notLet.map(c => {
    const d = daysEmpty(c)
    return {
      bar: brandColour(model.byCompany.find(g => g.companyId === c.companyId)?.color),
      cells: [{ t: c.name, bold: true, color: P.ink }, shortCo(c.company), { t: c.letLabel, color: PILL[c.status] || P.muted, bold: true },
        c.vacantSince ? `${dateShort(c.vacantSince)} (${d} days)` : { t: 'not recorded', color: P.faint },
        { t: c.rent ? money0(c.rent) : 'no rent set', color: c.rent ? P.slate : P.faint },
        { t: c.lettable && c.rent && d != null ? money0(c.rent * 12 / 365 * d) : '-', color: c.lettable && c.rent && d != null ? AMBER : P.faint }],
    }
  }), { emptyText: 'Every property is let.' })

  const notice = model.lines.filter(c => c.status === 'notice_given')
  if (notice.length) {
    sectionTitle('Notice given', 'still let, tenant leaving', AMBER)
    table([
      { label: 'Property', w: 52 }, { label: 'Company', w: 30 }, { label: 'Tenant', w: 40 }, { label: 'Leaving', w: 34, align: 'right' }, { label: 'Rent /mo', w: 30, align: 'right' },
    ], notice.map(c => ({ cells: [{ t: c.name, bold: true, color: P.ink }, shortCo(c.company), c.tenant || { t: 'not recorded', color: P.faint }, c.tenancyEnd ? dateShort(c.tenancyEnd) : { t: 'date not recorded', color: P.faint }, money0(c.rent)] })))
  }

  // ── A page per company ───────────────────────────────────────────────
  let accent = P.gold, tint = P.tile

  function companyTitle(g) {
    let yy = 13
    const logo = logos[g.companyId]
    if (logo) { const b = fitBox(logo.w, logo.h, 60, 32); img(logo, (W - b.w) / 2, yy, b.w, b.h); yy += b.h + 6 }
    font(17, 'bold'); text(g.company, W / 2, yy + 4, { align: 'center' })
    font(8.5, 'normal', P.muted)
    text(`${g.cards.length} properties - ${g.cards.filter(c => c.let).length} let - rent roll ${money0(g.rentRoll)}/mo`, W / 2, yy + 10, { align: 'center' })
    y = yy + 15
    doc.setFillColor(...accent); doc.rect(M, y, CW, 0.8, 'F'); y += 5
  }
  function runningHead(g) {
    const logo = logos[g.companyId]
    let x = M
    if (logo) { const b = fitBox(logo.w, logo.h, 16, 8); img(logo, M, 6.5 + (8 - b.h) / 2, b.w, b.h); x = M + b.w + 3 }
    font(9.5, 'bold'); text(g.company, x, 12)
    const cx = x + width(g.company) + 3
    font(7, 'normal', P.muted); text('continued', cx, 12)
    doc.setFillColor(...accent); doc.rect(M, 16, CW, 0.6, 'F')
    y = 19
  }

  // Register: one line per property, the year's months as coloured squares.
  const COLS = { name: 50, tenant: 32, status: 24, rent: 15, owed: 18 }
  const MW = (CW - COLS.name - COLS.tenant - COLS.status - COLS.rent - COLS.owed) / 12
  const RH = 6
  function registerHead() {
    doc.setFillColor(...P.head); doc.rect(M, y, CW, 6.6, 'F')
    font(6.2, 'bold', P.muted)
    let x = M
    text('PROPERTY', x + 2.5, y + 4.4); x += COLS.name
    text('TENANT', x + 2, y + 4.4); x += COLS.tenant
    text('STATUS', x + 2, y + 4.4); x += COLS.status
    text('RENT', x + COLS.rent - 2, y + 4.4, { align: 'right' }); x += COLS.rent
    MONTHS.forEach((m, i) => { text(m[0], x + i * MW + MW / 2, y + 4.4, { align: 'center' }) })
    x += MW * 12
    text('OWED', x + COLS.owed - 2.5, y + 4.4, { align: 'right' })
    y += 6.6
  }
  function monthSquare(x, yy, m) {
    const w = MW - 1, h = RH - 2
    if (m.future) { doc.setDrawColor(...mix(P.faint, WHITE, 0.35)); doc.setLineWidth(0.15); doc.roundedRect(x, yy, w, h, 0.7, 0.7, 'S'); return }
    const key = m.state === 'legacy' ? (LEGACY_KEY[m.legacyStatus] || 'not_collectible') : m.state
    const pair = TILE[key]
    if (!pair) { doc.setDrawColor(...P.rule); doc.setLineWidth(0.15); doc.roundedRect(x, yy, w, h, 0.7, 0.7, 'S'); return }
    doc.setFillColor(...pair[1]); doc.roundedRect(x, yy, w, h, 0.7, 0.7, 'F')
    if (key === 'missed') { doc.setFillColor(...pair[0]); doc.roundedRect(x + w * 0.25, yy + h * 0.3, w * 0.5, h * 0.4, 0.3, 0.3, 'F') }
    if (m.current) { doc.setDrawColor(...CURRENT); doc.setLineWidth(0.45); doc.roundedRect(x, yy, w, h, 0.7, 0.7, 'S') }
  }
  function registerRow(c, indent) {
    if (y + RH > BOTTOM) { newPage(); registerHead() }
    const owed = c.shortfallYear + c.arrears
    const rowTint = owed > 0 ? mix(RED, WHITE, 0.06) : !c.let ? mix(AMBER, WHITE, 0.06) : null
    if (rowTint) { doc.setFillColor(...rowTint); doc.rect(M, y, CW, RH, 'F') }
    let x = M
    const ty = y + RH / 2 + 1.2
    font(7.2, 'bold'); text(fit(indent ? `  ${c.name.split(',')[0].trim()}` : c.name, COLS.name - 3), x + 2.5, ty); x += COLS.name
    font(6.8, 'normal', c.tenant ? P.slate : P.faint); text(fit(c.tenant || (c.let ? 'not recorded' : '-'), COLS.tenant - 2), x + 2, ty); x += COLS.tenant
    font(6.8, 'bold', PILL[c.status] || P.muted); text(fit(c.letLabel, COLS.status - 2), x + 2, ty); x += COLS.status
    font(6.8, 'normal', P.slate); text(c.rent ? money0(c.rent) : '-', x + COLS.rent - 2, ty, { align: 'right' }); x += COLS.rent
    c.months.forEach((m, i) => monthSquare(x + i * MW + 0.5, y + 1, m))
    x += MW * 12
    font(7.2, owed > 0 ? 'bold' : 'normal', owed > 0 ? RED : P.faint); text(owed > 0 ? money0(owed) : '-', x + COLS.owed - 2.5, ty, { align: 'right' })
    doc.setDrawColor(...P.rule); doc.setLineWidth(0.15); doc.line(M, y + RH, W - M, y + RH)
    y += RH
  }
  function registerKey() {
    font(6.4, 'normal', P.muted)
    let kx = M
    for (const [k, l] of [['paid', 'Paid'], ['due', 'Due'], ['missed', 'Missed'], ['not_collectible', 'Nothing due (empty / refurb)']]) {
      monthSquare(kx, y - 2.6, { state: k }); text(l, kx + MW + 1, y); kx += MW + 3 + width(l) + 4
    }
    doc.setDrawColor(...CURRENT); doc.setLineWidth(0.45); doc.roundedRect(kx, y - 2.6, MW - 1, RH - 2, 0.7, 0.7, 'S')
    text('This month', kx + MW + 1, y); kx += MW + 3 + width('This month') + 4
    doc.setFillColor(...mix(RED, WHITE, 0.12)); doc.rect(kx, y - 2.6, 4, 3.4, 'F'); text('Owes rent', kx + 5.5, y); kx += 5.5 + width('Owes rent') + 4
    doc.setFillColor(...mix(AMBER, WHITE, 0.12)); doc.rect(kx, y - 2.6, 4, 3.4, 'F'); text('Not let', kx + 5.5, y)
    y += 5
  }

  for (const g of model.byCompany) {
    accent = brandColour(g.color); tint = mix(accent, WHITE, 0.08); brand = accent
    onNewPage = null
    newPage()
    companyTitle(g)
    tiles([
      { label: `Due ${model.year}`, value: money0(g.yearDue) },
      { label: 'Collected', value: money0(g.yearCollected), color: GREEN, sub: pct(g.yearRate) + ' of rent due' },
      { label: 'Owed', value: money0(g.owed), color: g.owed > 0 ? RED : GREEN, sub: `${g.missedMonths} missed months` },
      { label: `${monthLong} still to come`, value: money0(g.monthStill), color: g.monthStill > 0 ? AMBER : GREEN, sub: `${money0(g.monthCollected)} of ${money0(g.monthDue)} in` },
    ], 19)
    statusGuide(g.cards, 'STATUS')
    registerKey()
    onNewPage = () => { runningHead(g); registerHead() }
    registerHead()
    for (const gr of g.groups) {
      const lt = gr.cards.filter(c => !c.stl)
      if (!lt.length) continue
      if (gr.building && lt.length > 1) {
        if (y + RH * 2 > BOTTOM) newPage()
        doc.setFillColor(...tint); doc.rect(M, y, CW, 5.4, 'F')
        font(7, 'bold', P.ink); text(gr.name, M + 2.5, y + 3.8)
        const nx = M + 2.5 + width(gr.name) + 2
        font(6.4, 'normal', P.muted); text(`${lt.length} units`, nx, y + 3.8)
        y += 5.4
        lt.forEach(c => registerRow(c, true))
      } else lt.forEach(c => registerRow(c, false))
    }
    const stlHere = model.stl?.filter(b => b.companyId === g.companyId) || []
    for (const b of stlHere) {
      if (y + RH > BOTTOM) newPage()
      doc.setFillColor(...mix(PILL.short_term_let, WHITE, 0.07)); doc.rect(M, y, CW, RH, 'F')
      font(7.2, 'bold', P.ink); text(`${b.name} (${b.totalRooms} short-let rooms)`, M + 2.5, y + RH / 2 + 1.2)
      font(6.8, 'normal', PILL.short_term_let); text('see the short-term let page', W - M - 2.5, y + RH / 2 + 1.2, { align: 'right' })
      y += RH
    }
    onNewPage = null
  }

  // ── Short-term lets ──────────────────────────────────────────────────
  for (const b of model.stl || []) {
    const co = model.byCompany.find(g => g.companyId === b.companyId)
    accent = PILL.short_term_let; brand = brandColour(co?.color)
    onNewPage = null
    newPage()
    font(16, 'bold'); text(`${b.name} - short-term let`, M, y + 6)
    font(8.5, 'normal', P.muted)
    text(`${b.company} - ${b.rooms} of ${b.totalRooms} rooms open for bookings${b.manager ? ` - managed by ${b.manager.name} at ${Number(b.manager.percentage)}% of income after platform fees` : ''}`, M, y + 12)
    y += 18
    tiles([
      { label: `${monthLong} occupancy`, value: pct(b.month.occupancy), sub: `${b.month.nights} nights booked`, color: PILL.short_term_let },
      { label: 'Average per night', value: b.year.adr ? money0(b.year.adr) : '-', sub: `${model.year} so far` },
      { label: `${monthLong} to owner`, value: money0(b.month.toOwner), color: GREEN, sub: 'after all fees' },
      { label: `${model.year} to owner`, value: money0(b.year.toOwner), color: GREEN, sub: `${pct(b.year.occupancy)} occupancy` },
    ])
    sectionTitle('Month by month', 'bookings counted in the month the guest arrives', accent)
    const mRows = b.byMonth.filter(m => m.bookings || m.nights || m.gross)
    table([
      { label: 'Month', w: 18 }, { label: 'Nights', w: 16, align: 'right' }, { label: 'Occupancy', w: 20, align: 'right' },
      { label: 'Avg /night', w: 20, align: 'right' }, { label: 'Booking value', w: 24, align: 'right' }, { label: 'Platform fees', w: 22, align: 'right' },
      { label: 'After fees', w: 22, align: 'right' }, { label: 'Manager', w: 20, align: 'right' }, { label: 'To owner', w: 24, align: 'right' },
    ], mRows.map(m => ({
      cells: [{ t: m.label, bold: true, color: P.ink }, String(m.nights), pct(m.occupancy), m.adr ? money0(m.adr) : '-', money0(m.gross),
        { t: m.platformFees ? `-${money0(m.platformFees)}` : '-', color: P.muted }, money0(m.netAfterFees),
        { t: m.managerFee ? `-${money0(m.managerFee)}` : '-', color: P.muted }, { t: money0(m.toOwner), color: GREEN, bold: true }],
    })), {
      emptyText: 'No bookings yet this year.',
      totals: [`${model.year}`, String(b.year.nights), pct(b.year.occupancy), b.year.adr ? money0(b.year.adr) : '-', money0(b.year.gross),
        { t: `-${money0(b.year.platformFees)}`, color: P.muted }, money0(b.year.netAfterFees), { t: `-${money0(b.year.managerFee)}`, color: P.muted }, { t: money0(b.year.toOwner), color: GREEN }],
    })
    font(6.6, 'normal', P.muted)
    text('Occupancy = nights sold over nights available in the rooms open for bookings. Platform fees are the channel and Hostaway commission; where a channel has not reported yet they are estimated from its usual rate.', M, y, { maxWidth: CW })
    y += 8
  }

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

// "ExH Property Group" -> "ExH": the short name keeps tables readable.
function shortCo(name) {
  return String(name || '').replace(/\s+(Property Group|Group|Properties|Limited|Ltd)\.?$/i, '').trim() || name
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
