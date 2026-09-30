// ── EXTERNAL LOAN STATEMENT PDF ─────────────────────────────────────────────
// A statement for one loan (to send to the lender), or a report covering a
// set of loans (overview page, then one statement per loan). Shows the loan
// terms, what has been paid and when, what is overdue and what is still to
// come.
//
// Same look as the Reports PDFs (shared reportPdfKit): letterhead with the
// company's logo and brand colour, KPI tiles, bordered tables, Properly
// footer with page numbers. jsPDF is lazy-loaded from the CDN and drawn with
// the built-in Helvetica, so there is nothing to embed.
//
// Outward-facing by design: the loan's internal `notes` are never printed.

import { loadCdnScript } from './loadCdnScript'
import { loanStatus, statementLines, summariseLoans, REPAYMENT_TYPES, LENDER_TYPES, todayISO } from './externalLoans'
import { createPdfWriter, loadPdfImage, hexToRgb, PALETTE } from './reportPdfKit'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

const { ink: DARK, slate: SLATE, muted: MUTED, green: GREEN, red: RED } = PALETTE

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
  const today = todayISO()

  const [logo, mark] = await Promise.all([
    headCoId ? loadPdfImage(companySettings?.[headCoId]?.logo_url) : null,
    loadPdfImage('/icon-512.png', 256),
  ])

  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const k = createPdfWriter(doc, {
    accent: hexToRgb(headCo?.color), logo, mark,
    footerLabel: single ? `${list[0].lender_name} - loan statement` : `${headCo?.name || 'All companies'} - external loans`,
  })
  const accent = k.accent
  const { kpis, heading, note } = k
  const header = (title, subtitle) => k.letterhead({
    title, subtitle,
    meta: [`Position at ${longDate(today)}`, single ? 'Loan statement' : 'External loans report'],
  })
  const detailRows = k.details
  // cols: [{ label, w (fraction of width), align }]; rows: [{ cells, colors, bold }]
  const table = (cols, rows, totals) => k.table({ headers: cols, rows, totals })

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
      k.newPage()
      k.sectionBand(loan.lender_name, `${coById.get(loan.company_id)?.name || ''}${loan.reference ? ` - ref ${loan.reference}` : ''}`)
      statement(loan)
    }
  }

  const pages = k.finish()

  const slug = s => String(s || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50)
  doc.save(single
    ? `loan-statement-${slug(list[0].lender_name) || 'loan'}-${today}.pdf`
    : `external-loans-${slug(headCo?.name) || 'all-companies'}-${today}.pdf`)
  return { pages }
}
