// Pure report builders shared by the Reports screen, its PDF export and its
// CSV export. Reports feed landlords' year-end tax packs, so the rule is one
// builder per report: it returns the rows and totals as numbers, and the
// screen, the PDF and the CSV only format them. Nothing here touches React
// or Supabase, so every figure can be unit tested.
//
// PERIOD RULE (applies to every report on the Reports page)
// Users choose the year basis (saved per company in company_settings.year_type):
//   • Tax year ('tax', the default): the HMRC tax year, 6 April (year) to
//     5 April (year + 1) inclusive. The twelve columns are tax months, the
//     6th of one month to the 5th of the next, labelled by the month they
//     start in ("Apr" = 6 Apr – 5 May). A row's column is found by shifting
//     its date back 5 days, so every date in the period falls in exactly one
//     column. A rent row is dated by its receipt (the latest receipt
//     allocated to it) when it has receipt allocations, else its
//     period_start (legacy rows: the 1st of year/month).
//   • Financial year ('fy'): the twelve calendar months April (year) to March
//     (year + 1), i.e. 1 April to 31 March. Monthly rent rows are dated the
//     1st, so a row for April belongs to the year that starts that April.
// In both, the month columns, the period filter and every total cover the
// same twelve columns, and expenses use the same window so a cash-flow month
// always contains the same expenses as the P&L. A calendar year is 1 January
// to 31 December; a custom range uses its own dates, with month columns for
// every calendar month it touches.

import { isRentReceived, indexRentAllocations, rentReceivedOnRow } from './companyPnl'
import { calcMonthlyMortgage } from './propertyCalcs'
import { propValue } from './propertyValue'
import { CATALOGUE_BY_KEY, canonicalCertType } from './complianceCatalogue'
import { SOON_DAYS } from './complianceStatus'
import { evaluateProperty, collectionStats, arrearsSummary, GO_LIVE, isoToday } from './rentEngine'

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Periods ─────────────────────────────────────────────────────────────────

