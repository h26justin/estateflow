// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { agedArrears, ageBucket, evaluateProperty, missedOwed, arrearsSummary, sumAged, AGE_BUCKETS } from '../rentEngine'
import { buildAgentReport } from '../agentReport'

// Arrears by age (rent brief C7). Age = days from the payment-window end of
// the period (or, for non-monthly rent, of each instalment) to asOf.

const round2 = n => Math.round(n * 100) / 100
const row = (id, start, end, status = 'void', amount = null) => {
  const [y, m] = start.split('-').map(Number)
  return { id, year: y, month: m, month_label: `${m}/${y}`, period_start: start, period_end: end, status, amount }
}
const month = (id, y, m, status = 'void', amount = null) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return row(id, `${y}-${mm}-01`, `${y}-${mm}-${last}`, status, amount)
}
const T = (over = {}) => ({ id: 't1', tenancy_start: '2026-01-01', tenancy_end: null, rent_amount: 500, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant', opening_arrears: 0, ...over })
const prop = (over = {}) => ({ id: 'p1', name: 'Flat p1', status: 'rented', rent_pcm: 500, rent_due_day: '1st', company_id: 'c1', company: { name: 'ExH Property Group' }, managed_by_agent_id: 'ag1', tenancies: [T()], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [], rent_payments: [], ...over })
const owedOf = (p, asOf) => round2(evaluateProperty(p, { today: asOf }).reduce((s, e) => s + missedOwed(e, asOf), 0))
const bucketsSum = a => round2(AGE_BUCKETS.reduce((s, k) => s + a[k], 0) + a.historic)

describe('ageBucket', () => {
  it('puts 1-30 days in 0-30, 31-60, 61-90, and more than 90 in 90+', () => {
    expect([1, 30, 31, 60, 61, 90, 91, 400].map(ageBucket)).toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+', '90+'])
  })
})

describe('agedArrears: monthly rent', () => {
  // GBP 500 due on the 1st, 5-day window: each window closes on the 6th.
  const p = prop({
    rent_payments: [
      month('jan', 2026, 1, 'paid', 500),
      month('feb', 2026, 2), month('mar', 2026, 3), month('apr', 2026, 4), month('may', 2026, 5), month('jun', 2026, 6),
    ],
  })

  it('ages each overdue month from its own window end', () => {
    // 15 Jun: Jun 9 days, May 40, Apr 70, Mar 101, Feb 129.
    const a = agedArrears(p, '2026-06-15')
    expect(a).toEqual({ '0-30': 500, '31-60': 500, '61-90': 500, '90+': 1000, historic: 0, total: 2500 })
    expect(a.total).toBe(owedOf(p, '2026-06-15'))
  })

  it('moves a month across the 30-day boundary on day 31', () => {
    // June's window closed 6 Jun: 30 days on 6 Jul, 31 on 7 Jul.
    const only = prop({ rent_payments: [month('jun', 2026, 6)] })
    expect(agedArrears(only, '2026-07-06')['0-30']).toBe(500)
    expect(agedArrears(only, '2026-07-07')).toMatchObject({ '0-30': 0, '31-60': 500 })
  })

  it('leaves rent still inside its window out', () => {
    const only = prop({ rent_payments: [month('jun', 2026, 6)] })
    expect(agedArrears(only, '2026-06-04')).toEqual({ '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, historic: 0, total: 0 })
  })

  it('ages only the unpaid part of a part-paid month', () => {
    const pp = prop({ rent_payments: [month('mar', 2026, 3, 'partial', 180)] })
    expect(agedArrears(pp, '2026-06-15')).toMatchObject({ '90+': 320, total: 320 })
  })
})

describe('agedArrears: weekly rent, each instalment aged on its own', () => {
  // GBP 120 every Thursday from Thu 1 Jan 2026, 5-day window.
  const weekly = T({ rent_amount: 120, rent_frequency: 'weekly' })
  const asOf = '2026-06-15'

  it('splits a month of instalments across buckets and adds up to missedOwed', () => {
    // March: 5, 12, 19, 26 Mar, windows close 10, 17, 24, 31 Mar = 97, 90,
    // 83 and 76 days. June: 4 Jun (window 9 Jun, 6 days) overdue; 11 Jun
    // still in its window; 18 and 25 Jun not yet due.
    const p = prop({ tenancies: [weekly], rent_payments: [month('mar', 2026, 3), month('jun', 2026, 6)] })
    const a = agedArrears(p, asOf)
    expect(a).toEqual({ '0-30': 120, '31-60': 0, '61-90': 360, '90+': 120, historic: 0, total: 600 })
    expect(a.total).toBe(owedOf(p, asOf))
  })

  it('applies money to the earliest instalments first', () => {
    // GBP 200 against March clears 5 Mar and 80 of 12 Mar: 40 + 120 + 120
    // left, all 61-90 days old.
    const p = prop({ tenancies: [weekly], rent_payments: [month('mar', 2026, 3, 'partial', 200)] })
    const a = agedArrears(p, asOf)
    expect(a).toMatchObject({ '61-90': 280, '90+': 0, total: 280 })
    expect(a.total).toBe(owedOf(p, asOf))
  })
})

describe('agedArrears: historic arrears', () => {
  it('puts the unpaid historic opening balance in its own bucket', () => {
    const t = T({ opening_arrears: 750, opening_arrears_date: '2025-12-01' })
    const p = prop({
      tenancies: [t],
      rent_payments: [month('may', 2026, 5)],
      rent_receipts: [{ id: 'r1', received_date: '2026-03-01', amount: 150, payer: 'tenant', kind: 'receipt', tenancy_id: 't1',
        rent_allocations: [{ id: 'a1', target: 'historic_arrears', amount: 150, tenancy_id: 't1' }] }],
    })
    const a = agedArrears(p, '2026-06-15')
    expect(a).toEqual({ '0-30': 0, '31-60': 500, '61-90': 0, '90+': 0, historic: 600, total: 1100 })
    expect(a.historic).toBe(arrearsSummary(p).balance)
  })
})

describe('agent report: aged arrears', () => {
  const asOf = '2026-06-15'
  const props = [
    prop({ id: 'm', name: 'Flat M', rent_payments: [month('m1', 2026, 1, 'paid', 500), month('m2', 2026, 2), month('m4', 2026, 4), month('m6', 2026, 6)] }),
    prop({ id: 'w', name: 'Flat W', tenancies: [T({ rent_amount: 120, rent_frequency: 'weekly' })], rent_payments: [month('w3', 2026, 3, 'partial', 200), month('w6', 2026, 6)] }),
    prop({ id: 'h', name: 'Flat H', company_id: 'c2', company: { name: 'Vale Property' }, tenancies: [T({ opening_arrears: 333.33, opening_arrears_date: '2025-11-30' })], rent_payments: [month('h5', 2026, 5, 'partial', 166.67)] }),
    prop({ id: 'ok', name: 'Flat OK', company_id: 'c2', company: { name: 'Vale Property' }, rent_payments: [month('ok5', 2026, 5, 'paid', 500), month('ok6', 2026, 6, 'paid', 500)] }),
  ]
  const r = buildAgentReport(props, { agent: { id: 'ag1', name: 'Propertunity' }, asOf })

  it('gives every card buckets that add up to its owed + arrears to the penny', () => {
    expect(r.lines).toHaveLength(4)
    for (const c of r.lines) {
      expect(c.aged.total).toBe(round2(c.owed + c.arrears))
      expect(bucketsSum(c.aged)).toBe(c.aged.total)
    }
    const byName = Object.fromEntries(r.lines.map(c => [c.name, c.aged]))
    expect(byName['Flat M']).toEqual({ '0-30': 500, '31-60': 0, '61-90': 500, '90+': 500, historic: 0, total: 1500 })
    expect(byName['Flat H']).toEqual({ '0-30': 0, '31-60': 333.33, '61-90': 0, '90+': 0, historic: 333.33, total: 666.66 })
    expect(byName['Flat OK'].total).toBe(0)
  })

  it('totals the buckets per company and in the summary', () => {
    for (const g of r.byCompany) {
      expect(g.aged).toEqual(sumAged(g.cards.map(c => c.aged)))
      expect(g.aged.total).toBe(g.owed)
    }
    expect(r.summary.aged).toEqual(sumAged(r.lines.map(c => c.aged)))
    expect(r.summary.aged.total).toBe(round2(r.summary.owed + r.summary.arrears))
  })
})
