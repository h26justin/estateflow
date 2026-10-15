import { Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { ChromeLogo } from '../Logo'
import { MONO } from '../../lib/styles'
import { Icon, ICON_NAMES } from '../../lib/icons'

// Mobile navigation drawer (opened from the bottom nav's More button).
// Moved verbatim from App.jsx; every value it reads is passed in explicitly.
export function MobileDrawer({
  setShowDrawer, T, setShowPalette, navItems, view, setView, setSelectedId, setEditProp,
  setShowAddProp, openWorkflow, setShowAddCo, setShowReceiptScan, activeProperties, setDetailTab,
  showToast, openSettingsTab,
}) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:300,display:'flex'}}>
      {/* Backdrop */}
      <div style={{flex:1,background:'rgba(0,0,0,0.6)'}} onClick={()=>setShowDrawer(false)}/>
      {/* Drawer panel */}
      <div role="dialog" aria-modal="true" aria-label="Navigation menu" style={{width:260,background:T.surface,height:'100%',display:'flex',flexDirection:'column',borderLeft:`1px solid ${T.border}`}}>
        {/* Drawer header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:'flex',alignItems:'center'}}>
            <ChromeLogo height={26}/>
          </div>
          <button onClick={()=>setShowDrawer(false)} aria-label="Close menu"
            style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer',padding:'4px'}}>✕</button>
        </div>
        {/* Search row — the palette's only other mobile entry point is
            the header icon; keyboard ⌘K needs a keyboard. */}
        <button onClick={()=>{setShowDrawer(false);setShowPalette(true)}}
          style={{display:'flex',alignItems:'center',gap:10,margin:'12px 16px 0',padding:'10px 12px',
            background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',textAlign:'left'}}>
          <Icon name="search" size={16} color={T.muted}/>
          <span style={{fontFamily:MONO,fontSize:12,color:T.muted}}>Search & jump…</span>
        </button>
        {/* Nav items — grouped with the same section headers as the
            desktop rail */}
        <nav aria-label="Primary" style={{flex:1,overflowY:'auto',padding:'12px 0'}}>
          {navItems.map((n,i)=>{
            const active = view===n.key||(view==='detail'&&n.key==='properties')
            const newGroup = i>0 && n.group !== navItems[i-1].group
            return (
            <Fragment key={n.key}>
            {newGroup && <div style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',padding:'14px 20px 4px'}}>{n.group}</div>}
            <button aria-current={active?'page':undefined}
              onClick={()=>{setView(n.key);setSelectedId(null);setShowDrawer(false)}}
              style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 20px',
                background:active?T.gold+'18':'none',
                border:'none',borderLeft:active?`3px solid ${T.gold}`:'3px solid transparent',
                cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}>
              <span style={{width:24,display:'flex',justifyContent:'center',color:active?T.goldText:T.muted}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={19}/>:<span style={{fontSize:18}}>{n.icon}</span>}</span>
              <span style={{fontSize:14,fontWeight:active?600:400,color:active?T.goldText:T.text}}>{n.label}</span>
            </button>
            </Fragment>
          )})}
        </nav>
        {/* Drawer footer */}
        <div style={{padding:'16px 20px',borderTop:`1px solid ${T.border}`,display:'flex',flexDirection:'column',gap:6}}>
          {[
            {icon:'home',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true);setShowDrawer(false)}},
            {icon:'building',label:'Add Block of Flats', action:()=>{openWorkflow('bulk-add');setShowDrawer(false)}},
            {icon:'grid',label:'Add Company',     action:()=>{setShowAddCo(true);setShowDrawer(false)}},
            {icon:'file-text',label:'Import Statement',action:()=>{openWorkflow('import');setShowDrawer(false)}},
            {icon:'clipboard-check',label:'Rental Statement Audit',action:()=>{openWorkflow('statement-audit');setShowDrawer(false)}},
            {icon:'upload',label:'Import Historic Data',action:()=>{openWorkflow('import-data');setShowDrawer(false)}},
            {icon:'receipt',label:'Scan Receipt',    action:()=>{setShowReceiptScan(true);setShowDrawer(false)}},
            {icon:'pound',label:'Log Expense',     action:()=>{
              if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('expenses'); setView('detail') }
              else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log against' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
              setShowDrawer(false)
            }},
            {icon:'wrench',label:'Log Maintenance', action:()=>{
              if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('maintenance'); setView('detail') }
              else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log a job on' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
              setShowDrawer(false)
            }},
          ].map(item=>(
            <button key={item.label} onClick={item.action}
              style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
                background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',textAlign:'left'}}>
              <span style={{display:'flex',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={15}/>:<span style={{fontSize:15}}>{item.icon}</span>}</span>
              <span style={{fontFamily:MONO,fontSize:11,color:T.text,fontWeight:500}}>{item.label}</span>
            </button>
          ))}
          <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px',marginTop:4}}
            onClick={()=>{openSettingsTab('help');setShowDrawer(false)}}>
            Help & Guides
          </button>
          <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px'}}
            onClick={()=>{setView('feedback');setSelectedId(null);setShowDrawer(false)}}>
            Send Feedback
          </button>
          <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px'}}
            onClick={()=>supabase.auth.signOut()}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
