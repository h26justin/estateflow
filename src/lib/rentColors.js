// Rent status colour pairs for the month grid (moved verbatim from App.jsx).
import { statusColors } from './styles'

// AA text/tint pair for a rent status — the month grid renders the label in
// the status TEXT colour on the status TINT (the old raw-hue fill with white
// text sat at ~1.8:1 on paid-green). STL/pending keep their purple identity
// via a matching hand-tuned pair (purple isn't in the shared STATUS set).
export const STL_PAIR = { light: { text:'#6E44B8', bg:'#F0EAFB' }, dark: { text:'#B89BEF', bg:'#241A38' } }
// A short-term-let booking whose stay has not finished yet: recorded, not yet
// income (see 2026-09-07_stl_pending_until_stayed.sql). Same hue, lighter.
export const STL_PENDING_PAIR = { light: { text:'#8F73CF', bg:'#F8F5FD' }, dark: { text:'#9C86D4', bg:'#1B1529' } }
export function rentStatusPair(status, darkMode) {
  if (status === 'pending') return darkMode ? STL_PAIR.dark : STL_PAIR.light
  const key = { paid:'ok', overdue:'bad', missed:'bad', late:'warn', partial:'warn', refurb:'info' }[status] || 'void'
  return statusColors(key, darkMode)
}

// Traffic-light pair for an engine state (Stage 3). Legacy months keep the
// old status colours; short-term lets keep purple; grey is shared with void.
export function enginePair(m, darkMode) {
  if (!m) return null
  if (m.state === 'stl') return darkMode ? STL_PAIR.dark : STL_PAIR.light
  if (m.state === 'legacy') return rentStatusPair(m.evals?.[0]?.legacyStatus || 'void', darkMode)
  const key = { paid:'ok', due:'warn', part_paid:'warn', missed:'bad', not_collectible:'void', pending_review:'info' }[m.state] || 'void'
  return statusColors(key, darkMode)
}

// Short-term-let revenue keeps its own colour so STL and long-term income
// read differently at a glance even though both are status 'paid'.
export const STL_COLOR = '#9B6FDE'
