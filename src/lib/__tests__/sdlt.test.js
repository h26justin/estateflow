import { describe, it, expect } from 'vitest'
import { sdltFor, sdltRegime, dealSdltDate, sdltBasisLabel } from '../sdlt'
import { stampDuty } from '../dealMetrics'

describe('sdltFor: rates by completion date', () => {
  it('from 1 Apr 2025: £300k additional = 2,500 standard + 15,000 surcharge', () => {
    // 2% of 125k-250k = 2,500; 5% of 250k-300k = 2,500; surcharge 5% of 300k = 15,000
    expect(sdltFor(300000, { additional: true, date: '2026-12-09' })).toBe(20000)
    expect(sdltFor(300000, { additional: false, date: '2026-12-09' })).toBe(5000)
  })

  it('23 Sep 2022 to 30 Oct 2024: £250k nil band, 3% surcharge', () => {
    // 5% of 250k-300k = 2,500; surcharge 3% of 300k = 9,000
    expect(sdltFor(300000, { additional: true, date: '2023-06-01' })).toBe(11500)
    expect(sdltFor(300000, { additional: false, date: '2023-06-01' })).toBe(2500)
  })

  it('31 Oct 2024 to 31 Mar 2025: £250k nil band, 5% surcharge', () => {
    expect(sdltFor(300000, { additional: true, date: '2025-02-01' })).toBe(17500)
    // boundary days
    expect(sdltFor(300000, { additional: true, date: '2024-10-30' })).toBe(11500)
    expect(sdltFor(300000, { additional: true, date: '2025-03-31' })).toBe(17500)
    expect(sdltFor(300000, { additional: true, date: '2025-04-01' })).toBe(20000)
  })

  it('1 Oct 2021 to 22 Sep 2022: £125k nil band, 3% surcharge', () => {
    expect(sdltFor(300000, { additional: true, date: '2022-01-15' })).toBe(14000)
  })

  it('higher rates do not apply under £40,000', () => {
    expect(sdltFor(20000, { additional: true, date: '2026-12-14' })).toBe(0)
    expect(sdltFor(39999, { additional: true, date: '2026-12-14' })).toBe(0)
    expect(sdltFor(40000, { additional: true, date: '2026-12-14' })).toBe(2000)
    expect(sdltFor(55000, { additional: true, date: '2026-12-14' })).toBe(2750)
  })

  it('first-time buyer relief limits follow the date', () => {
    expect(sdltFor(400000, { additional: false, firstTimeBuyer: true, date: '2026-01-10' })).toBe(5000)  // 5% of 300k-400k
    expect(sdltFor(400000, { additional: false, firstTimeBuyer: true, date: '2024-01-10' })).toBe(0)     // under the 425k nil band
    // over the cap: no relief, standard bands (from Apr 2025: 2,500 + 5% of 250k-550k = 17,500)
    expect(sdltFor(550000, { additional: false, firstTimeBuyer: true, date: '2026-01-10' })).toBe(17500)
  })

  it('uses today when there is no date, and flags dates before the modelled range', () => {
    expect(sdltRegime().date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sdltRegime('2019-05-01').beforeModelled).toBe(true)
    expect(sdltRegime('2025-04-01').from).toBe('2025-04-01')
  })
})

describe('deals', () => {
  it('works SDLT out at completion, then expected, then target completion', () => {
    expect(dealSdltDate({ actual_completion_date: '2024-01-01', expected_completion_date: '2026-12-01' })).toBe('2024-01-01')
    expect(dealSdltDate({ expected_completion_date: '2026-12-01', target_completion_date: '2027-01-01' })).toBe('2026-12-01')
    expect(dealSdltDate({ target_completion_date: '2027-01-01' })).toBe('2027-01-01')
    expect(dealSdltDate({})).toBe(null)
  })

  it('stampDuty() follows the deal date and keeps the manual override', () => {
    const d = { purchase_price: 300000, is_additional_property: true, actual_completion_date: '2023-06-01' }
    expect(stampDuty(d)).toBe(11500)
    expect(stampDuty({ ...d, stamp_duty_override: 999 })).toBe(999)
    expect(stampDuty({ purchase_price: 20000, is_additional_property: true })).toBe(0)
  })

  it('labels the basis', () => {
    expect(sdltBasisLabel(20000, { additional: true, date: '2026-12-14' })).toMatch(/under £40,000/i)
    expect(sdltBasisLabel(55000, { additional: true, date: '2026-12-14' })).toBe('Standard bands + 5% surcharge · rates from 1 Apr 2025')
    expect(sdltBasisLabel(55000, { additional: true })).toMatch(/today's rates/)
  })
})
