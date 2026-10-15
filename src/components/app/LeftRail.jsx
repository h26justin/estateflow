import { Fragment } from 'react'
import { ChromeLogo, ChromeIcon } from '../Logo'
import { MONO, SANS, FS } from '../../lib/styles'
import { Icon, ICON_NAMES } from '../../lib/icons'

// Desktop left navigation rail (redesign app shell). Moved verbatim from
// App.jsx; every value it reads is passed in explicitly.
export function LeftRail({
  railWidth, T, railCollapsed, navItems, view, setView, setSelectedId, setRailCollapsed,
}) {
  return (
    <aside style={{position:'fixed',left:0,top:0,bottom:0,width:railWidth,background:T.surface,borderRight:`1px solid ${T.border}`,display:'flex',flexDirection:'column',zIndex:120}}>
      {/* Brand block — Properly mark (design/properly-brand): tile only
          when collapsed, sidebar/short lockup when expanded. */}
      <div style={{display:'flex',alignItems:'center',padding:railCollapsed?'14px 0':'14px 16px',justifyContent:railCollapsed?'center':'flex-start',height:52,flexShrink:0,borderBottom:`1px solid ${T.border}`}}>
        {railCollapsed ? <ChromeIcon size={30}/> : <ChromeLogo height={26}/>}
      </div>
      {/* Nav items */}
      <nav aria-label="Primary" style={{flex:1,overflowY:'auto',overflowX:'hidden',padding:'10px 8px',display:'flex',flexDirection:'column',gap:2}}>
        {navItems.map((n,i)=>{
          const active = view===n.key||(view==='detail'&&n.key==='properties')
          // Section header whenever the registry group changes (skip the
          // first group — a header above Dashboard is just noise).
          // Collapsed rail shows a hairline divider instead.
          const newGroup = i>0 && n.group !== navItems[i-1].group
          const header = newGroup && (railCollapsed
            ? <div key={`hdr-${n.group}`} aria-hidden="true" style={{height:1,background:T.border,margin:'8px 10px'}}/>
            : <div key={`hdr-${n.group}`} style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',padding:'12px 11px 4px'}}>{n.group}</div>)
          return (
            <Fragment key={n.key}>
            {header}
            <button title={railCollapsed?n.label:undefined} aria-current={active?'page':undefined}
              onClick={()=>{setView(n.key);if(n.key!=='detail')setSelectedId(null)}}
              style={{display:'flex',alignItems:'center',gap:11,padding:railCollapsed?'10px 0':'10px 11px',justifyContent:railCollapsed?'center':'flex-start',
                borderRadius:10,border:'none',cursor:'pointer',width:'100%',textAlign:'left',
                background:active?T.card:'transparent',color:active?T.text:T.muted,
                fontFamily:SANS,fontSize:14,fontWeight:active?700:500,transition:'background 0.15s,color 0.15s'}}
              onMouseEnter={e=>{if(!active)e.currentTarget.style.color=T.text}}
              onMouseLeave={e=>{if(!active)e.currentTarget.style.color=T.muted}}>
              <span style={{display:'flex',flexShrink:0,color:active?T.goldText:'inherit'}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={20}/>:n.icon}</span>
              {!railCollapsed && <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{n.label}</span>}
            </button>
            </Fragment>
          )
        })}
      </nav>
      {/* Collapse toggle */}
      <button onClick={()=>setRailCollapsed(c=>!c)} aria-label={railCollapsed?'Expand sidebar':'Collapse sidebar'}
        style={{display:'flex',alignItems:'center',gap:10,padding:railCollapsed?'12px 0':'12px 16px',justifyContent:railCollapsed?'center':'flex-start',
          background:'none',border:'none',borderTop:`1px solid ${T.border}`,cursor:'pointer',color:T.muted,fontFamily:MONO,fontSize:11,flexShrink:0}}>
        <Icon name={railCollapsed?'chevron-right':'chevron-left'} size={18}/>
        {!railCollapsed && <span>Collapse</span>}
      </button>
    </aside>
  )
}
