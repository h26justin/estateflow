import { describe, it, expect } from 'vitest'
import {
  monthDominantStatus, defaultRentYear, getMonthlyRentStats, legacyCollectionRate,
  stlPaymentIds, periodsIntersect, findOverlappingPaid,
} from '../rentStats'

// These tests PIN the pre-rebuild behaviour of the Rent Tracker arithmetic.
// When a later stage changes the collection rate on purpose, the affected
// expectation should be changed in the same commit, with a note saying why.

const seg = (year, month, status, amount = null, extra = {}) => ({ year, month, status, amount, ...extra })
const NOW = new Date(2026, 5, 15) // 15 June 2026

describe('monthDominantStatus', () => {
  it('surfaces problems before paid', () => {
    expect(monthDominantStatus([seg(2026, 1, 'paid'), seg(2026, 1, 'overdue')])).toBe('overdue')
    expect(monthDominantStatus([seg(2026, 1, 'paid'), seg(2026, 1, 'late')])).toBe('late')
    expect(monthDominantStatus([seg(2026, 1, 'paid'), seg(2026, 1, 'partial')])).toBe('partial')
  })
  it('treats legacy missed like overdue', () => {
    expect(monthDominantStatus([seg(2026, 1, 'missed'), seg(2026, 1, 'paid')])).toBe('missed')
  })
  it('prefers paid over refurb and void', () => {
    expect(monthDominantStatus([seg(2026, 1, 'void'), seg(2026, 1, 'paid'), seg(2026, 1, 'refurb')])).toBe('paid')
  })
  it('falls back to the first segment status, then void', () => {
    expect(monthDominantStatus([seg(2026, 1, 'weird')])).toBe('weird')
    expect(monthDominantStatus([])).toBe('void')
  })
})

describe('defaultRentYear', () => {
  it('returns null with no payments', () => {
    expect(defaultRentYear([], NOW)).toBeNull()
  })
  it('prefers the current year when it has rows', () => {
    expect(defaultRentYear([seg(2025, 1, 'paid'), seg(2026, 1, 'void'), seg(2027, 1, 'void')], NOW)).toBe(2026)
  })
  it('otherwise uses the latest year present', () => {
    expect(defaultRentYear([seg(2024, 1, 'paid'), seg(2025, 1, 'paid')], NOW)).toBe(2025)
  })
})

describe('getMonthlyRentStats (legacy behaviour pinned)', () => {
  it('counts one month once even when split into several segments', () => {
    const payments = [
      seg(2026, 3, 'paid', 300, { period_start: '2026-03-01', period_end: '2026-03-15' }),
      seg(2026, 3, 'paid', 300, { period_start: '2026-03-16', period_end: '2026-03-31' }),
    ]
    const s = getMonthlyRentStats(payments, 2026, 600, NOW)
    expect(s.paid).toBe(1)
    expect(s.paidToDate).toBe(1)
    expect(s.income).toBe(600)
  })

  it('excludes future months from paidToDate and voidM but not from paid', () => {
    const payments = [
      seg(2026, 5, 'paid', 500),
      seg(2026, 9, 'paid', 500),   // STL-style future paid month
      seg(2026, 10, 'void'),       // pre-generated future void
      seg(2026, 4, 'void'),        // genuine past void
    ]
    const s = getMonthlyRentStats(payments, 2026, 500, NOW)
    expect(s.paid).toBe(2)
    expect(s.paidToDate).toBe(1)
    expect(s.voidM).toBe(1)
  })

  it('buckets late and partial together as the attention bucket', () => {
    const payments = [seg(2026, 1, 'late', 500), seg(2026, 2, 'partial', 250)]
    const s = getMonthlyRentStats(payments, 2026, 500, NOW)
    expect(s.late).toBe(2)
    expect(s.missed).toBe(0)
  })

  it('buckets overdue and legacy missed as missed', () => {
    const payments = [seg(2026, 1, 'overdue'), seg(2026, 2, 'missed')]
    expect(getMonthlyRentStats(payments, 2026, 500, NOW).missed).toBe(2)
  })

  it('excludes refurb from every rate bucket but still counts it', () => {
    const s = getMonthlyRentStats([seg(2026, 1, 'refurb')], 2026, 500, NOW)
    expect(s.refurb).toBe(1)
    expect(legacyCollectionRate(s)).toBeNull()
  })

  it('falls back to rent_pcm for a paid month with no amount, once per month', () => {
    const payments = [seg(2026, 1, 'paid', null), seg(2026, 1, 'paid', null)]
    expect(getMonthlyRentStats(payments, 2026, 650, NOW).income).toBe(650)
  })

  it('gives a partial month with no amount zero income (no fallback)', () => {
    expect(getMonthlyRentStats([seg(2026, 1, 'partial', null)], 2026, 650, NOW).income).toBe(0)
  })

  it('gives a lone late month zero income even though it is counted', () => {
    const s = getMonthlyRentStats([seg(2026, 1, 'late', 500)], 2026, 500, NOW)
    expect(s.late).toBe(1)
    expect(s.income).toBe(0)
  })

  it('lets pending fall through every bucket', () => {
    const s = getMonthlyRentStats([seg(2026, 1, 'pending', 120)], 2026, 500, NOW)
    expect(s.paid + s.missed + s.late + s.refurb + s.voidM).toBe(0)
    expect(s.income).toBe(0)
  })

  it('scopes to the requested year and ignores others when year is null', () => {
    const payments = [seg(2025, 12, 'paid', 500), seg(2026, 1, 'paid', 500)]
    expect(getMonthlyRentStats(payments, 2026, 500, NOW).paid).toBe(1)
    expect(getMonthlyRentStats(payments, null, 500, NOW).paid).toBe(2)
  })
})

