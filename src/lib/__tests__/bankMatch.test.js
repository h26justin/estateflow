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
  const tx = (amount, id = 't1') => ({ id, amount, counterparty: 'J' })
  // Apply a plan to a row the way the database update does.
  const apply = (row, patch) => ({ ...row, ...patch })
  const roundTrip = (row, t) => {
    const matched = apply(row, planBankMatch(row, t))
    const unmatched = apply(matched, planBankUnmatch(matched, t))
    return { matched, unmatched }
  }

  it('adds to money already received (partial) and keeps notes', () => {
    const p = planBankMatch({ status: 'partial', amount: 300, notes: 'cash' }, tx(350))
    expect(p).toMatchObject({ status: 'paid', amount: 650 })
    expect(p.notes.split('\n')[0]).toBe('cash')
    expect(p.notes.split('\n')[1]).toMatch(/^Matched from bank · J \[bm .*mode=add/)
  })

  it('a void row carrying a stale amount is SET to the bank amount, not added to (reported repro)', () => {
    const p = planBankMatch({ status: 'void', amount: 1000, notes: null }, tx(1000))
    expect(p).toMatchObject({ status: 'paid', amount: 1000 })
  })

  it.each(['void', 'overdue', 'pending', null])('status %s: the match sets the amount', (status) => {
    expect(planBankMatch({ status, amount: 800 }, tx(650))).toMatchObject({ status: 'paid', amount: 650 })
  })

  it.each(['paid', 'late'])('%s row already recording the full amount: link only, nothing doubled', (status) => {
    const p = planBankMatch({ status, amount: 1000, notes: null }, tx(1000.4))
    expect(p.amount).toBeUndefined()
    expect(p.status).toBeUndefined()
    expect(p.notes).toMatch(/mode=link/)
    const over = planBankMatch({ status, amount: 1200 }, tx(1000))
    expect(over.amount).toBeUndefined()
  })

  it('a paid row recording less than the bank amount (by more than 50p) has the bank amount added', () => {
    expect(planBankMatch({ status: 'paid', amount: 400 }, tx(600))).toMatchObject({ status: 'paid', amount: 1000 })
  })

  it('unmatch is the exact inverse in all three cases, and re-match returns to the same numbers', () => {
    const cases = [
      { row: { status: 'void', amount: 1000, notes: null }, t: tx(1000) },           // set
      { row: { status: 'overdue', amount: null, notes: 'chased' }, t: tx(650) },     // set
      { row: { status: 'partial', amount: 300, notes: 'cash' }, t: tx(350) },        // add
      { row: { status: 'late', amount: 650, notes: null }, t: tx(650) },             // link
      { row: { status: 'paid', amount: 650, notes: 'x' }, t: tx(649.6) },            // link
    ]
    for (const { row, t } of cases) {
      const first = roundTrip(row, t)
      expect(first.unmatched).toEqual(row)
      const second = roundTrip(first.unmatched, t)
      expect(second.matched).toEqual(first.matched)
      expect(second.unmatched).toEqual(row)
    }
  })

  it('unmatch of a set-mode match restores the prior status and amount', () => {
    const matched = apply({ status: 'void', amount: 1000 }, planBankMatch({ status: 'void', amount: 1000 }, tx(900)))
    expect(matched).toMatchObject({ status: 'paid', amount: 900 })
    expect(planBankUnmatch(matched, tx(900))).toEqual({ status: 'void', amount: 1000, notes: null })
  })

  it('with two matches on one row, unmatching finds each by transaction id', () => {
    let row = { status: 'partial', amount: 100, notes: null }
    row = apply(row, planBankMatch(row, tx(200, 'a')))
    row = apply(row, planBankMatch(row, tx(500, 'b')))
    expect(row.amount).toBe(800)
    row = apply(row, planBankUnmatch(row, tx(500, 'b')))
    expect(row).toMatchObject({ status: 'paid', amount: 300 })
    row = apply(row, planBankUnmatch(row, tx(200, 'a')))
    expect(row).toEqual({ status: 'partial', amount: 100, notes: null })
  })

  it('a note written before markers existed: the bank amount comes off and its line is removed', () => {
    expect(planBankUnmatch({ status: 'paid', amount: 650, notes: 'cash\nMatched from bank · J' }, { amount: 350, counterparty: 'J' }))
      .toEqual({ amount: 300, notes: 'cash' })
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
    expect(db.rows.rent_payments.rp1.notes).toMatch(/tx=tx1/)
  })

  it('a void row with a leftover amount becomes paid at the bank amount, not double', async () => {
    db.rows.rent_payments.rp1.amount = 650
    await matchTransactionToRentPayment('tx1', 'rp1')
    expect(db.rows.rent_payments.rp1).toMatchObject({ status: 'paid', amount: 650 })
    await unmatchTransaction('tx1')
    expect(db.rows.rent_payments.rp1).toMatchObject({ status: 'void', amount: 650, notes: null })
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
