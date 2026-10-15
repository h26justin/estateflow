// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  scopeCompanies, companyIsLive, buildWeeklySummary, weeklySummaryEmail, weeklySummarySubject,
  weekStartFor, escapeHtml,
} from '../weeklySummary'
import { bundleWeeklySummary, OUT } from '../../../scripts/build-weekly-summary.mjs'

const NOW = new Date('2026-10-19T07:00:00Z')
const AS_OF = '2026-10-19' // a Monday

function prop(id, over = {}) {
  return {
    id, name: `Flat ${id}`, company_id: 'c1', company: { name: 'Acme Lets' },
    status: 'rented', rent_pcm: 1000, rent_due_day: 1,
    rent_payments: [], tenancies: [], rent_receipts: [], non_chargeable_periods: [], rent_overrides: [], stl_bookings: [],
    ...over,
  }
}
const ownerCo = (over = {}) => ({ id: 'c1', name: 'Acme Lets', owner_id: 'u1', is_free_tier: true, ...over })

describe('weekStartFor', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartFor('2026-10-19')).toBe('2026-10-19')
    expect(weekStartFor('2026-10-25')).toBe('2026-10-19')
    expect(weekStartFor('2026-10-20')).toBe('2026-10-19')
    expect(weekStartFor('2026-11-01')).toBe('2026-10-26')
  })
})

