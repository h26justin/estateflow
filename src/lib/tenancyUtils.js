// Tenancy helpers — pure functions shared by the tenancy panel, the seed-from-
// property backfill and (from Stage 3) the traffic-light month logic.

export const TENANCY_STATUSES = [
  { v: 'rented',        l: 'Rented' },
  { v: 'notice_given',  l: 'Notice Given' },
  { v: 'vacant',        l: 'Vacant' },
  { v: 'refurbishment', l: 'Refurbishment' },
  { v: 'ended',         l: 'Ended' },
]
export const PAYMENT_SOURCES = [
  { v: 'tenant',            l: 'Tenant' },
  { v: 'housing_benefit',   l: 'Housing Benefit' },
  { v: 'universal_credit',  l: 'Universal Credit' },
  { v: 'mixed',             l: 'Mixed: tenant plus government assistance' },
  { v: 'other',             l: 'Other' },
]
export const RENT_FREQUENCIES = [
  { v: 'monthly',     l: 'Monthly' },
  { v: 'four_weekly', l: 'Every 4 weeks' },
  { v: 'fortnightly', l: 'Fortnightly' },
  { v: 'weekly',      l: 'Weekly' },
  { v: 'quarterly',   l: 'Quarterly' },
]
export const BENEFIT_FREQUENCIES = [
  { v: 'weekly',      l: 'Weekly' },
  { v: 'fortnightly', l: 'Fortnightly' },
  { v: 'four_weekly', l: 'Every 4 weeks' },
  { v: 'monthly',     l: 'Monthly' },
]
export const DEFAULT_PAYMENT_WINDOW_DAYS = 5

export function usesBenefit(paymentSource) {
  return paymentSource === 'housing_benefit' || paymentSource === 'universal_credit' || paymentSource === 'mixed'
}

// "28th" → 28, "1st" → 1, "12" → 12, "" → null. Anything outside 1..31 → null.
export function parseDueDay(v) {
  if (v == null) return null
  const m = String(v).match(/(\d{1,2})/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 31 ? n : null
}

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

// Accepts the free-text date shapes found on properties.tenancy_end today:
// "2026-09-17", "31st March 2026", "12 Dec 2025", "1 April 2027", "April 2030"
// (→ first of the month). Returns ISO yyyy-mm-dd or null. "Monthly Rolling",
// "" and other non-dates return null — the caller decides what that means.
export function parseLooseDate(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return isoIfValid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return isoIfValid(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})$/)
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (mon >= 0) return isoIfValid(+m[3], mon + 1, +m[1])
  }
  m = s.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (m) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mon >= 0) return isoIfValid(+m[2], mon + 1, 1)
  }
  return null
}

function isoIfValid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function isPeriodicText(v) {
  return /rolling|periodic|monthly/i.test(String(v || ''))
}

// Map a property's current status to a tenancy status for the seed.
export function tenancyStatusFromProperty(propertyStatus) {
  if (propertyStatus === 'notice_given') return 'notice_given'
  if (propertyStatus === 'vacant') return 'vacant'
  if (propertyStatus === 'refurb') return 'refurbishment'
  return 'rented'
}

// Build a DRAFT tenancy from the free-text fields on a property. Nothing here
// is authoritative: every draft is flagged needs_confirmation for a human.
// `goLive` is the earliest start we assume when the property has no tenant_since.
export function tenancyDraftFromProperty(p, { goLive = '2026-01-01', today = new Date() } = {}) {
  if (!p) return null
  const endIso = parseLooseDate(p.tenancy_end)
  const todayIso = today.toISOString().slice(0, 10)
  const notes = []
  if (p.tenancy_end && !endIso) notes.push(`Property tenancy end read "${p.tenancy_end}" (not a date; treated as periodic).`)
  if (endIso && endIso < todayIso) notes.push(`Property tenancy end ${endIso} is in the past; likely a historic fixed term. Confirm the current end.`)
  if (!p.tenant_since) notes.push(`No tenancy start on the property; assumed ${goLive} (go-live). Confirm.`)
  return {
    property_id: p.id,
    company_id: p.company_id || null,
    tenant_name: p.tenant_name || null,
    tenancy_start: p.tenant_since || goLive,
    tenancy_end: endIso && endIso >= todayIso ? endIso : null,
    rent_amount: p.rent_pcm != null && Number(p.rent_pcm) > 0 ? Number(p.rent_pcm) : null,
    rent_frequency: 'monthly',
    rent_due_day: parseDueDay(p.rent_due_day),
    payment_window_days: DEFAULT_PAYMENT_WINDOW_DAYS,
    status: tenancyStatusFromProperty(p.status),
    payment_source: 'tenant',
    opening_arrears: Number(p.arrears) > 0 ? Number(p.arrears) : 0,
    opening_arrears_date: Number(p.arrears) > 0 ? todayIso : null,
    needs_confirmation: true,
    notes: notes.length ? notes.join(' ') : null,
  }
}

// Properties that should carry a tenancy record for the tracker to work.
export function propertyNeedsTenancy(status) {
  return status === 'rented' || status === 'notice_given' || status === 'let_agreed'
}

// Benefit + tenant contributions compared with the full rent. Returns
// { ok, diff, message } where message is null when everything ties.
export function benefitSplitCheck(t) {
  if (!t || !usesBenefit(t.payment_source)) return { ok: true, diff: 0, message: null }
  const rent = Number(t.rent_amount) || 0
  const b = Number(t.benefit_contribution) || 0
  const c = Number(t.tenant_contribution) || 0
  if (!rent) return { ok: true, diff: 0, message: null }
  if (t.payment_source !== 'mixed' && !b && !c) return { ok: true, diff: 0, message: null }
  const diff = Math.round((b + c - rent) * 100) / 100
  if (Math.abs(diff) < 0.005) return { ok: true, diff: 0, message: null }
  return {
    ok: false,
    diff,
    message: diff > 0
      ? `Contributions exceed the rent by £${diff.toFixed(2)}.`
      : `Contributions fall short of the rent by £${Math.abs(diff).toFixed(2)}.`,
  }
}

// Is a tenancy live on a given ISO date?
export function tenancyCoversDate(t, iso) {
  if (!t?.tenancy_start) return false
  if (iso < t.tenancy_start) return false
  const end = t.tenancy_end || t.expected_move_out || null
  return !end || iso <= end
}

// The tenancy covering a date, if any (latest start wins on the rare overlap).
export function tenancyForDate(tenancies, iso) {
  const hits = (tenancies || []).filter(t => tenancyCoversDate(t, iso))
  hits.sort((a, b) => (a.tenancy_start < b.tenancy_start ? 1 : -1))
  return hits[0] || null
}

export function currentTenancy(tenancies, today = new Date()) {
  const iso = today.toISOString().slice(0, 10)
  return tenancyForDate(tenancies, iso)
    || (tenancies || []).filter(t => t.status !== 'ended').sort((a, b) => (a.tenancy_start < b.tenancy_start ? 1 : -1))[0]
    || null
}

// Sum of allocations on a receipt versus its amount.
export function allocationBalance(receipt, allocations) {
  const total = (allocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const diff = Math.round(((Number(receipt?.amount) || 0) - total) * 100) / 100
  return { allocated: total, unallocated: diff, balanced: Math.abs(diff) < 0.005 }
}
