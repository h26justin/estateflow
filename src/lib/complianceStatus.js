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

// Status of ONE cert type for a property: the matrix-cell classifier. Shared so
// the portfolio matrix and any future surface can't diverge from this logic.
// Returns { state: 'missing' | 'expired' | 'expiring' | 'valid', days? }.
export function certTypeStatus(property, certType) {
  const items = (property?.compliance_items || []).filter(c => !c.deleted_at && c.cert_type === certType && c.expiry_date)
  if (!items.length) return { state: 'missing' }
  const latest = items.reduce((a, b) => new Date(b.expiry_date).getTime() > new Date(a.expiry_date).getTime() ? b : a)
  const days = daysUntilDate(latest.expiry_date)
  if (days === null) return { state: 'missing' }
  if (days <= 0) return { state: 'expired', days }      // expired today counts as expired
  if (days <= SOON_DAYS) return { state: 'expiring', days }
  return { state: 'valid', days }
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
