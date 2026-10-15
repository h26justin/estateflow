// Weekly portfolio summary: the Monday-morning email a landlord opts into
// with Settings > Notifications > Weekly Summary
// (user_profiles.notifications.weekly_summary).
//
// Pure functions, no React, no Supabase. The weekly-summary edge function
// loads one user's data with the service role and calls these, bundled into
// supabase-functions/weekly-summary/summary.bundle.js by
// scripts/build-weekly-summary.mjs, so the rent figures come from the same
// rent engine as the Rent Tracker.
//
// Tenant scoping is the caller's job for the query, and this module's job for
// the content: scopeCompanies() keeps only companies the user owns or has a
// user_company_access row for, that are live (company_is_live), and records
// the user's effective permissions there. buildWeeklySummary() then drops any
// property outside those companies and shows each section only for the
// companies whose role allows it (view_rent, view_compliance, view_tenancies).
// No tenant names, notes, values or mortgage figures are ever included.

import { evaluateProperty, arrearsSummary, monthBounds, addDays, STATE, GO_LIVE } from './rentEngine'
import { getEffectivePermissions } from './api/roles'
import { CATALOGUE_BY_KEY, canonicalCertType } from './complianceCatalogue'
import { subscriptionGrantsLive } from './subscriptionLive'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const RATED = [STATE.PAID, STATE.DUE, STATE.PART_PAID, STATE.MISSED]
// Properties that are not (or no longer) part of the letting portfolio.
const OUT_OF_PORTFOLIO = ['sold', 'purchased']

export const COMPLIANCE_DAYS = 30
export const TENANCY_DAYS = 60
export const TOP_ARREARS = 5
export const LIST_LIMIT = 8

