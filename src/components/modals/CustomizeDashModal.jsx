import { useState } from 'react'
import { MONO } from '../../lib/styles'
import FocusTrap from '../../lib/FocusTrap'
import { Icon, ICON_NAMES } from '../../lib/icons'

// ── CUSTOMIZE DASHBOARD WIDGETS MODAL ────────────────────────────────────
// Combined dashboard customization modal. Two tabs: Sections (top-level
// layout) and Widgets (KPI card customization). Both support up/down
// arrows AND HTML5 drag-and-drop. Pure JS — no third-party DnD library.
//
// Takes T (theme) as a prop rather than reading from useTheme() because
// the caller already has T in scope and threading it through avoids one
// extra context hop on a component that's only mounted on open.

export default function CustomizeDashModal({
  initialTab = 'sections',
  sectionDefs, currentSectionPrefs, defaultSectionOrder, defaultSectionEnabled, onSaveSections,
  widgetDefs, currentWidgetPrefs, defaultWidgetOrder, defaultWidgetEnabled, onSaveWidgets,
  onClose, T,
}) {
  const mono = MONO
  const [tab, setTab] = useState(initialTab)

  // Build initial section state, with all known keys
  const buildState = (current, defOrder, defEnabled) => {
    const map = {}; (current || []).forEach(w => { map[w.key] = w.enabled })
    const existing = (current || []).map(w => w.key)
    const existingSet = new Set(existing)
    const orderedKeys = existing.length > 0
      ? [...existing, ...defOrder.filter(k => !existingSet.has(k))]
      : [...defOrder]
    return orderedKeys.map(k => ({ key:k, enabled: map[k] !== undefined ? map[k] : (defEnabled[k] !== false) }))
  }
  const [sections, setSections] = useState(() =>
    buildState(currentSectionPrefs, defaultSectionOrder, defaultSectionEnabled))
  const [widgets, setWidgets] = useState(() =>
    buildState(currentWidgetPrefs, defaultWidgetOrder, defaultWidgetEnabled))

  // For drag-and-drop visual feedback
  const [dragKey, setDragKey] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  function activeList() { return tab === 'sections' ? sections : widgets }
  function setActiveList(updater) {
    if (tab === 'sections') setSections(updater)
    else                    setWidgets(updater)
  }
  function activeDefs() { return tab === 'sections' ? sectionDefs : widgetDefs }

  function toggle(key) {
    setActiveList(prev => prev.map(w => w.key === key ? { ...w, enabled: !w.enabled } : w))
  }
  function move(index, direction) {
    setActiveList(prev => {
      const newArr = [...prev]
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= newArr.length) return prev
      const tmp = newArr[index]
      newArr[index] = newArr[newIndex]
      newArr[newIndex] = tmp
      return newArr
    })
  }
  function moveByKey(srcKey, dstKey) {
    if (!srcKey || !dstKey || srcKey === dstKey) return
    setActiveList(prev => {
      const arr = [...prev]
      const srcIdx = arr.findIndex(w => w.key === srcKey)
      const dstIdx = arr.findIndex(w => w.key === dstKey)
      if (srcIdx < 0 || dstIdx < 0) return prev
      const [moved] = arr.splice(srcIdx, 1)
      arr.splice(dstIdx, 0, moved)
      return arr
    })
  }
  function resetToDefault() {
    if (tab === 'sections') {
      setSections(defaultSectionOrder.map(k => ({ key:k, enabled: defaultSectionEnabled[k] !== false })))
    } else {
      setWidgets(defaultWidgetOrder.map(k => ({ key:k, enabled: defaultWidgetEnabled[k] !== false })))
    }
  }
  function handleSave() {
    onSaveSections(sections)
    onSaveWidgets(widgets)
    onClose()
  }

  const list = activeList()
  const defs = activeDefs()
  const enabledCount = list.filter(w => w.enabled).length

  return (
    <div className="overlay" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={onClose}>
      <FocusTrap onEscape={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="customize-dash-modal-title" style={{background:T.surface,borderRadius:14,maxWidth:680,width:'100%',maxHeight:'90vh',overflow:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
          <div>
            <h2 id="customize-dash-modal-title" style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:4}}>Customize Dashboard</h2>
            <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>Drag to reorder, toggle to show/hide. {enabledCount} {tab === 'sections' ? 'sections' : 'cards'} on.</div>
          </div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
        </div>

        {/* Tab switcher */}
        <div style={{display:'flex',gap:6,marginBottom:14,borderBottom:`1px solid ${T.border}`}}>
          {['sections','widgets'].map(t => (
            <button key={t} onClick={()=>setTab(t)}
              style={{fontFamily:mono,fontSize:11,padding:'8px 14px',cursor:'pointer',background:'transparent',border:'none',
                color: tab === t ? T.gold : T.muted,
                borderBottom: tab === t ? `2px solid ${T.gold}` : '2px solid transparent',
                fontWeight: tab === t ? 700 : 400,
                marginBottom: -1,
              }}>
              {t === 'sections' ? 'Sections' : 'KPI Cards'}
            </button>
          ))}
        </div>

        <div style={{fontFamily:mono,fontSize:10,color:T.faint,marginBottom:10,fontStyle:'italic'}}>
          {tab === 'sections'
            ? 'Reorder major page sections. Drag the ⋮⋮ handle, or use the arrows.'
            : 'Reorder and toggle the KPI cards at the top of the dashboard.'}
        </div>

        <div style={{display:'grid',gap:8,marginBottom:16}}>
          {list.map((w, i) => {
            const def = defs[w.key]
            if (!def) return null
            const isDragging = dragKey === w.key
            const isDropTarget = dropTarget === w.key && dragKey !== w.key
            return (
              <div key={w.key}
                draggable
                onDragStart={(e) => { setDragKey(w.key); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(w.key); e.dataTransfer.dropEffect = 'move' }}
                onDragLeave={() => { if (dropTarget === w.key) setDropTarget(null) }}
                onDrop={(e) => { e.preventDefault(); moveByKey(dragKey, w.key); setDragKey(null); setDropTarget(null) }}
                onDragEnd={() => { setDragKey(null); setDropTarget(null) }}
                style={{
                  display:'flex',alignItems:'center',gap:10,
                  background: w.enabled ? T.card : T.bg,
                  border:`1px solid ${isDropTarget ? T.gold : (w.enabled ? T.border : T.border+'66')}`,
                  borderRadius:8,padding:'10px 12px',
                  opacity: isDragging ? 0.4 : (w.enabled ? 1 : 0.6),
                  transition:'opacity 0.15s, border-color 0.15s',
                  cursor:'move',
                }}>
                {/* Drag handle */}
                <div title="Drag to reorder" style={{fontFamily:mono,fontSize:14,color:T.muted,padding:'0 4px',userSelect:'none',cursor:'grab',lineHeight:1}}>⋮⋮</div>
                {/* Up/down arrows for keyboard/accessibility */}
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  <button onClick={()=>move(i,-1)} disabled={i===0}
                    style={{fontFamily:mono,fontSize:10,padding:'2px 6px',borderRadius:4,cursor:i===0?'default':'pointer',border:`1px solid ${T.border}`,background:T.surface,color:i===0?T.muted+'55':T.text}}>▲</button>
                  <button onClick={()=>move(i,1)} disabled={i===list.length-1}
                    style={{fontFamily:mono,fontSize:10,padding:'2px 6px',borderRadius:4,cursor:i===list.length-1?'default':'pointer',border:`1px solid ${T.border}`,background:T.surface,color:i===list.length-1?T.muted+'55':T.text}}>▼</button>
                </div>
                <div style={{fontSize:22,width:24,display:'flex',justifyContent:'center'}}>{ICON_NAMES.includes(def.icon)?<Icon name={def.icon} size={20} color={T.muted}/>:def.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:2}}>{def.label}</div>
                  <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{def.description}</div>
                </div>
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer'}} onClick={e=>e.stopPropagation()}>
                  <input type="checkbox" checked={w.enabled} onChange={()=>toggle(w.key)} style={{width:18,height:18,cursor:'pointer'}}/>
                  <span style={{fontFamily:mono,fontSize:10,color:w.enabled?T.green:T.muted,fontWeight:700,textTransform:'uppercase'}}>{w.enabled ? 'ON' : 'OFF'}</span>
                </label>
              </div>
            )
          })}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
          <button onClick={resetToDefault}
            style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
            ↻ Reset {tab === 'sections' ? 'sections' : 'cards'} to default
          </button>
          <div style={{display:'flex',gap:8}}>
            <button onClick={onClose}
              style={{fontFamily:mono,fontSize:11,padding:'8px 16px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
              Cancel
            </button>
            <button onClick={handleSave} className="btn btn-gold" style={{fontSize:11,padding:'8px 20px'}}>
              Save
            </button>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
