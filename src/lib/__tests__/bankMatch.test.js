import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal PostgREST stand-in for bank_transactions / rent_payments that
// records updates and lets a test decide how many rows an update "hits"
// (RLS refusals surface as zero rows, not as errors).
const db = vi.hoisted(() => ({ rows: {}, updates: [], hits: {} }))
vi.mock('../supabase', () => {
  function from(table) {
    let patch = null
    const filters = {}
    const match = () => Object.values(db.rows[table] || {}).filter(r => Object.entries(filters).every(([k, v]) => r[k] === v))
    const b = {
      select() { return b },
      update(p) { patch = p; return b },
      eq(col, val) { filters[col] = val; return b },
      single() { const r = match()[0]; return Promise.resolve(r ? { data: r, error: null } : { data: null, error: new Error('not found') }) },
      maybeSingle() { return Promise.resolve({ data: match()[0] || null, error: null }) },
      then(resolve) {
        // Awaited update chain (with or without .select()).
        const hit = table in db.hits ? db.hits[table] : match().length
        db.updates.push({ table, patch, filters: { ...filters } })
        if (hit) for (const r of match()) Object.assign(r, patch)
        return Promise.resolve({ data: Array.from({ length: hit }, () => ({ id: filters.id })), error: null }).then(resolve)
      },
    }
    return b
  }
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) } } }
})

import { matchTransactionToRentPayment, unmatchTransaction, planBankMatch, planBankUnmatch } from '../api/bank'

beforeEach(() => {
  db.updates.length = 0
  db.hits = {}
  db.rows = {
    bank_transactions: { tx1: { id: 'tx1', user_id: 'me', amount: 650, counterparty: 'J Smith', matched_rent_payment_id: null } },
    // Created by a team-mate: the old `.eq('user_id', me)` matched nothing.
    rent_payments: { rp1: { id: 'rp1', user_id: 'teammate', status: 'void', amount: null, notes: null } },
  }
})

describe('planBankMatch / planBankUnmatch', () => {
  it('adds to an amount already recorded instead of replacing it, and keeps notes', () => {
    expect(planBankMatch({ amount: 300, notes: 'cash' }, { amount: 350, counterparty: 'J' }))
      .toEqual({ status: 'paid', amount: 650, notes: 'cash\nMatched from bank · J' })
  })
  it('unmatch takes the bank amount back off and removes only its note', () => {
    expect(planBankUnmatch({ status: 'paid', amount: 650, notes: 'cash\nMatched from bank · J' }, { amount: 350, counterparty: 'J' }))
      .toEqual({ amount: 300, notes: 'cash' })
  })
  it('unmatch returns an empty slot to void with no bank amount or note left on it', () => {
    expect(planBankUnmatch({ status: 'paid', amount: 650, notes: 'Matched from bank · J' }, { amount: 650, counterparty: 'J' }))
      .toEqual({ status: 'void', amount: null, notes: null })
  })
})

describe('matchTransactionToRentPayment', () => {
  it("matches a team-mate's rent row (no creator filter on the rent update)", async () => {
    await matchTransactionToRentPayment('tx1', 'rp1')
    const rentUpdate = db.updates.find(u => u.table === 'rent_payments')
    expect(rentUpdate.filters).toEqual({ id: 'rp1' })
    expect(db.rows.rent_payments.rp1).toMatchObject({ status: 'paid', amount: 650 })
  })

  it('throws (and un-links the transaction) when the rent update hits zero rows', async () => {
    db.hits.rent_payments = 0
    await expect(matchTransactionToRentPayment('tx1', 'rp1')).rejects.toThrow(/not updated/)
    const txUpdates = db.updates.filter(u => u.table === 'bank_transactions')
    expect(txUpdates.at(-1).patch.matched_rent_payment_id).toBeNull()
  })

  it('refuses a transaction that is already matched', async () => {
    db.rows.bank_transactions.tx1.matched_rent_payment_id = 'rp9'
    await expect(matchTransactionToRentPayment('tx1', 'rp1')).rejects.toThrow(/already matched/)
  })
})

describe('unmatchTransaction', () => {
  it('restores the rent row and checks the row count', async () => {
    await matchTransactionToRentPayment('tx1', 'rp1')
    await unmatchTransaction('tx1')
    expect(db.rows.rent_payments.rp1).toMatchObject({ status: 'void', amount: null, notes: null })
    expect(db.rows.bank_transactions.tx1.matched_rent_payment_id).toBeNull()
  })

  it('throws when the rent row cannot be updated', async () => {
    await matchTransactionToRentPayment('tx1', 'rp1')
    db.hits.rent_payments = 0
    await expect(unmatchTransaction('tx1')).rejects.toThrow(/rent record could not be updated/)
  })
})