// ── Dates (ISO yyyy-mm-dd, UTC arithmetic) ──────────────────────────────────
function toUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
export function daysFrom(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000) }
// Monday of the week containing `iso` (weeks run Monday to Sunday).
export function weekStartFor(iso) {
  const dow = new Date(toUTC(iso)).getUTCDay() // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7))
}
export function dateLong(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
export function dateShort(iso) {
  if (!iso) return ''
  const [, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`
}
export const money0 = n => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB')

// Mirrors public.company_is_live (as hardened in
// 2026-10-15_billing_trialing_guard.sql) without the developer /
// platform-admin bypass, which does not apply to an email: live while a
// subscription grants it (subscriptionGrantsLive: active / past_due, or
// trialing backed by Stripe), the company is free tier, or its in-app trial
// has not ended.
export function companyIsLive(company, subscriptions = [], now = new Date()) {
  if (!company || company.deleted_at) return false
  if (company.is_free_tier === true) return true
  if ((subscriptions || []).some(s => s.company_id === company.id && subscriptionGrantsLive(s, now))) return true
  const end = company.trial_ends_at ? new Date(company.trial_ends_at).getTime() : 0
  return end > now.getTime()
}

// The companies this user may see in the email, each with the user's
// effective permissions there. Owner = companies.owner_id; collaborator = a
// user_company_access row keyed on this user's id (pending email-only
// invitations do not count). Anything not live is left out.
export function scopeCompanies({ userId, companies = [], access = [], subscriptions = [], now = new Date() }) {
  if (!userId) return []
  const uid = String(userId)
  const out = []
  for (const c of companies || []) {
    if (!c?.id || c.deleted_at) continue
    const isOwner = String(c.owner_id || '') === uid
    const row = isOwner ? null : (access || []).find(a => a.company_id === c.id && String(a.user_id || '') === uid)
    if (!isOwner && !row) continue
    if (!companyIsLive(c, subscriptions, now)) continue
    out.push({ id: c.id, name: c.name || 'Company', isOwner, perms: getEffectivePermissions(row, isOwner) })
  }
  return out
}

// The date a compliance row is judged on: its expiry, or for check-type
// requirements (smoke / CO alarms) the issue date plus the cycle. Same rule
// as complianceStatus.js effectiveExpiry().
function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = total % 12 + 1
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`
}
function effectiveExpiry(item, req) {
  if (item.expiry_date) return String(item.expiry_date).slice(0, 10)
  if (req?.isCheck && req.cycleMonths && item.issue_date) return addMonthsIso(String(item.issue_date).slice(0, 10), req.cycleMonths)
  return null
}

// The period counts as collected in full when the tracker shows it Paid
// without the money recorded (paid with no amount, or overridden to Paid), so
// the email never contradicts the Rent Tracker tiles (agentReport.js rule).
const collectedOf = e => (e.state === STATE.PAID && (e.received || 0) < e.expected ? e.expected : Math.min(e.received || 0, e.expected))

function rentSection(properties, { asOf, lastWeek, monthFrom }) {
  const out = {
    lastWeek: { expected: 0, received: 0 },
    monthToDate: { expected: 0, received: 0 },
    arrears: { total: 0, missed: 0, historic: 0, count: 0, top: [] },
  }
  const owing = []
  for (const p of properties) {
    if (p.status === 'short_term_let') continue // reported as STL income, not rent
    const evals = evaluateProperty(p, { today: asOf })
    let missed = 0
    for (const e of evals) {
      if (!RATED.includes(e.state) || e.expected == null || !e.dueDate) continue
      if (e.dueDate >= lastWeek.from && e.dueDate <= lastWeek.to) {
        out.lastWeek.expected = round2(out.lastWeek.expected + e.expected)
        out.lastWeek.received = round2(out.lastWeek.received + collectedOf(e))
      }
      if (e.dueDate >= monthFrom && e.dueDate <= asOf) {
        out.monthToDate.expected = round2(out.monthToDate.expected + e.expected)
        out.monthToDate.received = round2(out.monthToDate.received + collectedOf(e))
      }
      if (e.state === STATE.MISSED && e.outstanding > 0) missed = round2(missed + e.outstanding)
    }
    const historic = Math.max(0, arrearsSummary(p).balance)
    const owed = round2(missed + historic)
    out.arrears.missed = round2(out.arrears.missed + missed)
    out.arrears.historic = round2(out.arrears.historic + historic)
    if (owed > 0.005) owing.push({ id: p.id, name: p.name || 'Property', company: p.company?.name || null, amount: owed })
  }
  owing.sort((a, b) => b.amount - a.amount || String(a.name).localeCompare(String(b.name)))
  out.arrears.total = round2(out.arrears.missed + out.arrears.historic)
  out.arrears.count = owing.length
  out.arrears.top = owing.slice(0, TOP_ARREARS)
  return out
}

function complianceSection(properties, items, { asOf }) {
  const byProp = new Map(properties.map(p => [p.id, p]))
  // Latest date per property + certificate type: a renewed certificate
  // supersedes the old one, so an expired predecessor is not reported.
  const latest = new Map()
  for (const it of items || []) {
    if (!it || it.deleted_at) continue
    const p = byProp.get(it.property_id)
    if (!p) continue
    const key = canonicalCertType(it.cert_type)
    if ((p.compliance_optout || {})[key] === true) continue
    const req = CATALOGUE_BY_KEY[key]
    const date = effectiveExpiry(it, req)
    if (!date) continue
    const k = `${p.id}|${key}`
    const cur = latest.get(k)
    if (!cur || date > cur.date) latest.set(k, { propertyId: p.id, property: p.name || 'Property', label: req?.label || it.cert_name || String(it.cert_type || 'Certificate'), date })
  }
  const horizon = addDays(asOf, COMPLIANCE_DAYS)
  const overdue = [], dueSoon = []
  for (const x of latest.values()) {
    if (x.date > horizon) continue
    const days = daysFrom(asOf, x.date)
    if (days < 0) overdue.push({ ...x, days })
    else dueSoon.push({ ...x, days })
  }
  const order = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.property).localeCompare(String(b.property)))
  overdue.sort(order); dueSoon.sort(order)
  return { overdue, dueSoon, total: overdue.length + dueSoon.length }
}

