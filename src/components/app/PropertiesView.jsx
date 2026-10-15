import { canDo } from '../../lib/permissions'
import { ContractorsPage } from '../DashboardComponents'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS } from '../../lib/propertyStatus'
import { MONO, CV, FS } from '../../lib/styles'
import { Icon } from '../../lib/icons'
import { calcGrossYield } from '../../lib/propertyCalcs'
import { plural } from '../../lib/format'
import { PropertyMap } from './lazyViews'
import { fmt } from '../../lib/appFmt'
import { statusCfg } from './Badges'
import { PropertyGrid } from './PropertyGrid'
import { DraggablePropertyList } from './DraggablePropertyList'

// Properties view: filters, sort, layout toggle and the list / grid /
// map of properties. Moved verbatim from App.jsx; every value it reads is
// passed in explicitly.
export function PropertiesView({
  isMobile, T, filtered, properties, setPortfolioTab, portfolioTab, CompaniesPanel, companies,
  setCompanies, user, showToast, companySettings, setCompanySettings, setCoFilter, coFilter,
  setProperties, setSelectedId, setView, setDetailTab, setShowBuildingMortgage, permissionsMap,
  activeCoTab, devModeActive, openWorkflow, setEditProp, setShowAddProp, searchQ, setSearchQ,
  setStatusFilter, statusFilter, archivedCount, setShowArchived, showArchived, setSortBy, sortBy,
  resetCustomOrder, setPropLayout, propLayout, openDetail, yieldBasis,
}) {
  return (
    <div className="fade">
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:16}}>
        <div style={{flex:'1 1 auto',minWidth:0}}>
          <h1 style={{fontSize:isMobile?20:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Portfolio</h1>
          <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{filtered.length} of {plural(properties.length,'property','properties')} shown</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {[['properties','building','Properties'],['companies','grid','Companies'],['map','map','Map'],['contractors','wrench','Contractors']].map(([k,ic,l])=>(
            <button key={k} onClick={()=>setPortfolioTab(k)}
              style={{display:'inline-flex',alignItems:'center',gap:6,fontFamily:MONO,fontSize:11,padding:'6px 14px',borderRadius:8,cursor:'pointer',
                border:`1px solid ${portfolioTab===k?T.gold:T.border}`,
                background:portfolioTab===k?T.gold:'transparent',
                color:portfolioTab===k?CV.onGold:T.muted,fontWeight:portfolioTab===k?700:400}}>
              <Icon name={ic} size={14}/>{l}
            </button>
          ))}
        </div>
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
            <button key={c.id} onClick={()=>setCoFilter(c.id)} aria-pressed={coFilter===c.id} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.goldText):T.muted,transition:'all 0.18s'}}>{c.abbr||c.name}</button>
          ))}
        </div>
        <PropertyMap
          properties={filtered}
          setProperties={setProperties}
          showToast={showToast}
          onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}/>
      </>}
      {portfolioTab==='properties'&&<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {/* 🏦 Building Mortgage — bulk-edit mortgage details across
            every unit in a building in one save. Hidden unless the
            user can edit properties; modal itself handles the case
            where there are no multi-unit buildings yet. */}
        <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:'nowrap'}}
          onClick={()=>setShowBuildingMortgage(true)}
          disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive}
          title="Update a mortgage across all units in a building in one go"><span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="landmark" size={14}/>Building Mortgage</span></button>
        <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={()=>openWorkflow('bulk-add')} disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive} title="Add a block of flats (multiple units in one building)"><span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="building" size={14}/>+ Add Block</span></button>
        <button className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive} title={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive ? 'You don\'t have permission to add properties to this company' : ''}>+ Add Property</button>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
        <div style={{flex:'1 1 220px',minWidth:0,maxWidth:'100%',position:'relative',display:'flex',alignItems:'center'}}>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} aria-label="Search properties" placeholder="Search name, address, building, unit or tenant…" style={{flex:1,minWidth:0,width:'auto',padding:'7px 30px 7px 12px',fontSize:12}}/>
          {searchQ&&<button type="button" onClick={()=>setSearchQ('')} aria-label="Clear search" title="Clear search"
            style={{position:'absolute',right:6,background:'transparent',border:'none',cursor:'pointer',color:T.muted,fontSize:14,lineHeight:1,padding:'2px 4px'}}>×</button>}
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[{id:'all',abbr:'All',color:T.goldText},...companies].map(c=>(
            <button key={c.id} onClick={()=>setCoFilter(c.id)} aria-pressed={coFilter===c.id} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.goldText):T.muted,transition:'all 0.18s'}}>{c.abbr||c.name}</button>
          ))}
          <div style={{width:1,background:T.border,margin:'0 2px'}}/>
          {['all', ...PROPERTY_STATUSES].map(f=>(
            <button key={f} onClick={()=>setStatusFilter(f)} aria-pressed={statusFilter===f} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold:'transparent',color:statusFilter===f?CV.onGold:T.muted,transition:'all 0.18s'}}>{f==='all'?'All Status':(PROPERTY_STATUS_LABELS[f] || statusCfg(T)[f]?.label || f)}</button>
          ))}
          {archivedCount > 0 && (
            <>
              <div style={{width:1,background:T.border,margin:'0 2px'}}/>
              <button onClick={()=>setShowArchived(v=>!v)}
                title={showArchived ? `Hide ${archivedCount} archived` : `Show ${archivedCount} archived`}
                style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${showArchived?T.muted:T.border}`,
                  background:showArchived?T.muted+'22':'transparent',
                  color:showArchived?T.text:T.muted,transition:'all 0.18s',display:'inline-flex',alignItems:'center',gap:5}}>
                <Icon name="trash" size={12}/>{showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
              </button>
            </>
          )}
        </div>
      </div>
      {/* Sort control */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',flexShrink:0}}>Sort by:</span>
        {[
          {v:'company-name', l:'Company / Name'},
          {v:'name',         l:'Name A-Z'},
          {v:'status',       l:'Status'},
          {v:'rent-high',    l:'Rent (High-Low)'},
          {v:'yield-high',   l:'Yield (High-Low)'},
          {v:'arrears',      l:'Arrears'},
          {v:'value-high',   l:'Value (High-Low)'},
          {v:'custom',       l:'Custom Order'},
        ].map(opt=>(
          <button key={opt.v} onClick={()=>setSortBy(opt.v)} aria-pressed={sortBy===opt.v}
            style={{fontFamily:MONO,fontSize:FS.xs,padding:isMobile?'3px 8px':'4px 12px',minHeight:28,borderRadius:20,cursor:'pointer',
              border:`1px solid ${sortBy===opt.v?T.gold:T.border}`,
              background:sortBy===opt.v?T.gold:'transparent',
              color:sortBy===opt.v?CV.onGold:T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
            {opt.l}
          </button>
        ))}
        {sortBy==='custom'&&(
          <button onClick={resetCustomOrder} title="Reset to the default order (company → building → unit)"
            style={{fontFamily:MONO,fontSize:FS.xs,padding:isMobile?'3px 8px':'4px 12px',minHeight:28,borderRadius:20,cursor:'pointer',
              border:`1px dashed ${T.border}`,background:'transparent',color:T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
            ↺ Reset to default
          </button>
        )}
        {/* List / Grid layout toggle (grid is the redesign card view) */}
        <div style={{display:'flex',gap:2,marginLeft:'auto',background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:2}}>
          {[['list','list','List'],['grid','grid-2','Grid']].map(([k,ic,lbl])=>(
            <button key={k} onClick={()=>setPropLayout(k)} title={`${lbl} view`} aria-label={`${lbl} view`} aria-pressed={propLayout===k}
              style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',minHeight:28,minWidth:36,justifyContent:'center',borderRadius:7,cursor:'pointer',border:'none',
                background:propLayout===k?T.gold:'transparent',color:propLayout===k?CV.onGold:T.muted,
                fontFamily:MONO,fontSize:FS.xs,fontWeight:propLayout===k?700:400}}>
              <Icon name={ic} size={14}/>{!isMobile&&lbl}
            </button>
          ))}
        </div>
      </div>
      {propLayout==='grid'
        ? <PropertyGrid filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} yieldBasis={yieldBasis}/>
        : <DraggablePropertyList filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} setProperties={setProperties} properties={properties} sortBy={sortBy} yieldBasis={yieldBasis}/>}
      </div>}
    </div>
  )
}
