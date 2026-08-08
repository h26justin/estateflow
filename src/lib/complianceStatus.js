// Compliance status helper for property cards / lists.
//
// Returns one of: 'expired' | 'expiring' | 'missing' | 'ok'
// plus a count of items in the worst state, so callers can show a
// badge like "2 expired" / "1 expiring" / "add certs".
//
// Decision tree:
//   - Any compliance_item with expiry_date < today               → expired
//   - Any compliance_item with expiry_date within 60 days        → expiring
//   - Zero non-deleted compliance_items on a rented property     → missing
//   - Otherwise                                                  → ok

import { CATALOGUE_BY_KEY, canonicalCertType, requirementsForProperty, isOptedOut } from './complianceCatalogue'

// The "expiring soon" window (days). Exported so every compliance surface
// (cards, matrix, dashboard alerts, reports) shares one threshold rather than
// re-hardcoding 60 and silently drifting.
export const SOON_DAYS = 60

// Days until a date (whole days; negative = past). null for missing/invalid.
export function daysUntilDate(dateStr) {
  if (!dateStr) return null
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

const addMonths = (dateStr, months) => {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

const classifyDays = (days) => {
  if (days <= 0) return { state: 'expired', days }      // expired today counts as expired
  if (days <= SOON_DAYS) return { state: 'expiring', days }
  return { state: 'valid', days }
}

// The date a compliance_items row is judged on. Usually expiry_date; for
// check-date requirements (smoke/CO alarms — the row records when it was
// last checked, not when it "expires") we derive a due date from issue_date
// plus the requirement's cycle, so an old check goes red instead of the row
// counting as missing forever.
function effectiveExpiry(item, req) {
  if (item.expiry_date) return item.expiry_date
  if (req?.isCheck && req.cycleMonths && item.issue_date) return addMonths(item.issue_date, req.cycleMonths)
  return null
}

// Status of ONE cert type for a property: the matrix-cell classifier. Shared so
// the portfolio matrix and any future surface can't diverge from this logic.
// Alias-aware: 'gas' rows satisfy a 'gas_safety' query and vice versa.
// Returns { state: 'missing' | 'expired' | 'expiring' | 'valid', days? }.
export function certTypeStatus(property, certType) {
  const key = canonicalCertType(certType)
  const req = CATALOGUE_BY_KEY[key] || { key }
  const items = (property?.compliance_items || []).filter(c => !c.deleted_at && canonicalCertType(c.cert_type) === key)
  if (!items.length) return { state: 'missing' }
  const dates = items.map(c => effectiveExpiry(c, req)).filter(Boolean)
  if (!dates.length) {
    // Rows exist but carry no usable date — paperwork that doesn't expire
    // (tenancy agreement, deposit certificate) counts as held; dated
    // requirements without a date still read as missing.
    return req.expiryOptional ? { state: 'valid', days: null } : { state: 'missing' }
  }
  const latest = dates.reduce((a, b) => new Date(b).getTime() > new Date(a).getTime() ? b : a)
  const days = daysUntilDate(latest)
  if (days === null) return { state: 'missing' }
  return classifyDays(days)
}

// Insurance status for a property, from the insurance_policies register.
// A policy covers a property when it belongs to the same company AND either
// links to the property explicitly or has no property links (= company-wide).
// Policies superseded by a renewal (another policy's previous_policy_id)
// are ignored so an old expired year doesn't drag a renewed property red.
export function insuranceStatusFor(property, policies) {
  const all = policies || []
  const superseded = new Set(all.map(p => p.previous_policy_id).filter(Boolean))
  const covering = all.filter(pol => {
    if (superseded.has(pol.id)) return false
    if (pol.company_id !== property?.company_id) return false
    const links = pol.properties || []
    return links.length === 0 || links.some(l => l.id === property.id)
  })
  const dates = covering.map(p => p.expiry_date).filter(Boolean)
  if (!dates.length) return { state: 'missing' }
  const latest = dates.reduce((a, b) => new Date(b).getTime() > new Date(a).getTime() ? b : a)
  const days = daysUntilDate(latest)
  if (days === null) return { state: 'missing' }
  return classifyDays(days)
}

// Status of one catalogue requirement for a property — routes insurance to
// the policy register, everything else to compliance_items.
export function requirementStatus(property, req, policies) {
  if (req.group === 'insurance') return insuranceStatusFor(property, policies)
  return certTypeStatus(property, req.key)
}

// Full rollup for an overview card: every tracked+applicable requirement
// with its status, plus summary counts. `held` counts valid + expiring
// (still in date today), so a score like "7/9 held" reads naturally.
// Requirements the landlord has switched off for this property come back
// with state 'off' — rendered dimmed by callers, excluded from every count.
export function propertyComplianceSummary(property, companySettings, policies) {
  const reqs = requirementsForProperty(property, companySettings)
  const rows = reqs.map(req => ({
    req,
    status: isOptedOut(property, req.key) ? { state: 'off' } : requirementStatus(property, req, policies),
  }))
  let held = 0, expired = 0, expiring = 0, missing = 0, off = 0
  for (const r of rows) {
    if (r.status.state === 'off') off++
    else if (r.status.state === 'valid') held++
    else if (r.status.state === 'expiring') { held++; expiring++ }
    else if (r.status.state === 'expired') expired++
    else missing++
  }
  return { rows, total: rows.length - off, held, expired, expiring, missing, off }
}

export function complianceStatusFor(property) {
  if (!property) return { state: 'ok', count: 0 }
  const items = (property.compliance_items || []).filter(c => !c.deleted_at)
  const now = Date.now()
  const soonCutoff = now + SOON_DAYS * 86_400_000

  let expired = 0
  let expiring = 0
  for (const c of items) {
    if (!c.expiry_date) continue
    const t = new Date(c.expiry_date).getTime()
    if (Number.isNaN(t)) continue
    if (t < now) expired++
    else if (t < soonCutoff) expiring++
  }

  if (expired > 0)  return { state: 'expired',  count: expired }
  if (expiring > 0) return { state: 'expiring', count: expiring }

  // Only flag "missing" for rented properties — unoccupied / sold /
  // refurb properties don't need active compliance.
  if (items.length === 0 && property.status === 'rented') {
    return { state: 'missing', count: 0 }
  }

  return { state: 'ok', count: 0 }
}

// Returns the right colour + label for a status. Caller picks the layout.
export function complianceBadge(status, T) {
  switch (status.state) {
    case 'expired':
      return { color: T.red, bg: T.red + '22', iconName: 'alert-triangle', label: `${status.count} expired` }
    case 'expiring':
      return { color: T.amber, bg: T.amber + '22', iconName: 'alert-circle', label: `${status.count} expiring` }
    case 'missing':
      return { color: T.muted, bg: T.bg, iconName: 'file-text', label: 'Add certs' }
    default:
      return null
  }
}