function tenancySection(properties, { asOf }) {
  const horizon = addDays(asOf, TENANCY_DAYS)
  const out = []
  for (const p of properties) {
    if (p.status === 'short_term_let') continue
    const live = (p.tenancies || []).filter(t => t.status !== 'ended')
    let ends = live.map(t => ({ date: String(t.expected_move_out || t.tenancy_end || '').slice(0, 10), notice: !!t.notice_received_date || t.status === 'notice_given' }))
    // Before any tenancy is recorded, fall back to the property's own field.
    if (!(p.tenancies || []).length && ['rented', 'notice_given'].includes(p.status) && p.tenancy_end) {
      ends = [{ date: String(p.tenancy_end).slice(0, 10), notice: p.status === 'notice_given' }]
    }
    const next = ends.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= asOf && x.date <= horizon).sort((a, b) => (a.date < b.date ? -1 : 1))[0]
    if (next) out.push({ propertyId: p.id, property: p.name || 'Property', date: next.date, days: daysFrom(asOf, next.date), notice: next.notice || p.status === 'notice_given' })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.property).localeCompare(String(b.property))))
}

// The email model for one user. `properties` are fetchProperties-shaped rows
// (rent_payments, tenancies, rent_receipts, non_chargeable_periods,
// rent_overrides, stl_bookings joined); `companies` is scopeCompanies()
// output; `complianceItems` are compliance_items rows.
export function buildWeeklySummary({ properties = [], companies = [], complianceItems = [], asOf }) {
  if (!asOf) throw new Error('asOf is required')
  const weekStart = weekStartFor(asOf)
  const lastWeek = { from: addDays(weekStart, -7), to: addDays(weekStart, -1) }
  const [ay, am] = asOf.split('-').map(Number)
  const monthFrom = monthBounds(ay, am).start < GO_LIVE ? GO_LIVE : monthBounds(ay, am).start

  const coById = new Map(companies.map(c => [c.id, c]))
  // Hard scope: a property outside the user's live companies never enters.
  const inScope = (properties || []).filter(p => p && coById.has(p.company_id) && !p.deleted_at && !p.archived_at && !OUT_OF_PORTFOLIO.includes(p.status))
  const can = key => p => !!coById.get(p.company_id)?.perms?.[key]
  const viewable = inScope.filter(can('view_properties'))
  const rentProps = viewable.filter(can('view_rent'))
  const compProps = viewable.filter(can('view_compliance'))
  const tenProps = viewable.filter(can('view_tenancies'))

  return {
    asOf, weekStart, lastWeek, monthFrom, monthName: MONTHS[am - 1],
    companies: companies.length,
    properties: viewable.length,
    vacancy: {
      vacant: viewable.filter(p => p.status === 'vacant').length,
      onMarket: viewable.filter(p => p.status === 'on_rental_market').length,
    },
    rent: rentProps.length ? rentSection(rentProps, { asOf, lastWeek, monthFrom }) : null,
    compliance: compProps.length ? complianceSection(compProps, complianceItems, { asOf }) : null,
    tenancies: tenProps.length ? tenancySection(tenProps, { asOf }) : null,
  }
}

// ── Email ────────────────────────────────────────────────────────────────────
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// Strip line breaks from anything that goes into a header-ish line.
const oneLine = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim()
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const dueIn = d => (d < 0 ? `${plural(-d, 'day')} overdue` : d === 0 ? 'due today' : `in ${plural(d, 'day')}`)

export function weeklySummarySubject(model, { preview = false } = {}) {
  const bits = []
  if (model.rent && model.rent.arrears.total > 0.005) bits.push(`${money0(model.rent.arrears.total)} in arrears`)
  if (model.compliance && model.compliance.total) bits.push(`${plural(model.compliance.total, 'certificate')} due`)
  if (model.tenancies && model.tenancies.length) bits.push(`${plural(model.tenancies.length, 'tenancy', 'tenancies')} ending`)
  const head = bits.length ? bits.join(', ') : 'all clear'
  return `${preview ? '[Preview] ' : ''}Your week in property, ${dateShort(model.weekStart)}: ${head}`
}

