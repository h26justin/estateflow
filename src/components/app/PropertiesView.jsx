import { useState, useRef, useEffect, useId } from 'react'
import { canDo } from '../../lib/permissions'
import ActionMenu from '../ActionMenu'
import { ContractorsPage } from '../DashboardComponents'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS } from '../../lib/propertyStatus'
import { MONO, CV, FS, SANS } from '../../lib/styles'
import { Icon } from '../../lib/icons'
import { calcGrossYield } from '../../lib/propertyCalcs'
import { plural } from '../../lib/format'
import { PropertyMap } from './lazyViews'
import { fmt } from '../../lib/appFmt'
import { statusCfg } from './Badges'
import { PropertyGrid } from './PropertyGrid'
import { DraggablePropertyList } from './DraggablePropertyList'

const SORT_OPTIONS = [
  {v:'company-name', l:'Company'},
  {v:'name',         l:'Name A–Z'},
  {v:'status',       l:'Status'},
  {v:'rent-high',    l:'Rent (high–low)'},
  {v:'yield-high',   l:'Yield (high–low)'},
  {v:'arrears',      l:'Arrears'},
  {v:'value-high',   l:'Value (high–low)'},
  {v:'custom',       l:'Custom order'},
]

// Properties view: filters, sort, layout toggle and the list / grid /
// map of properties. Every value it reads is passed in explicitly.
//
// Layout: title + one primary action (Add Property) with the bulk actions
// behind ⋯; a single row of section tabs; then ONE compact toolbar —
// search · Filters (active count) · Sort · layout. Company / status /
// archived chips live in the Filters disclosure, and active filters show
// as removable chips while it's shut. This keeps the first property on
// the first screen of a 390px phone (it used to sit ~800px down).
export function PropertiesView({
  isMobile, T, filtered, properties, setPortfolioTab, portfolioTab, CompaniesPanel, companies,
  setCompanies, user, showToast, companySettings, setCompanySettings, setCoFilter, coFilter,
  setProperties, setSelectedId, setView, setDetailTab, setShowBuildingMortgage, permissionsMap,
  activeCoTab, devModeActive, openWorkflow, setEditProp, setShowAddProp, searchQ, setSearchQ,
  setStatusFilter, statusFilter, archivedCount, setShowArchived, showArchived, setSortBy, sortBy,
  resetCustomOrder, setPropLayout, propLayout, openDetail, yieldBasis,
}) {
  const canEdit = canDo(permissionsMap, activeCoTab, 'edit_properties') || devModeActive
  const filtersId = useId()
  const searchRef = useRef(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // "/" focuses the page search (the header search steps aside on this page).
  useEffect(() => {
    if (portfolioTab !== 'properties') return
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [portfolioTab])

  const statusLabel = f => PROPERTY_STATUS_LABELS[f] || statusCfg(T)[f]?.label || f
  const activeCo = companies.find(c => c.id === coFilter)
  const activeChips = [
    coFilter !== 'all' && activeCo && { k: 'co', l: activeCo.abbr || activeCo.name, clear: () => setCoFilter('all') },
    statusFilter !== 'all' && { k: 'st', l: statusLabel(statusFilter), clear: () => setStatusFilter('all') },
    showArchived && { k: 'ar', l: 'Archived shown', clear: () => setShowArchived(false) },
  ].filter(Boolean)
  const activeCount = activeChips.length
  function clearFilters() { setCoFilter('all'); setStatusFilter('all'); setShowArchived(false) }

  const chip = {fontFamily:MONO,fontSize:11,padding:'5px 12px',minHeight:30,borderRadius:20,cursor:'pointer',transition:'all 0.18s',whiteSpace:'nowrap'}
  const groupLbl = {fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',minWidth:isMobile?'100%':72}
  const toolBtn = {display:'inline-flex',alignItems:'center',gap:6,minHeight:34,padding:'6px 12px',borderRadius:8,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted,fontFamily:MONO,fontSize:11,whiteSpace:'nowrap'}

  return (
    <div className="fade">
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:12}}>
        <div style={{flex:'1 1 auto',minWidth:0}}>
          <h1 style={{fontSize:isMobile?20:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Portfolio</h1>
          <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{filtered.length} of {plural(properties.length,'property','properties')} shown</div>
        </div>
        {portfolioTab==='properties'&&(
          <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
            <button className="btn btn-gold" style={{fontSize:FS.sm,whiteSpace:'nowrap'}} onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled={!canEdit} title={!canEdit ? 'You don\'t have permission to add properties to this company' : ''}>+ Add property</button>
            {/* Less-used bulk actions sit behind ⋯ */}
            <ActionMenu buttonLabel="More portfolio actions" items={[
              { label: 'Add a block of flats', icon: 'building', disabled: !canEdit, onSelect: () => openWorkflow('bulk-add') },
              { label: 'Building mortgage', icon: 'landmark', disabled: !canEdit, onSelect: () => setShowBuildingMortgage(true) },
            ]}/>
          </div>
        )}
      </div>

      {/* Section tabs — one row; scrolls sideways rather than wrapping on a
          narrow phone. Icons drop on mobile to keep all four visible. */}
      <div role="group" aria-label="Portfolio section" style={{display:'flex',gap:6,marginBottom:14,overflowX:'auto',scrollbarWidth:'none'}}>
        {[['properties','building','Properties'],['companies','grid','Companies'],['map','map','Map'],['contractors','wrench','Contractors']].map(([k,ic,l])=>(
          <button key={k} type="button" onClick={()=>setPortfolioTab(k)} aria-pressed={portfolioTab===k}
            style={{display:'inline-flex',alignItems:'center',gap:6,flexShrink:0,fontFamily:SANS,fontSize:FS.sm,padding:isMobile?'6px 11px':'6px 14px',borderRadius:8,cursor:'pointer',
              border:`1px solid ${portfolioTab===k?T.gold:T.border}`,
              background:portfolioTab===k?T.gold:'transparent',
              color:portfolioTab===k?CV.onGold:T.muted,fontWeight:portfolioTab===k?700:400}}>
            {!isMobile&&<Icon name={ic} size={14}/>}{l}
          </button>
        ))}
      </div>

      {portfolioTab==='companies'&&<CompaniesPanel companies={companies} setCompanies={setCompanies} user={user} showToast={showToast} companySettings={companySettings} setCompanySettings={setCompanySettings} T={T}/>}
      {/* The Compliance matrix moved to the top-level Compliance page
          (#/compliance/matrix); legacy #/properties/compliance links
          are mapped across in parseHash. */}
      {portfolioTab==='contractors'&&<ContractorsPage user={user} companies={companies} showToast={showToast}/>}
      {portfolioTab==='map'&&<>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
          <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
          {[{id:'all',abbr:'All',color:T.goldText},...companies].map(c=>(
            <button key={c.id} onClick={()=>setCoFilter(c.id)} aria-pressed={coFilter===c.id} style={{fontFamily:SANS,fontSize:FS.sm,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.goldText):T.muted,transition:'all 0.18s'}}>{c.abbr||c.name}</button>
          ))}
        </div>
        <PropertyMap
          properties={filtered}
          setProperties={setProperties}
          showToast={showToast}
          onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}/>
      </>}
      {portfolioTab==='properties'&&<div>
      {/* Toolbar: search · Filters · Sort · layout */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:filtersOpen||activeCount?10:14,alignItems:'center'}}>
        <div style={{flex:isMobile?'1 1 100%':'1 1 260px',minWidth:0,position:'relative',display:'flex',alignItems:'center'}}>
          <span aria-hidden="true" style={{position:'absolute',left:10,display:'flex',color:T.muted,pointerEvents:'none'}}><Icon name="search" size={14}/></span>
          <input ref={searchRef} value={searchQ} onChange={e=>setSearchQ(e.target.value)} aria-label="Search properties" placeholder={isMobile?"Search properties or tenants…":"Search name, address, unit or tenant…"} style={{flex:1,minWidth:0,width:'auto',padding:'7px 30px',fontSize:12,minHeight:34}}/>
          {searchQ&&<button type="button" onClick={()=>{setSearchQ('');searchRef.current?.focus()}} aria-label="Clear search" title="Clear search"
            style={{position:'absolute',right:6,background:'transparent',border:'none',cursor:'pointer',color:T.muted,fontSize:16,lineHeight:1,padding:'4px 6px'}}>×</button>}
        </div>
        <button type="button" onClick={()=>setFiltersOpen(o=>!o)} aria-expanded={filtersOpen} aria-controls={filtersId}
          aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'}
          style={{...toolBtn,borderColor:activeCount?T.gold:T.border,color:activeCount?T.goldText:T.muted}}>
          <Icon name="list" size={14}/>Filters
          {activeCount>0&&<span aria-hidden="true" style={{minWidth:18,height:18,padding:'0 5px',borderRadius:9,background:T.gold,color:CV.onGold,fontSize:FS.xs,fontWeight:700,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{activeCount}</span>}
          <Icon name={filtersOpen?'chevron-down':'chevron-right'} size={12}/>
        </button>
        <label style={{display:'inline-flex',alignItems:'center',gap:6,flex:isMobile?'1 1 0':'0 0 auto',minWidth:0,fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>
          {!isMobile&&'Sort'}
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} aria-label="Sort properties by"
            style={{flex:1,minWidth:0,width:isMobile?'100%':'auto',padding:'6px 8px',fontFamily:SANS,fontSize:FS.sm,textTransform:'none',minHeight:34}}>
            {SORT_OPTIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </label>
        {sortBy==='custom'&&(
          <button type="button" onClick={resetCustomOrder} title="Reset to the default order (company → building → unit)" aria-label="Reset custom order"
            style={{...toolBtn,borderStyle:'dashed'}}>↺{!isMobile&&' Reset order'}</button>
        )}
        {/* List / Grid layout toggle (grid is the redesign card view) */}
        <div role="group" aria-label="Layout" style={{display:'flex',gap:2,background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:2,marginLeft:isMobile?0:'auto'}}>
          {[['list','list','List'],['grid','grid-2','Grid']].map(([k,ic,lbl])=>(
            <button key={k} type="button" onClick={()=>setPropLayout(k)} title={`${lbl} view`} aria-label={`${lbl} view`} aria-pressed={propLayout===k}
              style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',minHeight:28,minWidth:36,justifyContent:'center',borderRadius:7,cursor:'pointer',border:'none',
                background:propLayout===k?T.gold:'transparent',color:propLayout===k?CV.onGold:T.muted,
                fontFamily:SANS,fontSize:FS.sm,fontWeight:propLayout===k?700:400}}>
              <Icon name={ic} size={14}/>{!isMobile&&lbl}
            </button>
          ))}
        </div>
      </div>
      {filtersOpen&&(
        <div id={filtersId} className="card" style={{padding:'12px 14px',marginBottom:12,display:'grid',gap:10}}>
          <div role="group" aria-label="Company" style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span aria-hidden="true" style={groupLbl}>Company</span>
            {[{id:'all',abbr:'All',color:T.goldText},...companies].map(c=>(
              <button key={c.id} type="button" onClick={()=>setCoFilter(c.id)} aria-pressed={coFilter===c.id} style={{...chip,border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.goldText):T.muted}}>{c.abbr||c.name}</button>
            ))}
          </div>
          <div role="group" aria-label="Status" style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span aria-hidden="true" style={groupLbl}>Status</span>
            {['all', ...PROPERTY_STATUSES].map(f=>(
              <button key={f} type="button" onClick={()=>setStatusFilter(f)} aria-pressed={statusFilter===f} style={{...chip,border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold:'transparent',color:statusFilter===f?CV.onGold:T.muted}}>{f==='all'?'All':statusLabel(f)}</button>
            ))}
          </div>
          {(archivedCount>0||activeCount>0)&&(
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              {archivedCount>0&&<button type="button" onClick={()=>setShowArchived(v=>!v)} aria-pressed={showArchived}
                style={{...chip,border:`1px solid ${showArchived?T.muted:T.border}`,background:showArchived?T.muted+'22':'transparent',color:showArchived?T.text:T.muted,display:'inline-flex',alignItems:'center',gap:5}}>
                <Icon name="trash" size={12}/>{showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
              </button>}
              {activeCount>0&&<button type="button" onClick={clearFilters} style={{...chip,border:'none',background:'transparent',textDecoration:'underline',color:T.muted,marginLeft:'auto'}}>Clear filters</button>}
            </div>
          )}
        </div>
      )}
      {/* Active filters stay visible (and removable) while the panel is shut */}
      {!filtersOpen&&activeCount>0&&(
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:14}}>
          {activeChips.map(c=>(
            <button key={c.k} type="button" onClick={c.clear} aria-label={`Remove filter: ${c.l}`}
              style={{...chip,display:'inline-flex',alignItems:'center',gap:6,border:`1px solid ${T.gold}`,background:T.gold+'1A',color:T.goldText}}>
              {c.l}<span aria-hidden="true" style={{fontSize:13,lineHeight:1}}>×</span>
            </button>
          ))}
        </div>
      )}
      {propLayout==='grid'
        ? <PropertyGrid filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} yieldBasis={yieldBasis}/>
        : <DraggablePropertyList filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} setProperties={setProperties} properties={properties} sortBy={sortBy} yieldBasis={yieldBasis}/>}
      </div>}
    </div>
  )
}
