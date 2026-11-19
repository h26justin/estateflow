// ── DEALS EXCEL WORKBOOK ─────────────────────────────────────────────────────
// The Deals export (Deals brief §10) as a multi-sheet .xlsx, built from the
// same export model as the PDF and the CSVs (lib/dealExport), so the workbook
// never disagrees with the screen. Sheets:
//   Dashboard                 per-company headlines, the as-of date and filters
//   Deals                     one row per deal
//   Cost lines                every itemised line, estimate component and funding row
//   Completion funding        the weekly schedule per company
//   Assumptions & methodology the model's methodology and each company's working
//   Data quality              gaps to fill before relying on the numbers
//
// Where a reader would want to check a number, the cell is a real Excel
// formula over the cells next to it (balance due = total − credits, cash need
// = MAX(0, balance − confirmed financing), gap = MAX(0, need − cash), the
// running weekly total and shortfall, and the column totals). A formula is
// only written when it gives exactly the model's figure; otherwise the
// model's value is written as a number, so the sheet can never drift.
//
// Contacts are never included: rows come from the model's whitelisted
// fields and cost-line / funding notes are not in the model at all.
//
// buildDealsWorkbook is pure (no DOM, no library). exportDealsXlsx loads
// write-excel-file on demand, so it lands in its own lazy chunk, like jsPDF
// (lib/pdfLibs), and never in the entry bundle.

import { modelGroups, exportFileName } from './dealExport'
import { COST_STATE_LABEL, dateGB } from './dealFinance'

export const SHEET_NAMES = Object.freeze({
  dashboard: 'Dashboard',
  deals: 'Deals',
  lines: 'Cost lines',
  funding: 'Completion funding',
  methodology: 'Assumptions & methodology',
  dataQuality: 'Data quality',
})

const GBP = '"£"#,##0.00;-"£"#,##0.00'
const pence = v => Math.round((Number(v) || 0) * 100)
const isNum = v => v != null && v !== '' && Number.isFinite(Number(v))

