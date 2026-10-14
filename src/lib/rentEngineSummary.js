// Rent-engine month counts for the Rent Tracker overview (moved verbatim
// from App.jsx).
import { evaluateProperty, groupByMonth } from './rentEngine'

// Month counts and money received for a set of properties, from the rent
// engine (Stage 3+). Short-term lets are excluded (own page). Pre-2026 months
// keep their legacy status and amount but are counted so "All years" still
// adds up.
export function engineSummary(props, year) {
  const acc = { paid: 0, due: 0, missed: 0, nc: 0, backfill: 0, legacy: 0, received: 0 }
  for (const p of props) {
    if (p.status === 'short_term_let') continue
    const months = groupByMonth(evaluateProperty(p)).filter(m => (!year || m.year === year) && m.state !== 'future')
    for (const m of months) {
      if (m.state === 'legacy') {
        acc.legacy++
        const ls = m.evals[0]?.legacyStatus
        if (ls === 'paid') acc.paid++
        else if (ls === 'overdue' || ls === 'missed') acc.missed++
        else if (ls === 'late' || ls === 'partial') acc.due++
        acc.received += m.evals.reduce((t, e) => t + (e.legacyAmount || 0), 0)
        continue
      }
      if (m.state === 'paid') acc.paid++
      else if (m.state === 'due' || m.state === 'part_paid') acc.due++
      else if (m.state === 'missed') acc.missed++
      else if (m.state === 'pending_review') acc.review = (acc.review || 0) + 1
      else if (m.state === 'not_collectible') acc.nc++
      if (m.needsBackfill) acc.backfill++
      acc.received += m.received || 0
    }
  }
  acc.received = Math.round(acc.received * 100) / 100
  return acc
}
