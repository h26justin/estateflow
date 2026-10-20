import { memo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import { MONO, FS, R } from '../../lib/styles'
import { normalizeHex, readableOr } from '../../lib/contrast'

// Property-status hues. Five statuses map straight onto redesign theme
// tokens (T.green / gold / red / amber / blue / purple), so badges follow
// light/dark mode. Three have no token — notice given (orange: still let, but
// a vacancy is coming), on rental market (teal: being marketed, distinct from
// vacant red) and sold (muted violet) — and carry a fixed light/dark pair.
// `fg` is the hue the pill is tinted from and the dot colour; `dot` is kept
// for callers that read it.
const EXTRA = {
  notice_given:     { light:'#B5650F', dark:'#F0B850' },
  on_rental_market: { light:'#1E6F7C', dark:'#3AA7B8' },
  sold:             { light:'#5E5390', dark:'#9B8AC2' },
}
export const statusCfg = (T, darkMode = false) => {
  const x = k => EXTRA[k][darkMode ? 'dark' : 'light']
  const row = (label, fg) => ({ label, fg, dot: fg })
  return {
    rented:           row('Rented', T.green),
    short_term_let:   row('Short-Term Let', T.purple),   // purple — matches STL booking segments
    notice_given:     row('Notice given', x('notice_given')),
    let_agreed:       row('Let agreed', T.gold),         // gold — contracts being signed
    on_rental_market: row('On rental market', x('on_rental_market')),
    vacant:           row('Vacant', T.red),
    purchased:        row('Purchased', T.amber),
    refurb:           row('Refurbing', T.blue),
    sold:             row('Sold', x('sold')),
  }
}
// Pill *text* colours where the hue itself misses WCAG AA (4.5:1) on its own
// tint: gold is an accent, never text (use goldText); orange is darkened in
// light mode; vacant red is lifted a step in dark mode.
const textFor = (key, c, T, darkMode) => {
  if (key === 'let_agreed') return T.goldText
  if (key === 'notice_given' && !darkMode) return T.amber
  if (key === 'vacant' && darkMode) return '#EC7B7B'
  return c.fg
}
export const Badge = memo(({status}) => {
  const { T, darkMode } = useTheme()
  const cfg = statusCfg(T, darkMode)
  const key = cfg[status] ? status : 'purchased'
  const c = cfg[key]
  const fg = textFor(key, c, T, darkMode)
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:R.pill,background:c.fg+'22',border:`1px solid ${c.fg}44`,color:fg,fontSize:FS.xs,fontFamily:MONO,fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.dot,flexShrink:0}}/>{c.label}
  </span>
})

export const HealthBadge = memo(({property, tenancy=null}) => {
  const h = api.calcPropertyHealthScore(property, property.compliance_items||[], tenancy||property.tenancy||null, property.maintenance_jobs||[], property.rent_payments||[])
  return (
    <span title={`Health: ${h.score}/100${h.issues.length ? ' · ' + h.issues[0].text : ''}`}
      style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:20,
        background:h.color+'22',color:h.color,fontSize:FS.xs,fontFamily:MONO,fontWeight:700,cursor:'default'}}>
      {h.grade} {h.score}
    </span>
  )
})

export const CompanyPill = memo(({company}) => {
  const { T } = useTheme()
  if (!company) return null
  // Company colours are user-chosen; keep the tint, but only use the colour
  // as text where it reads on the card (else ink).
  const hue = normalizeHex(company.color) || T.gold
  const fg = normalizeHex(company.color) ? readableOr(hue, T.card, T.text) : T.goldText
  return <span style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:700,padding:'2px 8px',borderRadius:4,background:hue+'22',color:fg,border:`1px solid ${hue}44`}}>{company.abbr}</span>
})
