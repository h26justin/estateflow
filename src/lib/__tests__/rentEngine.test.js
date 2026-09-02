import { describe, it, expect } from 'vitest'
import {
  evaluatePeriod, evaluateProperty, collapseMonth, groupByMonth, collectionStats, arrearsSummary,
  dueDateFor, benefitDueOnOrAfter, collectibleDays, monthlyRent, fallbackTenancyFromProperty, STATE,
} from '../rentEngine'

// Scenario tests from the client pack (Prompt 5), plus the decisions ruled on
// 2 Sep 2026: go-live 1 Jan 2026, needs-backfill exclusion, 5-day window,
// benefit schedule, STL exclusion.

const row = (id, start, end, status = 'void', amount = null, extra = {}) => {
  const [y, m] = start.split('-').map(Number)
  return { id, year: y, month: m, month_label: `${m}/${y}`, period_start: start, period_end: end, status, amount, ...extra }
}
const month = (id, y, m, status, amount) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return row(id, `${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${last}`, status, amount)
}
const T = (over = {}) => ({ id: 't1', tenancy_start: '2026-01-01', tenancy_end: null, rent_amount: 500, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant', opening_arrears: 0, ...over })
const receipt = (id, date, amount, allocations, payer = 'tenant', kind = 'receipt') => ({ id, received_date: date, amount, payer, kind, rent_allocations: allocations.map((a, i) => ({ id: `${id}-${i}`, rent_payment_id: a.period, target: a.target || 'current_rent', amount: a.amount })) })
const prop = (over = {}) => ({ id: 'p1', status: 'rented', rent_pcm: 500, rent_due_day: '1st', tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [], rent_payments: [], ...over })
const ctx = (over = {}) => ({ property: prop(), tenancies: [T()], receipts: [], nonChargeable: [], overrides: [], today: '2026-06-15', ...over })

describe('helpers', () => {
  it('monthly-equivalent rent', () => {
    expect(monthlyRent({ rent_amount: 120, rent_frequency: 'weekly' })).toBe(520)
    expect(monthlyRent({ rent_amount: 480, rent_frequency: 'four_weekly' })).toBe(520)
    expect(monthlyRent({ rent_amount: 500, rent_frequency: 'monthly' })).toBe(500)
  })
  it('due date is the due day inside the month, never before the tenancy starts', () => {
    expect(dueDateFor(T({ rent_due_day: 28 }), '2026-02-01')).toBe('2026-02-28')
    expect(dueDateFor(T({ rent_due_day: 31 }), '2026-02-01')).toBe('2026-02-28')
    expect(dueDateFor(T({ rent_due_day: 1, tenancy_start: '2026-03-18' }), '2026-03-01')).toBe('2026-03-18')
  })
  it('benefit schedule steps to the first date on or after the due date', () => {
    const t = T({ payment_source: 'universal_credit', benefit_frequency: 'four_weekly', benefit_next_payment_date: '2026-06-24' })
    expect(benefitDueOnOrAfter(t, '2026-06-01')).toBe('2026-06-24')
    expect(benefitDueOnOrAfter(t, '2026-07-01')).toBe('2026-07-22')
    expect(benefitDueOnOrAfter(t, '2026-04-01')).toBe('2026-04-01')
    const m = T({ payment_source: 'housing_benefit', benefit_frequency: 'monthly', benefit_next_payment_date: '2026-06-10' })
    expect(benefitDueOnOrAfter(m, '2026-08-01')).toBe('2026-08-10')
  })
  it('collectible days exclude non-chargeable periods and days outside the tenancy', () => {
    expect(collectibleDays('2026-03-01', '2026-03-31', T({ tenancy_start: '2026-03-18' }), [])).toBe(14)
    expect(collectibleDays('2026-03-01', '2026-03-31', T(), [{ start_date: '2026-03-01', end_date: '2026-03-10' }])).toBe(21)
  })
  it('fallback tenancy only for earning properties with a rent', () => {
    expect(fallbackTenancyFromProperty(prop()).rent_amount).toBe(500)
    expect(fallbackTenancyFromProperty(prop({ status: 'vacant' }))).toBeNull()
    expect(fallbackTenancyFromProperty(prop({ rent_pcm: 0 }))).toBeNull()
  })
})

describe('period states', () => {
  it('monthly tenant payer: paid in full is Green', () => {
    const r = month('m5', 2026, 5, 'void')
    const e = evaluatePeriod(r, ctx({ receipts: [receipt('r1', '2026-05-01', 500, [{ period: 'm5', amount: 500 }])] }))
    expect(e.state).toBe(STATE.PAID); expect(e.expected).toBe(500); expect(e.received).toBe(500); expect(e.outstanding).toBe(0)
  })
  it('nothing received inside the window is Due, not Missed (no red on the 1st)', () => {
    const e = evaluatePeriod(month('m6', 2026, 6, 'void'), ctx({ today: '2026-06-03' }))
    expect(e.state).toBe(STATE.DUE); expect(e.windowEnd).toBe('2026-06-06')
  })
  it('nothing received after the window is Missed', () => {
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ today: '2026-05-07' }))
    expect(e.state).toBe(STATE.MISSED); expect(e.outstanding).toBe(500)
  })
  it('partial payment: Amber inside the window, Missed with balance after it', () => {
    const rec = [receipt('r1', '2026-05-01', 200, [{ period: 'm5', amount: 200 }])]
    expect(evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ receipts: rec, today: '2026-05-04' })).state).toBe(STATE.PART_PAID)
    const late = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ receipts: rec, today: '2026-05-20' }))
    expect(late.state).toBe(STATE.MISSED); expect(late.outstanding).toBe(300); expect(late.reasons.join()).toMatch(/Part paid/)
  })
  it('overpayment is Paid with the excess reported, never over 100%', () => {
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ receipts: [receipt('r1', '2026-05-01', 650, [{ period: 'm5', amount: 650 }])] }))
    expect(e.state).toBe(STATE.PAID); expect(e.excess).toBe(150)
    const s = collectionStats([e], { asOf: '2026-06-15' })
    expect(s.rate).toBe(100); expect(s.excess).toBe(150); expect(s.received).toBe(500)
  })
  it('bounced payment reverses the allocation', () => {
    const rec = [
      receipt('r1', '2026-05-01', 500, [{ period: 'm5', amount: 500 }]),
      receipt('r2', '2026-05-03', -500, [{ period: 'm5', amount: -500 }], 'tenant', 'bounce'),
    ]
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ receipts: rec, today: '2026-05-20' }))
    expect(e.received).toBe(0); expect(e.state).toBe(STATE.MISSED)
  })
  it('mid-month move-in prorates the expectation to the covered days', () => {
    const e = evaluatePeriod(month('m3', 2026, 3, 'void'), ctx({ tenancies: [T({ tenancy_start: '2026-03-18' })], today: '2026-03-20' }))
    expect(e.collectibleDays).toBe(14)
    expect(e.expected).toBe(225.81)   // 500 × 14/31
    expect(e.dueDate).toBe('2026-03-18'); expect(e.state).toBe(STATE.DUE)
  })
  it('notice given keeps rent due until the confirmed end, then stops', () => {
    const t = T({ status: 'notice_given', tenancy_end: '2026-05-31' })
    expect(evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], today: '2026-06-15' })).state).toBe(STATE.MISSED)
    const after = evaluatePeriod(month('m6', 2026, 6, 'void'), ctx({ tenancies: [t], today: '2026-06-15' }))
    expect(after.state).toBe(STATE.NOT_COLLECTIBLE); expect(after.reasons[0]).toMatch(/After tenancy end/)
  })
  it('move-out mid-month prorates and the remainder of the month is not collectible', () => {
    const t = T({ tenancy_end: '2026-05-15' })
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], today: '2026-06-15' }))
    expect(e.collectibleDays).toBe(15); expect(e.expected).toBe(241.94)
  })
  it('vacant unit with no tenancy is Not collectible and does not count', () => {
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ property: prop({ status: 'vacant' }), tenancies: [] }))
    expect(e.state).toBe(STATE.NOT_COLLECTIBLE)
    expect(collectionStats([e]).due).toBe(0)
  })
  it('refurbishment period on a tenanted unit is Not collectible', () => {
    const e = evaluatePeriod(month('m4', 2026, 4, 'void'), ctx({ nonChargeable: [{ start_date: '2026-03-20', end_date: '2026-04-30', reason: 'refurbishment' }] }))
    expect(e.state).toBe(STATE.NOT_COLLECTIBLE); expect(e.reasons[0]).toMatch(/non-chargeable/)
  })
  it('Housing Benefit paid in arrears is judged against the schedule, not the 5-day window', () => {
    const t = T({ payment_source: 'housing_benefit', benefit_contribution: 500, benefit_frequency: 'four_weekly', benefit_next_payment_date: '2026-05-27' })
    const due = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], today: '2026-05-20' }))
    expect(due.state).toBe(STATE.DUE); expect(due.benefitDue).toBe('2026-05-27')
    const missed = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], today: '2026-05-28' }))
    expect(missed.state).toBe(STATE.MISSED)
    const paid = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], today: '2026-05-28', receipts: [receipt('r1', '2026-05-27', 500, [{ period: 'm5', amount: 500 }], 'housing_benefit')] }))
    expect(paid.state).toBe(STATE.PAID)
  })
  it('mixed funding tracks tenant and benefit shares separately but combines for the month', () => {
    const t = T({ payment_source: 'mixed', tenant_contribution: 120, benefit_contribution: 380, benefit_frequency: 'four_weekly', benefit_next_payment_date: '2026-05-27' })
    const rec = [receipt('r1', '2026-05-02', 120, [{ period: 'm5', amount: 120 }], 'tenant')]
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], receipts: rec, today: '2026-05-20' }))
    expect(e.tenantShare).toBe(120); expect(e.benefitShare).toBe(380)
    expect(e.receivedTenant).toBe(120); expect(e.state).toBe(STATE.PART_PAID)
    const later = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], receipts: rec, today: '2026-05-28' }))
    expect(later.state).toBe(STATE.MISSED)  // benefit share overdue
    const full = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ tenancies: [t], today: '2026-05-28', receipts: [...rec, receipt('r2', '2026-05-27', 380, [{ period: 'm5', amount: 380 }], 'universal_credit')] }))
    expect(full.state).toBe(STATE.PAID); expect(full.received).toBe(500)
  })
  it('tenancy change in the same flat: each segment follows its own tenancy', () => {
    const a = T({ id: 'a', tenancy_start: '2026-01-01', tenancy_end: '2026-05-14', rent_amount: 500, status: 'ended' })
    const b = T({ id: 'b', tenancy_start: '2026-05-20', rent_amount: 600, rent_due_day: 20 })
    const s1 = row('s1', '2026-05-01', '2026-05-14', 'paid', 225.81)
    const gap = row('s2', '2026-05-15', '2026-05-19', 'void')
    const s3 = row('s3', '2026-05-20', '2026-05-31', 'void')
    const c = ctx({ tenancies: [a, b], today: '2026-06-15' })
    expect(evaluatePeriod(s1, c).tenancy.id).toBe('a'); expect(evaluatePeriod(s1, c).state).toBe(STATE.PAID)
    expect(evaluatePeriod(gap, c).state).toBe(STATE.NOT_COLLECTIBLE)
    const e3 = evaluatePeriod(s3, c)
    expect(e3.tenancy.id).toBe('b'); expect(e3.expected).toBe(232.26); expect(e3.dueDate).toBe('2026-05-20'); expect(e3.state).toBe(STATE.MISSED)
    const m = collapseMonth([evaluatePeriod(s1, c), evaluatePeriod(gap, c), e3])
    expect(m.state).toBe(STATE.MISSED); expect(m.expected).toBe(458.07)
  })
})

