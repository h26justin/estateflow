import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseAuditStatement, computeTotals, balanceCheck, compareWithExisting,
  deriveStatus, missingNumbers, lineKey, toIsoDate, seriesKeyFor, buildImportSummary,
} from '../statementAudit'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, 'fixtures', name), 'utf8')

// Fixtures are real PNE layouts (as produced by src/lib/pdfText.js) with the
// landlord and tenant names replaced. Property labels are kept because the
// audit records them verbatim and the parser must not mangle them.
const parse71 = () => parseAuditStatement(fixture('audit-pne-71.txt'))
const withStatus = lines => lines.map(l => ({ ...l, review_status: 'imported' }))
const stmtOf = p => ({ previous_balance: p.previousBalance, new_balance: p.newBalance, payment_amount: p.paymentAmount, stated_income_total: p.statedIncomeTotal, stated_expenditure_total: p.statedExpenditureTotal, invoice_fees: p.invoiceFees, import_errors: p.errors })

describe('parseAuditStatement - Statement 71 (the first audit statement)', () => {
  const p = parse71()

  it('reads the header exactly as printed', () => {
    expect(p.ok).toBe(true)
    expect(p.agent).toBe('PNE')
    expect(p.statementNumber).toBe(71)
    expect(p.statementDate).toBe('2026-01-05')
    expect(p.landlordCompany).toBe('EXH Property Group Limited')
    expect(p.seriesKey).toBe('exh-property-group')
    expect(p.invoiceNumber).toBe('INV3494')
    expect(p.invoiceFees).toBe(647)
  })

  it('imports every transaction: 10 rent lines and 10 management fees, no errors', () => {
    expect(p.errors).toEqual([])
    expect(p.lines.filter(l => l.line_type === 'rent')).toHaveLength(10)
    expect(p.lines.filter(l => l.line_type === 'management_fee')).toHaveLength(10)
  })

  it('keeps the property address verbatim and joins a tenant name that wrapped after the amounts', () => {
    const first = p.lines[0]
    expect(first.property_address).toBe('29, Briardene')
    expect(first.tenant_name).toBe('Tenant A1')
    expect(first.period_start).toBe('2025-12-29')
    expect(first.period_end).toBe('2026-01-28')
    expect(first.gross_rent).toBe(780)
    expect(first.vat_amount).toBe(0)
    // "47 B, Somerset Street" is printed with the space - it stays that way.
    expect(p.lines.some(l => l.property_address === '47 B, Somerset Street')).toBe(true)
  })

  it('survives a page break inside an entry (property label on one page, rent line on the next)', () => {
    const flat4 = p.lines.find(l => l.line_type === 'rent' && l.property_address === 'Flat 4, St. Georges House')
    expect(flat4).toBeTruthy()
    expect(flat4.gross_rent).toBe(900)
  })

  it('records management fees with their percentage and basis, VAT separately', () => {
    const fee = p.lines.find(l => l.line_type === 'management_fee' && l.property_address === '29, Briardene')
    expect(fee.fee_pct).toBe(10)
    expect(fee.fee_basis).toBe(780)
    expect(fee.fee_amount).toBe(78)
    expect(fee.vat_amount).toBe(0)
    expect(fee.flags).toEqual([])
  })

  it('captures the statement totals and summary figures', () => {
    expect(p.statedIncomeTotal).toBe(6470)
    expect(p.statedExpenditureTotal).toBe(647)
    expect(p.previousBalance).toBe(0)
    expect(p.newBalance).toBe(5823)
    expect(p.paymentAmount).toBe(5823)
  })

  it('balances: gross rent minus fees equals the payment transferred', () => {
    const c = balanceCheck(stmtOf(p), withStatus(p.lines))
    expect(c.totals.gross_rent).toBe(6470)
    expect(c.totals.management_fees).toBe(647)
    expect(c.totals.vat).toBe(0)
    expect(c.expected).toBe(5823)
    expect(c.stated).toBe(5823)
    expect(c.difference).toBe(0)
    expect(c.balances).toBe(true)
  })
})

