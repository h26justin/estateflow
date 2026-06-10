import { describe, it, expect } from 'vitest'
import { fmt, fmtMoney2dp, fmtPct, fmtNum, parseMoney } from '../format'

describe('fmt — GBP currency with no decimals', () => {
  it('formats whole pounds with thousand separators', () => {
    expect(fmt(1500)).toBe('£1,500')
    expect(fmt(2_500_000)).toBe('£2,500,000')
  })

  it('treats null/undefined as zero', () => {
    expect(fmt(null)).toBe('£0')
    expect(fmt(undefined)).toBe('£0')
  })

  it('surfaces NaN as the — sentinel (arithmetic-bug guard)', () => {
    expect(fmt(NaN)).toBe('—')
  })

  it('rounds pence (no decimals shown)', () => {
    expect(fmt(1500.49)).toBe('£1,500')
    expect(fmt(1500.51)).toBe('£1,501')
  })

  it('renders negative numbers with a minus', () => {
    expect(fmt(-250)).toBe('-£250')
  })
})

describe('fmtMoney2dp — GBP currency with 2 decimal places', () => {
  it('keeps pence', () => {
    expect(fmtMoney2dp(1500.5)).toBe('£1,500.50')
    expect(fmtMoney2dp(1500)).toBe('£1,500.00')
  })
})

describe('fmtPct — percentage with N decimal places', () => {
  it('defaults to 1dp', () => {
    expect(fmtPct(5)).toBe('5.0%')
    expect(fmtPct(5.25)).toBe('5.3%')  // rounds half-up
  })

  it('respects decimals argument', () => {
    expect(fmtPct(5.25, 2)).toBe('5.25%')
    expect(fmtPct(0, 0)).toBe('0%')
  })

  it('treats non-numeric as zero', () => {
    expect(fmtPct('abc')).toBe('0.0%')
    expect(fmtPct(null)).toBe('0.0%')
  })
})

describe('fmtNum — plain number with separators', () => {
  it('formats thousands', () => {
    expect(fmtNum(1234)).toBe('1,234')
    expect(fmtNum(1234567)).toBe('1,234,567')
  })

  it('treats null/non-numeric as zero', () => {
    expect(fmtNum(null)).toBe('0')
    expect(fmtNum('xyz')).toBe('0')
  })
})

describe('parseMoney — string → number', () => {
  it('strips commas and £/$/€', () => {
    expect(parseMoney('1,234.56')).toBe(1234.56)
    expect(parseMoney('£2,500,000')).toBe(2_500_000)
    expect(parseMoney('$1,000')).toBe(1000)
    expect(parseMoney('€500')).toBe(500)
  })

  it('handles whitespace', () => {
    expect(parseMoney('  1 000 ')).toBe(1000)
  })

  it('preserves decimal point', () => {
    expect(parseMoney('1.50')).toBe(1.5)
  })

  it('preserves leading minus', () => {
    expect(parseMoney('-£250')).toBe(-250)
  })

  it('returns NaN for empty/garbage input', () => {
    expect(parseMoney('')).toBeNaN()
    expect(parseMoney(null)).toBeNaN()
  })

  it('returns numbers unchanged', () => {
    expect(parseMoney(42)).toBe(42)
  })
})
