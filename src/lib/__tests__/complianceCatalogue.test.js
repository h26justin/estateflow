import { describe, it, expect } from 'vitest'
import {
  COMPLIANCE_CATALOGUE,
  CATALOGUE_BY_KEY,
  canonicalCertType,
  trackedRequirements,
  requirementsForProperty,
  canOptOut,
  isOptedOut,
  epcBand,
  epcNeedsUpgrade,
  epcBelowLegalMinimum,
} from '../complianceCatalogue'
import {
  certTypeStatus,
  insuranceStatusFor,
  propertyComplianceSummary,
  prsReadiness,
  itemPredatesTenancy,
} from '../complianceStatus'

const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString()
const cert = (cert_type, expiry_date, extra = {}) => ({ cert_type, expiry_date, ...extra })

describe('canonicalCertType', () => {
  it('maps legacy aliases onto canonical keys', () => {
    expect(canonicalCertType('gas')).toBe('gas_safety')
    expect(canonicalCertType('gas_cert')).toBe('gas_safety')
    expect(canonicalCertType('alarm')).toBe('smoke_alarm')
    expect(canonicalCertType('hmo_licence')).toBe('hmo')
  })
  it('passes canonical and unknown types through unchanged', () => {
    expect(canonicalCertType('eicr')).toBe('eicr')
    expect(canonicalCertType('my_custom_cert')).toBe('my_custom_cert')
    expect(canonicalCertType('')).toBe('')
  })
})

describe('alias-aware certTypeStatus', () => {
  it("a legacy 'gas' row satisfies a 'gas_safety' query and vice versa", () => {
    const p = { compliance_items: [cert('gas', inDays(200))] }
    expect(certTypeStatus(p, 'gas_safety').state).toBe('valid')
    const p2 = { compliance_items: [cert('gas_safety', inDays(200))] }
    expect(certTypeStatus(p2, 'gas').state).toBe('valid')
  })
  it('derives a due date for check-date items from issue_date + cycle', () => {
    // Smoke alarm checked 2 months ago, 12-month cycle → valid, due in ~10mo
    const recent = { compliance_items: [cert('smoke_alarm', null, { issue_date: inDays(-60) })] }
    expect(certTypeStatus(recent, 'smoke_alarm').state).toBe('valid')
    // Checked 13 months ago → overdue
    const stale = { compliance_items: [cert('smoke_alarm', null, { issue_date: inDays(-400) })] }
    expect(certTypeStatus(stale, 'smoke_alarm').state).toBe('expired')
  })
  it('treats undated rows as held for expiry-optional paperwork only', () => {
    const p = { compliance_items: [cert('deposit_protection', null), cert('eicr', null)] }
    expect(certTypeStatus(p, 'deposit_protection').state).toBe('valid')
    expect(certTypeStatus(p, 'eicr').state).toBe('missing')
  })
})

describe('applicability rules', () => {
  const settings = {} // all tracked (default)
  it('skips gas certs for properties without a gas supply', () => {
    const gasFree = { status: 'rented', has_gas_supply: false, heating_type: 'electric' }
    const keys = requirementsForProperty(gasFree, settings).map(r => r.key)
    expect(keys).not.toContain('gas_safety')
    expect(keys).not.toContain('co_alarm')
    expect(keys).toContain('eicr')
    expect(keys).toContain('epc')
  })
  it('defaults to requiring gas certs when flags are unset (legacy rows)', () => {
    const keys = requirementsForProperty({ status: 'rented' }, settings).map(r => r.key)
    expect(keys).toContain('gas_safety')
  })
  it('adds licence + fire paperwork for HMOs', () => {
    const hmo = { status: 'rented', is_hmo: true }
    const keys = requirementsForProperty(hmo, settings).map(r => r.key)
    expect(keys).toEqual(expect.arrayContaining(['hmo', 'fire', 'fire_alarm_service', 'emergency_lighting']))
    const nonHmo = requirementsForProperty({ status: 'rented' }, settings).map(r => r.key)
    expect(nonHmo).not.toContain('hmo')
  })
  it('adds the selective licence only in selective areas', () => {
    const sel = requirementsForProperty({ status: 'rented', licensing_scheme: 'selective' }, settings).map(r => r.key)
    expect(sel).toContain('selective_licence')
  })
  it('drops tenancy paperwork for non-let properties', () => {
    const vacant = requirementsForProperty({ status: 'vacant' }, settings).map(r => r.key)
    expect(vacant).not.toContain('deposit_protection')
    expect(vacant).not.toContain('tenancy_agreement')
    const let_ = requirementsForProperty({ status: 'rented' }, settings).map(r => r.key)
    expect(let_).toEqual(expect.arrayContaining(['deposit_protection', 'tenancy_agreement', 'right_to_rent', 'rra_info_sheet']))
  })
})

