import { describe, it, expect } from 'vitest'
import {
  moneyTokens, toPages, hasTextLayer, vatIncludedFor,
  parseCompletionStatement, validateCompletionFigures,
  parseOfferLetter, validateOfferFigures,
  detectDealDocumentType, extractDealDocumentFields, validateFor,
} from '../completionStatementParser'

// Fixtures written to match the Deals brief's worked examples. These are
// document-shaped examples, not live data.

// 3 Park Row: total £17,039, on account £300, balance £16,739.
const PARK_ROW = [
  [
    'Smith & Co Solicitors',
    'COMPLETION STATEMENT',
    'Property: 3 Park Row',
    'Completion date: 14 November 2026',
    'Purchase price   £15,000.00',
    'Stamp Duty Land Tax   £0.00',
    'Our legal fees   £1,450.00   plus VAT   £290.00',
    'Local authority search   £149.00',
    'Drainage and water search   £100.00',
  ],
  [
    'Land Registry fee (Scale 2)   £50.00',
    'Total   £17,039.00',
    'Less: monies received on account   (£300.00)',
    'BALANCE DUE TO COMPLETE   £16,739.00',
  ],
]

// 4 Douro Terrace: total £153,838, on account £150, balance £153,688.
const DOURO_TERRACE = [
  'Completion Statement',
  '4 Douro Terrace',
  'Purchase price  150,000.00',
  'Stamp Duty Land Tax  2,500.00',
  'Legal fees (inc VAT)  1,020.00',
  'Searches  228.00',
  'Land Registry  90.00',
  'Total  153,838.00',
  'Received on account  150.00',
  'Amount required to complete  153,688.00',
].join('\n')

const byField = (list, f) => list.filter(s => s.field === f)
const one = (list, f) => { const r = byField(list, f); expect(r).toHaveLength(1); return r[0] }

describe('moneyTokens', () => {
  it('reads pounds, pence, commas and brackets', () => {
    expect(moneyTokens('Total £17,039.00').map(t => t.value)).toEqual([17039])
    const t = moneyTokens('Less on account (£300.00)')
    expect(t[0]).toMatchObject({ value: 300, negative: true, strong: true })
  })

  it('ignores percentages, dates, scales and references', () => {
    expect(moneyTokens('VAT @ 20%  170.00').map(t => t.value)).toEqual([170])
    expect(moneyTokens('Completion 14/11/2026')).toEqual([])
    expect(moneyTokens('Land Registry fee (Scale 2)')).toEqual([])
    expect(moneyTokens('Balance due on 14 November 2026')).toEqual([])
    expect(moneyTokens('Our ref 12345')).toEqual([])
  })

  it('accepts a bare integer only as the last token', () => {
    expect(moneyTokens('Searches 228').map(t => t.value)).toEqual([228])
    expect(moneyTokens('Flat 3 searches 228.00').map(t => t.value)).toEqual([228])
  })
})

describe('toPages / hasTextLayer', () => {
  it('splits extractor text on the page break marker', () => {
    const pages = toPages('a\nb\n\n--- PAGE BREAK ---\n\nc')
    expect(pages).toEqual([['a', 'b'], ['c']])
  })
  it('treats an empty or near-empty document as having no text layer', () => {
    expect(hasTextLayer([[], []])).toBe(false)
    expect(hasTextLayer('  \n --- PAGE BREAK --- \n ')).toBe(false)
    expect(hasTextLayer(PARK_ROW)).toBe(true)
  })
})

