import { describe, it, expect } from 'vitest'
import { rentMonthSnapshot, recentMonthKeys, monthRate, monthLabel } from '../rentForecast'

// Dashboard "Rent Forecast" / "Rent Received" arithmetic. These lean on the
// rent engine, so the scenarios here only pin what the snapshot adds on top:
// month windowing, full-month forecasting for the current month, company
// attribution, STL exclusion and needs-backfill counting.

const month = (id, y, m, status = 'void', amount = null, extra = {}) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { id, year: y, month: m, month_label: `${mm}/${y}`, period_start: `${y}-${mm}-01`, period_end: `${y}-${mm}-${last}`, status, amount, ...extra }
}
const T = (over = {}) => ({ id: 't1', tenancy_start: '2026-01-01', tenancy_end: null, rent_amount: 600, rent_frequency: 'monthly', rent_due_day: 1, payment_window_days: 5, status: 'rented', payment_source: 'tenant', opening_arrears: 0, ...over })
const prop = (over = {}) => ({ id: 'p1', company_id: 'coA', status: 'rented', rent_pcm: 600, rent_due_day: '1st', tenancies: [T()], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [], rent_payments: [], ...over })

describe('recentMonthKeys', () => {
  it('walks back across a year boundary, newest first', () => {
    expect(recentMonthKeys('2026-01-15', 3)).toEqual([{ year: 2026, month: 1 }, { year: 2025, month: 12 }, { year: 2025, month: 11 }])
  })
  it('offset 1 starts at next month', () => {
    expect(recentMonthKeys('2026-12-03', 1, 1)).toEqual([{ year: 2027, month: 1 }])
  })
  it('labels months in short form', () => {
    expect(monthLabel(2026, 9)).toBe('Sep 2026')
  })
})

