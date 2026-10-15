import { useTheme } from '../../lib/ThemeContext'
import { statusPill } from '../../lib/styles'

export const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
}

export function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000*60*60*24))
}

export function ExpiryBadge({dateStr}) {
  // Theme-aware RAG pill via the redesign STATUS system (was hardcoded
  // dark-mode backgrounds that rendered wrong in light mode).
  const { darkMode } = useTheme()
  const days = daysUntil(dateStr)
  const pill = (key, txt) => <span style={{...statusPill(key, darkMode), fontSize:10}}>{txt}</span>
  if (days === null) return pill('void', 'No expiry set')
  if (days < 0)   return pill('bad',  `Expired ${Math.abs(days)}d ago`)
  if (days <= 30) return pill('warn', `Expires in ${days}d`)
  if (days <= 90) return pill('warn', `${days}d remaining`)
  return pill('ok', `${days}d remaining`)
}