describe('decisions from 2 Sep 2026', () => {
  it('pre-2026 periods are Legacy and never enter the value rate', () => {
    const e = evaluatePeriod(month('old', 2025, 11, 'paid', 500), ctx())
    expect(e.state).toBe(STATE.LEGACY); expect(e.legacy).toBe(true)
    expect(collectionStats([e]).due).toBe(0)
  })
  it('a pre-2026 paid month with no amount is Legacy, not Needs Backfill', () => {
    const e = evaluatePeriod(month('old2', 2025, 5, 'paid', null), ctx())
    expect(e.state).toBe(STATE.LEGACY); expect(e.needsBackfill).toBe(false)
    expect(collectionStats([e]).counts.needsBackfill).toBe(0)
  })
  it('paid with no amount stays Paid, flagged Needs Backfill, excluded from the rate', () => {
    const e = evaluatePeriod(month('m2', 2026, 2, 'paid', null), ctx())
    expect(e.state).toBe(STATE.PAID); expect(e.needsBackfill).toBe(true)
    const s = collectionStats([e, evaluatePeriod(month('m3', 2026, 3, 'paid', 500), ctx())])
    expect(s.due).toBe(500); expect(s.counts.needsBackfill).toBe(1)
  })
  it('legacy paid amounts on the month row still count as received (bridge)', () => {
    const e = evaluatePeriod(month('m4', 2026, 4, 'paid', 500), ctx())
    expect(e.state).toBe(STATE.PAID); expect(e.received).toBe(500)
  })
  it('a short-term-let property is reported separately, never in the rate', () => {
    const e = evaluatePeriod(row('b1', '2026-06-02', '2026-06-04', 'paid', 210), ctx({ property: prop({ status: 'short_term_let' }) }))
    expect(e.state).toBe(STATE.STL); expect(collectionStats([e]).due).toBe(0)
  })
  it('future periods are ignored on both sides', () => {
    const e = evaluatePeriod(month('m9', 2026, 9, 'void'), ctx())
    expect(e.state).toBe(STATE.FUTURE); expect(collectionStats([e]).periods).toBe(0)
  })
  it('a period whose due date has not been reached is not yet in the denominator', () => {
    const e = evaluatePeriod(month('m6', 2026, 6, 'void'), ctx({ tenancies: [T({ rent_due_day: 28 })], today: '2026-06-15' }))
    expect(e.state).toBe(STATE.DUE)
    expect(collectionStats([e], { asOf: '2026-06-15' }).due).toBe(0)
  })
  it('an override with a reason replaces the computed state', () => {
    const ov = [{ rent_payment_id: 'm5', state: 'not_collectible', reason: 'Agreed rent-free week', created_at: '2026-06-01T00:00:00Z' }]
    const e = evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ overrides: ov }))
    expect(e.state).toBe(STATE.NOT_COLLECTIBLE); expect(e.reasons.at(-1)).toMatch(/Override: Agreed/)
    const cleared = [...ov, { rent_payment_id: 'm5', state: 'clear', reason: 'Reverted', created_at: '2026-06-02T00:00:00Z' }]
    expect(evaluatePeriod(month('m5', 2026, 5, 'void'), ctx({ overrides: cleared })).state).toBe(STATE.MISSED)
  })
})

