// ── EXTERNAL LOAN STATEMENT PDF ─────────────────────────────────────────────
// A statement for one loan (to send to the lender), or a report covering a
// set of loans (overview page, then one statement per loan). Shows the loan
// terms, what has been paid and when, what is overdue and what is still to
// come.
//
// Same look as the Reports PDFs (ReportsPage renderReportPDF): cream paper,
// white cards, the company's logo and brand colour in the header, Properly
// footer with page numbers. jsPDF is lazy-loaded from the CDN and drawn with
// the built-in Helvetica, so there is nothing to embed.
//
// Outward-facing by design: the loan's internal `notes` are never printed.

import { loadCdnScript } from './loadCdnScript'
import { loanStatus, statementLines, summariseLoans, REPAYMENT_TYPES, LENDER_TYPES, todayISO } from './externalLoans'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

// Redesign palette (design/redesign-2026), identical to the Reports PDFs.
const CREAM  = [244, 243, 239]
const WHITE  = [255, 255, 255]
const BORDER = [228, 225, 217]
const GOLD   = [184, 144, 47]
const DARK   = [28, 40, 48]
const SLATE  = [20, 32, 42]
const MUTED  = [92, 102, 112]
const FAINT  = [104, 109, 114]
const GREEN  = [31, 157, 99]
const RED    = [184, 57, 45]

const money  = n => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')
const dateGB = iso => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
const longDate = iso => new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const typeLabel = v => REPAYMENT_TYPES.find(t => t.value === v)?.short || v
const lenderTypeLabel = v => LENDER_TYPES.find(t => t.value === v)?.label || v
const termLabel = m => {
  const n = Number(m) || 0
  return n % 12 === 0 ? `${n / 12} year${n === 12 ? '' : 's'} (${n} months)` : `${n} months`
}
const hexToRgb = h => (h || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)?.slice(1).map(x => parseInt(x, 16))
// Helvetica only has Latin-1 glyphs.
const clean = s => String(s ?? '')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[•·]/g, '-')
  .replace(/[^\u0009\u000A -~ -ÿ]/g, '').replace(/ {2,}/g, ' ').trim()

async function loadImg(url) {
  try {
    const r = await fetch(url); if (!r.ok) return null
    const b = await r.blob()
    return await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b) })
  } catch (_) { return null }
}

/**
 * Build and download the PDF.
 * @param {object}   opts
 * @param {object[]} opts.loans            one loan = a statement; several = a report
 * @param {object[]} opts.companies        company rows (name, color)
 * @param {object}   [opts.companySettings] { [companyId]: { logo_url } }
 * @param {object[]} [opts.properties]     for the linked property's address
 * @param {string}   [opts.companyId]      the company filter in force (report)
 */
