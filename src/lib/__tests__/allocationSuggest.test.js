import { describe, it, expect } from 'vitest'
import { suggestAllocation } from '../allocationSuggest'

const month = (id, m, status = 'void', amount = null) => {
  const mm = String(m).padStart(2, '0'); const last = new Date(Date.UTC(2026, m, 0)).getUTCDate()
  return { id, year: 2026, month: m, period_start: `2026-${mm}-01`, period_end: `2026-${mm}-${last}`, status, amount }
}
const T = { id: 't1', tenancy_start: '2026-01-01', rent_amount: 850, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant', opening_arrears: 0 }
const prop = (over = {}) => ({ id: 'p', status: 'rented', rent_pcm: 850, tenancies: [T], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [], rent_payments: [], ...over })

describe('suggestAllocation (decision 3: current rent first, then oldest arrears)', () => {
  it('brief C4 example: £850 current + £950 historic, £900 received', () => {
    const p = prop({ tenancies: [{ ...T, opening_arrears: 950, opening_arrears_date: '2025-12-31' }], rent_payments: [month('nov', 11)] })
    const s = suggestAllocation(p, 900, '2026-11-03')
    expect(s.allocations.map(a => [a.target, a.rent_payment_id, a.amount])).toEqual([['current_rent', 'nov', 850], ['historic_arrears', '', 50]])
    expect(s.remainder).toBe(0)
  })
  it('older overdue months are paid oldest first after the current month', () => {
    const p = prop({ rent_payments: [month('sep', 9), month('oct', 10), month('nov', 11)] })
    const s = suggestAllocation(p, 2000, '2026-11-03')
    expect(s.allocations.map(a => [a.rent_payment_id, a.amount])).toEqual([['nov', 850], ['sep', 850], ['oct', 300]])
  })
  it('a surplus is held for review, never put on a future month', () => {
    const p = prop({ rent_payments: [month('nov', 11), month('dec', 12)] })
    const s = suggestAllocation(p, 1000, '2026-11-03')
    expect(s.allocations).toHaveLength(1)
    expect(s.remainder).toBe(150)
  })
  it('skips months paid with no amount (what they owe is not established)', () => {
    const p = prop({ rent_payments: [month('oct', 10, 'paid', null), month('nov', 11)] })
    const s = suggestAllocation(p, 1700, '2026-11-03')
    expect(s.allocations.map(a => a.rent_payment_id)).toEqual(['nov'])
    expect(s.remainder).toBe(850)
  })
})
