import { describe, it, expect } from 'vitest'
import { complianceAttentionRows } from '../DashboardComponents'
import { isPropertyOverdue } from '../DayTrackerPage'
import { splitTotal } from '../BulkAddPropertyModal'
import { rateToPercent, percentToRate, suggestedDeposit } from '../modals/PropertyModal'
import { isMatchableRentRow } from '../BankInboxModal'

const isoIn = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('complianceAttentionRows (dashboard "Needs attention")', () => {
  const prop = { id: 'p1', name: 'Flat 1' }

  it('does not flag a certificate that was renewed (old row kept as history)', () => {
    const rows = [
      { id: 'old', cert_type: 'gas_safety', cert_name: 'Gas Safety', expiry_date: isoIn(-20), property: prop },
      { id: 'new', cert_type: 'gas_safety', cert_name: 'Gas Safety', expiry_date: isoIn(345), property: prop },
    ]
    expect(complianceAttentionRows(rows)).toEqual([])
  })

  it('treats legacy alias rows as the same cert type', () => {
    const rows = [
      { id: 'old', cert_type: 'gas', cert_name: 'Gas', expiry_date: isoIn(-20), property: prop },
      { id: 'new', cert_type: 'gas_safety', cert_name: 'Gas Safety', expiry_date: isoIn(300), property: prop },
    ]
    expect(complianceAttentionRows(rows)).toEqual([])
  })

  it('ignores deleted rows', () => {
    const rows = [{ id: 'x', cert_type: 'eicr', cert_name: 'EICR', expiry_date: isoIn(-5), deleted_at: '2026-01-01T00:00:00Z', property: prop }]
    expect(complianceAttentionRows(rows)).toEqual([])
  })

  it('flags an expired certificate once, judged on the latest row', () => {
    const rows = [
      { id: 'a', cert_type: 'eicr', cert_name: 'EICR 2019', expiry_date: isoIn(-400), property: prop },
      { id: 'b', cert_type: 'eicr', cert_name: 'EICR 2021', expiry_date: isoIn(-10), property: prop },
    ]
    const out = complianceAttentionRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].state).toBe('expired')
    expect(out[0].item.id).toBe('b')
  })

  it('keeps separate properties and separate "other" certificates apart', () => {
    const rows = [
      { id: 'a', cert_type: 'other', cert_name: 'Lift service', expiry_date: isoIn(10), property: prop },
      { id: 'b', cert_type: 'other', cert_name: 'Fire door survey', expiry_date: isoIn(20), property: prop },
      { id: 'c', cert_type: 'eicr', cert_name: 'EICR', expiry_date: isoIn(5), property: { id: 'p2' } },
    ]
    expect(complianceAttentionRows(rows).map(r => r.item.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('isPropertyOverdue (Day Tracker)', () => {
  const today = '2026-11-15'
  const base = { status: 'vacant' }

  it('does not flag a month paid late', () => {
    expect(isPropertyOverdue({ ...base, rent_payments: [{ year: 2026, month: 10, status: 'late', amount: 900 }] }, today)).toBe(false)
  })

  it('flags overdue and legacy missed rows', () => {
    expect(isPropertyOverdue({ ...base, rent_payments: [{ year: 2026, month: 10, status: 'overdue' }] }, today)).toBe(true)
    expect(isPropertyOverdue({ ...base, rent_payments: [{ year: 2026, month: 10, status: 'missed' }] }, today)).toBe(true)
  })

  it('flags a part-paid period only once it has ended', () => {
    const past = { period_start: '2026-10-01', period_end: '2026-10-31', status: 'partial', amount: 300 }
    const current = { period_start: '2026-11-01', period_end: '2026-11-30', status: 'partial', amount: 300 }
    expect(isPropertyOverdue({ ...base, rent_payments: [past] }, today)).toBe(true)
    expect(isPropertyOverdue({ ...base, rent_payments: [current] }, today)).toBe(false)
  })
})

describe('splitTotal (bulk add)', () => {
  it('puts the rounding remainder on the last unit so units sum to the total', () => {
    const parts = splitTotal(100000, 3)
    expect(parts).toEqual([33333, 33333, 33334])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100000)
  })
  it('handles pence and a single unit', () => {
    expect(splitTotal(1234.56, 1)).toEqual([1234.56])
    const parts = splitTotal(1000.5, 4)
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1000.5)
  })
  it('returns zeros for an empty total', () => {
    expect(splitTotal(0, 3)).toEqual([0, 0, 0])
  })
})

describe('PropertyModal helpers', () => {
  it('round-trips a three-decimal mortgage rate without rounding to 2dp', () => {
    expect(rateToPercent(0.05125)).toBe('5.125')
    expect(percentToRate(rateToPercent(0.05125))).toBe(0.05125)
    expect(rateToPercent(0.0499)).toBe('4.99')
    expect(rateToPercent(0)).toBe('')
    expect(percentToRate('')).toBe(0)
  })
  it('suggests price less mortgage as the deposit', () => {
    expect(suggestedDeposit(200000, 150000)).toBe(50000)
    expect(suggestedDeposit(200000, null)).toBe(200000)
    expect(suggestedDeposit('', 1000)).toBeNull()
    expect(suggestedDeposit(100000, 120000)).toBe(0)
  })
})

describe('isMatchableRentRow (bank inbox picker)', () => {
  it('offers every unpaid status and not settled ones', () => {
    for (const status of ['overdue', 'missed', 'pending', 'partial', 'late', 'void', null, undefined]) {
      expect(isMatchableRentRow({ status })).toBe(true)
    }
    expect(isMatchableRentRow({ status: 'paid' })).toBe(false)
    expect(isMatchableRentRow({ status: 'refurb' })).toBe(false)
  })
})
