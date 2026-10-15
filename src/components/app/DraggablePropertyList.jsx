import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import { buildingTailFromName, buildingKeyFromName, naturalCompare } from '../../lib/addressUtils'
import { complianceStatusFor, complianceBadge } from '../../lib/complianceStatus'
import { MONO } from '../../lib/styles'
import { Icon } from '../../lib/icons'
import { pressable } from '../../lib/pressable'
import { plural } from '../../lib/format'
import { Badge, CompanyPill } from './Badges'

// ─── DRAGGABLE PROPERTY LIST ─────────────────────────────────────────────────
export function DraggablePropertyList({filtered, fmt, openDetail, calcGrossYield, setProperties, properties, sortBy, yieldBasis}) {
  const { T } = useTheme()
  // We deliberately do NOT keep a local `items` copy. Holding a duplicated
  // list created subtle bugs where the local copy lagged behind the parent's
  // `filtered` after deletes/edits — for example after soft-deleting a
  // property, the parent state filtered the row out but this component
  // still showed it until the next mount. Reading directly from `filtered`
  // every render keeps the source of truth in one place.
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const items = filtered

  function handleDragStart(e, idx) {
    setDragging(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', idx)
  }

  function handleDragOver(e, idx) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(idx)
  }

  function handleDrop(e, targetIdx) {
    e.preventDefault()
    if (dragging === null || dragging === targetIdx) return
    // Compute the new ordering of the visible items.
    const newOrder = [...items]
    const [moved] = newOrder.splice(dragging, 1)
    newOrder.splice(targetIdx, 0, moved)
    // Build a quick lookup of the new sort_order per id.
    const sortMap = new Map(newOrder.map((p, i) => [p.id, i]))
    // Update parent state so `filtered` will re-derive on the next render
    // with the new sort_order values applied. This replaces the previous
    // local-items approach which drifted from parent state.
    setProperties(prev => prev.map(p =>
      sortMap.has(p.id) ? { ...p, sort_order: sortMap.get(p.id) } : p
    ))
    // Persist new order to DB in background
    newOrder.forEach((p, i) => {
      if (p.sort_order !== i) {
        api.updatePropertySortOrder(p.id, i).catch(()=>{})
      }
    })
    setDragging(null)
    setDragOver(null)
  }

  function handleDragEnd() {
    setDragging(null)
    setDragOver(null)
  }

  if (items.length === 0) return (
    <div style={{fontFamily:MONO,color:T.muted,fontSize:12,textAlign:'center',padding:40}}>No properties match this filter.</div>
  )

  const isCustomSort = sortBy === 'custom' || !sortBy
  const isByCompany  = sortBy === 'company-name'

  // Precompute building counts so we only show a building header when a
  // building actually has 2+ adjacent items in the current sort. We skip
  // grouping in custom-sort mode to keep drag-and-drop semantics simple.
  const buildingCounts = new Map()
  if (!isCustomSort) {
    for (const p of items) {
      const tail = buildingKeyFromName(p.name)
      if (tail) buildingCounts.set(tail, (buildingCounts.get(tail) || 0) + 1)
    }
  }

  // When not in custom-sort mode, re-order items so units in the same
  // building are adjacent AND naturally sorted within the building
  // ("Flat 1, 2, 3, 10" instead of the lexical "Flat 1, 10, 2, 3").
  // Companies stay in their original relative order; standalone properties
  // keep their position relative to other standalones.
  let renderItems = items
  if (!isCustomSort) {
    // Tag items with a stable group key + original index so we can
    // group-sort without losing the parent's company ordering.
    const tagged = items.map((p, i) => ({
      p, i,
      tail: buildingKeyFromName(p.name) || null,
    }))
    // Determine which company each building first appears in so groups
    // stay anchored to their owning company in the company-sorted view.
    const firstSeen = new Map()
    tagged.forEach(({ p, i, tail }) => {
      const key = tail && buildingCounts.get(tail) > 1 ? `b:${tail}` : `s:${i}`
      if (!firstSeen.has(key)) firstSeen.set(key, { firstIdx: i, companyId: p.company_id })
    })
    // Sort: primary by group's first-seen index (preserves company order),
    // secondary by natural-compare of name (Flat 1 < Flat 10).
    renderItems = [...tagged].sort((a, b) => {
      const ak = a.tail && buildingCounts.get(a.tail) > 1 ? `b:${a.tail}` : `s:${a.i}`
      const bk = b.tail && buildingCounts.get(b.tail) > 1 ? `b:${b.tail}` : `s:${b.i}`
      if (ak !== bk) return firstSeen.get(ak).firstIdx - firstSeen.get(bk).firstIdx
      return naturalCompare(a.p.name, b.p.name)
    }).map(t => t.p)
  }

  return (
    <div style={{display:'grid',gap:8}}>
      {renderItems.map((p, idx) => {
        // Company group header when sorted by company. Look back into the
        // already-rendered (post-grouping) order, not the input array.
        const prev = idx > 0 ? renderItems[idx-1] : null
        const showCompanyHeader = isByCompany && (idx===0 || prev.company_id !== p.company_id)
        const co = p.company

        // Building grouping: header when the *previous* item had a different
        // building tail and this building has 2+ properties in the visible
        // list. Indent the row itself if it belongs to a multi-unit building.
        const tail = !isCustomSort ? buildingKeyFromName(p.name) : null
        const buildingSize = tail ? (buildingCounts.get(tail) || 0) : 0
        const inBuilding = buildingSize > 1
        const prevTail = prev ? buildingKeyFromName(prev.name) : null
        const showBuildingHeader = inBuilding && tail !== prevTail
        // Inside a multi-unit building, drop the redundant suffix from the
        // displayed name (so "Room 1, Watts Moses House" → "Room 1").
        const displayName = inBuilding ? (String(p.name||'').split(',')[0].trim() || p.name) : p.name

        return (
        <div key={p.id}>
          {showCompanyHeader&&co&&(
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:idx>0?16:0,marginBottom:8}}>
              <div style={{width:3,height:18,background:co.color||T.gold,borderRadius:2,flexShrink:0}}/>
              <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:co.color||T.goldText}}>{co.abbr}</span>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>{co.name}</span>
              <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>
                {renderItems.filter(x=>x.company_id===co.id).length} properties
              </span>
            </div>
          )}
          {showBuildingHeader&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:showCompanyHeader?6:10,marginBottom:6,paddingLeft:8}}>
              <Icon name="building" size={14} color={T.muted}/>
              <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{buildingTailFromName(p.name)}</span>
              <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>· {plural(buildingSize,'unit')}</span>
            </div>
          )}
          <div
          draggable={isCustomSort}
          onDragStart={e=>isCustomSort&&handleDragStart(e,idx)}
          onDragOver={e=>isCustomSort&&handleDragOver(e,idx)}
          onDrop={e=>isCustomSort&&handleDrop(e,idx)}
          onDragEnd={handleDragEnd}
          style={{
            opacity: dragging===idx ? 0.4 : 1,
            transform: dragOver===idx && dragging!==idx ? 'translateY(-2px)' : 'none',
            transition: 'opacity 0.15s, transform 0.15s',
          }}>
          <div className="card" style={{padding:'16px 20px',display:'flex',alignItems:'center',gap:12,
            borderColor: dragOver===idx && dragging!==idx ? T.gold : T.border,
            cursor:isCustomSort?'grab':'default',
            marginLeft: inBuilding ? 22 : 0,
            borderLeft: inBuilding ? `2px solid ${T.gold}33` : `1px solid ${dragOver===idx && dragging!==idx ? T.gold : T.border}`,
          }}>
            {/* Drag handle - only show in custom sort mode */}
            {isCustomSort&&<div style={{color:T.faint,fontSize:14,cursor:'grab',padding:'0 4px',flexShrink:0,userSelect:'none'}} title="Drag to reorder">&#x283F;</div>}
            {!isCustomSort&&<div style={{width:4,flexShrink:0}}/>}
            {/* Content */}
            <div style={{flex:1,minWidth:180,cursor:'pointer'}} {...pressable(()=>openDetail(p))}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                <span style={{fontSize:15,fontWeight:700}}>{displayName}</span>
                <CompanyPill company={p.company}/>
              </div>
              <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>
                {p.prop_type} · {p.address}
                {p.managed_by&&<span style={{marginLeft:8,color:T.faint,display:'inline-flex',alignItems:'center',gap:4,verticalAlign:'middle'}}><Icon name="building" size={11}/> {p.managed_by}</span>}
              </div>
            </div>
            {/* Stats — same action as the name block, via pressable() so it
                carries role=button and Enter/Space handling. Kept out of the
                tab order (tabIndex -1): the name block above is already the
                row's focusable "open property" control, and two tab stops per
                row doubled the keyboard path through a long portfolio. */}
            <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap',cursor:'pointer'}} {...pressable(()=>openDetail(p), { tabIndex: -1 })}>
              {/* Compliance status pill — only renders for properties
                  that have something expired/expiring/missing. Silently
                  absent for fully-compliant or unoccupied properties so
                  the row stays clean. */}
              {(() => {
                const cs = complianceStatusFor(p)
                const cfg = complianceBadge(cs, T)
                if (!cfg) return null
                return (
                  <div title="Tap to view compliance"
                    onClick={(e)=>{e.stopPropagation(); openDetail(p)}}
                    style={{display:'flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:999,
                      background:cfg.bg,color:cfg.color,
                      fontFamily:MONO,fontSize:10,fontWeight:700,whiteSpace:'nowrap'}}>
                    <Icon name={cfg.iconName} size={12}/><span>{cfg.label}</span>
                  </div>
                )
              })()}
              {p.arrears>0&&<div style={{display:'inline-flex',alignItems:'center',gap:4,fontFamily:MONO,fontSize:11,color:T.red,fontWeight:700}}><Icon name="alert-triangle" size={13}/> {fmt(p.arrears)}</div>}
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:MONO,fontSize:14,fontWeight:700,color:T.goldText}}>{calcGrossYield(p, yieldBasis).toFixed(1)}% yield</div>
                <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{fmt(p.rent_pcm) + "/mo"}</div>
              </div>
              <Badge status={p.status}/>
            </div>
          </div>
        </div>
        </div>
      )})}
    </div>
  )
}
