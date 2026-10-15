import { VIEW_LABELS } from '../../lib/nav'
import { supabase } from '../../lib/supabase'
import { ChromeLogo } from '../Logo'
import { MONO, FS } from '../../lib/styles'
import { Icon, ICON_NAMES } from '../../lib/icons'
import NotificationCentre from '../NotificationCentre'
import PropertySearchBar from '../PropertySearchBar'

// Sticky top bar: logo/breadcrumb, search, notifications, quick-add menu
// and the account controls. Moved verbatim from App.jsx; every value it
// reads is passed in explicitly.
export function AppHeader({
  T, isMobile, view, selected, closeDetail, companies, setCoFilter, setStatusFilter,
  setPortfolioTab, setSelectedId, setView, navItems, activeProperties, openDetail, setShowNewMenu,
  showNewMenu, setEditProp, setShowAddProp, openWorkflow, setShowAddCo, setShowReceiptScan,
  setDetailTab, showToast, isPlatformAdmin, setShowAdmin, setShowMoreMenu, showMoreMenu,
  setShowPalette, openSettingsTab, setShowDrawer,
}) {
  return (
    <header role='banner' style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 16px',position:'sticky',top:0,zIndex:100,width:'100%'}}>
      <div style={{maxWidth:1240,margin:'0 auto',height:52,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        {/* Left: logo on mobile, breadcrumb on desktop (nav lives in the rail) */}
        <div style={{display:'flex',alignItems:'center',flexShrink:0,minWidth:0}}>
          {isMobile
            ? <ChromeLogo height={26}/>
            : view==='detail' && selected
              // Real breadcrumb on the property page: Portfolio and the
              // company segment are clickable; the property name is the
              // current location. (The old header showed the static string
              // "Portfolio / Property".)
              ? <nav aria-label="Breadcrumb" style={{fontFamily:MONO,fontSize:12,color:T.muted,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                  <button onClick={closeDetail} style={{background:'none',border:'none',cursor:'pointer',padding:0,fontFamily:MONO,fontSize:12,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}
                    onMouseEnter={e=>e.currentTarget.style.color=T.text} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>Portfolio</button>
                  {(()=>{ const co = companies.find(c=>c.id===selected.company_id); return co ? <>
                    <span aria-hidden="true">/</span>
                    <button onClick={()=>{setCoFilter(co.id);setStatusFilter('all');setPortfolioTab('properties');setSelectedId(null);setView('properties')}}
                      style={{background:'none',border:'none',cursor:'pointer',padding:0,fontFamily:MONO,fontSize:12,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.text} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>{co.abbr||co.name}</button>
                  </> : null })()}
                  <span aria-hidden="true">/</span>
                  <span aria-current="page" style={{color:T.text,overflow:'hidden',textOverflow:'ellipsis',maxWidth:260}}>{selected.name}</span>
                </nav>
              : <span style={{fontFamily:MONO,fontSize:12,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',whiteSpace:'nowrap'}}>
                  {navItems.find(n=>n.key===view)?.label || VIEW_LABELS[view] || 'Dashboard'}
                </span>}
        </div>

        {/* Desktop nav lives in the left rail, so the middle of the header
            is free for the property search — the most common thing anyone
            does on landing (dashboard → a specific property). It doubles as
            the spacer that pushes the action cluster right. "/" focuses it. */}
        {!isMobile&&(
          <div style={{flex:1,display:'flex',justifyContent:'center',minWidth:0,padding:'0 16px'}}>
            <PropertySearchBar
              properties={activeProperties}
              onOpen={p=>openDetail(p)}
              slashToFocus
              placeholder="Search properties by name, address or tenant…"
              style={{width:'100%',maxWidth:440}}/>
          </div>
        )}

        {/* Mobile: current page title */}
        {isMobile&&<div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>
          {(()=>{const ni=navItems.find(n=>n.key===view); return ni&&ICON_NAMES.includes(ni.icon)?<Icon name={ni.icon} size={15} color={T.muted}/>:ni?.icon})()} <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{view==='detail'&&selected?selected.name:(navItems.find(n=>n.key===view)?.label||VIEW_LABELS[view]||'Dashboard')}</span>
        </div>}

        {/* Right side */}
        <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
          {!isMobile&&(
            <div style={{position:'relative'}}>
              <button className="btn btn-gold" style={{fontSize:11,padding:'6px 14px',display:'flex',alignItems:'center',gap:6}}
                onClick={()=>setShowNewMenu(m=>!m)}>
                <span style={{fontSize:14,fontWeight:700}}>+</span> New
                <span style={{fontSize:FS.xs,opacity:0.8}}>{showNewMenu?'▲':'▼'}</span>
              </button>
              {showNewMenu&&(
                <>
                  {/* Backdrop to close */}
                  <div style={{position:'fixed',inset:0,zIndex:199}} onClick={()=>setShowNewMenu(false)}/>
                  {/* Dropdown */}
                  <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',zIndex:200,
                    background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
                    padding:'6px',minWidth:210,boxShadow:'0 8px 32px rgba(0,0,0,0.18)'}}>
                    {[
                      {icon:'home',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true)}},
                      {icon:'building',label:'Add Block of Flats', action:()=>openWorkflow('bulk-add')},
                      {icon:'grid',label:'Add Company',     action:()=>setShowAddCo(true)},
                      {icon:'file-text',label:'Import Statement',action:()=>openWorkflow('import')},
                      {icon:'clipboard-check',label:'Rental Statement Audit',action:()=>openWorkflow('statement-audit')},
                      {icon:'upload',label:'Import Historic Data',action:()=>openWorkflow('import-data')},
                      {icon:'receipt',label:'Scan Receipt',    action:()=>setShowReceiptScan(true)},
                      // For these three "drill into a property" actions:
                      // if the user has exactly one property, just open it on
                      // the right tab. If they have many, take them to the
                      // portfolio so they can pick. (Was previously a toast
                      // instruction with no action — looked broken.)
                      {icon:'pound',label:'Log Expense',     action:()=>{
                        if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('expenses'); setView('detail') }
                        else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log against' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                      }},
                      {icon:'clipboard-check',label:'Add Compliance',  action:()=>{
                        if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('compliance'); setView('detail') }
                        else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to add a certificate to' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                      }},
                      {icon:'wrench',label:'Log Maintenance', action:()=>{
                        if (activeProperties.length === 1) { setSelectedId(activeProperties[0].id); setDetailTab('maintenance'); setView('detail') }
                        else { setView('properties'); showToast(activeProperties.length ? 'Pick a property to log a job on' : 'Add a property first', activeProperties.length ? 'success' : 'error') }
                      }},
                    ].map((item,i,arr)=>(
                      <button key={item.label} onClick={()=>{item.action();setShowNewMenu(false)}}
                        style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                          background:'none',border:'none',borderRadius:8,cursor:'pointer',textAlign:'left',
                          borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',
                          transition:'background 0.15s'}}
                        onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                        onMouseLeave={e=>e.currentTarget.style.background='none'}>
                        <span style={{width:22,display:'flex',justifyContent:'center',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={16}/>:<span style={{fontSize:16}}>{item.icon}</span>}</span>
                        <span style={{fontFamily:MONO,fontSize:12,color:T.text,fontWeight:500}}>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Trial countdown pill — always visible while any company is
              still on trial. Was previously buried in Billing settings
              until ≤7 days remained, so users got surprised by the
              hard gate. Click to jump to Billing. */}
          {(() => {
            const trialing = companies
              .filter(c => !c.is_free_tier && c.trial_ends_at)
              .map(c => ({ c, days: Math.ceil((new Date(c.trial_ends_at) - Date.now()) / 86400000) }))
              .filter(x => x.days >= 0)
              .sort((a, b) => a.days - b.days)
            if (trialing.length === 0) return null
            const soonest = trialing[0]
            const tone = soonest.days <= 3 ? T.red : soonest.days <= 7 ? T.amber : T.gold
            const toneText = tone === T.gold ? T.goldText : tone
            return (
              <button
                onClick={() => {
                  // Hash first, then view — the lazy SettingsPage reads its
                  // initial tab from the URL at mount (the event below only
                  // reaches an already-mounted page). Same pattern as the
                  // dashboard upgrade CTA.
                  window.history.pushState({ view: 'settings', settingsTab: 'billing' }, '', '#/settings/billing')
                  setView('settings')
                  window.dispatchEvent(new CustomEvent(
                    'ownproperly:set-settings-tab',
                    { detail: { tab: 'billing' } }
                  ))
                }}
                title={trialing.length > 1
                  ? `${trialing.length} companies on trial — soonest ends in ${soonest.days} day${soonest.days===1?'':'s'} (${soonest.c.name})`
                  : `Trial ends in ${soonest.days} day${soonest.days===1?'':'s'} (${soonest.c.name})`}
                style={{
                  fontFamily:MONO, fontSize:11, fontWeight:700,
                  padding:'5px 12px', borderRadius:20, cursor:'pointer',
                  border:`1px solid ${tone}`, background:tone+'22', color:toneText,
                  whiteSpace:'nowrap',
                }}>
                {isMobile ? `${soonest.days}d` : `Trial: ${soonest.days} day${soonest.days===1?'':'s'} left`}
              </button>
            )
          })()}
          <NotificationCentre/>
          {isPlatformAdmin&&<button className="btn btn-ghost" style={{fontSize:11,padding:'6px 12px',color:T.goldText,borderColor:T.gold+'44'}} onClick={()=>setShowAdmin(true)}>Admin</button>}
          {/* "⋯ More" menu — houses pages that aren't worth their own tab
              (Feedback, Sign Out, etc.). Keeps primary nav focused on
              daily-use pages. */}
          {!isMobile&&(
            <div style={{position:'relative'}}>
              <button className="btn btn-ghost" style={{fontSize:13,padding:'6px 11px',fontWeight:700,letterSpacing:'0.05em'}}
                onClick={()=>setShowMoreMenu(m=>!m)}
                aria-label="More options" aria-expanded={showMoreMenu}>
                ⋯
              </button>
              {showMoreMenu&&(
                <>
                  <div style={{position:'fixed',inset:0,zIndex:199}} onClick={()=>setShowMoreMenu(false)}/>
                  <div role="menu" style={{position:'absolute',right:0,top:'calc(100% + 6px)',zIndex:200,
                    background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
                    padding:'6px',minWidth:180,boxShadow:'0 8px 32px rgba(0,0,0,0.18)'}}>
                    {[
                      {icon:'search', label:'Search & jump…', hint:'⌘K', action:()=>setShowPalette(true)},
                      {icon:'sparkle',label:'Help & Guides', action:()=>openSettingsTab('help')},
                      {icon:'trash',label:'Trash', action:()=>openSettingsTab('trash')},
                      {icon:'message',label:'Feedback',  action:()=>{setView('feedback');setSelectedId(null)}},
                      {icon:'log-out', label:'Sign Out',  action:()=>supabase.auth.signOut(), divider:true},
                    ].map((item,i,arr)=>(
                      <button key={item.label} role="menuitem"
                        onClick={()=>{item.action();setShowMoreMenu(false)}}
                        style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                          background:'none',border:'none',borderRadius:8,cursor:'pointer',textAlign:'left',
                          borderTop:item.divider?`1px solid ${T.border}`:'none',
                          marginTop:item.divider?4:0,paddingTop:item.divider?12:'10px',
                          transition:'background 0.15s'}}
                        onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                        onMouseLeave={e=>e.currentTarget.style.background='none'}>
                        <span style={{width:22,display:'flex',justifyContent:'center',color:T.muted}}>{ICON_NAMES.includes(item.icon)?<Icon name={item.icon} size={15}/>:<span style={{fontSize:14}}>{item.icon}</span>}</span>
                        <span style={{flex:1,fontFamily:MONO,fontSize:12,color:T.text,fontWeight:500}}>{item.label}</span>
                        {item.hint && <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,padding:'1px 5px'}}>{item.hint}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Search - mobile only (desktop has ⌘K + the ⋯ menu entry) */}
          {isMobile&&<button onClick={()=>setShowPalette(true)}
            aria-label="Search and jump" style={{background:'none',border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',color:T.text,display:'flex',alignItems:'center',justifyContent:'center',width:36,height:36}}>
            <Icon name="search" size={16}/>
          </button>}
          {/* Hamburger - mobile only */}
          {isMobile&&<button onClick={()=>setShowDrawer(true)}
            aria-label="Open menu" style={{background:'none',border:`1px solid ${T.border}`,borderRadius:8,padding:'6px 10px',cursor:'pointer',color:T.text,fontSize:16,display:'flex',flexDirection:'column',gap:4,alignItems:'center',justifyContent:'center',width:36,height:36}}>
            <span style={{display:'block',width:16,height:1.5,background:T.text,borderRadius:1}}/>
            <span style={{display:'block',width:16,height:1.5,background:T.text,borderRadius:1}}/>
            <span style={{display:'block',width:16,height:1.5,background:T.text,borderRadius:1}}/>
          </button>}
        </div>
      </div>
    </header>
  )
}
