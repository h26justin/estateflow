import { describe, it, expect } from 'vitest'
import {
  SOON_DAYS,
  daysUntilDate,
  certTypeStatus,
  complianceStatusFor,
  complianceBadge,
} from '../complianceStatus'

// Build an ISO date `n` days from now (negative = past).
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString()
const cert = (cert_type, expiry_date, extra = {}) => ({ cert_type, expiry_date, ...extra })

describe('daysUntilDate', () => {
  it('returns null for missing/invalid dates', () => {
    expect(daysUntilDate(null)).toBe(null)
    expect(daysUntilDate('')).toBe(null)
    expect(daysUntilDate('not-a-date')).toBe(null)
  })
  it('is positive for the future, negative for the past', () => {
    expect(daysUntilDate(inDays(30))).toBeGreaterThan(28)
    expect(daysUntilDate(inDays(-10))).toBeLessThan(0)
  })
})

describe('certTypeStatus', () => {
  const prop = (items) => ({ compliance_items: items })

  it('is "missing" when there is no cert of that type', () => {
    expect(certTypeStatus(prop([]), 'gas').state).toBe('missing')
    expect(certTypeStatus(prop([cert('eicr', inDays(100))]), 'gas').state).toBe('missing')
    expect(certTypeStatus(null, 'gas').state).toBe('missing')
  })

  it('classifies valid / expiring / expired by the SOON_DAYS window', () => {
    expect(certTypeStatus(prop([cert('gas', inDays(200))]), 'gas').state).toBe('valid')
    expect(certTypeStatus(prop([cert('gas', inDays(30))]), 'gas').state).toBe('expiring')
    expect(certTypeStatus(prop([cert('gas', inDays(-5))]), 'gas').state).toBe('expired')
  })

  it('treats a cert expiring earlier today as expired, not "0d expiring" (audit fix)', () => {
    // expiry a few seconds ago → days rounds to 0 → must be expired
    const justExpired = new Date(Date.now() - 5000).toISOString()
    expect(certTypeStatus(prop([cert('gas', justExpired)]), 'gas').state).toBe('expired')
  })

  it('honours the SOON_DAYS boundary', () => {
    expect(certTypeStatus(prop([cert('gas', inDays(SOON_DAYS - 1))]), 'gas').state).toBe('expiring')
    expect(certTypeStatus(prop([cert('gas', inDays(SOON_DAYS + 5))]), 'gas').state).toBe('valid')
  })

  it('uses the latest expiry when several certs of the type exist', () => {
    const r = certTypeStatus(prop([cert('gas', inDays(-10)), cert('gas', inDays(200))]), 'gas')
    expect(r.state).toBe('valid')
  })

  it('ignores deleted certs and certs without an expiry', () => {
    expect(certTypeStatus(prop([cert('gas', inDays(30), { deleted_at: '2020-01-01' })]), 'gas').state).toBe('missing')
    expect(certTypeStatus(prop([cert('gas', null)]), 'gas').state).toBe('missing')
  })
})

describe('complianceStatusFor', () => {
  it('returns ok for a null property', () => {
    expect(complianceStatusFor(null).state).toBe('ok')
  })
  it('prioritises expired over expiring', () => {
    const r = complianceStatusFor({ status: 'rented', compliance_items: [cert('gas', inDays(-1)), cert('eicr', inDays(10))] })
    expect(r.state).toBe('expired')
    expect(r.count).toBe(1)
  })
  it('reports expiring when nothing is expired', () => {
    expect(complianceStatusFor({ compliance_items: [cert('gas', inDays(10))] }).state).toBe('expiring')
  })
  it('flags missing only for rented properties with no certs', () => {
    expect(complianceStatusFor({ status: 'rented', compliance_items: [] }).state).toBe('missing')
    expect(complianceStatusFor({ status: 'vacant', compliance_items: [] }).state).toBe('ok')
  })
})

describe('complianceBadge', () => {
  const T = { red: '#f00', amber: '#fa0', muted: '#888', bg: '#fff' }
  it('returns a hairline iconName and no legacy emoji icon field', () => {
    const b = complianceBadge({ state: 'expired', count: 2 }, T)
    expect(b.iconName).toBe('alert-triangle')
    expect(b.icon).toBeUndefined()
    expect(b.label).toBe('2 expired')
  })
  it('maps each state, and returns null for ok', () => {
    expect(complianceBadge({ state: 'expiring', count: 1 }, T).iconName).toBe('alert-circle')
    expect(complianceBadge({ state: 'missing', count: 0 }, T).iconName).toBe('file-text')
    expect(complianceBadge({ state: 'ok', count: 0 }, T)).toBe(null)
  })
})
