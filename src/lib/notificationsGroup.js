// Groups a notification list by type for the bell panel, newest group first,
// so 20 compliance reminders read as one heading with a count rather than a
// wall. Pure; the panel does the rendering.
export const TYPE_LABEL = {
  autopilot: 'Autopilot', compliance_expired: 'Certificates expired', compliance_expiring: 'Certificates expiring',
  mortgage_expiring: 'Mortgage products ending', trial: 'Trial', backup: 'Backups', rent: 'Rent received',
  statement_received: 'Statements received',
}
export function typeLabel(type) {
  if (TYPE_LABEL[type]) return TYPE_LABEL[type]
  return String(type || 'other').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}
export function groupNotifications(items = []) {
  const map = new Map()
  for (const n of items) {
    const t = n.type || 'other'
    if (!map.has(t)) map.set(t, { type: t, label: typeLabel(t), items: [], unread: 0, newest: n.created_at || '' })
    const g = map.get(t)
    g.items.push(n)
    if (!n.read_at) g.unread++
    if ((n.created_at || '') > g.newest) g.newest = n.created_at
  }
  return [...map.values()].sort((a, b) => String(b.newest).localeCompare(String(a.newest)))
}