describe('rentMonthSnapshot', () => {
  it('returns three months newest first with forecast, received and outstanding', () => {
    const p = prop({ rent_payments: [
      month('jul', 2026, 7, 'paid', 600),
      month('aug', 2026, 8, 'partial', 400),
      month('sep', 2026, 9, 'void'),
    ] })
    const [sep, aug, jul] = rentMonthSnapshot([p], { asOf: '2026-09-08' })
    expect(sep.label).toBe('Sep 2026'); expect(aug.label).toBe('Aug 2026'); expect(jul.label).toBe('Jul 2026')
    expect(sep.expected).toBe(600); expect(sep.received).toBe(0); expect(sep.outstanding).toBe(600)
    expect(aug.expected).toBe(600); expect(aug.received).toBe(400); expect(aug.outstanding).toBe(200)
    expect(jul.expected).toBe(600); expect(jul.received).toBe(600); expect(jul.outstanding).toBe(0)
  })

  it('ignores rows outside the window and properties with no rows', () => {
    const p = prop({ rent_payments: [month('jun', 2026, 6, 'paid', 600), month('oct', 2026, 10, 'void')] })
    const months = rentMonthSnapshot([p, prop({ id: 'p2', rent_payments: [] })], { asOf: '2026-09-08' })
    expect(months.every(mo => mo.expected === 0 && mo.received === 0 && mo.periods === 0)).toBe(true)
  })

  it('forecasts the whole current month, including a segment that starts after today', () => {
    // Tenant moves in on 20 Sep: the tenancy starts then, so the engine
    // prorates 11 of 30 days. Evaluated as at 8 Sep the period would be
    // FUTURE with no expectation; the snapshot evaluates at month end instead.
    const p = prop({
      tenancies: [T({ tenancy_start: '2026-09-20' })],
      rent_payments: [{ ...month('sep', 2026, 9, 'void'), period_start: '2026-09-20' }],
    })
    const [sep] = rentMonthSnapshot([p], { asOf: '2026-09-08', count: 1 })
    expect(sep.expected).toBe(220) // 600 * 11 / 30
  })

  it('falls back to the property rent when it has no tenancy record', () => {
    const p = prop({ tenancies: [], rent_pcm: 750, rent_payments: [month('sep', 2026, 9, 'void')] })
    const [sep] = rentMonthSnapshot([p], { asOf: '2026-09-08', count: 1 })
    expect(sep.expected).toBe(750)
  })

  it('a vacant property with no tenancy adds nothing to the forecast', () => {
    const p = prop({ status: 'vacant', tenancies: [], rent_payments: [month('sep', 2026, 9, 'void')] })
    const [sep] = rentMonthSnapshot([p], { asOf: '2026-09-08', count: 1 })
    expect(sep.expected).toBe(0); expect(sep.received).toBe(0)
  })

  it('uses receipt allocations for received when any exist', () => {
    const p = prop({
      rent_payments: [month('sep', 2026, 9, 'void')],
      rent_receipts: [{ id: 'r1', received_date: '2026-09-02', amount: 600, payer: 'tenant', kind: 'receipt',
        rent_allocations: [{ id: 'a1', rent_payment_id: 'sep', target: 'current_rent', amount: 600 }] }],
    })
    const [sep] = rentMonthSnapshot([p], { asOf: '2026-09-08', count: 1 })
    expect(sep.received).toBe(600); expect(sep.outstanding).toBe(0)
  })

  it('counts a paid month with no amount as needs-backfill, not GBP 0 received', () => {
    const p = prop({ rent_payments: [month('aug', 2026, 8, 'paid', null)] })
    const [, aug] = rentMonthSnapshot([p], { asOf: '2026-09-08' })
    expect(aug.needsBackfill).toBe(1)
    expect(aug.expected).toBe(600)
    expect(aug.received).toBe(0)
    expect(aug.byCompany.coA.needsBackfill).toBe(1)
  })

  it('keeps short-term-let income out of the headline but reports it separately', () => {
    const stl = prop({ id: 'stl', status: 'short_term_let', tenancies: [], rent_payments: [
      { ...month('b1', 2026, 9, 'paid', 900), period_start: '2026-09-03', period_end: '2026-09-07' },
    ] })
    const p = prop({ rent_payments: [month('sep', 2026, 9, 'paid', 600)] })
    const [sep] = rentMonthSnapshot([p, stl], { asOf: '2026-09-08', count: 1 })
    expect(sep.expected).toBe(600); expect(sep.received).toBe(600)
    expect(sep.stlReceived).toBe(900)
  })

  it('attributes expected and received per company', () => {
    const a = prop({ id: 'a', company_id: 'coA', rent_payments: [month('a9', 2026, 9, 'paid', 600)] })
    const b = prop({ id: 'b', company_id: 'coB', tenancies: [T({ rent_amount: 1000 })], rent_pcm: 1000, rent_payments: [month('b9', 2026, 9, 'void')] })
    const [sep] = rentMonthSnapshot([a, b], { asOf: '2026-09-08', count: 1 })
    expect(sep.byCompany.coA).toMatchObject({ expected: 600, received: 600 })
    expect(sep.byCompany.coB).toMatchObject({ expected: 1000, received: 0 })
    expect(sep.expected).toBe(1600)
    expect(sep.propertiesWithRows).toBe(2)
  })

  it('offset 1 gives next month as a forward forecast', () => {
    const p = prop({ rent_payments: [month('oct', 2026, 10, 'void')] })
    const [oct] = rentMonthSnapshot([p], { asOf: '2026-09-08', count: 1, offset: 1 })
    expect(oct.label).toBe('Oct 2026'); expect(oct.expected).toBe(600)
  })

  it('pre-go-live months still report what was received', () => {
    const p = prop({ rent_payments: [month('dec', 2025, 12, 'paid', 550)] })
    const [dec] = rentMonthSnapshot([p], { asOf: '2025-12-20', count: 1 })
    expect(dec.received).toBe(550)
    expect(dec.expected).toBe(0)
  })
})

describe('monthRate', () => {
  it('is null with nothing expected and capped at 100', () => {
    expect(monthRate({ expected: 0, received: 0 })).toBeNull()
    expect(monthRate({ expected: 600, received: 300 })).toBe(50)
    expect(monthRate({ expected: 600, received: 700 })).toBe(100)
  })
})