// ISO start/end (inclusive) of a tax, financial or calendar year. See
// PERIOD RULE. 'tax_year' / 'financial_year' (the stored forms) are accepted.
export function yearPeriod(year, type) {
  const y = Number(year)
  const yy = String(y + 1).slice(2)
  const t = yearBasis(type)
  if (t === 'tax') return { start: `${y}-04-06`, end: `${y + 1}-04-05`, label: `${y}/${yy} Tax Year (6 Apr – 5 Apr)`, basis: 'tax' }
  if (t === 'fy') return { start: `${y}-04-01`, end: `${y + 1}-03-31`, label: `${y}/${yy} Financial Year (1 Apr – 31 Mar)`, basis: 'fy' }
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y} Calendar Year`, basis: 'calendar' }
}

// Internal basis from any stored or short form.
export function yearBasis(type) {
  if (type === 'tax' || type === 'tax_year') return 'tax'
  if (type === 'fy' || type === 'financial_year') return 'fy'
  if (type === 'custom') return 'custom'
  return type === 'calendar' || type === 'calendar_year' ? 'calendar' : type
}

// Column header note for the tax-year basis.
export const TAX_MONTH_NOTE = 'Tax months run 6th to 5th'

// Ordered {m,y} month columns for a tax, financial or calendar year. Tax
// months are keyed by the month they start in (the 6th), so both April
// bases share the same twelve keys.
export function yearMonths(year, type) {
  const t = yearBasis(type)
  if (t === 'tax' || t === 'fy') return [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2].map(m => ({ m, y: m >= 3 ? year : year + 1 }))
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(m => ({ m, y: year }))
}

// The UK tax year in progress on `d`: a tax year starts on 6 April.
export function currentTaxYear(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth()
  return (m > 3 || (m === 3 && d.getDate() >= 6)) ? y : y - 1
}

// Years offered by the period pickers: from the earliest year in the data
// (2022 when there is no dated data) to the current tax year + 1, always
// including the selected year.
export function reportYearOptions(dates = [], { now = new Date(), selected = null } = {}) {
  let first = null
  for (const s of dates) {
    const y = Number(String(s || '').slice(0, 4))
    if (y > 1900 && (first == null || y < first)) first = y
  }
  const last = currentTaxYear(now) + 1
  let from = first ?? 2022
  if (selected != null && selected < from) from = selected
  let to = last
  if (selected != null && selected > to) to = selected
  if (from > to) from = to
  const out = []
  for (let y = from; y <= to; y++) out.push(y)
  return out
}

// { y, m } (m 0-based) from an ISO date string, read from the text so the
// result never depends on the browser's time zone.
export function isoMonth(s) {
  const mt = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})/)
  return mt ? { y: Number(mt[1]), m: Number(mt[2]) - 1 } : null
}

// The calendar month a rent_payments row belongs to: its period_start, or the
// year/month columns on legacy rows that have no period_start.
export function rentRowMonth(r) {
  const fromStart = isoMonth(r?.period_start)
  if (fromStart) return fromStart
  if (r?.year && r?.month) return { y: Number(r.year), m: Number(r.month) - 1 }
  return null
}

const monthIndexer = months => {
  const idx = new Map(months.map(({ m, y }, i) => [`${y}-${m}`, i]))
  return mk => (mk ? idx.get(`${mk.y}-${mk.m}`) ?? -1 : -1)
}

// ISO date `days` later (negative: earlier), read as a calendar date.
function shiftIso(iso, days) {
  const mt = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!mt) return null
  const d = new Date(Date.UTC(Number(mt[1]), Number(mt[2]) - 1, Number(mt[3]) + days))
  return d.toISOString().slice(0, 10)
}

// Receipts → Map(rent_payment_id → the latest received_date of a receipt
// allocated to that period as current rent). null without receipts.
export function indexRentReceiptDates(receipts) {
  if (!Array.isArray(receipts)) return null
  const m = new Map()
  for (const r of receipts) {
    const d = r?.received_date ? String(r.received_date).slice(0, 10) : null
    if (!d) continue
    for (const a of (r?.rent_allocations || [])) {
      if (a?.target !== 'current_rent' || !a.rent_payment_id) continue
      const cur = m.get(a.rent_payment_id)
      if (!cur || d > cur) m.set(a.rent_payment_id, d)
    }
  }
  return m
}

// The date a rent row is reported on for a basis. Tax year: its receipt
// date when it has receipt allocations; otherwise (and on every other basis)
// its period_start, or the 1st of its year/month on legacy rows.
export function rentRowDate(r, type = null, receiptDates = null) {
  if (yearBasis(type) === 'tax' && receiptDates?.has(r?.id)) return receiptDates.get(r.id)
  if (r?.period_start) return String(r.period_start).slice(0, 10)
  if (r?.year && r?.month) return `${r.year}-${String(r.month).padStart(2, '0')}-01`
  return null
}

// The {y, m} column a dated row falls in. Tax year: the date shifted back 5
// days (6 Apr–5 May is the "Apr" tax month). Otherwise its calendar month.
export function columnMonth(iso, type = null) {
  return isoMonth(yearBasis(type) === 'tax' ? shiftIso(iso, -5) : iso)
}

// The column of a rent row (tax year: by rentRowDate; otherwise the
// committed rentRowMonth rule) and of an expense.
export function rentRowColumn(r, type = null, receiptDates = null) {
  if (yearBasis(type) !== 'tax') return rentRowMonth(r)
  const d = rentRowDate(r, type, receiptDates)
  return d ? columnMonth(d, type) : null
}
export const expenseColumn = (e, type = null) => columnMonth(e?.date, type)

export const monthName = m => MONTHS[m]

// ── Rent / expense figures ──────────────────────────────────────────────────

// Rent received per rent_payments row, exactly as the Company and Full
// Portfolio P&Ls count it: the row's receipt allocations when receipts are
// supplied (rent_receipts with rent_allocations, embedded on each property),
// otherwise the amount on a paid / late / partial row. Returns
// [{ r, amount }] for rows carrying a receipt record.
const received = (payments, ids, receipts) => {
  const idx = indexRentAllocations(receipts)
  const out = []
  for (const r of payments || []) {
    if (!ids.has(r.property_id)) continue
    if (!(isRentReceived(r) || (idx && idx.has(r.id)))) continue
    out.push({ r, amount: rentReceivedOnRow(r, idx) })
  }
  return out
}
const amt = v => Number(v) || 0

// Annual P&L — actual rent received only. No contracted-rent fallback: a tax
// report must not show rent nobody recorded. noRentRecorded flags the state.
export function buildPnlReport({ properties = [], payments = [], expenses = [], receipts = null }) {
  const ids = new Set(properties.map(p => p.id))
  const rentBy = new Map(), expBy = new Map()
  for (const { r, amount } of received(payments, ids, receipts)) rentBy.set(r.property_id, (rentBy.get(r.property_id) || 0) + amount)
  for (const e of expenses) if (ids.has(e.property_id)) expBy.set(e.property_id, (expBy.get(e.property_id) || 0) + amt(e.amount))
  const rows = properties.map(p => {
    const rent = round2(rentBy.get(p.id) || 0)
    const exp = round2(expBy.get(p.id) || 0)
    const value = propValue(p)
    return { p, name: p.name, rent, exp, net: round2(rent - exp), yield: value ? (amt(p.rent_pcm) * 12 / value) * 100 : 0 }
  }).sort((a, b) => b.net - a.net)
  const rent = round2(rows.reduce((s, r) => s + r.rent, 0))
  const exp = round2(rows.reduce((s, r) => s + r.exp, 0))
  return { rows, totals: { rent, exp, net: round2(rent - exp) }, noRentRecorded: rentBy.size === 0 }
}

// Rental income schedule — rent received per property per month column.
// basis — the year basis (see PERIOD RULE); only the tax year changes how
// rows are placed in columns.
export function buildIncomeSchedule({ properties = [], payments = [], months = [], receipts = null, basis = null }) {
  const ids = new Set(properties.map(p => p.id))
  const at = monthIndexer(months)
  const dates = yearBasis(basis) === 'tax' ? indexRentReceiptDates(receipts) : null
  const cells = new Map()
  let unplaced = 0
  for (const { r, amount } of received(payments, ids, receipts)) {
    const i = at(rentRowColumn(r, basis, dates))
    if (i < 0) { unplaced += amount; continue }
    const k = `${r.property_id}|${i}`
    cells.set(k, (cells.get(k) || 0) + amount)
  }
  const rows = properties.map(p => {
    const monthly = months.map((_, i) => round2(cells.get(`${p.id}|${i}`) || 0))
    return { p, name: p.name, monthly, total: round2(monthly.reduce((s, v) => s + v, 0)) }
  })
  const monthTotals = months.map((_, i) => round2(rows.reduce((s, r) => s + r.monthly[i], 0)))
  const total = round2(monthTotals.reduce((s, v) => s + v, 0))
  return { months, rows, monthTotals, total, average: months.length ? round2(total / months.length) : 0, unplaced: round2(unplaced), noRentRecorded: total === 0 && unplaced === 0, basis: yearBasis(basis) || null }
}

// Monthly cash flow — rent received in, expenses out, per month column.
export function buildCashFlow({ properties = [], payments = [], expenses = [], months = [], receipts = null, basis = null }) {
  const ids = new Set(properties.map(p => p.id))
  const at = monthIndexer(months)
  const dates = yearBasis(basis) === 'tax' ? indexRentReceiptDates(receipts) : null
  const rent = months.map(() => 0), exp = months.map(() => 0)
  for (const { r, amount } of received(payments, ids, receipts)) { const i = at(rentRowColumn(r, basis, dates)); if (i >= 0) rent[i] += amount }
  for (const e of expenses) { if (!ids.has(e.property_id)) continue; const i = at(expenseColumn(e, basis)); if (i >= 0) exp[i] += amt(e.amount) }
  const rows = months.map(({ m, y }, i) => ({ m, y, rent: round2(rent[i]), exp: round2(exp[i]), net: round2(rent[i] - exp[i]) }))
  const tRent = round2(rows.reduce((s, r) => s + r.rent, 0))
  const tExp = round2(rows.reduce((s, r) => s + r.exp, 0))
  return { rows, totals: { rent: tRent, exp: tExp, net: round2(tRent - tExp) }, noRentRecorded: tRent === 0, basis: yearBasis(basis) || null }
}

// Mortgage portfolio — monthly payment from calcMonthlyMortgage (honours a
// recorded monthly payment and interest-only loans), rounded to the pound
// once so screen, PDF and CSV add up identically.
export function buildMortgagePortfolio(properties = []) {
  const rows = properties.filter(p => amt(p.mortgage_amount) > 0).map(p => {
    const value = propValue(p)
    return {
      p, name: p.name, lender: p.lender || '', loan: amt(p.mortgage_amount), rate: amt(p.mortgage_rate),
      term: p.mortgage_term || null, type: p.mortgage_type === 'interest_only' ? 'Interest-only' : 'Repayment',
      monthly: Math.round(calcMonthlyMortgage(p) || 0), expiry: p.mortgage_expiry || '',
      ltv: value ? (amt(p.mortgage_amount) / value) * 100 : 0,
    }
  })
  return { rows, totals: { loan: round2(rows.reduce((s, r) => s + r.loan, 0)), monthly: rows.reduce((s, r) => s + r.monthly, 0) } }
}

// ── Arrears ─────────────────────────────────────────────────────────────────

// Arrears per property from the rent engine: overdue rent since go-live (the
// "Overdue" figure on the Rent outstanding report) plus the historic arrears
// balance. The hand-typed properties.arrears figure is carried only as a
// manual note when it differs.
export function buildArrearsReport(properties = [], { asOf = isoToday() } = {}) {
  const considered = properties.filter(p => p.status !== 'short_term_let')
  const all = considered.map(p => {
    const stats = collectionStats(evaluateProperty(p, { today: asOf }), { from: GO_LIVE, to: asOf, asOf })
    const overdue = round2(stats.overdue)
    const historic = round2(arrearsSummary(p).balance)
    const total = round2(overdue + historic)
    const manual = p.arrears == null || p.arrears === '' ? null : round2(p.arrears)
    const manualDiffers = manual != null && manual > 0 && Math.abs(manual - total) >= 0.01
    return { p, name: p.name, overdue, historic, total, rent: amt(p.rent_pcm), manual, manualDiffers }
  })
  const rows = all.filter(r => r.total > 0 || r.manualDiffers).sort((a, b) => b.total - a.total)
  const inArrears = rows.filter(r => r.total > 0).length
  return {
    asOf, rows, inArrears, clear: considered.length - inArrears,
    totals: {
      overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)),
      historic: round2(rows.reduce((s, r) => s + r.historic, 0)),
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
    },
    manualDiffers: all.filter(r => r.manualDiffers).length,
  }
}

// ── Compliance ──────────────────────────────────────────────────────────────

// Report label for a compliance_items row: the catalogue name for a known
// cert type (as the Compliance tab shows it), else the row's own name.
export function complianceLabel(c) {
  const req = CATALOGUE_BY_KEY[canonicalCertType(c?.cert_type)]
  return req?.label || c?.cert_name || c?.cert_type || '—'
}

const addMonthsIso = (iso, months) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}
const daysUntil = (iso, now) => {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : Math.ceil((t - now) / 86_400_000)
}

export const COMPLIANCE_STATUS_LABEL = { expired: 'EXPIRED', expiring: 'Expiring soon', valid: 'Valid', held: 'Held (no expiry)', 'no-date': 'No date set' }

// One row per property and certificate type: the LATEST certificate, judged
// the way the Compliance page judges it (certTypeStatus): alias-aware type,
// check-type items due issue date + cycle, expired on or before today,
// expiring within SOON_DAYS. Superseded certificates are not listed.
// Unknown/free-text types are grouped by type and name.
export function buildComplianceReport(items = [], { now = Date.now() } = {}) {
  const groups = new Map()
  for (const c of items) {
    if (c?.deleted_at) continue
    const key = canonicalCertType(c.cert_type)
    const req = CATALOGUE_BY_KEY[key] || null
    const gk = `${c.property_id}|${req ? key : `${key}|${String(c.cert_name || '').toLowerCase()}`}`
    if (!groups.has(gk)) groups.set(gk, { req, items: [] })
    groups.get(gk).items.push(c)
  }
  const rows = []
  for (const { req, items: list } of groups.values()) {
    const dated = list.map(c => ({ c, due: c.expiry_date || (req?.isCheck && req.cycleMonths && c.issue_date ? addMonthsIso(c.issue_date, req.cycleMonths) : null) }))
    const withDate = dated.filter(d => d.due)
    const latest = withDate.length
      ? withDate.reduce((a, b) => (new Date(b.due).getTime() > new Date(a.due).getTime() ? b : a))
      : { c: list.reduce((a, b) => (String(b.issue_date || b.created_at || '') > String(a.issue_date || a.created_at || '') ? b : a)), due: null }
    const days = latest.due ? daysUntil(latest.due, now) : null
    let status
    if (days == null) status = req?.expiryOptional ? 'held' : 'no-date'
    else if (days <= 0) status = 'expired'
    else if (days <= SOON_DAYS) status = 'expiring'
    else status = 'valid'
    rows.push({
      c: latest.c, property: latest.c.property?.name || '—', label: complianceLabel(latest.c),
      expiry: latest.due || '', days, status, statusLabel: COMPLIANCE_STATUS_LABEL[status],
      issuer: latest.c.issuer || '', superseded: list.length - 1,
    })
  }
  const order = { expired: 0, expiring: 1, 'no-date': 2, valid: 3, held: 4 }
  rows.sort((a, b) => (order[a.status] - order[b.status]) || ((a.days ?? 99999) - (b.days ?? 99999)) || a.property.localeCompare(b.property))
  const count = s => rows.filter(r => r.status === s).length
  return { rows, counts: { expired: count('expired'), expiring: count('expiring'), valid: count('valid') + count('held'), noDate: count('no-date'), total: rows.length } }
}

// ── Tenancies & maintenance ─────────────────────────────────────────────────

// tenancy_details columns are tenant_names / tenancy_start / tenancy_end.
export function buildTenancySchedule(tenancies = [], { now = Date.now() } = {}) {
  const rows = tenancies.map(t => {
    const end = t.tenancy_end || ''
    return {
      t, property: t.property?.name || '—', tenant: t.tenant_names || '', start: t.tenancy_start || '', end,
      rent: amt(t.property?.rent_pcm), noticePeriod: t.notice_period || '',
      days: end ? daysUntil(end, now) : null,
    }
  }).sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999))
  return { rows, expiringSoon: rows.filter(r => r.days != null && r.days >= 0 && r.days <= 90).length }
}

// A maintenance job's cost: the actual cost, else the quote (as the
// Maintenance tab totals it).
export const maintenanceCost = m => Number(m?.actual_cost ?? m?.quoted_cost) || 0

// Open-job sort: urgent first. `??` so urgent (0) is not treated as missing.
export const MAINTENANCE_PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 }
export const maintenancePriorityRank = p => MAINTENANCE_PRIORITY_ORDER[p] ?? 2

// ── Export shapes (PDF data + CSV rows) ─────────────────────────────────────
// fmt formats money for the PDF; CSV cells stay numeric.

const NO_RENT_NOTE = 'No rent received is recorded for this period, so income shows as £0. Record rent in the Rent tracker to populate it.'

export function pnlExports(model, { fmt, fmtPct }) {
  const { rows, totals } = model
  const pdf = {
    title: 'Annual P&L', note: model.noRentRecorded ? NO_RENT_NOTE : undefined,
    kpis: [['Total income', fmt(totals.rent)], ['Total expenses', fmt(totals.exp)], ['Net profit', fmt(totals.net)], ['Net margin', totals.rent > 0 ? fmtPct(totals.net / totals.rent * 100) : '—']],
    headers: ['Property', 'Rent received', 'Expenses', 'Net Profit', 'Gross Yield'],
    rows: rows.map(r => [r.name, fmt(r.rent), fmt(r.exp), fmt(r.net), r.yield > 0 ? fmtPct(r.yield) : '—']),
    totals: ['Total', fmt(totals.rent), fmt(totals.exp), fmt(totals.net), ''],
  }
  const csv = [
    ['Property', 'Status', 'Rent received (period)', 'Expenses', 'Net profit', 'Gross yield', 'Est. value', 'Mortgage'],
    ...rows.map(r => [r.name, r.p.status || '', r.rent, r.exp, r.net, r.yield > 0 ? r.yield.toFixed(2) + '%' : '', propValue(r.p), amt(r.p.mortgage_amount)]),
    ['Total', '', totals.rent, totals.exp, totals.net, '', '', ''],
  ]
  return { pdf, csv }
}

// The export note: no rent recorded, and on the tax-year basis that the
// month columns are tax months.
function exportNote(model) {
  const parts = [model.noRentRecorded ? NO_RENT_NOTE : null, model.basis === 'tax' ? `${TAX_MONTH_NOTE} (e.g. "Apr" is 6 April to 5 May).` : null].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

export function incomeScheduleExports(model, { fmt, monthLabel = ({ m }) => MONTHS[m] }) {
  const labels = model.months.map(monthLabel)
  const pdf = {
    title: 'Rental Income Schedule', note: exportNote(model),
    kpis: [['Total income', fmt(model.total)], ['Monthly average', fmt(model.average)], ['Properties', String(model.rows.length)]],
    headers: ['Property', 'Rent received'],
    rows: model.rows.map(r => [r.name, fmt(r.total)]),
    totals: ['Total', fmt(model.total)],
  }
  pdf.sections = [
    { title: 'By property', headers: pdf.headers, rows: pdf.rows, totals: pdf.totals },
    { title: 'By month', headers: ['Month', 'Rent received'], rows: labels.map((l, i) => [l, fmt(model.monthTotals[i])]), totals: ['Total', fmt(model.total)] },
  ]
  const csv = [
    ['Property', ...model.months.map(({ m, y }) => `${MONTHS[m]} ${y}`), 'Total'],
    ...model.rows.map(r => [r.name, ...r.monthly, r.total]),
    ['Total', ...model.monthTotals, model.total],
  ]
  return { pdf, csv }
}

export function cashFlowExports(model, { fmt, monthLabel = ({ m }) => MONTHS[m] }) {
  const { rows, totals } = model
  const pdf = {
    title: 'Monthly Cash Flow', note: exportNote(model),
    kpis: [['Total income', fmt(totals.rent)], ['Total outgoings', fmt(totals.exp)], ['Net cash flow', fmt(totals.net)]],
    headers: ['Month', 'Rent Income', 'Expenses', 'Net Cash Flow'],
    rows: rows.map(r => [monthLabel(r), fmt(r.rent), fmt(r.exp), fmt(r.net)]),
    totals: ['Total', fmt(totals.rent), fmt(totals.exp), fmt(totals.net)],
  }
  const csv = [
    ['Month', 'Rent income', 'Expenses', 'Net cash flow'],
    ...rows.map(r => [`${MONTHS[r.m]} ${r.y}`, r.rent, r.exp, r.net]),
    ['Total', totals.rent, totals.exp, totals.net],
  ]
  return { pdf, csv }
}

export function mortgagePortfolioExports(model, { fmt, fmtPct }) {
  const { rows, totals } = model
  const pdf = {
    title: 'Mortgage Portfolio Summary',
    kpis: [['Total debt', fmt(totals.loan)], ['Monthly payments', fmt(totals.monthly)], ['Mortgaged properties', String(rows.length)]],
    headers: ['Property', 'Loan Amount', 'Rate', 'Type', 'Term', 'Monthly', 'LTV'],
    rows: rows.map(r => [r.name, fmt(r.loan), fmtPct(r.rate * 100), r.type, r.term ? r.term + 'y' : '—', fmt(r.monthly), r.ltv > 0 ? fmtPct(r.ltv) : '—']),
    totals: ['Total', fmt(totals.loan), '', '', '', fmt(totals.monthly), ''],
  }
  const csv = [
    ['Property', 'Lender', 'Loan amount', 'Rate %', 'Type', 'Term (years)', 'Monthly payment', 'Expiry', 'LTV %'],
    ...rows.map(r => [r.name, r.lender, r.loan, r.rate ? +(r.rate * 100).toFixed(3) : '', r.type, r.term || '', r.monthly, r.expiry, r.ltv ? r.ltv.toFixed(1) : '']),
    ['Total', '', totals.loan, '', '', '', totals.monthly, '', ''],
  ]
  return { pdf, csv }
}

export function complianceExports(model) {
  const { rows, counts } = model
  const pdf = {
    title: 'Compliance Status',
    note: 'Latest certificate per property and type; superseded certificates are not listed.',
    kpis: [['Expired', String(counts.expired)], [`Expiring within ${SOON_DAYS} days`, String(counts.expiring)], ['Valid', String(counts.valid)], ['Total', String(counts.total)]],
    headers: ['Property', 'Certificate', 'Expiry / due date', 'Days', 'Status'],
    rows: rows.map(r => [r.property, r.label, r.expiry || '—', r.days != null ? String(r.days) : '—', r.statusLabel]),
  }
  const csv = [
    ['Property', 'Certificate type', 'Expiry / due date', 'Status', 'Days until expiry', 'Issuer', 'Superseded certificates'],
    ...rows.map(r => [r.property, r.label, r.expiry, r.statusLabel, r.days ?? '', r.issuer, r.superseded]),
  ]
  return { pdf, csv }
}

export function arrearsExports(model, { fmt }) {
  const { rows, totals } = model
  const manual = r => (r.manualDiffers ? `Manual figure ${fmt(r.manual)} differs from tracker` : '')
  const pdf = {
    title: 'Arrears Report',
    note: `Arrears from the rent tracker at ${model.asOf}: overdue rent since 1 January 2026 plus historic arrears balances. A hand-entered arrears figure is shown only as a note where it differs.`,
    kpis: [['Properties in arrears', String(model.inArrears)], ['Total arrears', fmt(totals.total)], ['Clear properties', String(model.clear)]],
    headers: ['Property', 'Overdue rent', 'Historic arrears', 'Total arrears', 'Monthly rent', 'Note'],
    rows: rows.length ? rows.map(r => [r.name, fmt(r.overdue), fmt(r.historic), fmt(r.total), fmt(r.rent), manual(r)]) : [['No arrears', '', '', '', '', 'All clear']],
    totals: rows.length ? ['Total', fmt(totals.overdue), fmt(totals.historic), fmt(totals.total), '', ''] : undefined,
  }
  const csv = [
    ['Property', 'Overdue rent', 'Historic arrears', 'Total arrears', 'Monthly rent', 'Manual arrears figure', 'Note'],
    ...rows.map(r => [r.name, r.overdue, r.historic, r.total, r.rent, r.manual ?? '', manual(r)]),
    ['Total', totals.overdue, totals.historic, totals.total, '', '', ''],
  ]
  return { pdf, csv }
}