describe('rate and arrears', () => {
  it('collection rate is value based and historic arrears stay separate', () => {
    const p = prop({
      tenancies: [T({ opening_arrears: 208 })],
      rent_payments: [month('m3', 2026, 3, 'void'), month('m4', 2026, 4, 'void'), month('m5', 2026, 5, 'void')],
      rent_receipts: [
        receipt('r1', '2026-03-02', 500, [{ period: 'm3', amount: 500 }]),
        receipt('r2', '2026-04-02', 550, [{ period: 'm4', amount: 500 }, { period: null, target: 'historic_arrears', amount: 50 }]),
      ],
    })
    const evals = evaluateProperty(p, { today: '2026-06-15' })
    const s = collectionStats(evals, { asOf: '2026-06-15' })
    expect(s.due).toBe(1500); expect(s.received).toBe(1000); expect(s.outstanding).toBe(500); expect(s.rate).toBe(66.7)
    expect(arrearsSummary(p)).toEqual({ opening: 208, paid: 50, balance: 158 })
  })
  it('groupByMonth surfaces problems first', () => {
    const p = prop({ rent_payments: [row('a', '2026-05-01', '2026-05-15', 'paid', 250), row('b', '2026-05-16', '2026-05-31', 'void')] })
    const months = groupByMonth(evaluateProperty(p, { today: '2026-06-15' }))
    expect(months).toHaveLength(1); expect(months[0].state).toBe(STATE.MISSED)
  })
})