describe('trackedRequirements', () => {
  it('tracks everything by default and honours explicit off-switches', () => {
    expect(trackedRequirements({}).length).toBe(COMPLIANCE_CATALOGUE.length)
    expect(trackedRequirements(null).length).toBe(COMPLIANCE_CATALOGUE.length)
    const keys = trackedRequirements({ compliance_tracked: { pat: false, inventory: false } }).map(r => r.key)
    expect(keys).not.toContain('pat')
    expect(keys).not.toContain('inventory')
    expect(keys).toContain('gas_safety')
  })
})

describe('insuranceStatusFor', () => {
  const prop = { id: 'p1', company_id: 'c1' }
  it('is missing with no covering policies', () => {
    expect(insuranceStatusFor(prop, []).state).toBe('missing')
    // Other company's policy doesn't cover it
    expect(insuranceStatusFor(prop, [{ id: 'x', company_id: 'c2', expiry_date: inDays(200), properties: [] }]).state).toBe('missing')
  })
  it('company-wide policies (no property links) cover every property', () => {
    const r = insuranceStatusFor(prop, [{ id: 'x', company_id: 'c1', expiry_date: inDays(200), properties: [] }])
    expect(r.state).toBe('valid')
  })
  it('property-linked policies cover only their properties', () => {
    const pol = { id: 'x', company_id: 'c1', expiry_date: inDays(200), properties: [{ id: 'p2' }] }
    expect(insuranceStatusFor(prop, [pol]).state).toBe('missing')
    expect(insuranceStatusFor({ id: 'p2', company_id: 'c1' }, [pol]).state).toBe('valid')
  })
  it('ignores superseded policies in a renewal chain', () => {
    const old = { id: 'old', company_id: 'c1', expiry_date: inDays(-30), properties: [] }
    const renewed = { id: 'new', company_id: 'c1', expiry_date: inDays(300), previous_policy_id: 'old', properties: [] }
    expect(insuranceStatusFor(prop, [old, renewed]).state).toBe('valid')
  })
})

describe('propertyComplianceSummary', () => {
  it('rolls up held / expired / missing across the applicable set', () => {
    const p = {
      id: 'p1', company_id: 'c1', status: 'rented', has_gas_supply: false, heating_type: 'electric',
      compliance_items: [cert('eicr', inDays(300)), cert('epc', inDays(-10))],
    }
    // Track a small set so the assertion is stable as the catalogue grows.
    const settings = { compliance_tracked: Object.fromEntries(
      COMPLIANCE_CATALOGUE.map(r => [r.key, ['eicr', 'epc', 'gas_safety', 'insurance'].includes(r.key)])
    ) }
    const s = propertyComplianceSummary(p, settings, [])
    // gas is n/a (no gas supply) → eicr valid, epc expired, insurance missing
    expect(s.total).toBe(3)
    expect(s.held).toBe(1)
    expect(s.expired).toBe(1)
    expect(s.missing).toBe(1)
  })
})

describe('per-property opt-outs', () => {
  it('tier 1 legal requirements cannot be opted out; tier 2/3 can', () => {
    expect(canOptOut(CATALOGUE_BY_KEY.gas_safety)).toBe(false)
    expect(canOptOut(CATALOGUE_BY_KEY.eicr)).toBe(false)
    expect(canOptOut(CATALOGUE_BY_KEY.legionella)).toBe(true)
    expect(canOptOut(CATALOGUE_BY_KEY.pat)).toBe(true)
  })
  it('isOptedOut reads properties.compliance_optout with safe defaults', () => {
    expect(isOptedOut({ compliance_optout: { pat: true } }, 'pat')).toBe(true)
    expect(isOptedOut({ compliance_optout: { pat: true } }, 'legionella')).toBe(false)
    expect(isOptedOut({}, 'pat')).toBe(false)
    expect(isOptedOut(null, 'pat')).toBe(false)
  })
  it('opted-out requirements come back as dimmed rows, excluded from counts', () => {
    const p = {
      id: 'p1', company_id: 'c1', status: 'rented', has_gas_supply: false, heating_type: 'electric',
      compliance_optout: { pat: true },
      compliance_items: [cert('eicr', inDays(300))],
    }
    const settings = { compliance_tracked: Object.fromEntries(
      COMPLIANCE_CATALOGUE.map(r => [r.key, ['eicr', 'pat'].includes(r.key)])
    ) }
    const s = propertyComplianceSummary(p, settings, [])
    const patRow = s.rows.find(r => r.req.key === 'pat')
    expect(patRow.status.state).toBe('off')
    expect(s.off).toBe(1)
    expect(s.total).toBe(1)     // only eicr counts
    expect(s.held).toBe(1)
    expect(s.missing).toBe(0)   // pat no longer reads as missing
  })
})

