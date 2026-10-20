import { describe, it, expect } from 'vitest'
import {
  portfolioHealth, portfolioHealthFor, healthBand, legalComplianceGaps,
  isInRefurb, refurbSummary, balancedColumns, CAP_EXPIRED_LEGAL, CAP_EXPIRED,
  complianceGaps, complianceSummariesFor,
} from '../dashboardKpis'

const row = (tier, state, key = 'x') => ({ req: { key, tier }, status: { state } })
const summary = rows => ({ rows })
const daysFromNow = d => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

describe('legalComplianceGaps', () => {
  it('counts only tier 1-2 expired and missing rows', () => {
    const s = summary([row(1, 'expired'), row(2, 'missing'), row(3, 'missing'), row(1, 'valid'), row(1, 'off'), row(1, 'expiring')])
    expect(legalComplianceGaps(s)).toEqual({ expired: 1, missing: 1 })
    expect(legalComplianceGaps(null)).toEqual({ expired: 0, missing: 0 })
  })
})

describe('portfolioHealth', () => {
  it('is good standing when every property is clean', () => {
    const h = portfolioHealth([
      { property: {}, baseScore: 97, compliance: summary([row(1, 'valid')]) },
      { property: {}, baseScore: 93, compliance: summary([row(1, 'valid'), row(3, 'missing')]) },
    ])
    expect(h.score).toBe(95)
    expect(h.band).toBe('good')
    expect(h.reasons).toEqual([])
  })

  it('can never read good standing with an expired legal certificate', () => {
    // The reported case: high per-property scores, but expired / missing
    // certs on the compliance card.
    const props = Array.from({ length: 6 }, (_, i) => ({
      property: {}, baseScore: 95,
      compliance: summary(i === 0 ? [row(1, 'expired', 'eicr')] : [row(1, 'valid')]),
    }))
    const h = portfolioHealth(props)
    expect(h.score).toBeLessThan(80)
    expect(h.band).not.toBe('good')
    expect(h.reasons[0]).toMatch(/1 expired legal item/)
  })

  it('caps a property with an expired legal cert below the attention band', () => {
    const h = portfolioHealth([{ property: {}, baseScore: 100, compliance: summary([row(1, 'expired')]) }])
    expect(h.score).toBeLessThanOrEqual(CAP_EXPIRED_LEGAL)
    expect(h.band).toBe('action')
  })

  it('needs action when most properties have expired legal items', () => {
    const props = Array.from({ length: 4 }, (_, i) => ({
      property: {}, baseScore: 100,
      compliance: summary(i < 2 ? [row(1, 'expired')] : [row(1, 'valid')]),
    }))
    expect(portfolioHealth(props).band).toBe('action')
  })

  it('missing legal items and arrears also stop good standing', () => {
    expect(portfolioHealth([{ property: {}, baseScore: 100, compliance: summary([row(1, 'missing')]) }]).band).not.toBe('good')
    const arrears = portfolioHealth([
      { property: { arrears: 1850 }, baseScore: 100, compliance: summary([]) },
      { property: { arrears: 0 }, baseScore: 100, compliance: summary([]) },
    ])
    expect(arrears.band).toBe('attention')
    expect(arrears.reasons).toEqual(['1 property in arrears'])
  })

  it('more gaps cost more points', () => {
    const one = portfolioHealth([{ property: {}, baseScore: 100, compliance: summary([row(1, 'missing')]) }])
    const many = portfolioHealth([{ property: {}, baseScore: 100, compliance: summary(Array.from({ length: 8 }, () => row(1, 'missing'))) }])
    expect(many.score).toBeLessThan(one.score)
  })

  it('an expired item at any tier stops good standing, like the compliance card', () => {
    // The Portfolio Compliance card goes red on s.expired (every tier); the
    // ring used to count only tier 1-2, so it read "95 Good standing" beside it.
    const props = Array.from({ length: 6 }, (_, i) => ({
      property: {}, baseScore: 95,
      compliance: summary(i === 0 ? [row(1, 'valid'), row(3, 'expired', 'insurance')] : [row(1, 'valid')]),
    }))
    const h = portfolioHealth(props)
    expect(h.band).not.toBe('good')
    expect(h.score).toBeLessThan(80)
    expect(h.counts).toMatchObject({ expired: 1, expiredLegal: 0, expiredOther: 1 })
    expect(h.reasons).toEqual(['1 other expired item'])
  })

  it('legal expiries still cost more than other expiries', () => {
    const legal = portfolioHealth([{ property: {}, baseScore: 100, compliance: summary([row(1, 'expired')]) }])
    const other = portfolioHealth([{ property: {}, baseScore: 100, compliance: summary([row(3, 'expired')]) }])
    expect(other.score).toBeLessThanOrEqual(CAP_EXPIRED)
    expect(other.band).toBe('attention')
    expect(legal.score).toBeLessThan(other.score)
    expect(legal.band).toBe('action')
    // A majority of properties with non-legal expiries alone isn't "action"
    const props = Array.from({ length: 4 }, (_, i) => ({
      property: {}, baseScore: 100,
      compliance: summary(i < 2 ? [row(3, 'expired')] : [row(1, 'valid')]),
    }))
    expect(portfolioHealth(props).band).toBe('attention')
  })

  it('handles an empty portfolio', () => {
    expect(portfolioHealth([]).band).toBe('good')
  })
})

