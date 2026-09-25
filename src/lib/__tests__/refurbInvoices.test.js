import { describe, it, expect } from 'vitest'
import {
  evenSplit, percentSplit, reconcile, allocationProblems, allocationBase, findDuplicate,
  paidAgainst, invoiceStatus, outstandingOn, splitPayment, invoicedByProject, invoicesForProject,
  defaultProjectFor, extractInvoiceFields, parseDate,
} from '../refurbInvoices'

const sum = xs => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100

describe('splits', () => {
  it('even split: £25,000 across 10 = £2,500 each', () => {
    expect(evenSplit(25000, 10)).toEqual(Array(10).fill(2500))
  })
  it('even split keeps the odd pennies so parts add back to the total', () => {
    const parts = evenSplit(1000, 3)
    expect(parts).toEqual([333.34, 333.33, 333.33])
    expect(sum(parts)).toBe(1000)
  })
  it('percentage split absorbs rounding on the last row when % add to 100', () => {
    const parts = percentSplit(999.99, [33.3, 33.3, 33.4])
    expect(sum(parts)).toBe(999.99)
  })
  it('percentage split that does not add to 100 does not reconcile', () => {
    const parts = percentSplit(1000, [50, 40])
    expect(reconcile(1000, parts)).toMatchObject({ allocated: 900, remaining: 100, ok: false })
  })
})

describe('reconciliation', () => {
  const inv = { supplier_name: 'GLB Building', gross_amount: 25000, net_amount: 25000, vat_amount: 0 }
  it('shows total / allocated / remaining live', () => {
    expect(reconcile(25000, [2500, 2500])).toEqual({ total: 25000, allocated: 5000, remaining: 20000, ok: false })
    expect(reconcile(25000, evenSplit(25000, 10)).ok).toBe(true)
  })
  it('blocks a save that does not reconcile, with a plain reason', () => {
    const rows = [{ project_id: 'a', amount: 12000 }, { project_id: 'b', amount: 12000 }]
    expect(allocationProblems(inv, rows)).toContain('£1000.00 still to allocate')
    expect(allocationProblems(inv, [{ project_id: 'a', amount: 26000 }])).toContain('Over-allocated by £1000.00')
    expect(allocationProblems(inv, [{ project_id: 'a', amount: 25000 }])).toEqual([])
  })
  it('flags net + VAT that does not equal gross', () => {
    expect(allocationProblems({ ...inv, net_amount: 20000, vat_amount: 4000 }, [{ project_id: 'a', amount: 25000 }])).toContain('Net plus VAT does not equal the gross amount')
  })
  it('a property with no refurb must be linked or have one created', () => {
    expect(allocationProblems(inv, [{ project_id: null, amount: 25000 }])).toContain('Every property needs a refurb to allocate to')
    expect(allocationProblems(inv, [{ project_id: null, create_project: true, amount: 25000 }])).toEqual([])
  })
  it('allocates on net when VAT is reclaimable', () => {
    expect(allocationBase({ gross_amount: 1200, net_amount: 1000, allocation_basis: 'net' })).toBe(1000)
    expect(allocationBase({ gross_amount: 1200, net_amount: 1000, allocation_basis: 'gross' })).toBe(1200)
  })
})

describe('duplicates', () => {
  const existing = [{ id: 'i1', supplier_name: 'GLB Building Ltd', invoice_number: 'INV-0022' }]
  it('same supplier + invoice number is a duplicate regardless of case, punctuation and Ltd', () => {
    expect(findDuplicate({ supplier_name: 'glb building', invoice_number: 'inv 0022' }, existing)?.id).toBe('i1')
  })
  it('different number or supplier is not', () => {
    expect(findDuplicate({ supplier_name: 'GLB Building', invoice_number: 'INV-0023' }, existing)).toBeNull()
    expect(findDuplicate({ supplier_name: 'Other Builders', invoice_number: 'INV-0022' }, existing)).toBeNull()
  })
  it('ignores deleted invoices', () => {
    expect(findDuplicate({ supplier_name: 'GLB Building', invoice_number: 'INV-0022' }, [{ ...existing[0], deleted_at: '2026-09-01' }])).toBeNull()
  })
})

