import { describe, it, expect } from 'vitest'
import {
  parseDueDay, parseLooseDate, isPeriodicText, tenancyDraftFromProperty, benefitSplitCheck,
  tenancyCoversDate, tenancyForDate, allocationBalance, propertyNeedsTenancy,
  tenancyCoverEnd, currentTenancy,
} from '../tenancyUtils'

describe('parseDueDay', () => {
  it('reads the ordinal text the property field holds today', () => {
    expect(parseDueDay('28th')).toBe(28)
    expect(parseDueDay('1st')).toBe(1)
    expect(parseDueDay('2nd')).toBe(2)
    expect(parseDueDay('12')).toBe(12)
  })
  it('rejects blanks and out-of-range values', () => {
    expect(parseDueDay('')).toBeNull()
    expect(parseDueDay(null)).toBeNull()
    expect(parseDueDay('32nd')).toBeNull()
    expect(parseDueDay('0')).toBeNull()
  })
})

describe('parseLooseDate', () => {
  it('handles every shape found on properties.tenancy_end', () => {
    expect(parseLooseDate('2026-09-17')).toBe('2026-09-17')
    expect(parseLooseDate('31st March 2026')).toBe('2026-03-31')
    expect(parseLooseDate('12 Dec 2025')).toBe('2025-12-12')
    expect(parseLooseDate('1 April 2027')).toBe('2027-04-01')
    expect(parseLooseDate('22nd December 2034')).toBe('2034-12-22')
    expect(parseLooseDate('April 2030')).toBe('2030-04-01')
    expect(parseLooseDate('05/10/2026')).toBe('2026-10-05')
  })
  it('returns null for periodic text and rubbish', () => {
    expect(parseLooseDate('Monthly Rolling')).toBeNull()
    expect(parseLooseDate('')).toBeNull()
    expect(parseLooseDate('31st February 2026')).toBeNull()
    expect(isPeriodicText('Monthly Rolling')).toBe(true)
    expect(isPeriodicText('2026-01-01')).toBe(false)
  })
})

describe('tenancyDraftFromProperty', () => {
  const today = new Date('2026-09-02T12:00:00Z')
  it('builds a needs-confirmation draft from a Watts Moses style row', () => {
    const d = tenancyDraftFromProperty({
      id: 'p1', company_id: 'c1', status: 'rented', tenant_name: null, tenant_since: null,
      tenancy_end: '20th September 2026', rent_due_day: '20th', rent_pcm: '500.00', arrears: '0.00',
    }, { today })
    expect(d.tenancy_start).toBe('2026-01-01')
    expect(d.tenancy_end).toBe('2026-09-20')
    expect(d.rent_amount).toBe(500)
    expect(d.rent_due_day).toBe(20)
    expect(d.payment_window_days).toBe(5)
    expect(d.status).toBe('rented')
    expect(d.needs_confirmation).toBe(true)
    expect(d.opening_arrears).toBe(0)
  })
  it('drops a past tenancy end and explains why, carries arrears as opening balance', () => {
    const d = tenancyDraftFromProperty({
      id: 'p2', status: 'notice_given', tenancy_end: '2nd August 2025', rent_due_day: '3rd', rent_pcm: 450, arrears: 700,
    }, { today })
    expect(d.tenancy_end).toBeNull()
    expect(d.status).toBe('notice_given')
    expect(d.opening_arrears).toBe(700)
    expect(d.opening_arrears_date).toBe('2026-09-02')
    expect(d.notes).toMatch(/in the past/)
  })
  it('dates the opening arrears on the local calendar day, not the UTC one', () => {
    const d = tenancyDraftFromProperty({ id: 'p4', status: 'rented', rent_pcm: 450, arrears: 100 }, { today: new Date(2026, 8, 2, 0, 30) })
    expect(d.opening_arrears_date).toBe('2026-09-02')
  })
  it('treats Monthly Rolling as periodic with a note', () => {
    const d = tenancyDraftFromProperty({ id: 'p3', status: 'rented', tenancy_end: 'Monthly Rolling', rent_pcm: 500 }, { today })
    expect(d.tenancy_end).toBeNull()
    expect(d.notes).toMatch(/periodic/)
  })
  it('flags rented, notice given and let agreed as needing a tenancy', () => {
    expect(propertyNeedsTenancy('rented')).toBe(true)
    expect(propertyNeedsTenancy('let_agreed')).toBe(true)
    expect(propertyNeedsTenancy('short_term_let')).toBe(false)
    expect(propertyNeedsTenancy('vacant')).toBe(false)
  })
})

describe('benefitSplitCheck', () => {
  it('ignores tenant-only tenancies', () => {
    expect(benefitSplitCheck({ payment_source: 'tenant', rent_amount: 500 }).ok).toBe(true)
  })
  it('ties when contributions equal the rent', () => {
    expect(benefitSplitCheck({ payment_source: 'mixed', rent_amount: 500, benefit_contribution: 380.5, tenant_contribution: 119.5 }).ok).toBe(true)
  })
  it('reports the gap either way', () => {
    const short = benefitSplitCheck({ payment_source: 'mixed', rent_amount: 500, benefit_contribution: 380, tenant_contribution: 100 })
    expect(short.ok).toBe(false)
    expect(short.diff).toBe(-20)
    expect(short.message).toMatch(/short/)
    const over = benefitSplitCheck({ payment_source: 'universal_credit', rent_amount: 500, benefit_contribution: 520, tenant_contribution: 0 })
    expect(over.diff).toBe(20)
  })
})

