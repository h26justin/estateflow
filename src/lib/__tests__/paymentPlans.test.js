import { describe, it, expect } from 'vitest'
import { planDueDates, planPaid, planProgress, activePlan, possibleDuplicate } from '../paymentPlans'

const plan = (over = {}) => ({ id: 'pl1', opening_balance: 208, start_date: '2026-03-01', instalment_amount: 52, frequency: 'monthly', due_day: 1, status_override: null, ...over })
const rcpt = (id, date, amount, planId = 'pl1', target = 'historic_arrears') => ({ id, received_date: date, amount, kind: 'receipt', rent_allocations: [{ id: id + 'a', target, amount, payment_plan_id: planId }] })

describe('planDueDates', () => {
  it('monthly on a due day, clamped to short months', () => {
    expect(planDueDates(plan({ start_date: '2026-01-31', due_day: 31 }), '2026-04-15')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('four-weekly from the start date', () => {
    expect(planDueDates(plan({ frequency: 'four_weekly', due_day: null }), '2026-04-01')).toEqual(['2026-03-01', '2026-03-29', '2026-04-26'])
  })
})

describe('planProgress (Park Place West example: £208 arrears, £52 a month)', () => {
  it('is on track when every instalment due has arrived', () => {
    const r = [rcpt('r1', '2026-03-01', 52), rcpt('r2', '2026-04-01', 52)]
    const p = planProgress(plan(), r, '2026-04-10')
    expect(p.paid).toBe(104); expect(p.balance).toBe(104); expect(p.status).toBe('on_track'); expect(p.nextDue).toBe('2026-05-01'); expect(p.instalmentsPaid).toBe(2); expect(p.instalmentsTotal).toBe(4)
  })
  it('is due soon within a week of the next instalment', () => {
    const r = [rcpt('r1', '2026-03-01', 52), rcpt('r2', '2026-04-01', 52)]
    expect(planProgress(plan(), r, '2026-04-26').status).toBe('due_soon')
  })
  it('is broken once a full instalment is behind', () => {
    const r = [rcpt('r1', '2026-03-01', 52)]
    expect(planProgress(plan(), r, '2026-04-10').status).toBe('broken')
  })
  it('completes when the balance is cleared, and respects a manual pause', () => {
    const r = [rcpt('r1', '2026-03-01', 208)]
    expect(planProgress(plan(), r, '2026-04-10').status).toBe('completed')
    expect(planProgress(plan({ status_override: 'paused' }), [], '2026-04-10').status).toBe('paused')
  })
  it('counts unlinked historic-arrears allocations since the start when none are linked to a plan', () => {
    const r = [{ id: 'x', received_date: '2026-03-05', amount: 52, kind: 'receipt', rent_allocations: [{ target: 'historic_arrears', amount: 52, payment_plan_id: null }] },
               { id: 'y', received_date: '2026-02-01', amount: 30, kind: 'receipt', rent_allocations: [{ target: 'historic_arrears', amount: 30, payment_plan_id: null }] }]
    expect(planPaid(plan(), r)).toBe(52)
  })
  it('never lets a current-rent allocation count towards the plan', () => {
    const r = [rcpt('r1', '2026-03-01', 480, 'pl1', 'current_rent')]
    expect(planPaid(plan(), r)).toBe(0)
  })
})

describe('activePlan', () => {
  it('picks the latest started plan that is not completed', () => {
    const plans = [plan({ id: 'a', start_date: '2025-01-01', status_override: 'completed' }), plan({ id: 'b', start_date: '2026-03-01' })]
    expect(activePlan(plans, '2026-04-01').id).toBe('b')
    expect(activePlan(plans, '2026-02-01')).toBeNull()
  })
})

describe('possibleDuplicate', () => {
  const existing = [{ id: 'e1', received_date: '2026-05-02', amount: 500, kind: 'receipt', source: 'statement', source_ref: 'stmt:1' }]
  it('flags the same amount within three days from another source', () => {
    expect(possibleDuplicate(existing, { received_date: '2026-05-04', amount: 500, source: 'bank' })?.id).toBe('e1')
  })
  it('ignores different amounts, distant dates and the same source reference', () => {
    expect(possibleDuplicate(existing, { received_date: '2026-05-04', amount: 480 })).toBeNull()
    expect(possibleDuplicate(existing, { received_date: '2026-05-20', amount: 500 })).toBeNull()
    expect(possibleDuplicate(existing, { received_date: '2026-05-02', amount: 500, source_ref: 'stmt:1' })).toBeNull()
  })
})