describe('portfolioHealthFor', () => {
  it('uses the real compliance rollup: a let property with an expired gas cert is not good standing', () => {
    const p = {
      id: 'p1', company_id: 'c1', status: 'rented', prop_type: 'Terraced house',
      compliance_items: [{ cert_type: 'gas_safety', expiry_date: daysFromNow(-10) }],
    }
    const h = portfolioHealthFor([p], { baseScoreFor: () => 95 })
    expect(h.counts.expiredLegal).toBeGreaterThanOrEqual(1)
    expect(h.band).not.toBe('good')
  })

  it('reuses precomputed summaries and agrees with the card rollup', () => {
    const live = { id: 'p1', status: 'rented' }
    const sold = { id: 'p2', status: 'sold' }
    const summaries = new Map([[live, summary([row(3, 'expired')])]])
    const h = portfolioHealthFor([live, sold], { baseScoreFor: () => 95, summaries })
    expect(h.counts.expired).toBe(1)
    expect(h.band).not.toBe('good')
  })
})

describe('complianceSummariesFor', () => {
  it('rolls up tracked properties only, keyed by the property row', () => {
    const settings = { c1: {} }
    const let1 = { id: 'p1', company_id: 'c1', status: 'rented', prop_type: 'Terraced house',
      compliance_items: [{ cert_type: 'gas_safety', expiry_date: daysFromNow(-10) }] }
    const sold = { id: 'p2', company_id: 'c1', status: 'sold' }
    const archived = { id: 'p3', company_id: 'c1', status: 'rented', archived_at: '2026-01-01' }
    const m = complianceSummariesFor([let1, sold, archived], settings, [])
    expect([...m.keys()]).toEqual([let1])
    expect(m.get(let1).expired).toBeGreaterThanOrEqual(1)
    // Same result as computing inline
    expect(portfolioHealthFor([let1], { summaries: m }).counts)
      .toEqual(portfolioHealthFor([let1], { settingsFor: () => ({}), policies: [] }).counts)
  })
})

describe('complianceGaps', () => {
  it('counts expired rows at every tier, legal share separately', () => {
    const s = summary([row(1, 'expired'), row(3, 'expired'), row(2, 'missing'), row(3, 'missing'), row(1, 'off')])
    expect(complianceGaps(s)).toEqual({ expired: 2, expiredLegal: 1, expiredOther: 1, missingLegal: 1 })
  })
})

describe('healthBand', () => {
  it('maps thresholds', () => {
    expect(healthBand(80)).toBe('good')
    expect(healthBand(79)).toBe('attention')
    expect(healthBand(59)).toBe('action')
  })
})

describe('refurb KPI', () => {
  it('counts property status, the refurb_status mirror and live projects', () => {
    expect(isInRefurb({ status: 'refurb' })).toBe(true)
    expect(isInRefurb({ status: 'vacant', refurb_status: 'in-progress' })).toBe(true)
    expect(isInRefurb({ status: 'vacant', refurb_projects: [{ stage: 'snagging' }] })).toBe(true)
    expect(isInRefurb({ status: 'vacant', refurb_projects: [{ stage: 'in_progress', deleted_at: '2026-01-01' }] })).toBe(false)
    expect(isInRefurb({ status: 'rented', refurb_status: 'complete' })).toBe(false)
  })

  it('summarises properties and active projects like the Refurbs page', () => {
    const s = refurbSummary([
      { status: 'refurb', refurb_projects: [{ stage: 'in_progress' }] },
      { status: 'rented', refurb_projects: [{ stage: 'planned' }], refurb_status: 'planned' },
      { status: 'rented', refurb_projects: [{ stage: 'complete' }], refurb_status: 'complete' },
    ])
    expect(s.count).toBe(1)
    expect(s.activeProjects).toBe(2)
    expect(s.planned).toBe(1)
    expect(s.completed).toBe(1)
  })
})

describe('balancedColumns', () => {
  it('evens out rows instead of leaving a short last row', () => {
    expect(balancedColumns(8, 1200)).toBe(4)   // 5 fit → 4 + 4
    expect(balancedColumns(9, 1200)).toBe(5)   // 5 + 4
    expect(balancedColumns(6, 1200)).toBe(3)   // 3 + 3
    expect(balancedColumns(5, 1200)).toBe(5)
  })

  it('drops to one column at phone widths', () => {
    expect(balancedColumns(8, 358)).toBe(1)
    expect(balancedColumns(0, 358)).toBe(1)
  })
})