describe('companyIsLive / scopeCompanies', () => {
  it('mirrors company_is_live', () => {
    expect(companyIsLive({ id: 'a', is_free_tier: true }, [], NOW)).toBe(true)
    expect(companyIsLive({ id: 'a', trial_ends_at: '2026-10-20T00:00:00Z' }, [], NOW)).toBe(true)
    expect(companyIsLive({ id: 'a', trial_ends_at: '2026-10-01T00:00:00Z' }, [], NOW)).toBe(false)
    expect(companyIsLive({ id: 'a' }, [{ company_id: 'a', status: 'past_due' }], NOW)).toBe(true)
    expect(companyIsLive({ id: 'a' }, [{ company_id: 'a', status: 'canceled' }], NOW)).toBe(false)
    expect(companyIsLive({ id: 'a' }, [{ company_id: 'b', status: 'active' }], NOW)).toBe(false)
    expect(companyIsLive({ id: 'a', is_free_tier: true, deleted_at: '2026-10-01' }, [], NOW)).toBe(false)
    // A bare 'trialing' row (checkout opened, never paid) is not live; one backed by Stripe is.
    expect(companyIsLive({ id: 'a' }, [{ company_id: 'a', status: 'trialing' }], NOW)).toBe(false)
    expect(companyIsLive({ id: 'a' }, [{ company_id: 'a', status: 'trialing', stripe_subscription_id: 'sub_1' }], NOW)).toBe(true)
  })

  it('keeps only owned or granted, live companies', () => {
    const companies = [
      ownerCo(),
      { id: 'c2', name: 'Shared', owner_id: 'u9', is_free_tier: true },
      { id: 'c3', name: 'Stranger', owner_id: 'u9', is_free_tier: true },
      { id: 'c4', name: 'Lapsed', owner_id: 'u1' },
      { id: 'c5', name: 'Email invite only', owner_id: 'u9', is_free_tier: true },
    ]
    const access = [
      { company_id: 'c2', user_id: 'u1', role: 'viewer' },
      { company_id: 'c3', user_id: 'u2', role: 'admin' },
      { company_id: 'c5', user_id: null, email: 'me@example.com', role: 'admin' },
    ]
    const out = scopeCompanies({ userId: 'u1', companies, access, subscriptions: [], now: NOW })
    expect(out.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(out[0].perms.view_rent).toBe(true)
    expect(out[1].perms.view_tenant_personal).toBe(false)
    expect(scopeCompanies({ userId: null, companies, access, now: NOW })).toEqual([])
  })

  it('honours a per-user permission override', () => {
    const out = scopeCompanies({
      userId: 'u1', now: NOW,
      companies: [{ id: 'c2', owner_id: 'u9', is_free_tier: true }],
      access: [{ company_id: 'c2', user_id: 'u1', role: 'editor', permissions: { view_rent: false } }],
    })
    expect(out[0].perms.view_rent).toBe(false)
  })
})

describe('buildWeeklySummary', () => {
  const companies = scopeCompanies({ userId: 'u1', companies: [ownerCo()], now: NOW })

  it('never includes a property outside the scoped companies', () => {
    const m = buildWeeklySummary({ asOf: AS_OF, companies, properties: [prop('a'), prop('x', { company_id: 'other', status: 'vacant' })] })
    expect(m.properties).toBe(1)
    expect(m.vacancy.vacant).toBe(0)
    expect(JSON.stringify(m)).not.toContain('Flat x')
  })

  it('works out rent due last week, month to date and arrears', () => {
    const p = prop('a', {
      rent_due_day: 14,
      rent_payments: [
        { id: 'sep', year: 2026, month: 9, status: 'unpaid', amount: null },
        { id: 'oct', year: 2026, month: 10, status: 'paid', amount: 400 },
      ],
    })
    const m = buildWeeklySummary({ asOf: AS_OF, companies, properties: [p] })
    expect(m.weekStart).toBe('2026-10-19')
    expect(m.lastWeek).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(m.rent.lastWeek).toEqual({ expected: 1000, received: 400 })
    expect(m.rent.monthToDate).toEqual({ expected: 1000, received: 400 })
    // September is missed in full; October's balance is still inside its
    // payment window (due 14th + 5 days), so it is not arrears yet.
    expect(m.rent.arrears.total).toBe(1000)
    expect(m.rent.arrears.top).toEqual([{ id: 'a', name: 'Flat a', company: 'Acme Lets', amount: 1000 }])
  })

  it('lists compliance due within 30 days on the latest certificate only', () => {
    const items = [
      { id: 1, property_id: 'a', cert_type: 'gas', expiry_date: '2026-10-01' },          // superseded
      { id: 2, property_id: 'a', cert_type: 'gas_safety', expiry_date: '2026-11-05' },   // due in 17 days
      { id: 3, property_id: 'a', cert_type: 'eicr', expiry_date: '2026-10-10' },         // overdue
      { id: 4, property_id: 'a', cert_type: 'epc', expiry_date: '2027-06-01' },          // fine
      { id: 5, property_id: 'a', cert_type: 'pat', expiry_date: '2026-10-20', deleted_at: '2026-10-02' },
      { id: 6, property_id: 'x', cert_type: 'eicr', expiry_date: '2026-10-10' },         // out of scope
      { id: 7, property_id: 'a', cert_type: 'smoke_alarm', issue_date: '2025-11-01' },   // check due 1 Nov
    ]
    const m = buildWeeklySummary({ asOf: AS_OF, companies, properties: [prop('a')], complianceItems: items })
    expect(m.compliance.overdue.map(c => [c.label, c.days])).toEqual([['Electrical Safety (EICR)', -9]])
    expect(m.compliance.dueSoon.map(c => [c.label, c.date])).toEqual([['Smoke alarms', '2026-11-01'], ['Gas Safety (CP12)', '2026-11-05']])
  })

  it('lists tenancies ending in the next 60 days and counts empty properties', () => {
    const props = [
      prop('a', { tenancies: [{ id: 't1', tenancy_start: '2025-01-01', tenancy_end: '2026-12-01', status: 'active', rent_amount: 1000 }] }),
      prop('b', { status: 'notice_given', tenancy_end: '2026-11-10' }),
      prop('c', { tenancies: [{ id: 't2', tenancy_start: '2025-01-01', tenancy_end: '2027-06-01', status: 'active', rent_amount: 1000 }] }),
      prop('d', { status: 'vacant' }),
      prop('e', { status: 'on_rental_market' }),
      prop('f', { status: 'sold' }),
    ]
    const m = buildWeeklySummary({ asOf: AS_OF, companies, properties: props })
    expect(m.tenancies.map(t => [t.property, t.date, t.notice])).toEqual([['Flat b', '2026-11-10', true], ['Flat a', '2026-12-01', false]])
    expect(m.vacancy).toEqual({ vacant: 1, onMarket: 1 })
    expect(m.properties).toBe(5)
  })

  it('hides sections the role cannot see', () => {
    const viewer = scopeCompanies({
      userId: 'u1', now: NOW, companies: [{ id: 'c1', owner_id: 'u9', is_free_tier: true }],
      access: [{ company_id: 'c1', user_id: 'u1', role: 'viewer', permissions: { view_rent: false, view_compliance: false } }],
    })
    const m = buildWeeklySummary({ asOf: AS_OF, companies: viewer, properties: [prop('a')] })
    expect(m.rent).toBeNull()
    expect(m.compliance).toBeNull()
    expect(m.tenancies).toEqual([])
  })
})

describe('weeklySummaryEmail', () => {
  const companies = scopeCompanies({ userId: 'u1', companies: [ownerCo()], now: NOW })

  it('escapes user data in the HTML and links to preferences', () => {
    const p = prop('a', { name: '<img src=x onerror=alert(1)> & Co', rent_payments: [{ id: 'sep', year: 2026, month: 9, status: 'unpaid' }] })
    const m = buildWeeklySummary({ asOf: AS_OF, companies, properties: [p] })
    const { html, text, subject } = weeklySummaryEmail(m, { appUrl: 'https://app.example/', firstName: '"Jo"<b>' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; Co')
    expect(html).toContain('&quot;Jo&quot;&lt;b&gt;')
    expect(html).toContain('https://app.example/#/settings/notifications')
    expect(text).toContain('https://app.example/#/settings/notifications')
    expect(text).toContain('Arrears: £1,000 across 1 property')
    expect(subject).toBe('Your week in property, 19 Oct: £1,000 in arrears')
  })

  it('says all clear when there is nothing to flag', () => {
    const m = buildWeeklySummary({ asOf: AS_OF, companies, properties: [prop('a', { status: 'vacant' })] })
    expect(weeklySummarySubject(m, { preview: true })).toBe('[Preview] Your week in property, 19 Oct: all clear')
  })

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('weekly-summary edge function bundle', () => {
  it('is up to date with src/lib (run node scripts/build-weekly-summary.mjs)', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await bundleWeeklySummary())
  })
})
