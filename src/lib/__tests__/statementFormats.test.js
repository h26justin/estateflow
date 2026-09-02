import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectFormat, detectFormatDetail, parseStatement, normaliseStatementText, mergeSamePeriodRent } from '../statementParser'

// Text produced by src/lib/pdfText.js from real 2026 statements (tenant names
// anonymised). These pin the two layouts that broke the importer: the PNE
// template that no longer names the agent, and the rotated RMS
// STATEMENT/INVOICE page.
const fixture = f => readFileSync(join(process.cwd(), 'src/lib/__tests__/fixtures', f), 'utf8')
const PNE = fixture('pne-statement-2026.txt')
const RMS = fixture('rms-statement-invoice-2026.txt')

describe('detectFormat', () => {
  it('recognises the 2026 PNE layout without brand words', () => {
    expect(PNE.includes('PNE')).toBe(false)
    expect(PNE.includes('Propertunity')).toBe(false)
    expect(detectFormat(PNE)).toBe('PNE')
  })
  it('recognises the 2026 RMS layout from its structure, not the logo', () => {
    expect(/Rook Matthews/i.test(RMS)).toBe(false)
    const d = detectFormatDetail(RMS)
    expect(d.format).toBe('RMS'); expect(d.rmsHits).toBeGreaterThanOrEqual(4); expect(d.pneHits).toBe(0)
  })
  it('refuses unrelated text and explains why', () => {
    const r = parseStatement('Dear landlord, please find attached the invoice for the boiler service.')
    expect(r.format).toBe('UNKNOWN'); expect(r.parsed).toBeNull(); expect(r.problem).toMatch(/Could not recognise/)
  })
  it('names a scanned (textless) PDF', () => {
    expect(parseStatement('').problem).toMatch(/no readable text/)
  })
})

describe('PNE 2026 statement', () => {
  const r = parseStatement(PNE)
  it('finds every rent line and ties to the statement total', () => {
    expect(r.counts.rent).toBe(31)
    expect(r.parsed.totalIncome).toBe(16305)
    expect(r.parsed.statementNo).toBe('99')
    expect(r.parsed.paymentAmount).toBe(14358.4)
  })
  it('finds every commission line, including the wrapped ones on later pages', () => {
    expect(r.counts.fees).toBe(27)
    expect(Math.round(r.parsed.totalFees * 100) / 100).toBe(1946.6)
    expect(Math.round((r.parsed.totalIncome - r.parsed.totalFees) * 100) / 100).toBe(14358.4)
  })
  it('keeps the property and tenant on each rent line', () => {
    const first = r.parsed.items.find(i => i.type === 'rent')
    expect(first.propertyName).toBe('35, Henley Road')
    expect(first.period).toBe('31/07/2026 to 30/08/2026')
    expect(first.tenant).toBe('Tenant A')
    expect(first.amount).toBe(635)
  })
  it('repairs wrapped fee cells before parsing', () => {
    const t = normaliseStatementText('Management\nCommission 12.00%  £60.00  £0.00  £60.00\nof £500.00')
    expect(t.trim()).toBe('Management Commission 12.00%  £60.00  £0.00  £60.00 of £500.00')
  })
})

describe('RMS 2026 STATEMENT/INVOICE', () => {
  const r = parseStatement(RMS)
  it('reads the header', () => {
    expect(r.parsed.statementNo).toBe('BYHS-RMS-P600298')
    expect(r.parsed.date).toBe('02/09/2026')
  })
  it('reads the rent receipt with property, tenant and period', () => {
    const rent = r.parsed.items.filter(i => i.type === 'rent')
    expect(rent).toHaveLength(1)
    expect(rent[0]).toMatchObject({ propertyName: '5 Jubilee Road', amount: 600, period: '31/08/2026 to 29/09/2026', tenant: 'Mr Example Tenant' })
  })
  it('reads the letting agent fee once (not again from the fee invoice block) and the payout', () => {
    const fees = r.parsed.items.filter(i => i.type === 'fee')
    expect(fees).toHaveLength(1)
    expect(fees[0].amount).toBe(50.4)
    expect(r.parsed.paymentAmount).toBe(549.6)
    expect(Math.round((r.parsed.totalIncome - r.parsed.totalFees) * 100) / 100).toBe(549.6)
  })
})

describe('mergeSamePeriodRent', () => {
  const line = (propertyId, period, amount, tenant, type = 'rent', include = true) => ({ propertyId, period, amount, editAmount: amount, tenant, type, include, propertyName: 'x' })
  it('sums part payments for one property and period and keeps each line as a part', () => {
    const items = [line('p1', '01/08/2026 to 31/08/2026', 300, 'A'), line('p1', '01/08/2026 to 31/08/2026', 200, 'B'), line('p2', '01/08/2026 to 31/08/2026', 500, 'C')]
    const out = mergeSamePeriodRent(items)
    expect(out).toHaveLength(2)
    expect(out[0].editAmount).toBe(500); expect(out[0].parts).toHaveLength(2); expect(out[0].tenant).toBe('A + B')
    expect(out[1].editAmount).toBe(500); expect(out[1].parts).toHaveLength(1)
  })
  it('leaves fees, unmatched and excluded lines untouched and preserves order', () => {
    const items = [line('p1', 'x', 60, '', 'fee'), line(null, 'y', 500, 'A'), line('p1', 'y', 500, 'A', 'rent', false), line('p1', 'y', 500, 'A')]
    const out = mergeSamePeriodRent(items)
    expect(out).toHaveLength(4); expect(out[0].type).toBe('fee'); expect(out[3].parts).toHaveLength(1)
  })
  it('keeps very large and very small amounts exactly', () => {
    const out = mergeSamePeriodRent([line('p1', 'z', 12345.67, 'A'), line('p1', 'z', 0.33, 'B')])
    expect(out[0].editAmount).toBe(12346)
  })
})