describe('EPC / MEES helpers', () => {
  it('normalises the register-synced band and rejects junk', () => {
    expect(epcBand({ epc_rating: 'd' })).toBe('D')
    expect(epcBand({ epc_rating: ' C ' })).toBe('C')
    expect(epcBand({ epc_rating: 'X' })).toBe(null)
    expect(epcBand({})).toBe(null)
    expect(epcBand(null)).toBe(null)
  })
  it('flags bands below C as needing upgrade', () => {
    expect(epcNeedsUpgrade('D')).toBe(true)
    expect(epcNeedsUpgrade('G')).toBe(true)
    expect(epcNeedsUpgrade('C')).toBe(false)
    expect(epcNeedsUpgrade('A')).toBe(false)
    expect(epcNeedsUpgrade(null)).toBe(false)
  })
  it('flags only F and G as below the current legal minimum (E)', () => {
    expect(epcBelowLegalMinimum('F')).toBe(true)
    expect(epcBelowLegalMinimum('G')).toBe(true)
    expect(epcBelowLegalMinimum('E')).toBe(false)
    expect(epcBelowLegalMinimum('D')).toBe(false)
    expect(epcBelowLegalMinimum(null)).toBe(false)
  })
})

describe('prsReadiness', () => {
  it('is null for non-let properties', () => {
    expect(prsReadiness({ status: 'vacant' })).toBe(null)
    expect(prsReadiness({ status: 'sold' })).toBe(null)
  })
  it('ready when the statutory set is in date', () => {
    const p = {
      status: 'rented', has_gas_supply: false, heating_type: 'electric', epc_rating: 'C',
      compliance_items: [cert('eicr', inDays(300)), cert('epc', inDays(500))],
    }
    const r = prsReadiness(p)
    expect(r.ready).toBe(true)
    expect(r.gaps).toEqual([])
  })
  it('lists gaps for missing/expired statutory items and sub-E bands', () => {
    const p = {
      status: 'rented', is_hmo: true, epc_rating: 'F',
      compliance_items: [cert('gas_safety', inDays(-5)), cert('epc', inDays(500))],
    }
    const r = prsReadiness(p)
    expect(r.ready).toBe(false)
    expect(r.gaps).toEqual(expect.arrayContaining([
      'Gas Safety (CP12) expired',
      'EICR missing',
      'HMO licence missing',
      'EPC band F — below the legal minimum E',
    ]))
  })
  it('ignores per-property opt-outs — the law does too', () => {
    const p = { status: 'rented', is_hmo: true, compliance_optout: { hmo: true }, compliance_items: [] }
    const r = prsReadiness(p)
    expect(r.gaps).toEqual(expect.arrayContaining(['HMO licence missing']))
  })
})

describe('itemPredatesTenancy', () => {
  it('compares issue_date (or created_at fallback) against tenancy start', () => {
    expect(itemPredatesTenancy({ issue_date: '2025-01-01' }, '2026-01-01')).toBe(true)
    expect(itemPredatesTenancy({ issue_date: '2026-06-01' }, '2026-01-01')).toBe(false)
    expect(itemPredatesTenancy({ created_at: '2025-12-31T10:00:00Z' }, '2026-01-01')).toBe(true)
    expect(itemPredatesTenancy({}, '2026-01-01')).toBe(false)
    expect(itemPredatesTenancy({ issue_date: '2025-01-01' }, null)).toBe(false)
  })
})

describe('catalogue integrity', () => {
  it('keys are unique and aliases never collide with keys', () => {
    const keys = COMPLIANCE_CATALOGUE.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    const aliases = COMPLIANCE_CATALOGUE.flatMap(r => r.aliases || [])
    for (const a of aliases) expect(CATALOGUE_BY_KEY[a]).toBeUndefined()
  })
})