describe('tenancy dates', () => {
  const t = { tenancy_start: '2026-02-10', tenancy_end: '2026-08-09', status: 'ended' }
  it('covers inclusive start and end', () => {
    expect(tenancyCoversDate(t, '2026-02-10')).toBe(true)
    expect(tenancyCoversDate(t, '2026-08-09')).toBe(true)
    expect(tenancyCoversDate(t, '2026-08-10')).toBe(false)
    expect(tenancyCoversDate(t, '2026-02-09')).toBe(false)
  })
  it('open-ended tenancies run on; expected move-out closes them', () => {
    expect(tenancyCoversDate({ tenancy_start: '2026-01-01' }, '2030-01-01')).toBe(true)
    expect(tenancyCoversDate({ tenancy_start: '2026-01-01', expected_move_out: '2026-06-30' }, '2026-07-01')).toBe(false)
  })
  it('a tenancy not marked ended holds over past an old fixed-term end (periodic since 1 May 2026)', () => {
    const holding = { tenancy_start: '2025-02-10', tenancy_end: '2026-02-09', status: 'rented' }
    expect(tenancyCoversDate(holding, '2026-11-15')).toBe(true)
    expect(tenancyCoverEnd(holding)).toBeNull()
    // Cover ends on a recorded move-out, or once the tenancy is marked ended.
    expect(tenancyCoversDate({ ...holding, expected_move_out: '2026-10-31' }, '2026-11-01')).toBe(false)
    expect(tenancyCoversDate({ ...holding, status: 'ended' }, '2026-02-10')).toBe(false)
    // A tenant's notice: the end date recorded is when the notice runs out.
    expect(tenancyCoverEnd({ ...holding, status: 'notice_given', tenancy_end: '2026-12-01' })).toBe('2026-12-01')
    expect(tenancyCoverEnd({ ...holding, status: 'notice_given', tenancy_end: '2026-12-01', expected_move_out: '2026-12-15' })).toBe('2026-12-15')
  })
  it('holding over applies only to status rented; every other status ends cover at tenancy_end', () => {
    const base = { tenancy_start: '2025-06-01', tenancy_end: '2026-05-31' }
    // rented: runs past tenancy_end, until expected_move_out if set.
    expect(tenancyCoverEnd({ ...base, status: 'rented' })).toBeNull()
    expect(tenancyCoversDate({ ...base, status: 'rented' }, '2026-09-01')).toBe(true)
    expect(tenancyCoverEnd({ ...base, status: 'rented', expected_move_out: '2026-08-15' })).toBe('2026-08-15')
    // A missing status is the DB default, 'rented'.
    expect(tenancyCoverEnd(base)).toBeNull()
    for (const status of ['notice_given', 'vacant', 'refurbishment', 'ended']) {
      expect(tenancyCoverEnd({ ...base, status })).toBe('2026-05-31')
      expect(tenancyCoversDate({ ...base, status }, '2026-05-31')).toBe(true)
      expect(tenancyCoversDate({ ...base, status }, '2026-09-01')).toBe(false)
      // expected_move_out first when set.
      expect(tenancyCoverEnd({ ...base, status, expected_move_out: '2026-06-14' })).toBe('2026-06-14')
    }
  })
  it('currentTenancy takes today from the local calendar date, not UTC', () => {
    const a = { id: 'a', tenancy_start: '2026-01-01', tenancy_end: '2026-06-30', status: 'ended' }
    const b = { id: 'b', tenancy_start: '2026-07-01', status: 'rented' }
    // 00:30 on 1 July local time is still 30 June in UTC during BST.
    expect(currentTenancy([a, b], new Date(2026, 6, 1, 0, 30)).id).toBe('b')
    expect(currentTenancy([a, b], '2026-06-30').id).toBe('a')
  })
  it('picks the tenancy covering a date', () => {
    const list = [t, { tenancy_start: '2026-08-15', tenancy_end: null }]
    expect(tenancyForDate(list, '2026-03-01')).toBe(t)
    expect(tenancyForDate(list, '2026-09-01').tenancy_start).toBe('2026-08-15')
    expect(tenancyForDate(list, '2026-08-12')).toBeNull()
  })
})

describe('allocationBalance', () => {
  it('reports unallocated remainder', () => {
    const r = allocationBalance({ amount: 480 }, [{ amount: 400 }, { amount: 50 }])
    expect(r.allocated).toBe(450)
    expect(r.unallocated).toBe(30)
    expect(r.balanced).toBe(false)
    expect(allocationBalance({ amount: 480 }, [{ amount: 480 }]).balanced).toBe(true)
  })
})