describe('parseAuditStatement - awkward layouts', () => {
  it('reassembles a rent period split around the amount cell and a two-line tenant name', () => {
    const p = parseAuditStatement(fixture('audit-pne-wrapped-37.txt'))
    expect(p.errors).toEqual([])
    const rents = p.lines.filter(l => l.line_type === 'rent')
    expect(rents).toHaveLength(5)
    expect(rents[0]).toMatchObject({ property_address: '36 Watts Moses House, High Street East', period_start: '2025-04-30', period_end: '2025-05-29', tenant_name: 'Ms Tenant B1', gross_rent: 500 })
    expect(rents[1]).toMatchObject({ period_start: '2024-06-30', period_end: '2024-07-30', gross_rent: 100 })
    expect(rents[2]).toMatchObject({ property_address: '38 Watts Moses House, High Street East', tenant_name: 'Tenant B2', gross_rent: 500 })
    expect(rents[4]).toMatchObject({ property_address: 'Flat 4, St. Georges House', tenant_name: 'Mr Tenant B4 & Tenant B5', gross_rent: 900 })
  })

  it('keeps a rent-related adjustment apart from monthly rent and flags it for review', () => {
    const p = parseAuditStatement(fixture('audit-pne-wrapped-37.txt'))
    const adj = p.lines.find(l => l.line_type === 'other_income')
    expect(adj).toMatchObject({ property_address: 'Flat 6, St. Georges House', gross_rent: 182, tenant_name: 'Tenant B6 & Tenant B7' })
    expect(adj.flags).toContain('review_description')
    const c = balanceCheck(stmtOf(p), withStatus(p.lines))
    expect(c.balances).toBe(true)
    expect(c.expected).toBe(2557.8)
  })

  it('records arrears payments separately from rent and reads a part-period rent line', () => {
    const p = parseAuditStatement(fixture('audit-pne-arrears-87.txt'))
    expect(p.errors).toEqual([])
    const arrears = p.lines.filter(l => l.line_type === 'arrears')
    expect(arrears).toHaveLength(1)
    expect(arrears[0]).toMatchObject({ property_address: '18 Watts Moses House, High Street East', gross_rent: 300, description: 'Rent Arrears From 19 Watts Moses' })
    expect(arrears[0].tenant_name).toMatch(/^Tenant C/)
    const part = p.lines.find(l => l.flags.includes('part_period'))
    expect(part).toMatchObject({ property_address: '24, Avonmouth Road', period_start: '2026-05-10', period_end: '2026-05-22', gross_rent: 345 })
    const c = balanceCheck(stmtOf(p), withStatus(p.lines))
    expect(c.totals.arrears).toBe(300)
    expect(c.balances).toBe(true)
    expect(c.expected).toBe(5866)
  })

  it('treats "Brought Forward Arrears" as an arrears payment, not part of the property label', () => {
    const p = parseAuditStatement(fixture('audit-pne-brought-forward-36.txt'))
    expect(p.errors).toEqual([])
    const bf = p.lines.find(l => /Brought Forward/i.test(l.description))
    expect(bf.line_type).toBe('arrears')
    expect(bf.property_address).toBe('7 Watts Moses House, High Street East')
    expect(bf.gross_rent).toBe(500)
    expect(balanceCheck(stmtOf(p), withStatus(p.lines)).balances).toBe(true)
  })

  it('reads the three-line "Management / Commission x% / of £y" fee cell', () => {
    const p = parseAuditStatement(fixture('audit-pne-three-line-fee-99.txt'))
    expect(p.errors).toEqual([])
    const fees = p.lines.filter(l => l.line_type === 'management_fee')
    expect(fees).toHaveLength(27)
    const lounge = fees.find(f => /Lounge/.test(f.property_address))
    expect(lounge).toMatchObject({ fee_pct: 12, fee_basis: 1200, fee_amount: 144 })
    expect(fees.every(f => f.flags.length === 0)).toBe(true)
    const c = balanceCheck(stmtOf(p), withStatus(p.lines))
    expect(c.totals.gross_rent).toBe(16305)
    expect(c.totals.management_fees).toBe(1946.6)
    expect(c.expected).toBe(14358.4)
    expect(c.balances).toBe(true)
  })

  it('reports an entry with no amount as an import error and carries on', () => {
    const text = fixture('audit-pne-71.txt').replace('£780.00  £0.00  £780.00\n', '')
    const p = parseAuditStatement(text)
    expect(p.ok).toBe(true)
    expect(p.errors).toHaveLength(1)
    expect(p.errors[0]).toMatchObject({ property_address: '29, Briardene', reason: 'No amount cell found for this entry' })
    expect(p.lines.filter(l => l.line_type === 'rent')).toHaveLength(9)
  })

  it('refuses a scanned (textless) PDF with a clear reason', () => {
    const p = parseAuditStatement('   ')
    expect(p.ok).toBe(false)
    expect(p.problem).toMatch(/no readable text/i)
  })
})

describe('balanceCheck - discrepancies', () => {
  it('shows expected, stated and the exact difference, and points at the section to blame', () => {
    const p = parse71()
    const stmt = { ...stmtOf(p), payment_amount: 5323 }
    const c = balanceCheck(stmt, withStatus(p.lines))
    expect(c.balances).toBe(false)
    expect(c.expected).toBe(5823)
    expect(c.stated).toBe(5323)
    expect(c.difference).toBe(500)
    expect(c.causes.some(s => /Summary/.test(s))).toBe(true)
  })

  it('names a line worth exactly the difference, and the section whose lines no longer add up', () => {
    const p = parse71()
    const c1 = balanceCheck({ ...stmtOf(p), payment_amount: 5123, new_balance: 5123 }, withStatus(p.lines))
    expect(c1.difference).toBe(700)
    expect(c1.causes.some(s => /Flat 7, St. Georges House.*£700\.00/.test(s))).toBe(true)
    const lines = withStatus(p.lines).filter(l => !(l.line_type === 'rent' && l.property_address === 'Flat 7, St. Georges House'))
    const c2 = balanceCheck(stmtOf(p), lines)
    expect(c2.difference).toBe(-700)
    expect(c2.causes.some(s => /Income section/.test(s))).toBe(true)
  })

  it('includes a balance carried from the previous statement', () => {
    const p = parse71()
    const c = balanceCheck({ ...stmtOf(p), previous_balance: 100, payment_amount: 5923 }, withStatus(p.lines))
    expect(c.balances).toBe(true)
  })

  it('leaves possible duplicates, errors and excluded lines out of the totals', () => {
    const p = parse71()
    const lines = withStatus(p.lines)
    lines[0].review_status = 'possible_duplicate'
    const t = computeTotals(lines)
    expect(t.gross_rent).toBe(6470 - 780)
    expect(t.excluded).toBe(1)
  })
})