describe('parseCompletionStatement: 3 Park Row', () => {
  const { suggestions, validation } = parseCompletionStatement(PARK_ROW)

  it('finds every figure with its page and quote', () => {
    expect(one(suggestions, 'purchase_price')).toMatchObject({ category: 'purchase_price', value_number: 15000, page: 1, quote: 'Purchase price £15,000.00' })
    expect(one(suggestions, 'sdlt')).toMatchObject({ category: 'sdlt', value_number: 0, page: 1 })
    expect(byField(suggestions, 'searches').map(s => s.value_number)).toEqual([149, 100])
    expect(one(suggestions, 'land_registry')).toMatchObject({ value_number: 50, page: 2 })
    expect(one(suggestions, 'total')).toMatchObject({ category: null, value_number: 17039, page: 2 })
    expect(one(suggestions, 'on_account')).toMatchObject({ category: 'on_account', value_number: 300, page: 2 })
    expect(one(suggestions, 'balance_due')).toMatchObject({ category: null, value_number: 16739, page: 2, quote: 'BALANCE DUE TO COMPLETE £16,739.00' })
  })

  it('splits a fee-plus-VAT line into the fee and the VAT', () => {
    expect(one(suggestions, 'legal_fee')).toMatchObject({ value_number: 1450, category: 'legal_fee' })
    expect(one(suggestions, 'legal_vat')).toMatchObject({ value_number: 290, category: 'legal_vat' })
    expect(vatIncludedFor('legal_fee', one(suggestions, 'legal_fee').quote)).toBe(false)
  })

  it('every suggestion carries a confidence between 0 and 1', () => {
    for (const s of suggestions) {
      expect(s.confidence).toBeGreaterThan(0)
      expect(s.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('validates total - credits = balance due', () => {
    expect(validation).toMatchObject({ status: 'ok', total: 17039, credits: 300, balanceDue: 16739, expectedBalance: 16739, difference: 0 })
    // The items add up to the total too.
    expect(validation.itemsTotal).toBe(17039)
    expect(validation.itemsDifference).toBe(0)
  })
})

describe('parseCompletionStatement: 4 Douro Terrace', () => {
  const { suggestions, validation } = parseCompletionStatement(DOURO_TERRACE)

  it('reads figures without £ signs', () => {
    expect(one(suggestions, 'purchase_price').value_number).toBe(150000)
    expect(one(suggestions, 'sdlt').value_number).toBe(2500)
    expect(one(suggestions, 'searches').value_number).toBe(228)
    expect(one(suggestions, 'land_registry').value_number).toBe(90)
    expect(one(suggestions, 'on_account').value_number).toBe(150)
    expect(one(suggestions, 'balance_due').value_number).toBe(153688)
  })

  it('keeps a VAT-inclusive fee as one line', () => {
    const fee = one(suggestions, 'legal_fee')
    expect(fee.value_number).toBe(1020)
    expect(byField(suggestions, 'legal_vat')).toHaveLength(0)
    expect(vatIncludedFor('legal_fee', fee.quote)).toBe(true)
  })

  it('balances within £1', () => {
    expect(validation).toMatchObject({ status: 'ok', total: 153838, credits: 150, balanceDue: 153688 })
  })
})

describe('validation', () => {
  it('flags a mismatch beyond £1', () => {
    const text = DOURO_TERRACE.replace('153,688.00', '153,588.00')
    const { validation } = parseCompletionStatement(text)
    expect(validation.status).toBe('mismatch')
    expect(validation.difference).toBe(-100)
    expect(validation.message).toMatch(/Mismatch/)
  })

  it('tolerates rounding up to £1', () => {
    const v = validateCompletionFigures([
      { field: 'total', value_number: 1000 }, { field: 'on_account', value_number: 100 }, { field: 'balance_due', value_number: 900.99 },
    ])
    expect(v.status).toBe('ok')
    const w = validateCompletionFigures([
      { field: 'total', value_number: 1000 }, { field: 'on_account', value_number: 100 }, { field: 'balance_due', value_number: 901.5 },
    ])
    expect(w.status).toBe('mismatch')
  })

  it('is incomplete without a total or balance, and never assumes zero', () => {
    const v = validateCompletionFigures([{ field: 'total', value_number: 1000 }])
    expect(v.status).toBe('incomplete')
    expect(v.message).toMatch(/balance due/)
  })

  it('leaves rejected rows out and uses edited values', () => {
    const rows = [
      { field: 'total', value_number: 1000 },
      { field: 'on_account', value_number: 100, status: 'rejected' },
      { field: 'balance_due', value_number: '1000' },
    ]
    expect(validateCompletionFigures(rows).status).toBe('ok')
  })

  it('counts a mortgage advance as a credit but not a cost', () => {
    const { suggestions, validation } = parseCompletionStatement([
      'Completion statement', 'Purchase price 200,000.00', 'Total 200,000.00',
      'Mortgage advance (150,000.00)', 'Paid on account 1,000.00', 'Balance required 49,000.00',
    ])
    expect(one(suggestions, 'mortgage_advance')).toMatchObject({ category: null, value_number: 150000 })
    expect(validation).toMatchObject({ status: 'ok', credits: 151000 })
  })
})

describe('statement layouts', () => {
  it('joins a label with its amount on the next line', () => {
    const { suggestions } = parseCompletionStatement(['Completion statement', 'Balance due', '£16,739.00'].join('\n'))
    expect(one(suggestions, 'balance_due')).toMatchObject({ value_number: 16739, quote: 'Balance due £16,739.00' })
  })

  it('keeps the first of a repeated single figure and lowers its confidence when they differ', () => {
    const { suggestions } = parseCompletionStatement(['Purchase price 100,000.00', 'Purchase price 110,000.00'])
    const p = one(suggestions, 'purchase_price')
    expect(p.value_number).toBe(100000)
    expect(p.confidence).toBeLessThan(0.95)
    expect(p.alternatives).toEqual([expect.objectContaining({ value_number: 110000 })])
  })

  it('does not treat "Total legal fees" as the statement total', () => {
    const { suggestions } = parseCompletionStatement(['Total legal fees 1,200.00'])
    expect(byField(suggestions, 'total')).toHaveLength(0)
    expect(one(suggestions, 'legal_fee').value_number).toBe(1200)
  })

  it('takes the debit column from a two-column total line', () => {
    const { suggestions } = parseCompletionStatement(['Total  17,039.00  300.00'])
    expect(one(suggestions, 'total').value_number).toBe(17039)
  })

  it('reads a separate VAT line and disbursements', () => {
    const { suggestions } = parseCompletionStatement(['Legal fees 850.00', 'VAT on legal fees 170.00', 'Bank transfer fee 42.00', 'ID check 12.00'])
    expect(one(suggestions, 'legal_vat').value_number).toBe(170)
    expect(byField(suggestions, 'disbursements').map(s => s.value_number)).toEqual([42, 12])
  })

  it('ignores lines with no recognised label', () => {
    const { suggestions } = parseCompletionStatement(['Client account 12345678', 'Sort code 20-00-00', 'Something else 99.00'])
    expect(suggestions).toEqual([])
  })
})

describe('offer letters and brochures', () => {
  it('separates the agreed price from the asking price', () => {
    const { suggestions, validation } = parseOfferLetter([
      'Memorandum of sale',
      'Asking price: £180,000',
      'Offer accepted: £172,500 subject to contract',
    ])
    expect(one(suggestions, 'agreed_price')).toMatchObject({ category: 'purchase_price', value_number: 172500, confidence: 0.9 })
    expect(one(suggestions, 'asking_price')).toMatchObject({ category: null, value_number: 180000 })
    expect(validation).toMatchObject({ status: 'ok', agreed: 172500, asking: 180000, difference: -7500 })
    expect(validation.message).toMatch(/below the asking price/)
  })

  it('never treats an advertised price as agreed', () => {
    const { suggestions, validation } = parseOfferLetter(['Guide price £250,000', 'Offers in excess of £240,000'])
    expect(byField(suggestions, 'agreed_price')).toHaveLength(0)
    expect(suggestions.every(s => s.category === null)).toBe(true)
    expect(validation.status).toBe('no_agreed')
    expect(validation.message).toMatch(/not the agreed price/)
  })

  it('splits a line that names both', () => {
    const { suggestions } = parseOfferLetter(['Sale agreed at £95,000 against an asking price of £100,000'])
    expect(one(suggestions, 'agreed_price').value_number).toBe(95000)
    expect(one(suggestions, 'asking_price').value_number).toBe(100000)
  })

  it('validateOfferFigures with no figures', () => {
    expect(validateOfferFigures([]).status).toBe('no_agreed')
  })
})

describe('extractDealDocumentFields', () => {
  it('detects the document type', () => {
    expect(detectDealDocumentType(PARK_ROW)).toBe('completion_statement')
    expect(detectDealDocumentType(['We are pleased to confirm your offer of £150,000'])).toBe('offer')
    expect(detectDealDocumentType(['Hello'])).toBe('unknown')
  })

  it('returns hasText false for a scan', () => {
    expect(extractDealDocumentFields([[], []])).toEqual({ docType: 'unknown', hasText: false, suggestions: [], validation: null })
  })

  it('routes an offer letter to the offer parser', () => {
    const out = extractDealDocumentFields(['Offer letter', 'Our offer of £150,000 has been accepted'])
    expect(out.docType).toBe('offer')
    expect(one(out.suggestions, 'agreed_price').value_number).toBe(150000)
  })

  it('reads an unlabelled statement by its lines', () => {
    const out = extractDealDocumentFields(['Purchase price 100,000.00', 'Total 100,000.00'])
    expect(out.docType).toBe('completion_statement')
  })

  it('validateFor picks the offer check for offer rows', () => {
    expect(validateFor('offer', [{ field: 'agreed_price', value_number: 1 }]).status).toBe('ok')
    expect(validateFor('completion_statement', [{ field: 'total', value_number: 1 }]).status).toBe('incomplete')
  })
})