describe('invoice vs payment', () => {
  const inv = { id: 'inv', gross_amount: 1000, approval_status: 'approved' }
  it('uploading an invoice does not make it paid', () => {
    expect(paidAgainst('inv', [])).toBe(0)
    expect(invoiceStatus(inv, [])).toBe('approved')
    expect(outstandingOn(inv, [])).toBe(1000)
  })
  it('only payment lines linked to the invoice move it to part paid / paid', () => {
    const lines = [
      { invoice_id: 'inv', kind: 'payment', amount: 400 },
      { invoice_id: 'inv', kind: 'extra', amount: 999 },       // a variation extra is not money paid
      { invoice_id: 'other', kind: 'payment', amount: 600 },
    ]
    expect(invoiceStatus(inv, lines)).toBe('part_paid')
    expect(outstandingOn(inv, lines)).toBe(600)
    expect(invoiceStatus(inv, [...lines, { invoice_id: 'inv', kind: 'payment', amount: 600 }])).toBe('paid')
  })
  it('a refund linked to the invoice reduces what was paid', () => {
    const lines = [{ invoice_id: 'inv', kind: 'payment', amount: 1000 }, { invoice_id: 'inv', kind: 'credit', amount: 100 }]
    expect(paidAgainst('inv', lines)).toBe(900)
    expect(invoiceStatus(inv, lines)).toBe('part_paid')
  })
  it('credit notes show as Credit / refunded', () => {
    expect(invoiceStatus({ id: 'c', doc_kind: 'credit_note', gross_amount: 200 }, [])).toBe('credit')
  })
  it('splits one payment across the allocations pro rata, to the penny', () => {
    const allocs = [{ id: 'a1', project_id: 'p1', amount: 2500 }, { id: 'a2', project_id: 'p2', amount: 2500 }, { id: 'a3', project_id: 'p3', amount: 5000 }]
    const parts = splitPayment(1000, allocs)
    expect(parts.map(p => p.amount)).toEqual([250, 250, 500])
    const odd = splitPayment(100, [{ project_id: 'a', amount: 1 }, { project_id: 'b', amount: 1 }, { project_id: 'c', amount: 1 }])
    expect(sum(odd.map(p => p.amount))).toBe(100)
  })
})

describe('traceability', () => {
  const invoices = [
    { id: 'i1', invoice_number: 'INV-0022', invoice_date: '2026-09-01', refurb_invoice_allocations: [{ project_id: 'p1', amount: 2500 }, { project_id: 'p2', amount: 2500 }] },
    { id: 'c1', doc_kind: 'credit_note', invoice_date: '2026-09-10', refurb_invoice_allocations: [{ project_id: 'p1', amount: 300 }] },
    { id: 'gone', deleted_at: '2026-09-11', refurb_invoice_allocations: [{ project_id: 'p1', amount: 999 }] },
  ]
  it('invoiced per project nets credit notes and ignores deleted invoices', () => {
    const m = invoicedByProject(invoices)
    expect(m.get('p1')).toBe(2200); expect(m.get('p2')).toBe(2500)
  })
  it('lists the invoices behind a project, newest first, with its share', () => {
    const rows = invoicesForProject('p1', invoices)
    expect(rows.map(r => r.invoice.id)).toEqual(['c1', 'i1'])
    expect(rows[1].allocated).toBe(2500)
  })
  it('picks the open refurb for a property, else its latest', () => {
    expect(defaultProjectFor({ refurb_projects: [{ id: 'old', stage: 'complete', start_date: '2025-01-01' }, { id: 'now', stage: 'in_progress', start_date: '2026-05-01' }] }).id).toBe('now')
    expect(defaultProjectFor({ refurb_projects: [{ id: 'old', stage: 'complete', start_date: '2025-01-01' }] }).id).toBe('old')
    expect(defaultProjectFor({ refurb_projects: [] })).toBeNull()
  })
})

describe('reading invoice text', () => {
  const xero = [
    'GLB Building Services',
    'TAX INVOICE',
    'Invoice Number  INV-0022',
    'Invoice Date  1 Sep 2026',
    'Due Date  15 Sep 2026',
    'Description  Quantity  Unit Price  Amount GBP',
    'Kitchen refit and rewire, Flats 1-10  1.00  25,000.00  25,000.00',
    'Subtotal  25,000.00',
    'TOTAL VAT 20%  5,000.00',
    'TOTAL GBP  30,000.00',
  ].join('\n')
  it('pulls number, dates and totals from a Xero-style invoice', () => {
    const f = extractInvoiceFields(xero)
    expect(f.invoice_number).toBe('INV-0022')
    expect(f.invoice_date).toBe('2026-09-01')
    expect(f.due_date).toBe('2026-09-15')
    expect(f.net_amount).toBe(25000)
    expect(f.vat_amount).toBe(5000)
    expect(f.gross_amount).toBe(30000)
    expect(f.supplier_name).toBe('GLB Building Services')
    expect(f.doc_kind).toBe('invoice')
  })
  it('recognises a credit note', () => {
    expect(extractInvoiceFields('Acme Ltd\nCREDIT NOTE\nCredit Note No: CN-12\nTotal  200.00').doc_kind).toBe('credit_note')
  })
  it('fills gross from net + VAT when there is no total line', () => {
    const f = extractInvoiceFields('Builder Co\nInvoice No: 77\nNet amount 1,000.00\nVAT 200.00')
    expect(f.gross_amount).toBe(1200)
  })
  it('returns blanks, never guesses, on empty text (a scanned PDF)', () => {
    expect(extractInvoiceFields('')).toMatchObject({ supplier_name: null, invoice_number: null, gross_amount: null })
  })
  it('parses UK dates', () => {
    expect(parseDate('03/10/2026')).toBe('2026-10-03')
    expect(parseDate('3rd October 2026')).toBe('2026-10-03')
    expect(parseDate('2026-10-03')).toBe('2026-10-03')
    expect(parseDate('31/02/x')).toBeNull()
  })
})
