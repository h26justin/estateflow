// ── DEAL PACK PDF ────────────────────────────────────────────────────────────
// Builds a shareable A4 PDF for one deal: headline numbers, the full
// calculator breakdown, deal score + stress test, timeline, purchase-tracker
// progress, contacts, notes, a list of attached documents and the photos
// themselves. Meant for sending to a partner, broker or lender.
//
// Same approach as the other exports in the app: jsPDF lazy-loaded from the
// CDN (already on the CSP allow-list), everything drawn with the built-in
// Helvetica so there is nothing to embed. Photos are pulled through signed
// URLs, downscaled on a canvas and embedded as JPEG so a 20-photo pack stays
// a few MB rather than a few hundred.

import * as api from './api'
import { loadCdnScript } from './loadCdnScript'
import { computeDealMetrics, projectDeal, refinanceScenarios, growthAssumptions } from './dealMetrics'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

const STATUS_LABEL   = { analysing:'Analysing', offer_made:'Offer made', under_offer:'Under offer', exchanged:'Exchanged', completed:'Completed', dead:'Dead' }
const DEAL_TYPE_LABEL = { btl:'Buy-to-Let', hmo:'HMO', sa:'Serviced Apartment', brrr:'BRRR', flip:'Flip' }
const PURCHASE_LABEL = { cash:'Cash purchase', mortgage:'Mortgage', bridge:'Bridging finance' }
const STAGE_LABEL = {
  offer:'Offer stage', professionals:'Instructing professionals', legal:'Legal due diligence',
  exchange:'Exchange', completion:'Completion & post-completion',
  pre_auction:'Pre-auction', auction_day:'Auction day', brrr:'BRRR refinance',
}
const CONTACT_ROLE = { solicitor:'Solicitor', estate_agent:'Estate agent', mortgage_broker:'Mortgage broker', surveyor:'Surveyor', other:'Other' }

// Palette (RGB) — matches the app's report exports.
const INK    = [26, 37, 48]
const MUTED  = [107, 118, 145]
const FAINT  = [160, 168, 185]
const BORDER = [222, 226, 234]
const CARD   = [247, 247, 244]
const GOLD   = [200, 168, 75]
const GREEN  = [46, 204, 138]
const RED    = [224, 85, 85]
const AMBER  = [224, 148, 58]

const money = n => '£' + new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Math.round(n || 0))
const pct   = n => (Number.isFinite(n) ? n : 0).toFixed(1) + '%'
const dateGB = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

/** Fetch an image through its signed URL and return a downscaled JPEG data URL. */
async function loadPhoto(path, maxPx = 1400) {
  const url = await api.getDocumentSignedUrl(path, 120)
  if (!url) throw new Error('no signed url')
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const blob = await res.blob()
  const bmp = await createImageBitmap(blob) // throws on formats the browser can't decode (e.g. HEIC on Chrome)
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  if (bmp.close) bmp.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), w, h }
}

async function loadLogo() {
  try {
    const r = await fetch('/icon-512.png'); const b = await r.blob()
    return await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b) })
  } catch (_) { return null }
}

/**
 * Build and download the deal pack.
 * @param {object} opts
 * @param {object} opts.deal      deal row (or the editor's form state)
 * @param {object} [opts.company] the deal's company row, for the header
 */
