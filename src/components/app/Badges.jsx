import { memo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import { MONO } from '../../lib/styles'

export const STATUS_CFG = {
  rented:       {label:'Rented',       bg:'#0D2B1F',fg:'#2ECC8A',dot:'#2ECC8A'},
  short_term_let:{label:'Short-Term Let',bg:'#1E142B',fg:'#9B6FDE',dot:'#9B6FDE'}, // purple — matches STL_COLOR booking segments
  notice_given: {label:'Notice given', bg:'#2B200A',fg:'#F0B850',dot:'#F0B850'},  // amber — still rented but vacancy looming
  let_agreed:   {label:'Let agreed',   bg:'#2B250A',fg:'#C8A84B',dot:'#C8A84B'},  // gold — contracts being signed, not yet rented
  on_rental_market:{label:'On rental market',bg:'#0A242B',fg:'#3AA7B8',dot:'#3AA7B8'}, // teal: being marketed, distinct from vacant red
  vacant:       {label:'Vacant',       bg:'#2B1010',fg:'#E05555',dot:'#E05555'},
  purchased:    {label:'Purchased',    bg:'#2B200A',fg:'#E0943A',dot:'#E0943A'},
  refurb:       {label:'Refurbing',    bg:'#0A1A2B',fg:'#4B8FE0',dot:'#4B8FE0'},
  sold:         {label:'Sold',         bg:'#1A1A2B',fg:'#9B8AC2',dot:'#9B8AC2'},
}
// Pill *text* colours that clear WCAG AA (4.5:1) on the pill's own tint. The
// STATUS_CFG hues are tuned for the dark theme; on light cards several fall to
// 2.4–3.6:1 (Purchased, Vacant), so light mode uses a darkened sibling hue.
// Dark mode only needs the two that miss on the #1B242D card.
const STATUS_TEXT_LIGHT = {
  rented:'#167A4C', short_term_let:'#6E45B8', notice_given:'#8A5600', let_agreed:'#7A5E1C',
  on_rental_market:'#1E6F7C', vacant:'#B8392D', purchased:'#9A4A10', refurb:'#2A65A0', sold:'#5E5390',
}
const STATUS_TEXT_DARK = { vacant:'#EC7B7B', short_term_let:'#A98AE6' }
export const Badge = memo(({status}) => {
  const { darkMode } = useTheme()
  const key = STATUS_CFG[status] ? status : 'purchased'
  const c = STATUS_CFG[key]
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
  if (!company) return null
  return <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(company.color||'#C8A84B')+'22',color:company.color||'#C8A84B',border:`1px solid ${(company.color||'#C8A84B')}44`}}>{company.abbr}</span>
})