/** Column letter for a 0-based index: 0 -> A, 26 -> AA. */
export function colLetter(i) {
  let n = i + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// ── cell helpers ────────────────────────────────────────────────────────────
const text = (v, extra) => (v == null || v === '' ? null : { value: String(v), type: String, ...extra })
const bold = v => text(v, { fontWeight: 'bold' })
const head = v => ({ value: String(v), type: String, fontWeight: 'bold', backgroundColor: '#E8ECE9', wrap: true, alignVertical: 'top' })
const int = v => (isNum(v) ? { value: Number(v), type: Number } : null)
const money = (v, extra) => (isNum(v) ? { value: Math.round(Number(v) * 100) / 100, type: Number, format: GBP, ...extra } : null)
const formula = (f, extra) => ({ value: f, type: 'Formula', format: GBP, ...extra })
const yesNo = v => (v == null ? null : text(v ? 'Yes' : 'No'))
const isoDate = v => (v ? text(v) : null)

/**
 * A formula cell when `expected` (the model's figure) equals what the formula
 * gives on the inputs to the penny, else the model's value as a number.
 */
function checked(f, computed, expected, extra) {
  if (!isNum(expected)) return null
  return computed != null && pence(computed) === pence(expected) ? formula(f, extra) : money(expected, extra)
}

const columnsOf = widths => widths.map(width => ({ width }))

// ── Dashboard ───────────────────────────────────────────────────────────────
const DASH_HEADERS = ['Company', 'Live deals', 'Balance due', 'Confirmed financing', 'Cash need', 'Cash available', 'Cash as of',
  'Funding gap', 'Refurb forecast', 'Gap with refurb', 'Deals with unknown need', 'Estimates']

function dashboardSheet(model, groups, title) {
  const data = [
    [bold(title || 'Deals: costs, funding and cash need')],
    [bold('As of'), text(model.asOfLabel)],
    [bold('As-of date'), text(model.asOfDate)],
    [bold('Filters'), text(model.filters.text)],
    [],
    DASH_HEADERS.map(head),
  ]
  const first = data.length + 1 // 1-based row of the first company
  groups.forEach((g, i) => {
    const r = first + i
    const t = g.totals
    const cash = g.company.unassigned ? null : t.cash
    const cash0 = cash == null ? 0 : cash
    data.push([
      text(g.company.name),
      int(t.liveDeals),
      money(t.balanceDue),
      money(t.financingConfirmed),
      money(t.cashNeed),
      money(cash),
      g.company.unassigned ? text('n/a: no company') : t.cashAsOf ? text(t.cashAsOf) : text('Not entered (taken as £0)'),
      checked(`MAX(0,E${r}-F${r})`, Math.max(0, (pence(t.cashNeed) - pence(cash0)) / 100), t.fundingGap),
      money(t.refurbForecast),
      checked(`MAX(0,E${r}+I${r}-F${r})`, Math.max(0, (pence(t.cashNeed) + pence(t.refurbForecast) - pence(cash0)) / 100), t.combinedGap),
      int(t.unknownCount),
      int(t.estimateCount),
    ])
  })
  if (groups.length) {
    const last = first + groups.length - 1
    const T = model.totals
    const sumOf = (col, key) => {
      const values = groups.map(g => (key === 'cash' ? (g.company.unassigned ? 0 : g.totals.cash || 0) : g.totals[key]))
      return checked(`SUM(${col}${first}:${col}${last})`, values.reduce((s, v) => s + pence(v), 0) / 100, T[key], { fontWeight: 'bold' })
    }
    data.push([
      bold('Total'),
      { value: `SUM(B${first}:B${last})`, type: 'Formula', fontWeight: 'bold' },
      sumOf('C', 'balanceDue'), sumOf('D', 'financingConfirmed'), sumOf('E', 'cashNeed'), sumOf('F', 'cash'), null,
      sumOf('H', 'fundingGap'), sumOf('I', 'refurbForecast'), sumOf('J', 'combinedGap'),
      { value: `SUM(K${first}:K${last})`, type: 'Formula', fontWeight: 'bold' },
      { value: `SUM(L${first}:L${last})`, type: 'Formula', fontWeight: 'bold' },
    ])
  } else {
    data.push([text('No deals match these filters.')])
  }
  data.push([])
  data.push([text('Funding gap = MAX(0, cash need − cash available), worked out per company. The total is the sum of each company\'s gap: one company\'s cash cannot pay for another company\'s purchase.')])
  data.push([text('Unknown is not zero: a deal with no price and no completion statement is counted under "Deals with unknown need" and left out of the sums.')])
  if (model.totals.financingExpected > 0) data.push([text(`Expected financing of £${model.totals.financingExpected.toFixed(2)} is listed on the Deals sheet but not deducted until it is confirmed.`)])
  return { sheet: SHEET_NAMES.dashboard, data, columns: columnsOf([30, 10, 15, 15, 15, 15, 16, 15, 15, 15, 12, 10]) }
}

// ── Deals ───────────────────────────────────────────────────────────────────
const DEAL_HEADERS = ['Company', 'Deal', 'Address', 'Stage', 'Attention', 'Next action', 'Next action due',
  'Purchase price', 'Completion total', 'Credits', 'Balance due', 'Basis', 'State',
  'Confirmed financing', 'Expected financing', 'Cash need', 'Refurb forecast', 'Refurb basis',
  'Expected completion', 'Counts in funding', 'Not counted because', 'Group role', 'Part of', 'Missing data']
// Columns used by formulas: I total, J credits, K balance, N confirmed, P need.

function dealsSheet(groups) {
  const data = [DEAL_HEADERS.map(head)]
  for (const g of groups) {
    for (const r of g.deals) {
      const row = data.length + 1
      const balance = r.completionTotal != null && r.credits != null
        ? checked(`I${row}-J${row}`, (pence(r.completionTotal) - pence(r.credits)) / 100, r.balanceDue)
        : money(r.balanceDue)
      const need = r.balanceDue != null
        ? checked(`MAX(0,K${row}-N${row})`, Math.max(0, (pence(r.balanceDue) - pence(r.financingConfirmed)) / 100), r.cashNeed)
        : money(r.cashNeed)
      data.push([
        text(g.company.name), text(r.name), text(r.address), text(r.stage), text(r.attention), text(r.nextAction), isoDate(r.nextActionDue),
        money(r.price), money(r.completionTotal), money(r.credits), balance, text(r.basisLabel), text(r.stateLabel),
        money(r.financingConfirmed), money(r.financingExpected), need, money(r.refurbForecast), text(r.refurbBasisLabel),
        isoDate(r.expectedCompletion), yesNo(r.countsInFunding), text(r.excludedReason),
        text(r.groupRole === 'unit' ? 'Unit' : r.groupRole === 'parent' ? `Group parent (${r.unitCount} unit${r.unitCount === 1 ? '' : 's'})` : ''),
        text(r.partOf), text(r.missing.join('; ')),
      ])
    }
  }
  return {
    sheet: SHEET_NAMES.deals, data, stickyRowsCount: 1,
    columns: columnsOf([22, 26, 26, 16, 18, 26, 13, 14, 14, 12, 14, 22, 12, 14, 14, 14, 14, 26, 13, 10, 14, 18, 22, 40]),
  }
}

// ── Cost lines ──────────────────────────────────────────────────────────────
const GROUP_LABEL = { completion: 'Completion', credit: 'Credit (deducted)', refurb: 'Refurb (separate)', other: 'Not counted' }
const LINE_HEADERS = ['Company', 'Deal', 'Record type', 'Category', 'Counts towards', 'Label', 'Amount', 'State',
  'Due / expected date', 'VAT included', 'Source', 'Deducted from cash need', 'Deal counts in funding']

function linesSheet(groups) {
  const data = [LINE_HEADERS.map(head)]
  for (const g of groups) {
    for (const r of g.deals) {
      const base = [text(g.company.name), text(r.name)]
      const live = yesNo(r.countsInFunding)
      for (const l of r.lines) {
        data.push([...base, text('Cost line'), text(l.categoryLabel), text(GROUP_LABEL[l.group] || l.group), text(l.label), money(l.amount),
          text(l.stateLabel), isoDate(l.dueDate), yesNo(l.vatIncluded), text(l.source), null, live])
      }
      for (const c of r.estimateComponents) {
        data.push([...base, text('Estimate from deal fields'), text(c.label), text(GROUP_LABEL.completion), null, money(c.amount),
          text(COST_STATE_LABEL.estimate), null, null, text('Deal analysis'), null, live])
      }
      if (r.refurbEstimate != null) {
        data.push([...base, text('Estimate from deal fields'), text('Refurb cost'), text(GROUP_LABEL.refurb), null, money(r.refurbEstimate),
          text(COST_STATE_LABEL.estimate), null, null, text('Deal analysis'), null, live])
      }
      for (const f of r.funding) {
        data.push([...base, text('Funding'), text(f.sourceLabel), text('Financing'), text(f.label), money(f.amount),
          text(f.stateLabel), isoDate(f.expectedDate), null, null, yesNo(f.deducted), live])
      }
    }
  }
  return { sheet: SHEET_NAMES.lines, data, stickyRowsCount: 1, columns: columnsOf([22, 26, 22, 24, 18, 26, 14, 12, 14, 10, 20, 12, 12]) }
}

// ── Completion funding (weekly schedule) ────────────────────────────────────
const WEEK_HEADERS = ['Week commencing', 'Week ending', 'Overdue', 'Deals', 'Need', 'Deals with unknown need', 'Cumulative need', 'Cash available', 'Shortfall']

function fundingSheet(groups) {
  const data = []
  for (const g of groups) {
    const f = g.funding
    const nameOf = id => g.deals.find(r => r.id === id)?.name || 'Deal'
    if (data.length) data.push([])
    data.push([bold(g.company.name)])
    data.push(WEEK_HEADERS.map(head))
    const cash = f.cash ? f.cash.amount : 0
    let prevRow = null, running = 0
    for (const wk of f.weeks) {
      const row = data.length + 1
      running += pence(wk.need)
      const cum = prevRow == null
        ? checked(`E${row}`, wk.need, wk.cumulative)
        : checked(`G${prevRow}+E${row}`, running / 100, wk.cumulative)
      data.push([
        text(wk.week), text(wk.weekEnd), yesNo(wk.overdue), text(wk.deals.map(nameOf).join(', ')),
        money(wk.need), int(wk.unknownCount), cum, money(cash),
        checked(`MAX(0,G${row}-H${row})`, Math.max(0, (running - pence(cash)) / 100), wk.shortfall),
      ])
      prevRow = row
    }
    if (f.unscheduled.deals.length) {
      data.push([text('Unscheduled'), null, null, text(f.unscheduled.deals.map(nameOf).join(', ')), money(f.unscheduled.need), int(f.unscheduled.unknownCount)])
    }
    if (!f.weeks.length && !f.unscheduled.deals.length) data.push([text('No live deals to schedule.')])
    data.push([text(g.company.unassigned
      ? 'No company: no cash available is recorded, so the shortfall is the cumulative need.'
      : f.cash ? `Cash available: latest position as of ${dateGB(f.cash.asOf)}, counted once for the company.` : 'Cash available: not entered, so taken as £0.')])
  }
  if (!data.length) data.push([text('No deals match these filters.')])
  return { sheet: SHEET_NAMES.funding, data, columns: columnsOf([16, 14, 9, 48, 14, 12, 15, 15, 14]) }
}

// ── Methodology and data quality ───────────────────────────────────────────
function methodologySheet(model, groups) {
  const data = [[head('Assumptions & methodology')]]
  for (const s of model.methodology) data.push([text(s, { wrap: true })])
  for (const g of groups) {
    data.push([])
    data.push([head(`How calculated: ${g.company.name}`)])
    for (const s of g.funding.explain) data.push([text(s, { wrap: true })])
  }
  return { sheet: SHEET_NAMES.methodology, data, columns: columnsOf([120]) }
}

function dataQualitySheet(model) {
  const data = [[head('Data quality: gaps to fill before relying on these numbers')]]
  for (const s of model.dataQuality) data.push([text(s, { wrap: true })])
  return { sheet: SHEET_NAMES.dataQuality, data, columns: columnsOf([120]) }
}

/**
 * The workbook as write-excel-file's multi-sheet input: an array of
 * { sheet, data, columns, stickyRowsCount? }. Pure.
 */
export function buildDealsWorkbook(model, { title } = {}) {
  const groups = modelGroups(model)
  return [
    dashboardSheet(model, groups, title),
    dealsSheet(groups),
    linesSheet(groups),
    fundingSheet(groups),
    methodologySheet(model, groups),
    dataQualitySheet(model),
  ]
}

/** Build and download the workbook. Returns { sheets }. */
export async function exportDealsXlsx(model, opts = {}) {
  const mod = await import('write-excel-file/browser')
  const writeExcelFile = mod.default || mod
  const sheets = buildDealsWorkbook(model, opts)
  await writeExcelFile(sheets, { fontFamily: 'Calibri', fontSize: 11 }).toFile(exportFileName(model, 'deals', 'xlsx'))
  return { sheets: sheets.length }
}