export async function exportDealPdf({ deal, company }) {
  if (!deal) throw new Error('No deal to export')

  // Gather everything up front so page-flow logic below is synchronous.
  const [contacts, milestones, documents] = await Promise.all([
    api.fetchDealContacts(deal.id).catch(() => []),
    api.fetchDealMilestones(deal.id).catch(() => []),
    api.fetchDealDocuments(deal.id).catch(() => []),
  ])
  const photoDocs = documents.filter(api.isDealPhoto)
  const fileDocs  = documents.filter(d => !api.isDealPhoto(d))
  const photos = []
  for (const p of photoDocs) {
    try { photos.push({ doc: p, ...(await loadPhoto(p.file_path)) }) } catch (_) { /* skip undecodable */ }
  }
  const logo = await loadLogo()

  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 16, CW = W - M * 2
  const FOOT = 20 // reserved footer height
  let y = M

  const m = computeDealMetrics(deal)
  const score = api.calcDealScore({ ...deal, expected_rent: m.grossMonthlyRent })
  const stress = m.isCash ? null : api.calcStressTest(m.loanAmount, m.mortgageTerm, m.grossMonthlyRent * 12, num(deal.mortgage_rate))
  const isHmo = deal.deal_type === 'hmo', isSa = deal.deal_type === 'sa', isBrrr = deal.deal_type === 'brrr'

  // ── primitives ─────────────────────────────────────────────────────────
  const ensure = (h) => { if (y + h > H - FOOT - 4) { doc.addPage(); y = M } }
  // The built-in Helvetica only has Latin-1 glyphs; anything outside it
  // (✦ on a milestone label, emoji in a caption) prints as stray characters.
  const clean = (s) => String(s ?? '')
    .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...').replace(/\u2022/g, '-')
    .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u00FF]/g, '').replace(/ {2,}/g, ' ').trim()
  const text = (s, x, yy, opts = {}) => doc.text(clean(s), x, yy, opts)
  const setFont = (size, style = 'normal', color = INK) => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color) }

  function sectionTitle(title) {
    // Title plus at least three rows, so a heading never sits alone at the
    // foot of a page.
    ensure(30)
    y += 3
    setFont(8.5, 'bold', MUTED)
    text(title.toUpperCase(), M, y)
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5); doc.line(M, y + 1.6, M + 10, y + 1.6)
    y += 6.5
  }

  function kvRows(rows, { big = false } = {}) {
    rows.filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== '').forEach(([k, v, color]) => {
      ensure(6.5)
      setFont(9.5, 'normal', MUTED); text(k, M, y)
      setFont(big ? 11 : 9.5, big ? 'bold' : 'normal', color || INK); text(v, W - M, y, { align: 'right' })
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.2); doc.line(M, y + 2, W - M, y + 2)
      y += 6.5
    })
    y += 1.5
  }

  function paragraph(s, size = 9.5, color = INK) {
    setFont(size, 'normal', color)
    const lines = doc.splitTextToSize(clean(s), CW)
    for (const ln of lines) { ensure(5); text(ln, M, y); y += 4.6 }
    y += 2
  }

  function statBoxes(items) {
    const gap = 4, bw = (CW - gap * (items.length - 1)) / items.length, bh = 20
    ensure(bh + 4)
    items.forEach((it, i) => {
      const x = M + i * (bw + gap)
      doc.setFillColor(...CARD); doc.roundedRect(x, y, bw, bh, 2, 2, 'F')
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.roundedRect(x, y, bw, bh, 2, 2, 'S')
      setFont(6.5, 'bold', MUTED); text(it.label.toUpperCase(), x + 4, y + 6)
      setFont(13, 'bold', it.color || INK); text(it.value, x + 4, y + 13.5)
      if (it.sub) { setFont(6.5, 'normal', FAINT); text(it.sub, x + 4, y + 17.5) }
    })
    y += bh + 6
  }

  // ── header ─────────────────────────────────────────────────────────────
  // Title wraps within the space left of the right-hand meta block; the band
  // grows with it so nothing overlaps.
  const titleMaxW = CW - 58
  setFont(18, 'bold', [255, 255, 255])
  let titleLines = doc.splitTextToSize(clean(deal.name || deal.address || 'Deal'), titleMaxW)
  if (titleLines.length > 2) { setFont(14, 'bold', [255, 255, 255]); titleLines = doc.splitTextToSize(clean(deal.name || deal.address || 'Deal'), titleMaxW).slice(0, 2) }
  const titleLH = titleLines.length > 1 ? 7 : 8
  const showAddr = deal.address && deal.address !== deal.name
  const bandH = 12 + titleLines.length * titleLH + (showAddr ? 5.5 : 0) + 8.5
  doc.setFillColor(...INK); doc.rect(0, 0, W, bandH, 'F')
  doc.setFillColor(...GOLD); doc.rect(0, bandH, W, 1.2, 'F')
  let hy = 15
  titleLines.forEach(ln => { text(ln, M, hy); hy += titleLH })
  setFont(9, 'normal', [200, 205, 215])
  if (showAddr) { text(deal.address, M, hy - 0.5); hy += 5.5 }
  const chips = [STATUS_LABEL[deal.status] || deal.status, DEAL_TYPE_LABEL[deal.deal_type] || 'Buy-to-Let', PURCHASE_LABEL[deal.purchase_type] || 'Mortgage', deal.is_auction ? 'Auction' : null].filter(Boolean)
  text(chips.join('  ·  '), M, hy + 0.5)
  setFont(8, 'normal', [200, 205, 215])
  text('Deal pack', W - M, 13, { align: 'right' })
  if (company?.name) text(company.name, W - M, 19, { align: 'right' })
  text('Prepared ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), W - M, 25, { align: 'right' })
  y = bandH + 9

  // Hero: the first photo, full width, so the reader sees the property
  // before the numbers. Landscape shots fill the width; tall ones are
  // capped in height and centred.
  if (photos.length) {
    const hero = photos[0]
    const maxH = 78
    const s = Math.min(CW / hero.w, maxH / hero.h)
    const hw = hero.w * s, hh = hero.h * s
    doc.setFillColor(...CARD); doc.roundedRect(M, y, CW, hh, 2, 2, 'F')
    try { doc.addImage(hero.dataUrl, 'JPEG', M + (CW - hw) / 2, y, hw, hh) } catch (_) {}
    y += hh
    const cap = hero.doc.caption || ''
    if (cap) { setFont(8, 'normal', MUTED); text(doc.splitTextToSize(clean(cap), CW)[0], M, y + 4); y += 5 }
    y += 6
  }

  // ── headline ───────────────────────────────────────────────────────────
  const scoreColor = score.score >= 70 ? GREEN : score.score >= 55 ? AMBER : RED
  statBoxes([
    { label: 'Purchase price', value: money(m.price) },
    { label: 'Cash in deal', value: money(m.cashIn), sub: m.isCash ? 'Cash purchase' : `after ${money(m.loanAmount)} loan` },
    { label: 'Monthly profit', value: money(m.monthlyProfit), color: m.monthlyProfit >= 0 ? GREEN : RED, sub: `${money(m.annualProfit)} a year` },
    { label: 'Gross yield', value: pct(m.grossYield), sub: `net ${pct(m.netYield)}` },
    { label: 'Deal score', value: `${score.score}/100`, color: scoreColor, sub: score.rating },
  ])

  // ── acquisition ────────────────────────────────────────────────────────
  sectionTitle('Acquisition costs')
  kvRows([
    ['Purchase price', money(m.price)],
    ['Stamp duty (SDLT)' + (deal.stamp_duty_override != null ? ' — user override' : ''), money(m.sd)],
    ['Legal fees', money(num(deal.legal_fees))],
    num(deal.solicitor_fee) ? ['   of which solicitor', money(num(deal.solicitor_fee))] : null,
    num(deal.search_fees) ? ['   of which searches', money(num(deal.search_fees))] : null,
    num(deal.disbursements) ? ['   of which disbursements', money(num(deal.disbursements))] : null,
    ['Survey / valuation', money(num(deal.survey_cost))],
    deal.is_auction ? ['Auction fees', money(num(deal.auction_fees))] : null,
    num(deal.broker_fee) ? ['Broker / finder fee', money(num(deal.broker_fee))] : null,
    ['Refurbishment', money(num(deal.refurb_cost))],
    num(deal.other_costs) ? [deal.other_costs_label || 'Other costs', money(num(deal.other_costs))] : null,
    m.mortgageFee ? [`Mortgage arrangement fee (${num(deal.mortgage_fee_percent)}% of loan)`, money(m.mortgageFee)] : null,
    ['Total capital required', money(m.totalAcquisition), INK],
  ], { big: false })

  // ── finance ────────────────────────────────────────────────────────────
  if (!m.isCash) {
    sectionTitle('Finance')
    kvRows([
      ['Deposit', `${num(deal.deposit_percent)}%  ·  ${money(m.deposit)}`],
      ['Loan', money(m.loanAmount)],
      ['Mortgage type', m.isInterestOnly ? 'Interest only' : `Repayment over ${m.mortgageTerm} years`],
      ['Rate', `${num(deal.mortgage_rate)}% p.a.`],
      [m.isInterestOnly ? 'Monthly payment (interest only)' : 'Monthly repayment', money(m.monthlyRepayment)],
      ['Cash in deal', money(m.cashIn), GOLD],
    ])
  }

  // ── income ─────────────────────────────────────────────────────────────
  sectionTitle('Rental income')
  const incomeRows = []
  if (isHmo) {
    const rents = Array.isArray(deal.hmo_room_rents) ? deal.hmo_room_rents : []
    if (deal.hmo_rent_mode === 'individual' && rents.length) {
      rents.forEach((r, i) => incomeRows.push([`Room ${i + 1}`, money(num(r)) + ' pcm']))
    } else {
      incomeRows.push(['Rooms', String(num(deal.hmo_rooms))], ['Rent per room', money(num(deal.hmo_rent_per_room)) + ' pcm'])
    }
  } else if (isSa) {
    incomeRows.push(['Nightly rate', money(num(deal.sa_nightly_rate))], ['Occupancy', `${num(deal.sa_occupancy_percent)}%`])
  } else {
    incomeRows.push(['Monthly rent', money(num(deal.monthly_rent))])
  }
  incomeRows.push(
    ['Gross monthly rent', money(m.grossMonthlyRent)],
    ['Void allowance', `${num(deal.void_percent)}%`],
    ['Effective rent (after void)', money(m.effectiveRent), GREEN],
  )
  kvRows(incomeRows)

  // ── running costs ──────────────────────────────────────────────────────
  sectionTitle('Monthly running costs')
  kvRows([
    !m.isCash ? [m.isInterestOnly ? 'Mortgage interest' : 'Mortgage repayment', money(m.monthlyRepayment)] : null,
    [`Letting agent (${num(deal.agent_fee_percent)}%${m.agentFeeVat === 'ex_vat' ? ' + VAT' : ' inc. VAT'})`, money(m.agentFee)],
    [`Maintenance reserve (${num(deal.maintenance_percent)}%)`, money(m.maintenanceFee)],
    ['Buildings insurance', money(num(deal.insurance_monthly))],
    num(deal.service_charge_monthly) ? ['Service charge', money(num(deal.service_charge_monthly))] : null,
    num(deal.ground_rent_monthly) ? ['Ground rent', money(num(deal.ground_rent_monthly))] : null,
    isHmo && num(deal.hmo_utilities_monthly) ? ['Utilities', money(num(deal.hmo_utilities_monthly))] : null,
    isHmo && num(deal.hmo_council_tax_monthly) ? ['Council tax', money(num(deal.hmo_council_tax_monthly))] : null,
    isHmo && num(deal.hmo_licence_annual) ? ['HMO licence (monthly equivalent)', money(num(deal.hmo_licence_annual) / 12)] : null,
    ['Total monthly costs', money(m.totalMonthlyCosts), RED],
    ['Monthly profit / loss', money(m.monthlyProfit), m.monthlyProfit >= 0 ? GREEN : RED],
  ])

  // ── returns ────────────────────────────────────────────────────────────
  sectionTitle('Returns')
  kvRows([
    ['Annual profit', money(m.annualProfit), m.annualProfit >= 0 ? GREEN : RED],
    ['Gross yield', pct(m.grossYield)],
    ['Net yield (after all costs)', pct(m.netYield)],
    ['Cash-on-cash return', pct(m.cashOnCash)],
    ['Return on capital employed', pct(m.roce)],
    ['Payback period', m.payback > 0 ? m.payback.toFixed(1) + ' years' : '—'],
  ])

  if (isBrrr) {
    sectionTitle('BRRR refinance')
    kvRows([
      ['Estimated end value', money(num(deal.brrr_end_value))],
      ['Refinance LTV', `${num(deal.brrr_refinance_ltv)}%`],
      ['New loan', money(m.brrrNewLoan)],
      ['New monthly payment', money(m.brrrNewRepayment)],
      ['Capital released', money(m.brrrCapitalReleased), GREEN],
      ['Money left in deal', money(m.brrrMoneyLeft), GOLD],
      ['Cash-on-cash (post refinance)', pct(m.brrrCashOnCash)],
    ])
  }

  // ── refinance scenarios ────────────────────────────────────────────────
  const refi = refinanceScenarios(deal, m)
  if (refi) {
    sectionTitle('Remortgage after refurb')
    setFont(8, 'normal', MUTED)
    ensure(6)
    text(`Based on an estimated post-refurb value of ${money(refi.value)}, a remortgage at ${refi.rate}% ${refi.isInterestOnly ? 'interest only' : `repayment over ${refi.term} years`}, and ${money(refi.cashIn)} cash in the deal today.`, M, y, { maxWidth: CW }); y += 8
    ensure(6.5 * (refi.scenarios.length + 1) + 8) // header + rows + note stay together
    const cols = ['LTV', 'New loan', 'Cash back', 'Left in deal', 'New payment', 'Profit / mo']
    const cw = [16, 34, 34, 34, 30, 30]
    const tableRow = (cells, opts = {}) => {
      ensure(7)
      let x = M
      cells.forEach((c, i) => {
        setFont(opts.head ? 7 : 8.5, opts.head ? 'bold' : (i === 0 ? 'bold' : 'normal'), opts.head ? MUTED : (opts.colors?.[i] || INK))
        text(c, i === 0 ? x : x + cw[i] - 1, y, i === 0 ? {} : { align: 'right' })
        x += cw[i]
      })
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.2); doc.line(M, y + 2, M + cw.reduce((a, b) => a + b, 0), y + 2)
      y += 6.5
    }
    tableRow(cols.map(c => c.toUpperCase()), { head: true })
    for (const sc of refi.scenarios) {
      tableRow([
        `${sc.ltv}%`, money(sc.newLoan),
        (sc.released < 0 ? '-' : '') + money(Math.abs(sc.released)),
        sc.allMoneyOut ? 'All money out' : money(sc.moneyLeft),
        money(sc.newPayment), money(sc.monthlyProfit),
      ], { colors: [INK, INK, sc.released >= 0 ? GREEN : RED, sc.allMoneyOut ? GREEN : INK, INK, sc.monthlyProfit >= 0 ? INK : RED] })
    }
    const best = refi.scenarios.find(sc => sc.allMoneyOut)
    setFont(7.5, 'normal', FAINT); ensure(6)
    text(best
      ? `At ${best.ltv}% LTV the remortgage returns all the cash in the deal${best.moneyLeft < 0 ? ` and ${money(-best.moneyLeft)} more` : ''}. Profit is after the new mortgage payment.`
      : 'No LTV shown returns all the cash in the deal at this value. Profit is after the new mortgage payment.', M, y); y += 6
  }

  // ── 10-year projection ─────────────────────────────────────────────────
  {
    const p = projectDeal(deal, m)
    const { rentGrowth, capitalGrowth } = growthAssumptions(deal)
    const last = p.rows[p.rows.length - 1]
    sectionTitle('10-year projection')
    setFont(8, 'normal', MUTED); ensure(6)
    text(`Rent growing ${rentGrowth}% a year and value ${capitalGrowth}% a year from ${money(p.startValue)}. Percentage costs grow with rent; fixed costs and the mortgage payment stay flat. Before tax and selling costs.`, M, y, { maxWidth: CW }); y += 9
    // Headline strip
    statBoxes([
      { label: 'Profit over 10 yrs', value: money(last.cumulativeProfit), color: last.cumulativeProfit >= 0 ? GREEN : RED },
      { label: 'Value growth', value: money(last.equityGain), color: GOLD, sub: `to ${money(last.value)}` },
      ...(last.principalRepaid > 0 ? [{ label: 'Mortgage paid down', value: money(last.principalRepaid) }] : []),
      { label: 'Total return', value: money(last.totalReturn), color: last.totalReturn >= 0 ? GREEN : RED, sub: p.cashIn > 0 ? `${pct(last.roiOnCash)} of ${money(p.cashIn)} cash in` : undefined },
    ])
    // Bar chart: total return by year
    const chartH = 34, base = y + chartH, barGap = 3, barW = (CW - barGap * (p.rows.length - 1)) / p.rows.length
    const maxV = Math.max(1, ...p.rows.map(r => Math.max(0, r.totalReturn)))
    ensure(chartH + 12)
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.2); doc.line(M, base, W - M, base)
    p.rows.forEach((r, i) => {
      const h = Math.max(0.6, (Math.max(0, r.totalReturn) / maxV) * chartH)
      const x = M + i * (barW + barGap)
      doc.setFillColor(...(r.totalReturn >= 0 ? GOLD : RED)); doc.rect(x, base - h, barW, h, 'F')
      setFont(6, 'normal', MUTED); text(`Y${r.year}`, x + barW / 2, base + 3.5, { align: 'center' })
      setFont(6, 'normal', INK); text(money(r.totalReturn), x + barW / 2, base - h - 1.2, { align: 'center' })
    })
    y = base + 9
    // Table — keep the header and all ten rows together rather than
    // splitting two rows onto one page and eight onto the next.
    ensure(6 * (p.rows.length + 1) + 6)
    const cols = ['Year', 'Rent / mo', 'Profit / yr', 'Cumulative', 'Value', 'Equity', 'Total return']
    const cw = [14, 24, 26, 30, 28, 28, 28]
    const tableRow = (cells, opts = {}) => {
      ensure(6.5)
      let x = M
      cells.forEach((c, i) => {
        setFont(opts.head ? 7 : 8.5, opts.head ? 'bold' : 'normal', opts.head ? MUTED : (opts.colors?.[i] || INK))
        text(c, i === 0 ? x : x + cw[i] - 1, y, i === 0 ? {} : { align: 'right' })
        x += cw[i]
      })
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.2); doc.line(M, y + 2, M + cw.reduce((a, b) => a + b, 0), y + 2)
      y += 6
    }
    tableRow(cols.map(c => c.toUpperCase()), { head: true })
    for (const r of p.rows) {
      tableRow([String(r.year), money(r.grossMonthlyRent), money(r.annualProfit), money(r.cumulativeProfit), money(r.value), money(r.equity), money(r.totalReturn)],
        { colors: [MUTED, INK, r.annualProfit >= 0 ? INK : RED, r.cumulativeProfit >= 0 ? GREEN : RED, INK, INK, r.totalReturn >= 0 ? INK : RED] })
    }
    y += 2
  }

  // ── score + stress test ────────────────────────────────────────────────
  sectionTitle('Deal score & stress test')
  const labels = { yield: 'Yield', dscr: 'DSCR', stress: 'Stress test', cash_on_cash: 'Cash-on-cash', ltv: 'LTV' }
  kvRows([
    ['Overall score', `${score.score} / 100  ·  ${score.rating}`, scoreColor],
    ...Object.entries(score.breakdown || {}).map(([k, b]) => [labels[k] || k, `${b.value}  ·  ${b.points}/${b.max} pts`]),
  ])
  if (Array.isArray(stress) && stress.length) {
    ensure(8)
    setFont(8.5, 'bold', MUTED); text('DSCR at higher interest rates (lenders typically want 1.25 or more)', M, y); y += 5
    const cols = stress.length, cw = CW / cols
    ensure(16)
    stress.forEach((row, i) => {
      const x = M + i * cw
      doc.setFillColor(...CARD); doc.rect(x + 1, y, cw - 2, 14, 'F')
      doc.setFillColor(...(row.passes ? GREEN : RED)); doc.rect(x + 1, y, 1, 14, 'F')
      setFont(7, 'normal', MUTED); text(`@ ${row.rate}%`, x + 4, y + 4.5)
      setFont(10, 'bold', row.passes ? GREEN : RED); text(row.dscr != null ? Number(row.dscr).toFixed(2) : '—', x + 4, y + 9.5)
      setFont(6.5, 'normal', FAINT); text(`${money(row.monthlyPayment)}/mo · ${row.passes ? 'PASS' : 'FAIL'}`, x + 4, y + 13)
    })
    y += 19
  }

  // ── timeline ───────────────────────────────────────────────────────────
  const timeline = [
    ['Exchanged', dateGB(deal.exchanged_date)],
    ['Expected completion', dateGB(deal.expected_completion_date)],
    ['Target completion', dateGB(deal.target_completion_date)],
    ['Actual completion', dateGB(deal.actual_completion_date)],
    ['Refurb start', dateGB(deal.refurb_start_date)],
    ['Refurb end', dateGB(deal.refurb_end_date)],
  ].filter(r => r[1])
  if (timeline.length) { sectionTitle('Timeline'); kvRows(timeline) }

  // ── purchase tracker ───────────────────────────────────────────────────
  const enabled = milestones.filter(x => x.is_enabled !== false)
  if (enabled.length) {
    const done = enabled.filter(x => x.completed).length
    sectionTitle(`Purchase progress — ${done} of ${enabled.length} steps complete`)
    const stages = [...new Set(enabled.map(x => x.stage))]
    for (const st of stages) {
      ensure(7)
      setFont(8, 'bold', INK); text(STAGE_LABEL[st] || st, M, y); y += 4.5
      for (const ms of enabled.filter(x => x.stage === st).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
        ensure(5.2)
        doc.setDrawColor(...(ms.completed ? GREEN : BORDER)); doc.setLineWidth(0.4)
        if (ms.completed) { doc.setFillColor(...GREEN); doc.rect(M + 1, y - 3, 3, 3, 'FD') } else doc.rect(M + 1, y - 3, 3, 3, 'S')
        setFont(8.5, 'normal', ms.completed ? MUTED : INK); text(ms.label, M + 7, y)
        if (ms.completed_date) { setFont(8, 'normal', FAINT); text(dateGB(ms.completed_date), W - M, y, { align: 'right' }) }
        y += 5.2
      }
      y += 1.5
    }
  }

  // ── contacts ───────────────────────────────────────────────────────────
  if (contacts.length) {
    sectionTitle('Contacts')
    for (const c of contacts) {
      ensure(11)
      setFont(9.5, 'bold', INK); text(c.name || '—', M, y)
      setFont(8, 'normal', MUTED); text([CONTACT_ROLE[c.role] || c.role, c.company_name].filter(Boolean).join(' · '), W - M, y, { align: 'right' })
      y += 4.3
      const line = [c.phone, c.email, c.notes].filter(Boolean).join('   ·   ')
      if (line) { setFont(8, 'normal', MUTED); text(doc.splitTextToSize(line, CW)[0], M, y); y += 4.3 }
      y += 2
    }
  }

  // ── notes ──────────────────────────────────────────────────────────────
  if (deal.notes && String(deal.notes).trim()) {
    sectionTitle('Notes')
    paragraph(deal.notes)
  }

  // ── documents ──────────────────────────────────────────────────────────
  if (fileDocs.length) {
    sectionTitle(`Documents on file (${fileDocs.length})`)
    for (const d of fileDocs) {
      ensure(5.2)
      setFont(8.5, 'normal', INK); text(doc.splitTextToSize(d.caption || d.name || 'Document', CW - 50)[0], M, y)
      setFont(7.5, 'normal', FAINT); text([d.uploaded_by, dateGB(d.created_at)].filter(Boolean).join(' · '), W - M, y, { align: 'right' })
      y += 5.2
    }
    setFont(7.5, 'normal', FAINT); text('Documents are listed for reference; they are not embedded in this pack.', M, y + 1); y += 6
  }

  // ── photos ─────────────────────────────────────────────────────────────
  const gallery = photos.slice(1) // the first photo is the hero on page 1
  if (gallery.length) {
    doc.addPage(); y = M
    sectionTitle(`More photos (${gallery.length})`)
    const gap = 5, cellW = (CW - gap) / 2, maxH = 68
    for (let i = 0; i < gallery.length; i += 2) {
      const pair = gallery.slice(i, i + 2)
      const dims = pair.map(p => { const s = Math.min(cellW / p.w, maxH / p.h); return { w: p.w * s, h: p.h * s } })
      const rowH = Math.max(...dims.map(d => d.h)) + 9
      ensure(rowH)
      pair.forEach((p, j) => {
        const x = M + j * (cellW + gap), d = dims[j]
        doc.setFillColor(...CARD); doc.rect(x, y, cellW, d.h, 'F')
        try { doc.addImage(p.dataUrl, 'JPEG', x + (cellW - d.w) / 2, y, d.w, d.h) } catch (_) {}
        const cap = p.doc.caption || p.doc.name || ''
        setFont(8, 'normal', INK); text(doc.splitTextToSize(cap, cellW)[0] || '', x, y + d.h + 4)
        setFont(6.5, 'normal', FAINT); text([p.doc.uploaded_by, dateGB(p.doc.created_at)].filter(Boolean).join(' · '), x, y + d.h + 7.5)
      })
      y += rowH + 3
    }
  }
  if (photoDocs.length > photos.length) {
    ensure(6)
    setFont(7.5, 'normal', FAINT)
    text(`${photoDocs.length - photos.length} photo(s) could not be embedded (unsupported format) and are available in the app.`, M, y); y += 5
  }

  // ── footer on every page ───────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = H - FOOT + 4
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.line(M, fy, W - M, fy)
    if (logo) { try { doc.addImage(logo, 'PNG', M, fy + 2.5, 7, 7) } catch (_) {} }
    setFont(7, 'bold', INK); text('Prepared with Properly', M + (logo ? 9 : 0), fy + 5.5)
    setFont(6.5, 'normal', MUTED); text('Figures are estimates based on the deal analysis entered; verify before relying on them.', M + (logo ? 9 : 0), fy + 9.2)
    setFont(7, 'normal', MUTED); text(`Page ${p} of ${pages}`, W - M, fy + 5.5, { align: 'right' })
  }

  const slug = String(deal.name || deal.address || 'deal').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60)
  doc.save(`deal-pack-${slug || 'deal'}-${new Date().toISOString().slice(0, 10)}.pdf`)
  return { photos: photos.length, documents: fileDocs.length, pages }
}
