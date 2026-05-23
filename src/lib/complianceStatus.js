// Compliance status helper for property cards / lists.
//
// Returns one of: 'expired' | 'expiring' | 'missing' | 'ok'
// plus a count of items in the worst state, so callers can show a
// badge like "⚠ 2 expired" / "⏰ 1 expiring" / "📋 add certs".
//
// Decision tree:
//   - Any compliance_item with expiry_date < today               → expired
//   - Any compliance_item with expiry_date within 60 days        → expiring
//   - Zero non-deleted compliance_items on a rented property     → missing
//   - Otherwise                                                  → ok

const SOON_DAYS = 60

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
      return { color: T.red, bg: T.red + '22', icon: '⚠', label: `${status.count} expired` }
    case 'expiring':
      return { color: T.amber, bg: T.amber + '22', icon: '⏰', label: `${status.count} expiring` }
    case 'missing':
      return { color: T.muted, bg: T.bg, icon: '📋', label: 'Add certs' }
    default:
      return null
  }
}
