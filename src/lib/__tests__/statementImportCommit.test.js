import { describe, it, expect, vi, beforeEach } from 'vitest'

// A tiny in-memory stand-in for the tables a statement import and its revert
// touch, so the undo bookkeeping can be checked end to end.
const db = { import_batches: [], rent_payments: [], rent_receipts: [], rent_allocations: [], property_expenses: [], statement_imports: [] }
let seq = 0
function query(table) {
  const filters = []
  let op = 'select', payload = null, wantRows = false
  const rows = () => db[table].filter(r => filters.every(f => f(r)))
  const run = () => {
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: `${table}-${++seq}`, ...r }))
      db[table].push(...list)
      return { data: list, error: null }
    }
    if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null } }
    if (op === 'delete') {
      const hit = rows()
      db[table] = db[table].filter(r => !hit.includes(r))
      if (table === 'rent_receipts') db.rent_allocations = db.rent_allocations.filter(a => !hit.some(h => h.id === a.receipt_id))
      return { data: wantRows ? hit : null, error: null }
    }
    return { data: rows().map(r => ({ ...r })), error: null }
  }
  const q = {
    select: () => { if (op !== 'select') wantRows = true; return q },
    insert: v => { op = 'insert'; payload = v; return q },
    update: v => { op = 'update'; payload = v; return q },
    delete: () => { op = 'delete'; return q },
    eq: (c, v) => { filters.push(r => r[c] === v); return q },
    in: (c, vs) => { filters.push(r => vs.includes(r[c])); return q },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return q },
    not: (c, _o, v) => { filters.push(r => (r[c] ?? null) !== v); return q },
    gte: () => q, lte: () => q, order: () => q, limit: () => q, range: () => q,
    single: async () => { const { data, error } = run(); return { data: Array.isArray(data) ? data[0] ?? null : data, error } },
    maybeSingle: async () => { const { data, error } = run(); return { data: Array.isArray(data) ? data[0] ?? null : data, error } },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  }
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: table => query(table),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('../api/documents', () => ({ validateUpload: () => {} }))
vi.mock('../api/tenancies', () => ({
  createReceipt: async (receipt, allocations) => {
    const r = { id: `rent_receipts-${++seq}`, ...receipt }
    db.rent_receipts.push(r)
    for (const a of allocations) db.rent_allocations.push({ id: `rent_allocations-${++seq}`, receipt_id: r.id, ...a })
    return r
  },
}))

import { commitStatementImport } from '../api/statementImports'
import { revertImportBatch } from '../api/dataImport'
import { planImport } from '../statementImport'

const header = n => ({ agent: 'RMS', statementRef: n, statementDate: '2026-09-02' })
const property = { id: 'p1', company_id: 'c1' }
const rentRow = (ref, row, create, alreadyReceived) => ({
  include: true, blocked: false, kind: 'rent', propertyId: 'p1', property, tenancy: null, tenant: 'A Tenant',
  periodStart: '2026-09-01', periodEnd: '2026-09-30', txDate: '2026-09-02', amount: 400, ref,
  target: row ? { row, exact: true } : { create }, rentDue: 1000, alreadyReceived, legacyAmount: null,
})

describe('statement import revert bookkeeping', () => {
  beforeEach(() => { for (const k of Object.keys(db)) db[k] = []; seq = 0 })

  it('statement A creates a period, B adds to it: reverting B then A leaves no phantom period', async () => {
    // A: no period covers September yet, so the import creates one.
    const create = { year: 2026, month: 9, month_label: 'Sep 2026', period_start: '2026-09-01', period_end: '2026-09-30' }
    const planA = planImport([rentRow('ref-a', null, create, 0)], { header: header('A') })
    const a = await commitStatementImport({ plan: planA, header: header('A'), companyId: 'c1' })
    expect(a.errors).toEqual([])
    const period = db.rent_payments[0]
    expect(period).toMatchObject({ status: 'partial', amount: 400, import_batch_id: a.batchId })

    // B: the review sees the period as the property embed loads it, which
    // carries no source_ref / import_batch_id.
    const embedRow = { id: period.id, year: 2026, month: 9, period_start: period.period_start, period_end: period.period_end, status: period.status, amount: period.amount }
    const planB = planImport([rentRow('ref-b', embedRow, null, 400)], { header: header('B') })
    const b = await commitStatementImport({ plan: planB, header: header('B'), companyId: 'c1' })
    expect(b.errors).toEqual([])
    expect(db.rent_payments[0]).toMatchObject({ amount: 800, import_batch_id: b.batchId })

    await revertImportBatch(b.batchId)
    expect(db.rent_payments).toHaveLength(1)
    expect(db.rent_payments[0]).toMatchObject({ status: 'partial', amount: 400, import_batch_id: a.batchId })

    await revertImportBatch(a.batchId)
    expect(db.rent_receipts).toHaveLength(0)
    expect(db.rent_payments).toHaveLength(0)
  })

  it('a period that existed before any import is restored, never deleted', async () => {
    db.rent_payments.push({ id: 'sep', property_id: 'p1', period_start: '2026-09-01', period_end: '2026-09-30', status: 'partial', amount: 200, source_ref: 'hand', import_batch_id: null })
    const plan = planImport([rentRow('ref-c', { id: 'sep', status: 'partial', amount: 200 }, null, 200)], { header: header('C') })
    const c = await commitStatementImport({ plan, header: header('C'), companyId: 'c1' })
    expect(c.periodsUpdated).toBe(1)
    await revertImportBatch(c.batchId)
    expect(db.rent_payments).toEqual([expect.objectContaining({ id: 'sep', status: 'partial', amount: 200, source_ref: 'hand', import_batch_id: null })])
  })
})
