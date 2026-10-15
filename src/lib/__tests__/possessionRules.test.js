import { describe, it, expect } from 'vitest'
import {
  GROUNDS, groundById, addMonthsISO, addDaysISO, periodEndISO,
  earliestPossessionDate, validateSection8, ground8Threshold,
  earliestRentIncreaseDate, validateSection13, currentTenancyStart,
} from '../possessionRules'

describe('grounds catalogue', () => {
  it('uses the post-1 May 2026 Ground 8 rules', () => {
    const g8 = groundById('8')
    expect(g8.period).toEqual({ weeks: 4 })
    expect(g8.mandatory).toBe(true)
    expect(g8.detail).toMatch(/3 months/)
  })
  it('has unique ids and no section 21', () => {
    const ids = GROUNDS.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(JSON.stringify(GROUNDS)).not.toMatch(/section 21/i)
  })
  it('groups notice periods as published', () => {
    expect(groundById('1').period).toEqual({ months: 4 })
    expect(groundById('1A').period).toEqual({ months: 4 })
    expect(groundById('7').period).toEqual({ months: 2 })
    expect(groundById('7B').period).toEqual({ weeks: 2 })
    expect(groundById('12').period).toEqual({ weeks: 2 })
    expect(groundById('14').period).toEqual({ none: true })
  })
})

describe('date arithmetic', () => {
  it('clamps month ends', () => {
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsISO('2026-10-15', 4)).toBe('2027-02-15')
  })
  it('adds days across DST without drift', () => {
    expect(addDaysISO('2026-10-20', 14)).toBe('2026-11-03')
    expect(addDaysISO('2027-03-20', 14)).toBe('2027-04-03')
  })
  it('immediate grounds end on the service date', () => {
    expect(periodEndISO('2026-11-01', { none: true })).toBe('2026-11-01')
  })
})

describe('earliestPossessionDate', () => {
  it('uses the longest period across grounds', () => {
    const r = earliestPossessionDate({ dateServed: '2026-11-02', groundIds: ['8', '10', '11'] })
    expect(r.date).toBe('2026-11-30')
    const r2 = earliestPossessionDate({ dateServed: '2026-11-02', groundIds: ['8', '1A'] })
    expect(r2.date).toBe('2027-03-02')
  })
  it('pushes Grounds 1/1A past the first 12 months of the tenancy', () => {
    const r = earliestPossessionDate({ dateServed: '2026-11-02', groundIds: ['1A'], tenancyStart: '2026-09-01' })
    expect(r.date).toBe('2027-09-01')
  })
})

describe('validateSection8', () => {
  it('blocks a date earlier than the notice period', () => {
    const v = validateSection8({ dateServed: '2026-11-02', possessionDate: '2026-11-16', groundIds: ['8'], arrears: 4000, rentAmount: 1000 })
    expect(v.errors.join(' ')).toMatch(/2026-11-30/)
  })
  it('warns when arrears are below the Ground 8 threshold', () => {
    const v = validateSection8({ dateServed: '2026-11-02', possessionDate: '2026-12-01', groundIds: ['8'], arrears: 2000, rentAmount: 1000 })
    expect(v.errors).toEqual([])
    expect(v.warnings.join(' ')).toMatch(/3 months/)
  })
  it('accepts a valid Ground 8 notice', () => {
    const v = validateSection8({ dateServed: '2026-11-02', possessionDate: '2026-11-30', groundIds: ['8'], arrears: 3000, rentAmount: 1000 })
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual([])
  })
  it('rejects pre-commencement service dates', () => {
    const v = validateSection8({ dateServed: '2026-04-01', possessionDate: '2026-12-01', groundIds: ['12'] })
    expect(v.errors.length).toBeGreaterThan(0)
  })
  it('works out 13 weeks for weekly rent', () => {
    expect(ground8Threshold({ rentAmount: 200, frequency: 'weekly' }).amount).toBe(2600)
  })
})

describe('section 13 (Form 4A)', () => {
  it('needs two months notice', () => {
    expect(earliestRentIncreaseDate({ dateServed: '2026-11-01' }).date).toBe('2027-01-01')
  })
  it('respects the first 52 weeks and the last increase', () => {
    const r = earliestRentIncreaseDate({ dateServed: '2026-11-01', tenancyStart: '2026-06-01', lastIncreaseDate: '2026-03-01' })
    expect(r.date).toBe(addDaysISO('2026-06-01', 364))
  })
  it('validates amounts and dates', () => {
    const bad = validateSection13({ dateServed: '2026-11-01', startDate: '2026-12-01', tenancyStart: '2024-01-01', currentRent: 1000, proposedRent: 900 })
    expect(bad.errors.length).toBe(2)
    const ok = validateSection13({ dateServed: '2026-11-01', startDate: '2027-01-01', tenancyStart: '2024-01-01', currentRent: 1000, proposedRent: 1050, rentDueDay: 1 })
    expect(ok.errors).toEqual([])
    expect(ok.warnings).toEqual([])
  })
  it('warns when the start date is not a rent day', () => {
    const v = validateSection13({ dateServed: '2026-11-01', startDate: '2027-01-05', tenancyStart: '2024-01-01', currentRent: 1000, proposedRent: 1050, rentDueDay: 1 })
    expect(v.warnings.join(' ')).toMatch(/first day of a rental period/)
  })
})

describe('currentTenancyStart', () => {
  it('prefers the latest active tenancy', () => {
    expect(currentTenancyStart({ tenant_since: '2020-01-01', tenancies: [
      { tenancy_start: '2022-05-01', status: 'ended' },
      { tenancy_start: '2024-03-10', status: 'active' },
    ] })).toBe('2024-03-10')
    expect(currentTenancyStart({ tenant_since: '2020-01-01' })).toBe('2020-01-01')
    expect(currentTenancyStart(null)).toBe('')
  })
})
