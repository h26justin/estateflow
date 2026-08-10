import { describe, it, expect } from 'vitest'
import {
  bandFromSap,
  parseIndicativeCost,
  fmtCostRange,
  measureLabel,
  planToC,
  BELOW_C,
  SAP_C_THRESHOLD,
} from '../epcUpgrade'

// Helper: one raw suggested_improvements entry as the register stores it.
const m = (sequence, number, cost, after, saving) => ({
  sequence,
  indicative_cost: cost,
  improvement_details: { improvement_number: number },
  energy_performance_rating: after,
  typical_saving: saving != null ? { value: saving, currency: 'GBP' } : undefined,
})

describe('bandFromSap', () => {
  it('maps SAP scores to standard EPC bands', () => {
    expect(bandFromSap(92)).toBe('A')
    expect(bandFromSap(81)).toBe('B')
    expect(bandFromSap(80)).toBe('C')
    expect(bandFromSap(SAP_C_THRESHOLD)).toBe('C')
    expect(bandFromSap(68)).toBe('D')
    expect(bandFromSap(55)).toBe('D')
    expect(bandFromSap(54)).toBe('E')
    expect(bandFromSap(38)).toBe('F')
    expect(bandFromSap(20)).toBe('G')
    expect(bandFromSap(1)).toBe('G')
  })
  it('rejects non-scores', () => {
    expect(bandFromSap(0)).toBeNull()
    expect(bandFromSap(null)).toBeNull()
    expect(bandFromSap('not a number')).toBeNull()
  })
  it('accepts numeric strings (register JSON is stringly typed in places)', () => {
    expect(bandFromSap('69')).toBe('C')
  })
})

describe('parseIndicativeCost', () => {
  it('handles plain numbers', () => {
    expect(parseIndicativeCost(450)).toEqual({ lo: 450, hi: 450 })
  })
  it('handles bare numeric strings with thousands separators', () => {
    expect(parseIndicativeCost('1,500')).toEqual({ lo: 1500, hi: 1500 })
  })
  it('handles single £ amounts', () => {
    expect(parseIndicativeCost('£10')).toEqual({ lo: 10, hi: 10 })
  })
  it('handles register range strings', () => {
    expect(parseIndicativeCost('£4,000 - £14,000')).toEqual({ lo: 4000, hi: 14000 })
    expect(parseIndicativeCost('£100 - £350')).toEqual({ lo: 100, hi: 350 })
  })
  it('returns null for missing/unparseable values', () => {
    expect(parseIndicativeCost(null)).toBeNull()
    expect(parseIndicativeCost(undefined)).toBeNull()
    expect(parseIndicativeCost('free')).toBeNull()
  })
})

describe('fmtCostRange', () => {
  it('collapses equal bounds', () => {
    expect(fmtCostRange({ lo: 450, hi: 450 })).toBe('£450')
  })
  it('formats ranges with GB separators', () => {
    expect(fmtCostRange({ lo: 4000, hi: 14000 })).toBe('£4,000 - £14,000')
  })
  it('em-dashes the unknown', () => {
    expect(fmtCostRange(null)).toBe('—')
  })
})

describe('measureLabel', () => {
  it('resolves known RdSAP improvement numbers', () => {
    expect(measureLabel(m(1, 5, 100, 60))).toBe('Increase loft insulation to 270 mm')
    expect(measureLabel(m(1, 6, 100, 60))).toBe('Cavity wall insulation')
    expect(measureLabel(m(1, 34, 100, 60))).toBe('Solar photovoltaic panels, 2.5 kWp')
  })
  it('falls back to the letter code, then a generic label', () => {
    expect(measureLabel({ improvement_type: 'Q', improvement_details: { improvement_number: 999 } }))
      .toBe('Solid wall insulation')
    expect(measureLabel({ improvement_details: { improvement_number: 999 } }))
      .toBe('Improvement measure 999')
    expect(measureLabel({})).toBe('Improvement measure')
  })
})

describe('planToC', () => {
  it('reports already_c for bands A-C', () => {
    const plan = planToC({ current_rating: 'B', sap_score: 85, improvements: [m(1, 5, 100, 90)] })
    expect(plan.status).toBe('already_c')
    expect(plan.measures).toHaveLength(0)
  })

  it('stops at the measure that reaches SAP 69 and sums its costs', () => {
    const plan = planToC({
      current_rating: 'E', sap_score: 48,
      improvements: [
        m(1, 5, '£100 - £350', 55, 40),
        m(2, 6, '£500 - £1,500', 70, 150),   // crosses the C threshold here
        m(3, 34, '£3,500 - £5,500', 78, 300), // beyond C — excluded
      ],
    })
    expect(plan.status).toBe('plan')
    expect(plan.measures).toHaveLength(2)
    expect(plan.costLo).toBe(600)
    expect(plan.costHi).toBe(1850)
    expect(plan.sapAfter).toBe(70)
    expect(plan.savingPerYear).toBe(190)
    expect(plan.hasUnknownCost).toBe(false)
  })

  it('sorts by sequence before walking', () => {
    const plan = planToC({
      current_rating: 'D', sap_score: 60,
      improvements: [m(2, 6, 200, 72), m(1, 5, 100, 65)],
    })
    expect(plan.measures.map(x => x.label)).toEqual([
      'Increase loft insulation to 270 mm',
      'Cavity wall insulation',
    ])
  })

  it('flags not_reachable when all measures stay below 69, keeping the full list', () => {
    const plan = planToC({
      current_rating: 'E', sap_score: 45,
      improvements: [m(1, 5, 100, 50), m(2, 35, 10, 52)],
    })
    expect(plan.status).toBe('not_reachable')
    expect(plan.measures).toHaveLength(2)
    expect(plan.sapAfter).toBe(52)
    expect(plan.costLo).toBe(110)
  })

  it('flags not_reachable with unknown cost when the certificate lists no measures', () => {
    const plan = planToC({ current_rating: 'F', sap_score: 30, improvements: [] })
    expect(plan.status).toBe('not_reachable')
    expect(plan.hasUnknownCost).toBe(true)
  })

  it('marks unparseable measure costs without dropping the measure', () => {
    const plan = planToC({
      current_rating: 'D', sap_score: 60,
      improvements: [m(1, 5, null, 72)],
    })
    expect(plan.status).toBe('plan')
    expect(plan.hasUnknownCost).toBe(true)
    expect(plan.costLo).toBe(0)
  })

  it('classifies from the SAP score when the band is missing', () => {
    const plan = planToC({ current_rating: null, sap_score: 50, improvements: [m(1, 5, 100, 70)] })
    expect(plan.status).toBe('plan')
  })

  it('reports no_data when neither band nor score exists', () => {
    expect(planToC({ current_rating: null, sap_score: null, improvements: [] }).status).toBe('no_data')
  })

  it('treats every band below C as needing work', () => {
    expect([...BELOW_C].sort()).toEqual(['D', 'E', 'F', 'G'])
  })
})
