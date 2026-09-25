import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  parseForImport, reviewRows, planImport, planSummary, statusCounts, targetPeriod, matchCompany,
  matchTenancy, statementFingerprint, auditLines, REVIEW_STATUS,
} from '../statementImport'

const fixture = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')
const COMPANIES = [
  { id: 'exh', name: 'ExH Property Group' },
  { id: 'vale', name: 'Vale Property Group' },
]
const month = (id, y, m, status = 'void', amount = null, extra = {}) => {
  const mm = String(m).padStart(2, '0'), last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { id, year: y, month: m, month_label: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`, period_start: `${y}-${mm}-01`, period_end: `${y}-${mm}-${last}`, status, amount, ...extra }
}
const prop = (id, name, company_id, over = {}) => ({ id, name, address: '', company_id, status: 'rented', rent_pcm: 500, rent_due_day: '1st', tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], rent_payments: [], ...over })

describe('parseForImport', () => {
  it('reads a PNE statement: number, date, company, 31 rent + 27 fees, balances to the payment', () => {
    const p = parseForImport(fixture('pne-statement-2026.txt'))
    expect(p.ok).toBe(true)
    expect(p.header).toMatchObject({ agent: 'PNE', statementRef: '99', statementDate: '2026-08-10', landlordCompany: 'EXH Property Group Limited', paymentAmount: 14358.4, invoiceNumber: 'INV4188' })
    expect(p.lines.filter(l => l.line_type === 'rent')).toHaveLength(31)
    expect(p.lines.filter(l => l.line_type === 'management_fee')).toHaveLength(27)
    expect(p.balance.balances).toBe(true)
  })
  it('reads an RMS statement with its own row dates and a fee / VAT split', () => {
    const p = parseForImport(fixture('rms-statement-invoice-2026.txt'))
    expect(p.header).toMatchObject({ agent: 'RMS', statementRef: 'BYHS-RMS-P600298', statementDate: '2026-09-02', landlordCompany: 'Vale Property Group Limited', paymentAmount: 549.6 })
    const fee = p.lines.find(l => l.line_type === 'management_fee')
    expect(fee).toMatchObject({ fee_amount: 42, vat_amount: 8.4 })
    expect(p.transfers).toHaveLength(1)
  })
  it('fingerprints the same statement identically', () => {
    const t = fixture('audit-pne-71.txt')
    expect(statementFingerprint(parseForImport(t))).toBe(statementFingerprint(parseForImport(t)))
    expect(statementFingerprint(parseForImport(t))).not.toBe(statementFingerprint(parseForImport(fixture('audit-pne-arrears-87.txt'))))
  })
})

describe('matching', () => {
  it('matches the landlord company by name', () => {
    expect(matchCompany('EXH Property Group Limited', COMPANIES)?.id).toBe('exh')
    expect(matchCompany('Vale Property Group Limited', COMPANIES)?.id).toBe('vale')
    expect(matchCompany('Someone Else Ltd', COMPANIES)).toBeNull()
  })
  it('never uses the statement date: a 29 Dec - 28 Jan period is January rent', () => {
    const p = prop('p', 'x', 'exh', { rent_payments: [month('dec', 2025, 12), month('jan', 2026, 1)] })
    expect(targetPeriod(p, '2025-12-29', '2026-01-28').row.id).toBe('jan')
  })
  it('uses an exact tenancy-cycle row when there is one and never reshapes rows', () => {
    const cyc = { id: 'cyc', year: 2026, month: 7, period_start: '2026-07-31', period_end: '2026-08-30', status: 'void' }
    const p = prop('p', 'x', 'exh', { rent_payments: [month('jul', 2026, 7), cyc] })
    const t = targetPeriod(p, '2026-07-31', '2026-08-30')
    expect(t.row.id).toBe('cyc'); expect(t.exact).toBe(true)
  })
  it('creates a new period labelled by the month holding most of its days when none exists', () => {
    const t = targetPeriod(prop('p', 'x', 'exh'), '2026-03-30', '2026-04-29')
    expect(t.create).toMatchObject({ period_start: '2026-03-30', period_end: '2026-04-29', year: 2026, month: 4, month_label: 'Apr 2026' })
  })
  it('picks the tenancy covering the period, flags a different tenant name', () => {
    const t1 = { id: 't1', tenant_name: 'Jo Bloggs', tenancy_start: '2026-01-01', tenancy_end: null }
    expect(matchTenancy(prop('p', 'x', 'exh', { tenancies: [t1] }), '2026-08-01', '2026-08-31', 'Jo Bloggs').tenancy.id).toBe('t1')
    const m = matchTenancy(prop('p', 'x', 'exh', { tenancies: [t1] }), '2026-08-01', '2026-08-31', 'Sam Smith')
    expect(m.mismatch).toBe(true)
    const t2 = { id: 't2', tenant_name: 'Sam Smith', tenancy_start: '2026-01-01', tenancy_end: null }
    expect(matchTenancy(prop('p', 'x', 'exh', { tenancies: [t1, t2] }), '2026-08-01', '2026-08-31', 'Sam Smith').tenancy.id).toBe('t2')
    expect(matchTenancy(prop('p', 'x', 'exh', { tenancies: [t1, t2] }), '2026-08-01', '2026-08-31', '').ambiguous).toBe(true)
  })
})

// RMS Jubilee Road statement: 600 rent 31/08-29/09, fee 42 + 8.40 VAT.
const rmsParsed = () => parseForImport(fixture('rms-statement-invoice-2026.txt'))
const jubilee = (over = {}) => prop('jub', '5 Jubilee Road', 'vale', { rent_pcm: 600, rent_payments: [month('aug', 2026, 8), month('sep', 2026, 9)], ...over })

describe('review rows', () => {
  it('matched rent + fee rows are Ready to import with rent due, fee and VAT shown', () => {
    const { company, rows } = reviewRows(rmsParsed(), { properties: [jubilee()], companies: COMPANIES, today: '2026-09-25' })
    expect(company.id).toBe('vale')
    const rent = rows.find(r => r.kind === 'rent'), fee = rows.find(r => r.kind === 'fee')
    expect(rent).toMatchObject({ status: REVIEW_STATUS.READY, propertyId: 'jub', amount: 600, targetLabel: 'Sep 2026', rentDue: 600 })
    expect(fee).toMatchObject({ status: REVIEW_STATUS.READY, fee: 42, vat: 8.4, amount: 50.4 })
  })
  it('an unknown property is Unmatched and not imported', () => {
    const { rows } = reviewRows(rmsParsed(), { properties: [prop('x', '99 Nowhere Street', 'vale')], companies: COMPANIES })
    expect(rows.every(r => r.status === REVIEW_STATUS.UNMATCHED && !r.include)).toBe(true)
  })
  it('a manual property pick fixes an unmatched line', () => {
    const other = prop('x', 'Jubilee Cottage', 'vale', { rent_pcm: 600, rent_payments: [month('sep', 2026, 9)] })
    const { rows } = reviewRows(rmsParsed(), { properties: [other], companies: COMPANIES, today: '2026-09-25' }, { [rmsParsed().lines[0].line_no]: { propertyId: 'x' } })
    expect(rows[0], rows[0].reasons.join(' | ')).toMatchObject({ propertyId: 'x', matchedVia: 'manual', status: REVIEW_STATUS.READY })
  })
  it('a rent line with no period needs a person; the statement date is never used', () => {
    const p = rmsParsed(); p.lines[0] = { ...p.lines[0], period_start: null, period_end: null }
    const { rows } = reviewRows(p, { properties: [jubilee()], companies: COMPANIES })
    expect(rows[0].status).toBe(REVIEW_STATUS.NEEDS_REVIEW)
    expect(rows[0].include).toBe(false)
    expect(rows[0].reasons.join(' ')).toMatch(/statement date is never used/)
    // Entering the dates resolves it.
    const fixed = reviewRows(p, { properties: [jubilee()], companies: COMPANIES, today: '2026-09-25' }, { [p.lines[0].line_no]: { periodStart: '2026-08-31', periodEnd: '2026-09-29' } })
    expect(fixed.rows[0].status).toBe(REVIEW_STATUS.READY)
  })
  it('the same statement line imported before is a Duplicate that cannot be confirmed through', () => {
    const first = reviewRows(rmsParsed(), { properties: [jubilee()], companies: COMPANIES })
    const known = new Set(first.rows.map(r => r.ref))
    const again = reviewRows(rmsParsed(), { properties: [jubilee()], companies: COMPANIES, knownRefs: known }, { [first.rows[0].lineNo]: { confirmed: true } })
    expect(again.rows.every(r => r.status === REVIEW_STATUS.DUPLICATE && !r.include)).toBe(true)
  })
  it('a period already marked paid by hand for the same amount is a Duplicate, never overwritten', () => {
    const p = jubilee({ rent_payments: [month('sep', 2026, 9, 'paid', 600)] })
    const { rows } = reviewRows(rmsParsed(), { properties: [p], companies: COMPANIES, today: '2026-09-25' })
    const rent = rows.find(r => r.kind === 'rent')
    expect(rent.status).toBe(REVIEW_STATUS.DUPLICATE)
    expect(rent.reasons.join(' ')).toMatch(/already marked paid by hand/)
  })
  it('a hand-entered part payment is kept: importing needs confirmation and plans a bridge receipt', () => {
    const p = jubilee({ rent_payments: [month('sep', 2026, 9, 'partial', 200)] })
    const parsed = rmsParsed(); parsed.lines[0] = { ...parsed.lines[0], gross_rent: 400 }
    const ctx = { properties: [p], companies: COMPANIES, today: '2026-09-25' }
    const r1 = reviewRows(parsed, ctx).rows[0]
    expect(r1.status).toBe(REVIEW_STATUS.NEEDS_REVIEW)
    const r2 = reviewRows(parsed, ctx, { [r1.lineNo]: { confirmed: true } }).rows
    expect(r2[0].status).toBe(REVIEW_STATUS.READY)
    const plan = planImport(r2, { header: parsed.header })
    expect(plan.bridges).toHaveLength(1)
    expect(plan.bridges[0].receipt).toMatchObject({ amount: 200, source: 'manual' })
    expect(plan.periodUpdates[0]).toMatchObject({ rent_payment_id: 'sep', amount: 600, status: 'paid', previous: { status: 'partial', amount: 200 } })
  })
  it('a fee already recorded within 45 days is flagged as a probable duplicate', () => {
    const { rows } = reviewRows(rmsParsed(), { properties: [jubilee()], companies: COMPANIES, existingFees: [{ property_id: 'jub', amount: 50.4, date: '2026-09-03' }] })
    expect(rows.find(r => r.kind === 'fee').status).toBe(REVIEW_STATUS.DUPLICATE)
  })
  it('counts statuses for the filter tabs', () => {
    const { rows } = reviewRows(rmsParsed(), { properties: [jubilee()], companies: COMPANIES })
    expect(statusCounts(rows).ready).toBe(2)
  })
})

describe('plan: multiple payments for one period land on ONE period', () => {
  it('two part payments for the same month are two receipts on one period, status from the total', () => {
    const parsed = rmsParsed()
    const rent = parsed.lines[0]
    parsed.lines = [{ ...rent, line_no: 1, gross_rent: 250 }, { ...rent, line_no: 2, gross_rent: 250 }, parsed.lines[1]]
    const { rows } = reviewRows(parsed, { properties: [jubilee()], companies: COMPANIES, today: '2026-09-25' })
    const plan = planImport(rows, { header: parsed.header })
    const rentReceipts = plan.receipts.filter(r => r.allocation.target === 'current_rent')
    expect(rentReceipts).toHaveLength(2)
    expect(new Set(rentReceipts.map(r => r.periodKey)).size).toBe(1)
    expect(new Set(rentReceipts.map(r => r.receipt.source_ref)).size).toBe(2)   // identical lines still get distinct refs
    expect(plan.newPeriods).toHaveLength(0)
    expect(plan.periodUpdates).toEqual([expect.objectContaining({ rent_payment_id: 'sep', amount: 500, status: 'partial' })])
  })
  it('receipts carry the statement, the tenant and the real period; fees carry fee + VAT', () => {
    const parsed = rmsParsed()
    const { rows } = reviewRows(parsed, { properties: [jubilee()], companies: COMPANIES, today: '2026-09-25' })
    const plan = planImport(rows, { header: parsed.header })
    expect(plan.receipts[0].receipt).toMatchObject({ property_id: 'jub', company_id: 'vale', amount: 600, received_date: '2026-09-02', source: 'statement', reference: 'RMS statement BYHS-RMS-P600298' })
    expect(plan.receipts[0].receipt.notes).toMatch(/2026-08-31 to 2026-09-29/)
    expect(plan.expenses[0]).toMatchObject({ category: 'agent_fees', amount: 50.4, date: '2026-09-02' })
    expect(plan.expenses[0].description).toMatch(/VAT £8.40/)
    expect(planSummary(plan)).toMatchObject({ rentReceipts: 1, rentTotal: 600, fees: 1, feeTotal: 50.4, periods: 1 })
  })
  it('arrears go to historic arrears, never to a rent month', () => {
    const p = parseForImport(fixture('audit-pne-arrears-87.txt'))
    const arrears = p.lines.find(l => l.line_type === 'arrears')
    const props = [prop('a', arrears.property_address, 'exh')]
    const { rows } = reviewRows({ ...p, lines: [arrears] }, { properties: props, companies: COMPANIES })
    const plan = planImport(rows, { header: p.header })
    expect(plan.receipts[0].allocation.target).toBe('historic_arrears')
    expect(plan.periodUpdates).toHaveLength(0)
  })
  it('excluded rows write nothing', () => {
    const parsed = rmsParsed()
    const { rows } = reviewRows(parsed, { properties: [jubilee()], companies: COMPANIES }, Object.fromEntries(parsed.lines.map(l => [l.line_no, { include: false }])))
    const plan = planImport(rows, { header: parsed.header })
    expect(plan.receipts.length + plan.expenses.length + plan.periodUpdates.length).toBe(0)
  })
})

describe('whole PNE statement against a portfolio', () => {
  it('every rent line maps to a period by its own dates and the plan totals the statement income', () => {
    const p = parseForImport(fixture('pne-statement-2026.txt'))
    const labels = [...new Set(p.lines.map(l => l.property_address))]
    const properties = labels.map((l, i) => prop(`p${i}`, l, 'exh', { rent_payments: [3, 4, 5, 6, 7, 8, 9].map(m => month(`p${i}-${m}`, 2026, m)) }))
    const { rows } = reviewRows(p, { properties, companies: COMPANIES, today: '2026-09-25' })
    const confirmAll = Object.fromEntries(rows.map(r => [r.lineNo, { confirmed: true }]))
    const final = reviewRows(p, { properties, companies: COMPANIES, today: '2026-09-25' }, confirmAll).rows
    // Each rent line lands on the period its own dates cover, not the
    // statement's August date: the March-April arrears lines go to April/May.
    const rent = final.filter(r => r.kind === 'rent')
    expect(rent.every(r => r.target?.row && r.target.overlapDays > 0)).toBe(true)
    expect(rent.find(r => r.periodStart === '2026-03-30').targetLabel).toBe('Apr 2026')
    const plan = planImport(final, { header: p.header })
    const s = planSummary(plan)
    expect(s.rentTotal + plan.receipts.filter(r => r.allocation.target !== 'current_rent').reduce((a, r) => a + r.receipt.amount, 0)).toBe(16305)
    expect(s.feeTotal).toBe(1946.6)
    const audit = auditLines(final, confirmAll)
    expect(audit).toHaveLength(p.lines.length)
    expect(audit[0]).toHaveProperty('property_on_statement')
  })
})