// { subject, html, text } for one model. appUrl is the app origin, no slash.
export function weeklySummaryEmail(model, { appUrl = 'https://www.ownproperly.com', firstName = '', preview = false } = {}) {
  const app = String(appUrl).replace(/\/+$/, '')
  const links = {
    app: `${app}/#/dashboard`,
    rent: `${app}/#/rent`,
    compliance: `${app}/#/compliance`,
    prefs: `${app}/#/settings/notifications`,
  }
  const subject = weeklySummarySubject(model, { preview })
  const name = oneLine(firstName)
  const rent = model.rent, comp = model.compliance, ten = model.tenancies
  const T = []
  const H = []

  // Plain text.
  T.push(`Hi ${name || 'there'},`, '', `Your portfolio for the week starting ${dateLong(model.weekStart)} (${plural(model.properties, 'property', 'properties')} across ${plural(model.companies, 'company', 'companies')}).`, '')
  if (rent) {
    T.push('RENT')
    T.push(`- Due last week (${dateShort(model.lastWeek.from)} to ${dateShort(model.lastWeek.to)}): ${money0(rent.lastWeek.expected)} expected, ${money0(rent.lastWeek.received)} received`)
    T.push(`- ${model.monthName} to date: ${money0(rent.monthToDate.expected)} expected, ${money0(rent.monthToDate.received)} received`)
    if (rent.arrears.total > 0.005) {
      T.push(`- Arrears: ${money0(rent.arrears.total)} across ${plural(rent.arrears.count, 'property', 'properties')}`)
      for (const a of rent.arrears.top) T.push(`    ${oneLine(a.name)}: ${money0(a.amount)}`)
    } else T.push('- Arrears: none')
    T.push('')
  }
  if (comp) {
    T.push(`COMPLIANCE (next ${COMPLIANCE_DAYS} days)`)
    if (!comp.total) T.push('- Nothing expiring')
    for (const c of [...comp.overdue, ...comp.dueSoon].slice(0, LIST_LIMIT)) T.push(`- ${oneLine(c.property)}: ${oneLine(c.label)}, ${dueIn(c.days)} (${dateShort(c.date)})`)
    if (comp.total > LIST_LIMIT) T.push(`- and ${comp.total - LIST_LIMIT} more`)
    T.push('')
  }
  if (ten) {
    T.push(`TENANCIES ENDING (next ${TENANCY_DAYS} days)`)
    if (!ten.length) T.push('- None')
    for (const t of ten.slice(0, LIST_LIMIT)) T.push(`- ${oneLine(t.property)}: ${dateLong(t.date)}${t.notice ? ' (notice given)' : ''}`)
    if (ten.length > LIST_LIMIT) T.push(`- and ${ten.length - LIST_LIMIT} more`)
    T.push('')
  }
  T.push('EMPTY PROPERTIES')
  T.push(`- ${model.vacancy.vacant} vacant, ${model.vacancy.onMarket} on the rental market`, '')
  T.push(`Open Properly: ${links.app}`, '')
  T.push('You get this every Monday because Weekly Summary is switched on.')
  T.push(`Turn it off or change your email preferences: ${links.prefs}`)
  const text = T.join('\n') + '\n'

  // HTML.
  const C = { ink: '#1A2530', muted: '#5A6A7A', faint: '#9CA3AF', panel: '#F4F3EF', bad: '#B8392D', warn: '#8A5600', ok: '#1F9D63', link: '#2D6FA8' }
  const stat = (label, value, sub = '') => `<td style="padding:12px 14px;background:${C.panel};border-radius:8px;width:33%;vertical-align:top"><div style="font-size:10px;color:${C.muted};text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(label)}</div><div style="font-size:18px;font-weight:700;color:${C.ink};margin-top:3px">${escapeHtml(value)}</div>${sub ? `<div style="font-size:12px;color:${C.muted};margin-top:2px">${escapeHtml(sub)}</div>` : ''}</td>`
  const h3 = (title, href) => `<p style="margin:22px 0 8px;font-weight:700;font-size:14px;color:${C.ink}">${escapeHtml(title)}${href ? ` <a href="${escapeHtml(href)}" style="font-weight:400;font-size:12px;color:${C.link}">Open</a>` : ''}</p>`
  const row = (left, right, tone = C.ink) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E5E3DC;font-size:14px;color:${C.ink}">${left}</td><td style="padding:6px 0 6px 10px;border-bottom:1px solid #E5E3DC;font-size:14px;color:${tone};text-align:right;white-space:nowrap">${right}</td></tr>`
  const table = rows => `<table style="width:100%;border-collapse:collapse">${rows}</table>`
  const note = s => `<p style="margin:0;font-size:14px;color:${C.muted}">${escapeHtml(s)}</p>`

  H.push(`<div style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;padding:28px 22px;color:${C.ink}">`)
  H.push(`<div style="text-align:center;margin-bottom:22px"><img src="https://www.ownproperly.com/brand/email-lockup.png" alt="Properly" style="height:36px;width:auto"/></div>`)
  H.push(`<h2 style="margin:0 0 6px;font-size:20px">Your week in property</h2>`)
  H.push(`<p style="margin:0 0 18px;color:${C.muted};font-size:14px">Hi ${escapeHtml(name || 'there')}. Week starting ${escapeHtml(dateLong(model.weekStart))} &middot; ${escapeHtml(plural(model.properties, 'property', 'properties'))} across ${escapeHtml(plural(model.companies, 'company', 'companies'))}</p>`)
  if (rent) {
    H.push(`<table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px 4px"><tr>`)
    H.push(stat('Due last week', money0(rent.lastWeek.expected), `${money0(rent.lastWeek.received)} received`))
    H.push(stat(`${model.monthName} to date`, money0(rent.monthToDate.expected), `${money0(rent.monthToDate.received)} received`))
    H.push(stat('Arrears', money0(rent.arrears.total), rent.arrears.count ? plural(rent.arrears.count, 'property', 'properties') : 'none'))
    H.push(`</tr></table>`)
    if (rent.arrears.top.length) {
      H.push(h3('Largest arrears', links.rent))
      H.push(table(rent.arrears.top.map(a => row(escapeHtml(a.name), escapeHtml(money0(a.amount)), C.bad)).join('')))
    }
  }
  if (comp) {
    H.push(h3(`Compliance due in the next ${COMPLIANCE_DAYS} days`, links.compliance))
    if (!comp.total) H.push(note('Nothing expiring. Every recorded certificate is in date.'))
    else {
      const list = [...comp.overdue, ...comp.dueSoon].slice(0, LIST_LIMIT)
      H.push(table(list.map(c => row(`${escapeHtml(c.property)}<br/><span style="font-size:12px;color:${C.muted}">${escapeHtml(c.label)}</span>`, escapeHtml(dueIn(c.days)), c.days < 0 ? C.bad : C.warn)).join('')))
      if (comp.total > LIST_LIMIT) H.push(`<p style="margin:6px 0 0;font-size:12px;color:${C.muted}">and ${comp.total - LIST_LIMIT} more</p>`)
    }
  }
  if (ten) {
    H.push(h3(`Tenancies ending in the next ${TENANCY_DAYS} days`))
    if (!ten.length) H.push(note('None.'))
    else {
      H.push(table(ten.slice(0, LIST_LIMIT).map(t => row(`${escapeHtml(t.property)}${t.notice ? `<br/><span style="font-size:12px;color:${C.muted}">Notice given</span>` : ''}`, escapeHtml(dateLong(t.date)), C.warn)).join('')))
      if (ten.length > LIST_LIMIT) H.push(`<p style="margin:6px 0 0;font-size:12px;color:${C.muted}">and ${ten.length - LIST_LIMIT} more</p>`)
    }
  }
  H.push(h3('Empty properties'))
  H.push(note(`${model.vacancy.vacant} vacant, ${model.vacancy.onMarket} on the rental market.`))
  H.push(`<p style="margin:26px 0 0;text-align:center"><a href="${escapeHtml(links.app)}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px">Open Properly</a></p>`)
  H.push(`<p style="margin:26px 0 0;color:${C.faint};font-size:11px;line-height:1.6;text-align:center">You get this every Monday because Weekly Summary is switched on in your Properly settings.<br/><a href="${escapeHtml(links.prefs)}" style="color:${C.faint}">Turn it off or manage email preferences</a></p>`)
  H.push(`</div>`)
  return { subject, html: H.join('\n'), text }
}