describe('compareWithExisting', () => {
  const p = parse71()
  const existing = withStatus(p.lines).map((l, i) => ({ ...l, id: `row-${i}` }))

  it('marks identical lines as previously imported', () => {
    const { decisions, missingFromUpload } = compareWithExisting(p.lines, existing)
    expect(decisions.every(d => d.decision === 'previously_imported_checked')).toBe(true)
    expect(missingFromUpload).toEqual([])
  })

  it('offers a correction (with the original values) when the same slot has different figures', () => {
    const changed = existing.map(l => l.property_address === '29, Briardene' && l.line_type === 'rent' ? { ...l, gross_rent: 700, net_amount: 700, line_key: null } : l)
    const { decisions } = compareWithExisting(p.lines, changed)
    const d = decisions.find(x => x.parsed.property_address === '29, Briardene' && x.parsed.line_type === 'rent')
    expect(d.decision).toBe('correction_required')
    expect(d.diff).toEqual(expect.arrayContaining([{ field: 'gross_rent', from: 700, to: 780 }]))
  })

  it('flags a second identical line as a possible duplicate instead of importing it twice', () => {
    const doubled = [...p.lines, { ...p.lines[0] }]
    const { decisions } = compareWithExisting(doubled, [])
    expect(decisions.filter(d => d.decision === 'possible_duplicate')).toHaveLength(1)
    expect(decisions.filter(d => d.decision === 'new')).toHaveLength(20)
  })

  it('reports register lines that are missing from the upload', () => {
    const { missingFromUpload } = compareWithExisting(p.lines.slice(1), existing)
    expect(missingFromUpload).toHaveLength(1)
    expect(missingFromUpload[0].property_address).toBe('29, Briardene')
  })
})

describe('statuses, sequence and summary', () => {
  it('derives the statement status from what happened', () => {
    expect(deriveStatus({ errorCount: 1 })).toBe('import_error')
    expect(deriveStatus({ correctionCount: 1 })).toBe('correction_required')
    expect(deriveStatus({ missingFromUpload: 1 })).toBe('correction_required')
    expect(deriveStatus({ duplicateCount: 1 })).toBe('possible_duplicate')
    expect(deriveStatus({ balances: false })).toBe('discrepancy_found')
    expect(deriveStatus({ newCount: 0, previouslyCount: 5 })).toBe('previously_imported_checked')
    expect(deriveStatus({ newCount: 5 })).toBe('imported_awaiting_review')
  })

  it('flags the gap in 71, 72, 74 as statement 73 missing', () => {
    expect(missingNumbers([71, 72, 74], 71)).toEqual([73])
    expect(missingNumbers([74], 71)).toEqual([71, 72, 73])
    expect(missingNumbers([], 71)).toEqual([])
  })

  it('builds the final import summary', () => {
    const p = parse71()
    const { decisions } = compareWithExisting(p.lines, [])
    const check = balanceCheck(stmtOf(p), withStatus(p.lines))
    const s = buildImportSummary({ parsed: p, decisions, applied: { inserted: 20 }, check, checked: false, status: 'imported_awaiting_review' })
    expect(s).toMatchObject({ statement_number: 71, statement_date: '2026-01-05', statement_total: 5823, transactions_on_statement: 20, imported: 20, previously_imported: 0, corrections: 0, possible_duplicates: 0, import_errors: 0, balances: true, manually_checked: false, ready_for_bank: false })
  })

  it('helpers', () => {
    expect(toIsoDate('5th January 2026')).toBe('2026-01-05')
    expect(toIsoDate('05/01/2026')).toBe('2026-01-05')
    expect(seriesKeyFor('EXH Property Group Limited')).toBe('exh-property-group')
    const a = lineKey({ line_type: 'rent', property_address: '47 B, Somerset Street', period_start: '2026-01-01', period_end: '2026-01-31', gross_rent: 550, tenant_name: 'Ms X' })
    const b = lineKey({ line_type: 'rent', property_address: '47B Somerset Street', period_start: '2026-01-01', period_end: '2026-01-31', gross_rent: 550, tenant_name: 'ms x' })
    expect(a).toBe(b)
  })
})