export async function exportLoansPdf({ loans, companies = [], companySettings = {}, properties = [], companyId = null }) {
  const list = (loans || []).filter(l => l && !l.deleted_at)
  if (!list.length) throw new Error('No loans to export')
  const single = list.length === 1
  const coById = new Map(companies.map(c => [c.id, c]))
  const propById = new Map(properties.map(p => [p.id, p]))
  const loanCos = [...new Set(list.map(l => l.company_id))]
  const headCoId = single ? list[0].company_id : (companyId || (loanCos.length === 1 ? loanCos[0] : null))
  const headCo = headCoId ? coById.get(headCoId) : null
  const accent = hexToRgb(headCo?.color) || GOLD
  const today = todayISO()

  const [coLogo, opLogo] = await Promise.all([
    headCoId && companySettings?.[headCoId]?.logo_url ? loadImg(companySettings[headCoId].logo_url) : null,
    loadImg('/icon-512.png'),
  ])

  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 14, CW = W - M * 2, BOTTOM = H - 26
  let y = 0

  const setFont = (size, style = 'normal', color = DARK) => { doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color) }
  const text = (s, x, yy, opts) => doc.text(clean(s), x, yy, opts)
  const card = (x, yy, w, h) => {
    doc.setFillColor(...WHITE); doc.roundedRect(x, yy, w, h, 2.5, 2.5, 'F')
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.roundedRect(x, yy, w, h, 2.5, 2.5, 'S')
  }
  const paper = () => { doc.setFillColor(...CREAM); doc.rect(0, 0, W, H, 'F') }
  const newPage = () => { doc.addPage(); paper(); y = 14 }
  const ensure = h => { if (y + h > BOTTOM) newPage() }

  function header(title, subtitle) {
    doc.setFillColor(...accent); doc.rect(0, 0, W, 3, 'F')
    card(M, 8, CW, 30)
    let tx = M + 8
    if (coLogo) { try { doc.addImage(coLogo, 'PNG', M + 5, 12, 22, 11); tx = M + 32 } catch (_) { /* bad image */ } }
    else if (opLogo) { try { doc.addImage(opLogo, 'PNG', M + 6, 13, 11, 11); tx = M + 22 } catch (_) { /* bad image */ } }
    const maxW = CW - (tx - M) - 52
    setFont(16, 'bold'); text(doc.splitTextToSize(clean(title), maxW)[0], tx, 19)
    setFont(10, 'normal', MUTED); text(doc.splitTextToSize(clean(subtitle), maxW)[0], tx, 26)
    setFont(8, 'normal', FAINT)
    text(`Position at ${longDate(today)}`, W - M - 6, 18, { align: 'right' })
    text(single ? 'Loan statement' : 'External loans report', W - M - 6, 24, { align: 'right' })
    doc.setFillColor(...accent); doc.rect(M, 36.5, CW, 1, 'F')
    y = 44
  }

  function kpis(items) {
    const perRow = 4, gap = 5
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow)
      const kw = (CW - (row.length - 1) * gap) / row.length
      ensure(22)
      row.forEach((k, j) => {
        const x = M + j * (kw + gap)
        card(x, y, kw, 19)
        doc.setFillColor(...(k.color || accent)); doc.rect(x, y + 3, 1.2, 13, 'F')
        setFont(6.5, 'normal', MUTED); text(k.label.toUpperCase(), x + 5, y + 6.5)
        setFont(12.5, 'bold', k.color || DARK); text(doc.splitTextToSize(clean(k.value), kw - 7)[0], x + 5, y + 12.5)
        if (k.sub) { setFont(6.5, 'normal', FAINT); text(doc.splitTextToSize(clean(k.sub), kw - 7)[0], x + 5, y + 16.5) }
      })
      y += 24
    }
    y += 1
  }

  function heading(s) {
    ensure(30)
    setFont(10.5, 'bold'); text(s, M, y + 4)
    doc.setFillColor(...accent); doc.rect(M, y + 6.5, 26, 0.9, 'F')
    y += 12
  }

  // Label / value rows inside a white card; the card splits cleanly if it
  // runs onto a new page.
  function detailRows(rows) {
    const shown = rows.filter(r => r && r[1] != null && r[1] !== '')
    const rh = 6.5
    ensure(Math.min(shown.length, 4) * rh + 4)
    let start = y
    const close = () => { doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.roundedRect(M, start, CW, y - start + 1.5, 2.5, 2.5, 'S') }
    y += 2
    shown.forEach(([k, v], i) => {
      if (y + rh > BOTTOM) { close(); newPage(); start = y; y += 2 }
      doc.setFillColor(...WHITE); doc.rect(M + 0.4, y - 1.6, CW - 0.8, rh + 0.2, 'F')
      setFont(9, 'normal', MUTED); text(k, M + 5, y + 3.2)
      setFont(9, 'bold', SLATE); text(doc.splitTextToSize(clean(v), CW * 0.58)[0], W - M - 5, y + 3.2, { align: 'right' })
      if (i < shown.length - 1) { doc.setDrawColor(...BORDER); doc.setLineWidth(0.15); doc.line(M + 3, y + rh - 1.4, W - M - 3, y + rh - 1.4) }
      y += rh
    })
    close()
    y += 7
  }

  // cols: [{ label, w (fraction of CW), align }]; rows: [{ cells, color: [..] per cell or null, bold }]
  function table(cols, rows, totals) {
    const xs = []; let acc = M
    cols.forEach(c => { xs.push(acc); acc += c.w * CW })
    const cellX = (i, align) => align === 'right' ? xs[i] + cols[i].w * CW - 3 : xs[i] + 3
    const head = () => {
      card(M, y, CW, 8)
      setFont(6.8, 'bold', MUTED)
      cols.forEach((c, i) => text(c.label.toUpperCase(), cellX(i, c.align), y + 5.3, c.align === 'right' ? { align: 'right' } : undefined))
      y += 9.5
    }
    ensure(24); head()
    rows.forEach((r, ri) => {
      // A cell given as an array prints as two lines (e.g. an underpayment).
      const rh = r.cells.some(c => Array.isArray(c)) ? 9.6 : 6.2
      if (y + rh > BOTTOM) { newPage(); head() }
      if (ri % 2 === 0) { doc.setFillColor(...WHITE); doc.rect(M, y - 1.4, CW, rh, 'F') }
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.15); doc.line(M + 2, y + rh - 1.4, W - M - 2, y + rh - 1.4)
      r.cells.forEach((cell, i) => {
        const opts = cols[i].align === 'right' ? { align: 'right' } : undefined
        const [first, second] = Array.isArray(cell) ? cell : [cell]
        setFont(8.2, r.bold?.[i] ? 'bold' : 'normal', r.colors?.[i] || SLATE)
        text(doc.splitTextToSize(clean(first), cols[i].w * CW - 5)[0] || '', cellX(i, cols[i].align), y + 3.3, opts)
        if (second) { setFont(7, 'normal', MUTED); text(doc.splitTextToSize(clean(second), cols[i].w * CW - 5)[0] || '', cellX(i, cols[i].align), y + 6.9, opts) }
      })
      y += rh
    })
    if (totals) {
      if (y + 10 > BOTTOM) { newPage(); head() }
      y += 1
      doc.setFillColor(...accent); doc.rect(M, y - 2, CW, 0.8, 'F')
      card(M, y - 0.5, CW, 8)
      setFont(8.4, 'bold')
      totals.forEach((cell, i) => { if (cell) text(cell, cellX(i, cols[i].align), y + 4.5, cols[i].align === 'right' ? { align: 'right' } : undefined) })
      y += 10
    }
    y += 4
  }

  function note(s) {
    setFont(7.5, 'italic', MUTED)
    const lines = doc.splitTextToSize(clean(s), CW - 4)
    ensure(lines.length * 3.6 + 3)
    doc.text(lines, M + 2, y); y += lines.length * 3.6 + 3
  }

  const STATUS_TXT = { paid: 'Paid', overdue: 'Overdue', due: 'Next due', upcoming: 'Upcoming' }

  function statement(loan) {
    const co = coById.get(loan.company_id)
    const prop = propById.get(loan.property_id)
    const s = loanStatus(loan, today)
    const lines = statementLines(loan, today)
    const rolled = loan.repayment_type === 'rolled_up'
    const nextLine = lines.find(l => l.status === 'due')

    kpis([
      { label: 'Amount borrowed', value: money0(loan.principal), sub: `received ${dateGB(loan.received_date)}` },
      { label: rolled ? 'Repaid at end' : 'Monthly payment', value: money(rolled ? s.totalRepayable : s.regularPayment), sub: `${Number(loan.annual_rate) || 0}% a year - ${typeLabel(loan.repayment_type).toLowerCase()}` },
      { label: 'Paid so far', value: money(s.paidToDate), sub: `${s.paidCount} of ${s.periods} payment${s.periods === 1 ? '' : 's'}`, color: GREEN },
      { label: 'Capital outstanding', value: money(s.outstanding), sub: s.status === 'repaid' ? 'repaid in full' : `final payment ${dateGB(s.finalDate)}` },
      s.overdueCount
        ? { label: 'Overdue', value: money(s.overdueAmount), sub: `${s.overdueCount} payment${s.overdueCount === 1 ? '' : 's'} not yet received`, color: RED }
        : { label: 'Next payment', value: nextLine ? money(nextLine.payment) : 'None', sub: nextLine ? `due ${dateGB(nextLine.due_date)}` : 'loan repaid' },
      { label: 'Total interest', value: money(s.totalInterest), sub: `over the term` },
      { label: 'Total to repay', value: money(s.totalRepayable), sub: 'capital plus interest' },
      { label: 'Still to pay', value: money(Math.max(0, s.totalRepayable - lines.filter(l => l.status === 'paid').reduce((a, l) => a + l.payment, 0))), sub: `${s.periods - s.paidCount} payment${s.periods - s.paidCount === 1 ? '' : 's'} left` },
    ])

    heading('Loan details')
    detailRows([
      ['Lender', loan.lender_name],
      ['Type of lender', lenderTypeLabel(loan.lender_type)],
      ['Borrower', co?.name],
      ['Reference', loan.reference],
      ['Amount borrowed', money(loan.principal)],
      ['Money received', longDate(loan.received_date)],
      ['Interest rate', `${Number(loan.annual_rate) || 0}% a year`],
      ['Term', termLabel(loan.term_months)],
      ['Repayment', REPAYMENT_TYPES.find(t => t.value === loan.repayment_type)?.label],
      ['First payment due', lines[0] ? longDate(lines[0].due_date) : null],
      ['Final payment due', s.finalDate ? longDate(s.finalDate) : null],
      ['Property', prop ? (prop.address || prop.name) : null],
      ['Purpose', loan.purpose],
    ])

    heading(`Payment schedule (${lines.length} payment${lines.length === 1 ? '' : 's'})`)
    const cols = [
      { label: '#', w: 0.06 }, { label: 'Due', w: 0.15 }, { label: 'Payment', w: 0.14, align: 'right' },
      { label: 'Interest', w: 0.13, align: 'right' }, { label: 'Capital', w: 0.14, align: 'right' },
      { label: 'Balance after', w: 0.16, align: 'right' }, { label: 'Status', w: 0.22 },
    ]
    const rows = lines.map(l => {
      const status = l.status === 'paid'
        ? (Math.abs(l.paid_amount - l.payment) > 0.005 ? [`Paid ${dateGB(l.paid_date)}`, `${money(l.paid_amount)} received`] : `Paid ${dateGB(l.paid_date)}`)
        : STATUS_TXT[l.status]
      const col = l.status === 'paid' ? GREEN : l.status === 'overdue' ? RED : l.status === 'due' ? accent : MUTED
      return {
        cells: [String(l.period), dateGB(l.due_date), money(l.payment), money(l.interest), money(l.principal), money(l.balance), status],
        colors: [MUTED, l.status === 'overdue' ? RED : SLATE, DARK, SLATE, SLATE, SLATE, col],
        bold: [false, l.status === 'overdue', true, false, false, false, l.status !== 'upcoming'],
      }
    })
    table(cols, rows, ['', 'Total', money(s.totalRepayable), money(s.totalInterest), money(loan.principal), '', `Paid ${money(s.paidToDate)}`])
    note('Balance after is the capital still owed once that payment is made. Paid dates and amounts are as recorded by the borrower; where an amount paid differs from the schedule it is shown under the date, and the schedule is not recalculated. '
      + (loan.repayment_type === 'interest_only' ? 'Interest only: the capital is repaid with the final payment.' : loan.repayment_type === 'rolled_up' ? 'Rolled up: capital and simple interest are repaid in one payment at the end of the term.' : ''))
  }

  paper()
  if (single) {
    const loan = list[0]
    header(loan.lender_name, `Loan statement - ${coById.get(loan.company_id)?.name || ''}`)
    statement(loan)
  } else {
    header(headCo?.name || 'All companies', 'External loans report')
    const sum = summariseLoans(list, today)
    kpis([
      { label: 'Loans running', value: String(sum.active), sub: `${money0(sum.borrowed)} borrowed` },
      { label: 'Capital outstanding', value: money0(sum.outstanding) },
      { label: 'Monthly payments', value: money(sum.monthlyOutgoing), sub: 'regular monthly total' },
      sum.overdueCount
        ? { label: 'Overdue', value: money(sum.overdueAmount), sub: `${sum.overdueCount} payment${sum.overdueCount === 1 ? '' : 's'}`, color: RED }
        : { label: 'Due next 30 days', value: money(sum.dueNext30), sub: 'nothing overdue', color: GREEN },
    ])
    heading(`Loans (${list.length})`)
    const cols = [
      { label: 'Lender', w: 0.24 }, { label: 'Borrower', w: 0.12 }, { label: 'Borrowed', w: 0.12, align: 'right' },
      { label: 'Terms', w: 0.14 }, { label: 'Monthly', w: 0.12, align: 'right' }, { label: 'Paid', w: 0.1, align: 'right' },
      { label: 'Outstanding', w: 0.16, align: 'right' },
    ]
    const withS = list.map(l => ({ l, s: loanStatus(l, today) }))
    table(cols, withS.map(({ l, s }) => ({
      cells: [l.lender_name, coById.get(l.company_id)?.abbr || coById.get(l.company_id)?.name || '', money0(l.principal),
        `${Number(l.annual_rate) || 0}% - ${Math.round(l.term_months / 12 * 10) / 10}y`, l.repayment_type === 'rolled_up' ? 'at end' : money(s.regularPayment),
        `${s.paidCount}/${s.periods}`, s.status === 'repaid' ? 'Repaid' : money0(s.outstanding)],
      colors: [DARK, MUTED, SLATE, SLATE, DARK, s.overdueCount ? RED : SLATE, s.status === 'repaid' ? GREEN : DARK],
      bold: [true, false, false, false, true, false, true],
    })), ['Total', '', money0(list.reduce((a, l) => a + Number(l.principal || 0), 0)), '', money(sum.monthlyOutgoing), '', money0(sum.outstanding)])
    note('A statement for each loan follows, one per page.')
    for (const loan of list) {
      newPage()
      setFont(13, 'bold'); text(loan.lender_name, M, y + 3)
      setFont(8.5, 'normal', MUTED); text(`${coById.get(loan.company_id)?.name || ''}${loan.reference ? ` - ref ${loan.reference}` : ''}`, M, y + 8.5)
      doc.setFillColor(...accent); doc.rect(M, y + 11, CW, 0.8, 'F')
      y += 17
      statement(loan)
    }
  }

  // Footer on every page, same as the Reports PDFs.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = H - 18
    doc.setFillColor(...CREAM); doc.rect(0, fy - 2, W, 20, 'F')
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.line(M, fy, W - M, fy)
    doc.setFillColor(...accent); doc.rect(M, fy, CW, 0.6, 'F')
    if (opLogo) { try { doc.addImage(opLogo, 'PNG', M, fy + 2.5, 9, 9) } catch (_) { /* bad image */ } }
    const lx = opLogo ? M + 12 : M
    setFont(7.5, 'bold'); text('Generated by Properly', lx, fy + 7)
    setFont(6.5, 'normal', MUTED); text('Property portfolios, properly', lx, fy + 11)
    setFont(6, 'normal', FAINT); text('ownproperly.com', lx, fy + 14.5)
    setFont(7, 'normal', MUTED); text(`Page ${p} of ${pages}`, W - M, fy + 8, { align: 'right' })
  }

  const slug = s => String(s || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50)
  doc.save(single
    ? `loan-statement-${slug(list[0].lender_name) || 'loan'}-${today}.pdf`
    : `external-loans-${slug(headCo?.name) || 'all-companies'}-${today}.pdf`)
  return { pages }
}
