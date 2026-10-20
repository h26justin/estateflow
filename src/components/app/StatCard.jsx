import { useState, useEffect, useRef, memo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'
import { Icon, ICON_NAMES } from '../../lib/icons'
import { pressable } from '../../lib/pressable'

// One line inside a StatCard's expanded breakdown. Rows that carry an
// `onClick` become real buttons — the arrears and refurb widgets list
// properties, and going from "Flat 18 owes £2,300" to that property's page
// used to mean re-finding it in the portfolio. Rows without `onClick`
// render exactly as before (plain label + value, no affordance).
const BreakdownRow = memo(({item, T}) => {
  const [hover, setHover] = useState(false)
  const clickable = typeof item.onClick === 'function'
  const rowStyle = {
    display:'flex', justifyContent:'space-between', alignItems:'center',
    paddingLeft:item.indent?16:0,
    // Buttons need the div's defaults spelled out — no UA chrome, full width,
    // and a hit area that doesn't shift the non-clickable rows around it.
    ...(clickable && {
      width:'100%', background:hover?T.gold+'14':'none', border:'none',
      borderRadius:5, cursor:'pointer', textAlign:'left', font:'inherit',
      padding:`3px ${item.indent?0:5}px 3px ${item.indent?16:5}px`,
      margin:'-3px 0', transition:'background 0.15s',
    }),
  }
  const inner = (
    <>
      <span style={{fontFamily:MONO,fontSize:FS.xs,color:clickable&&hover?T.goldText:(item.indent?T.faint:T.muted),flex:1,display:'flex',alignItems:'center',gap:4,minWidth:0}}>
        {item.indent&&<span style={{color:T.border}}>└</span>}
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.label}</span>
        {clickable&&<Icon name="arrow-right" size={10} color={hover?T.gold:T.faint}/>}
      </span>
      <span style={{fontFamily:MONO,fontSize:item.indent?FS.xs:11,fontWeight:item.indent?400:700,color:item.color||(item.indent?T.muted:T.text),flexShrink:0,paddingLeft:8}}>{item.value}</span>
    </>
  )
  if (!clickable) return <div style={rowStyle}>{inner}</div>
  return (
    <button type="button" style={rowStyle}
      // The card itself toggles open/closed on click, so stop the bubble or
      // opening a property would also collapse the breakdown behind it.
      onClick={e=>{e.stopPropagation();item.onClick()}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      onFocus={()=>setHover(true)} onBlur={()=>setHover(false)}
      title={item.linkTitle||`Open ${item.label}`}
      aria-label={item.linkTitle||`Open ${item.label}`}>
      {inner}
    </button>
  )
})

export const StatCard = memo(({icon,label,value,sub,strip,table,accent,breakdown,onNavigate,navLabel}) => {
  const [open,setOpen] = useState(false)
  const [alignRight,setAlignRight] = useState(false)
  const { T } = useTheme()
  const rootRef = useRef(null)
  // The breakdown opens as an overlay panel below the card rather than
  // inline, so expanding one KPI card never changes the height of its row
  // or shoves the page about. Close on outside click or Escape.
  //
  // The panel is wider than the card (PANEL_MIN) so every row and note is
  // read in full with no scrolling; cards near the right edge of the
  // viewport anchor the panel to their right edge so it stays on screen.
  const PANEL_MIN = 560
  useEffect(() => {
    if (!open) return
    const r = rootRef.current?.getBoundingClientRect()
    setAlignRight(!!r && r.left + PANEL_MIN > window.innerWidth - 16)
    const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  // The whole card is the control. Cards with a breakdown toggle it (the
  // panel carries the "Open …" link to the full page); cards without one
  // navigate straight there. Only a small chevron hints at the affordance —
  // the old "PORTFOLIO → DETAIL ›" header text crowded the icon.
  const [hover,setHover] = useState(false)
  const action = breakdown ? ()=>setOpen(o=>!o) : onNavigate
  const a11y = breakdown
    ? {'aria-expanded':open, 'aria-label':`${label}: ${value}. ${open?'Hide':'Show'} breakdown`}
    : onNavigate ? {role:'link', 'aria-label':`${label}: ${value}. Open ${navLabel||label}`} : {}
  return (
    <div ref={rootRef} className="kpi-card"
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{position:'relative',zIndex:open?30:undefined,display:'flex',flexDirection:'column',minWidth:0,height:'100%',boxSizing:'border-box',background:T.card,border:`1px solid ${open?T.gold:hover&&action?T.gold+'88':T.border}`,borderRadius:12,padding:'18px 20px',transition:'border-color 0.2s',cursor:action?'pointer':'default'}}
      {...pressable(action, a11y)}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
        {/* Redesign: a known icon name renders the hairline glyph in a tinted
            accent tile; legacy emoji strings still render as-is. */}
        {ICON_NAMES.includes(icon)
          ? <div style={{width:34,height:34,borderRadius:9,background:(accent||T.gold)+'1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name={icon} size={18} color={accent||T.gold}/></div>
          : <div style={{fontSize:20}}>{icon}</div>}
        {action&&(
          <span aria-hidden="true" style={{display:'inline-flex',color:open||hover?T.goldText:T.faint,transition:'color 0.2s, transform 0.2s',transform:breakdown&&open?'rotate(90deg)':'none',marginTop:2}}>
            <Icon name="chevron-right" size={14}/>
          </span>
        )}
      </div>
      <div title={label} style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:(!accent||accent===T.gold)?T.goldText:accent,letterSpacing:'-0.02em',marginBottom:2,overflowWrap:'anywhere'}}>{value}</div>
      {sub&&<div style={{fontFamily:MONO,fontSize:11,color:T.faint,lineHeight:1.5,overflowWrap:'anywhere'}}>{sub}</div>}
      {/* Optional 2-column strip of small label/value pairs on the card face,
          for cards whose story needs a few figures at a glance (e.g. the last
          three months of rent) rather than one sub-line. */}
      {/* Optional compact table on the card face: `table.columns` are the
          header labels, each row has `cells` (one per column) and optional
          per-cell `colors`; `strong` bolds the row. First column left-aligned,
          the rest right-aligned so figures line up. */}
      {table&&table.rows.length>0&&(
        <div style={{marginTop:10,overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'auto'}}>
            <thead>
              <tr>
                {table.columns.map((c,i)=>(
                  <th key={'h'+i} style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:400,color:T.faint,textTransform:'uppercase',letterSpacing:'0.06em',textAlign:i?'right':'left',padding:`0 0 4px ${i?6:0}px`,whiteSpace:'nowrap'}}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r,ri)=>(
                <tr key={ri}>
                  {r.cells.map((cell,ci)=>(
                    <td key={ci} style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:r.strong?700:400,color:(r.colors&&r.colors[ci])||(ci?T.text:T.muted),textAlign:ci?'right':'left',padding:`3px 0 3px ${ci?6:0}px`,whiteSpace:'nowrap',borderTop:ri?`1px solid ${T.border}`:'none'}}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {strip&&strip.length>0&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:'7px 12px',marginTop:10}}>
          {strip.map((s,i)=>(
            <div key={i} style={{minWidth:0}}>
              <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,textTransform:'uppercase',letterSpacing:'0.08em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.label}</div>
              <div style={{fontFamily:MONO,fontSize:12,color:s.color||T.text,overflowWrap:'anywhere'}}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {open&&breakdown&&(
        <div onClick={e=>e.stopPropagation()}
          style={{position:'absolute',top:'calc(100% + 6px)',...(alignRight?{right:0}:{left:0}),
            width:`max(100%, min(${PANEL_MIN}px, calc(100vw - 32px)))`,
            zIndex:30,background:T.card,border:`1px solid ${T.gold}`,borderRadius:12,padding:'14px 18px 16px',boxShadow:'0 12px 32px rgba(0,0,0,0.14)',display:'grid',gap:5,cursor:'default'}}>
          {breakdown.map((item,i)=>(
            <div key={i} style={{minWidth:0}}>
              {item.separator&&<div style={{borderTop:`1px solid ${T.border}`,margin:'4px 0'}}/>}
              <BreakdownRow item={item} T={T}/>
              {item.note&&<div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,marginTop:2,lineHeight:1.5,paddingLeft:2,whiteSpace:'normal',overflowWrap:'anywhere'}}>{item.note}</div>}
            </div>
          ))}
          {onNavigate&&(
            <div style={{borderTop:`1px solid ${T.border}`,marginTop:6,paddingTop:8,display:'flex',justifyContent:'flex-end'}}>
              <button type="button" onClick={e=>{e.stopPropagation();setOpen(false);onNavigate()}}
                style={{background:'none',border:'none',cursor:'pointer',padding:'4px 2px',minHeight:28,fontFamily:MONO,fontSize:11,fontWeight:700,color:T.goldText,display:'inline-flex',alignItems:'center',gap:4}}>
                Open {navLabel||label}<Icon name="arrow-right" size={11}/>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
