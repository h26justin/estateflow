import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory PostgREST stand-in: supports the select / eq / in / is / order /
// range / maybeSingle chain exportUserData uses, with a 1,000-row page cap.
const db = vi.hoisted(() => ({ tables: {}, failTable: null, calls: [] }))
vi.mock('../supabase', () => {
  function builder(table) {
    const filters = []
    const b = {
      select() { return b },
      eq(col, val) { filters.push(r => r[col] === val); return b },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return b },
      is(col, val) { filters.push(r => (r[col] ?? null) === val); return b },
      order() { return b },
      rows() { return (db.tables[table] || []).filter(r => filters.every(f => f(r))) },
      range(from, to) {
        db.calls.push(table)
        if (db.failTable === table) return Promise.resolve({ data: null, error: new Error(`${table} failed`) })
        return Promise.resolve({ data: b.rows().slice(from, Math.min(to + 1, from + 1000)), error: null })
      },
      maybeSingle() { return Promise.resolve({ data: b.rows()[0] || null, error: null }) },
    }
    return b
  }
  return { supabase: { from: builder } }
})

import { exportUserData } from '../api/backups'

const U = 'user-1'
beforeEach(() => {
  db.failTable = null
  db.calls.length = 0
  db.tables = {
    user_profiles: [{ id: 'p', user_id: U }],
    companies: [
      { id: 'co-own', owner_id: U },
      { id: 'co-shared', owner_id: 'owner-2' },
      { id: 'co-other', owner_id: 'stranger' },
    ],
    user_company_access: [{ id: 'a1', user_id: U, company_id: 'co-shared' }],
    properties: [
      { id: 'pr1', company_id: 'co-own', user_id: U },
      { id: 'pr2', company_id: 'co-shared', user_id: 'owner-2' },   // created by a team-mate
      { id: 'pr3', company_id: 'co-other', user_id: 'stranger' },
    ],
    rent_payments: Array.from({ length: 2500 }, (_, i) => ({ id: `rp${i}`, property_id: i % 2 ? 'pr1' : 'pr2' })),
    rent_receipts: [{ id: 'rr1', property_id: 'pr2' }, { id: 'rr2', property_id: 'pr3' }],
    rent_allocations: [{ id: 'al1', receipt_id: 'rr1' }, { id: 'al2', receipt_id: 'rr2' }],
    refurb_projects: [{ id: 'rf1', property_id: 'pr1' }],
    refurb_lines: [{ id: 'rl1', project_id: 'rf1' }],
    external_loans: [{ id: 'l1', company_id: 'co-shared' }],
    external_loan_payments: [{ id: 'lp1', loan_id: 'l1' }],
  }
})

describe('exportUserData', () => {
  it('scopes by accessible companies, not by creator', async () => {
    const out = await exportUserData(U)
    expect(out.companies.map(c => c.id).sort()).toEqual(['co-own', 'co-shared'])
    expect(out.properties.map(p => p.id).sort()).toEqual(['pr1', 'pr2'])
    expect(out.rent_receipts.map(r => r.id)).toEqual(['rr1'])
    expect(out.rent_allocations.map(r => r.id)).toEqual(['al1'])
  })

  it('paginates past the 1,000-row cap', async () => {
    const out = await exportUserData(U)
    expect(out.rent_payments).toHaveLength(2500)
  })

  it('exports the Rent Tracker, refurb and loan tables', async () => {
    const out = await exportUserData(U)
    expect(out.refurb_lines.map(r => r.id)).toEqual(['rl1'])
    expect(out.external_loan_payments.map(r => r.id)).toEqual(['lp1'])
    for (const k of ['rent_tracker_tenancies', 'non_chargeable_periods', 'rent_overrides', 'payment_plans',
      'refurb_invoices', 'refurb_invoice_allocations', 'stl_bookings', 'stl_adjustments']) {
      expect(Array.isArray(out[k])).toBe(true)
    }
  })

  it('throws when a table fails instead of exporting it as empty', async () => {
    db.failTable = 'rent_payments'
    await expect(exportUserData(U)).rejects.toThrow('rent_payments failed')
  })
})
