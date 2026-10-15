import { memo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import { MONO } from '../../lib/styles'

// Status hues. The core statuses use theme tokens so badges follow
// light/dark mode and match the PropertyMap pins; the remaining hues have no
// token yet and stay fixed. `bg` is unused by Badge (it tints from fg).
export const statusCfg = (T) => ({
  rented:       {label:'Rented',       bg:'#0D2B1F',fg:T.green,dot:T.green},
  short_term_let:{label:'Short-Term Let',bg:'#1E142B',fg:'#9B6FDE',dot:'#9B6FDE'}, // purple — matches STL_COLOR booking segments
  notice_given: {label:'Notice given', bg:'#2B200A',fg:'#F0B850',dot:'#F0B850'},  // amber — still rented but vacancy looming
  let_agreed:   {label:'Let agreed',   bg:'#2B250A',fg:T.gold,dot:T.gold},  // gold — contracts being signed, not yet rented
  on_rental_market:{label:'On rental market',bg:'#0A242B',fg:'#3AA7B8',dot:'#3AA7B8'}, // teal: being marketed, distinct from vacant red
  vacant:       {label:'Vacant',       bg:'#2B1010',fg:T.red,dot:T.red},
  purchased:    {label:'Purchased',    bg:'#2B200A',fg:T.amber,dot:T.amber},
  refurb:       {label:'Refurbing',    bg:'#0A1A2B',fg:T.blue,dot:T.blue},
  sold:         {label:'Sold',         bg:'#1A1A2B',fg:'#9B8AC2',dot:'#9B8AC2'},
})
// Pill *text* colours that clear WCAG AA (4.5:1) on the pill's own tint. The
// status hues are tuned for the dark theme; on light cards several fall to
// 2.4–3.6:1 (Purchased, Vacant), so light mode uses a darkened sibling hue.
// Dark mode only needs the two that miss on the #1B242D card.
const STATUS_TEXT_LIGHT = {
  rented:'#167A4C', short_term_let:'#6E45B8', notice_given:'#8A5600', let_agreed:'#7A5E1C',
  on_rental_market:'#1E6F7C', vacant:'#B8392D', purchased:'#9A4A10', refurb:'#2A65A0', sold:'#5E5390',
}
const STATUS_TEXT_DARK = { vacant:'#EC7B7B', short_term_let:'#A98AE6' }
export const Badge = memo(({status}) => {
  const { T, darkMode } = useTheme()
  const cfg = statusCfg(T)
  const key = cfg[status] ? status : 'purchased'
  const c = cfg[key]
  const fg = (darkMode ? STATUS_TEXT_DARK[key] : STATUS_TEXT_LIGHT[key]) || c.fg
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:20,background:c.fg+'22',border:`1px solid ${c.fg}44`,color:fg,fontSize:11,fontFamily:MONO,fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.dot,flexShrink:0}}/>{c.label}
  </span>
})

export const HealthBadge = memo(({property, tenancy=null}) => {
  const h = api.calcPropertyHealthScore(property, property.compliance_items||[], tenancy||property.tenancy||null, property.maintenance_jobs||[], property.rent_payments||[])
  return (
    <span title={`Health: ${h.score}/100${h.issues.length ? ' · ' + h.issues[0].text : ''}`}
      style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:20,
        background:h.color+'22',color:h.color,fontSize:11,fontFamily:MONO,fontWeight:700,cursor:'default'}}>
      {h.grade} {h.score}
    </span>
  )
})

export const CompanyPill = memo(({company}) => {
  const { T } = useTheme()
  if (!company) return null
  return <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(company.color||T.gold)+'22',color:company.color||T.goldText,border:`1px solid ${(company.color||T.gold)}44`}}>{company.abbr}</span>
})