describe('legacyCollectionRate', () => {
  it('is a month count: void and late months count against you', () => {
    const payments = [
      seg(2026, 1, 'paid', 500), seg(2026, 2, 'paid', 500), seg(2026, 3, 'late', 500), seg(2026, 4, 'void'),
    ]
    const s = getMonthlyRentStats(payments, 2026, 500, NOW)
    expect(legacyCollectionRate(s)).toBe(50)
  })
  it('returns null when nothing is tracked', () => {
    expect(legacyCollectionRate({ paidToDate: 0, missed: 0, late: 0, voidM: 0 })).toBeNull()
  })
})

describe('stlPaymentIds', () => {
  it('collects linked rent payment ids and ignores unlinked bookings', () => {
    const ids = stlPaymentIds({ stl_bookings: [{ rent_payment_id: 'a' }, { rent_payment_id: null }, { rent_payment_id: 'b' }] })
    expect([...ids].sort()).toEqual(['a', 'b'])
    expect(stlPaymentIds(null).size).toBe(0)
  })
})

describe('overlap detection', () => {
  it('detects shared days across a month boundary', () => {
    expect(periodsIntersect('2026-05-07', '2026-06-06', '2026-06-01', '2026-06-30')).toBe(true)
    expect(periodsIntersect('2026-05-07', '2026-06-06', '2026-06-07', '2026-07-06')).toBe(false)
    expect(periodsIntersect(null, '2026-06-06', '2026-06-01', '2026-06-30')).toBe(false)
  })

  it('finds a paid, amounted row on the same days but ignores the row being updated', () => {
    const rows = [
      { id: 'x', status: 'paid', amount: 500, period_start: '2026-05-07', period_end: '2026-06-06' },
      { id: 'y', status: 'void', amount: null, period_start: '2026-06-01', period_end: '2026-06-30' },
    ]
    expect(findOverlappingPaid(rows, '2026-06-01', '2026-06-30')?.id).toBe('x')
    expect(findOverlappingPaid(rows, '2026-06-01', '2026-06-30', 'x')).toBeNull()
  })

  it('ignores paid rows with no amount (they cannot double-count income)', () => {
    const rows = [{ id: 'x', status: 'paid', amount: null, period_start: '2026-06-01', period_end: '2026-06-30' }]
    expect(findOverlappingPaid(rows, '2026-06-01', '2026-06-30')).toBeNull()
  })
})
