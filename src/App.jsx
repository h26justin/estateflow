
import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { useTheme } from './lib/ThemeContext'
import { useIsMobile } from './lib/useWindowSize'
import { ComplianceTab, TenancyTab, ExpensesTab, SettingsPage, NotesTimeline, OverviewTab, FinancialsTab, DocumentsTab, CompanyDocumentsTab } from './components/FeatureComponents'
import { MaintenanceTab } from './components/maintenance'
import { RightToRentTab, DepositProtectionTab, NoticeTrackerTab, RentHistoryTab, TenancyRenewalAlert } from './components/tenancy'
import { SmartAlerts, ContractorsPage, RentReviewModal } from './components/DashboardComponents'
import TenantInbox from './components/TenantInbox'
import ReportsPage from './components/ReportsPage'
import InsurancePage from './components/InsurancePage'
import { StatementImporter } from './components/StatementImporter'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/AuthContext'
import * as api from './lib/api'
import LoginPage from './components/LoginPage'
import OnboardingWizard from './components/OnboardingWizard'
import MarketingSite from './components/MarketingSite'
import BillingPage from './components/BillingPage'
import AdminDashboard from './components/AdminDashboard'
import TenantPortal from './components/TenantPortal'
import PrivacyPolicy from './components/PrivacyPolicy'
import DealsPage from './components/DealsPage'
import DayTrackerPage from './components/DayTrackerPage'
import OnboardingTour from './components/OnboardingTour'
import CalcExplain from './components/CalcExplain'
import ActionMenu from './components/ActionMenu'
import PropertyMap from './components/PropertyMap'
import BulkAddPropertyModal from './components/BulkAddPropertyModal'
import MoneyInput from './lib/MoneyInput'
import { aggregateDeals } from './lib/dealCashflow'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS, isPropertyEarningRent, isPropertyOccupied } from './lib/propertyStatus'
import { groupKeyForAddress, flatKeyWithinBuilding, buildingTailFromName } from './lib/addressUtils'
import { useConfirm } from './lib/ConfirmContext'
import { looksLikeCompanyInviteCode } from './lib/inviteUtils'
import { logError } from './lib/logError'
import FeedbackPage from './components/FeedbackPage'
import NotificationCentre from './components/NotificationCentre'
import CommandPalette from './components/CommandPalette'
import PortfolioInsightsWidget from './components/PortfolioInsightsWidget'
import TenantReferenceModal from './components/TenantReferenceModal'
import PropertyModal from './components/modals/PropertyModal'
import CompanyModal from './components/modals/CompanyModal'
import DeleteConfirmModal from './components/modals/DeleteConfirmModal'
import SellPropertyModal from './components/modals/SellPropertyModal'
import DeleteCompanyModal from './components/modals/DeleteCompanyModal'
import PaymentModal from './components/modals/PaymentModal'
import AccessModal from './components/modals/AccessModal'



const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

function calcMonthlyMortgage(p) {
  if (!p.mortgage_rate || !p.mortgage_amount) return 0
  const r = p.mortgage_rate/12, n=(p.mortgage_term||25)*12
  return p.mortgage_amount * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1)
}
function calcGrossYield(p, basis='cost') {
  const base = basis==='value'
    ? (p.current_value||p.est_value||0)
    : (p.purchase_price||0)+(p.refurb_cost||0)
  return base&&p.rent_pcm?((p.rent_pcm*12)/base)*100:0
}
function calcMonthlyProfit(p) {
  return (p.rent_pcm||0)-calcMonthlyMortgage(p)-(p.insurance||0)/12
}

// Permission helper — check if current user can perform action on a company
// permissionsMap: { [companyId]: { edit_properties: true, view_financial: false, ... } }
// Returns true if permission granted; treats missing company as allowed (backwards compat)
function canDo(permissionsMap, companyId, permissionKey) {
  if (!companyId) return true  // no company context
  const perms = permissionsMap?.[companyId]
  if (!perms) return true  // no permission data loaded yet → don't block
  return perms[permissionKey] === true
}

const STATUS_CFG = {
  rented:       {label:'Rented',       bg:'#0D2B1F',fg:'#2ECC8A',dot:'#2ECC8A'},
  notice_given: {label:'Notice given', bg:'#2B200A',fg:'#F0B850',dot:'#F0B850'},  // amber — still rented but vacancy looming
  let_agreed:   {label:'Let agreed',   bg:'#2B250A',fg:'#C8A84B',dot:'#C8A84B'},  // gold — contracts being signed, not yet rented
  vacant:       {label:'Vacant',       bg:'#2B1010',fg:'#E05555',dot:'#E05555'},
  purchased:    {label:'Purchased',    bg:'#2B200A',fg:'#E0943A',dot:'#E0943A'},
  refurb:       {label:'Refurbing',    bg:'#0A1A2B',fg:'#4B8FE0',dot:'#4B8FE0'},
  sold:         {label:'Sold',         bg:'#1A1A2B',fg:'#9B8AC2',dot:'#9B8AC2'},
}
const REFURB_CFG = {
  complete:     {label:'Complete',    color:'#2ECC8A'},
  'in-progress':{label:'In Progress', color:'#E0943A'},
  planned:      {label:'Planned',     color:'#4B8FE0'},
}

const Badge = memo(({status}) => {
  const { T } = useTheme()
  const c = STATUS_CFG[status]||STATUS_CFG.purchased
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:20,background:c.fg+'22',border:`1px solid ${c.fg}44`,color:c.fg,fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.dot,flexShrink:0}}/>{c.label}
  </span>
})

const HealthBadge = memo(({property}) => {
  const h = api.calcPropertyHealthScore(property, property.compliance_items||[], property.tenancy||null, property.maintenance_jobs||[], property.rent_payments||[])
  return (
    <span title={`Health: ${h.score}/100${h.issues.length ? ' · ' + h.issues[0].text : ''}`}
      style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:20,
        background:h.color+'22',color:h.color,fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:700,cursor:'default'}}>
      {h.grade} {h.score}
    </span>
  )
})

const CompanyPill = memo(({company}) => {
  if (!company) return null
  return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(company.color||'#C8A84B')+'22',color:company.color||'#C8A84B',border:`1px solid ${(company.color||'#C8A84B')}44`}}>{company.abbr}</span>
})

const StatCard = memo(({icon,label,value,sub,accent,breakdown}) => {
  const [open,setOpen] = useState(false)
  const { T } = useTheme()
  return (
    <div style={{background:T.card,border:`1px solid ${open?T.gold:T.border}`,borderRadius:12,padding:'20px 22px',transition:'border-color 0.2s',cursor:breakdown?'pointer':'default'}}
      onClick={breakdown?()=>setOpen(o=>!o):undefined}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div style={{fontSize:20,marginBottom:8}}>{icon}</div>
        {breakdown&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:open?T.gold:T.muted,letterSpacing:'0.1em',marginTop:2}}>{open?'▲ CLOSE':'▼ DETAIL'}</span>}
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:accent||T.gold,letterSpacing:'-0.02em',marginBottom:2}}>{value}</div>
      {sub&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint}}>{sub}</div>}
      {open&&breakdown&&(
        <div style={{marginTop:14,borderTop:`1px solid ${T.border}`,paddingTop:12,display:'grid',gap:4}}>
          {breakdown.map((item,i)=>(
            <div key={i}>
              {item.separator&&<div style={{borderTop:`1px solid ${T.border}`,margin:'4px 0'}}/>}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingLeft:item.indent?16:0}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:item.indent?9:10,color:item.indent?T.faint:T.muted,flex:1,display:'flex',alignItems:'center',gap:4}}>
                  {item.indent&&<span style={{color:T.border}}>└</span>}
                  {item.label}
                </span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:item.indent?10:11,fontWeight:item.indent?400:700,color:item.color||(item.indent?T.muted:T.text)}}>{item.value}</span>
              </div>
              {item.note&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.faint,marginTop:2,lineHeight:1.5,paddingLeft:2}}>{item.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

const MONTH_LETTER = ['J','F','M','A','M','J','J','A','S','O','N','D']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getStatusColor(status) {
  if (status==='paid')    return '#2ECC8A'
  if (status==='missed')  return '#E05555'
  if (status==='late') return '#E0943A'
  if (status==='refurb')  return '#4B8FE0'
  return '#888EA8' // void - visible in both themes
}

// ── DAY POPOVER ──────────────────────────────────────────────────────────────
function DayPopover({ payment, allPayments, onClose, onDayTracker }) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
  const year = payment.year, month = payment.month
  const days = new Date(year, month, 0).getDate()
  const firstDow = (new Date(year, month-1, 1).getDay() + 6) % 7

  function getDayStatus(day) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    if (dateStr > todayStr) return 'future'
    for (const p of allPayments) {
      if (p.period_start && p.period_end) {
        if (dateStr >= p.period_start && dateStr <= p.period_end) return p.status
      } else if (p.year === year && p.month === month) {
        return p.status
      }
    }
    return 'void'
  }

  const COLOR = { paid:'#2ECC8A', missed:'#E05555', late:'#E0943A', refurb:'#4B8FE0', void:'#888EA8', future:'transparent' }
  const monthName = new Date(year, month-1).toLocaleString('en-GB', {month:'long', year:'numeric'})
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  const statuses = Array.from({length:days},(_,i)=>getDayStatus(i+1))
  const paidDays = statuses.filter(s=>s==='paid').length
  const voidDays = statuses.filter(s=>s==='void').length
  const missedDays = statuses.filter(s=>s==='missed').length

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={onClose}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:20,width:300,boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:T.text}}>{monthName}</div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,color:T.muted,cursor:'pointer',lineHeight:1}}>×</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:4}}>
          {['M','T','W','T','F','S','S'].map((d,i)=>(
            <div key={i} style={{fontFamily:mono,fontSize:9,color:T.muted,textAlign:'center'}}>{d}</div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:14}}>
          {cells.map((d,i)=>{
            if (!d) return <div key={`b${i}`}/>
            const status = statuses[d-1]
            const col = COLOR[status]
            const isFuture = status==='future'
            return (
              <div key={d} title={`${d}: ${status}`} style={{
                aspectRatio:'1',borderRadius:3,
                background:isFuture?'transparent':col,
                border:isFuture?`1px dashed ${T.border}`:'none',
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>
                <span style={{fontFamily:mono,fontSize:8,color:isFuture?T.muted:'rgba(255,255,255,0.85)',fontWeight:700}}>{d}</span>
              </div>
            )
          })}
        </div>
        <div style={{display:'flex',gap:14,marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${T.border}`,flexWrap:'wrap'}}>
          {[[paidDays,'#2ECC8A','paid'],[voidDays,'#888EA8','void'],[missedDays,'#E05555','missed']].map(([v,c,l])=>(
            <div key={l} style={{fontFamily:mono,fontSize:10}}>
              <span style={{color:c,fontWeight:700}}>{v}</span>
              <span style={{color:T.muted}}> {l}</span>
            </div>
          ))}
          {payment.period_start&&<div style={{fontFamily:mono,fontSize:9,color:T.muted,marginLeft:'auto'}}>{payment.period_start} → {payment.period_end}</div>}
        </div>
        <button onClick={()=>{onClose();if(onDayTracker)onDayTracker()}}
          style={{width:'100%',fontFamily:mono,fontSize:11,fontWeight:700,padding:'9px 0',borderRadius:8,
            border:'none',background:'#C8A84B',color:'#1A2530',cursor:'pointer'}}>
          📅 View full day tracker →
        </button>
      </div>
    </div>
  )
}

const RentDots = ({payments, onUpdate, filterYear, onDayTracker}) => {
  if (!payments?.length) return null
  const [popover, setPopover] = useState(null)
  const sorted=[...payments].sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month)
  const filtered = filterYear ? sorted.filter(m=>m.year===filterYear) : sorted
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  return <>
    <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:8}}>
      {filtered.map(m=>{
        const isFuture = m.year > currentYear || (m.year === currentYear && m.month > currentMonth)
        const isCurrent = m.year === currentYear && m.month === currentMonth
        const col = getStatusColor(m.status)
        const letter = MONTH_LETTER[(m.month||1)-1]
        const boxStyle = isFuture
          ? { background:'transparent', border:'1px dashed rgba(128,128,128,0.35)', cursor:'default' }
          : isCurrent
            ? { background:col, border:`2px solid #C8A84B`, cursor:'pointer' }
            : { background:col, border:'1px solid transparent', cursor:'pointer' }
        const letterColor = isFuture ? 'rgba(128,128,128,0.45)' : '#fff'
        return (
          <div key={m.id}
            title={isFuture ? `${m.month_label}: future` : `${m.month_label}: ${m.status} — click for day view`}
            onClick={!isFuture ? ()=>setPopover(m) : undefined}
            style={{width:28,height:28,borderRadius:5,transition:'transform 0.15s, box-shadow 0.15s',
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,...boxStyle}}
            onMouseEnter={e=>{if(!isFuture){e.currentTarget.style.transform='scale(1.2)';e.currentTarget.style.boxShadow=`0 2px 8px ${col}88`}}}
            onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}
          >
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,fontWeight:700,color:letterColor,lineHeight:1,userSelect:'none'}}>{letter}</span>
          </div>
        )
      })}
    </div>
    {popover&&<DayPopover payment={popover} allPayments={payments} onClose={()=>setPopover(null)} onDayTracker={onDayTracker}/>}
  </>
}
const Spinner = () => {
  const { T } = useTheme()
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200}}>
    <div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
  </div>
}

// ── CUSTOMIZE DASHBOARD WIDGETS MODAL ────────────────────────────────────────
// Combined dashboard customization modal. Two tabs: Sections (top-level layout)
// and Widgets (KPI card customization). Both support up/down arrows AND
// HTML5 drag-and-drop. Pure JS — no third-party DnD library.
function CustomizeDashModal({
  initialTab = 'sections',
  sectionDefs, currentSectionPrefs, defaultSectionOrder, defaultSectionEnabled, onSaveSections,
  widgetDefs, currentWidgetPrefs, defaultWidgetOrder, defaultWidgetEnabled, onSaveWidgets,
  onClose, T,
}) {
  const mono = "'DM Mono',monospace"
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
      <div style={{background:T.surface,borderRadius:14,maxWidth:680,width:'100%',maxHeight:'90vh',overflow:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:4}}>⚙ Customize Dashboard</h2>
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
              {t === 'sections' ? '📐 Sections' : '📊 KPI Cards'}
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
                <div style={{fontSize:22}}>{def.icon}</div>
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
    </div>
  )
}

function PortfolioModellerWidget({ properties = [] }) {
  const { T } = useTheme()
  const [extraProps, setExtraProps] = useState(5)
  const [avgPrice, setAvgPrice] = useState(175000)
  const [avgYield, setAvgYield] = useState(6.5)
  const [years, setYears] = useState(10)
  const [growthRate, setGrowthRate] = useState(3)
  const mono = "'DM Mono',monospace"
  const currentIncome = properties.reduce((s,p) => s + (p.rent_pcm||0)*12, 0)
  const currentValue  = properties.reduce((s,p) => s + (p.current_value||p.est_value||0), 0)
  const newIncome = extraProps * avgPrice * (avgYield/100)
  const totalIncome = currentIncome + newIncome
  const totalValue  = currentValue + (extraProps * avgPrice)
  const futureValue = totalValue * Math.pow(1 + growthRate/100, years)
  const futureIncome= totalIncome * Math.pow(1 + 0.02, years)
  const f = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
  return (
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px',marginTop:16}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
        <span style={{fontSize:20}}>📈</span>
        <div style={{fontSize:14,fontWeight:700,color:T.text}}>Portfolio what-if modeller</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:16}}>
        {[
          {label:'Additional properties',min:0,max:50,step:1,val:extraProps,set:setExtraProps,suffix:' props'},
          {label:'Avg purchase price',min:50000,max:1000000,step:5000,val:avgPrice,set:setAvgPrice,prefix:'£',fmt:true},
          {label:'Target gross yield',min:2,max:15,step:0.5,val:avgYield,set:setAvgYield,suffix:'%'},
          {label:'Annual capital growth',min:0,max:10,step:0.5,val:growthRate,set:setGrowthRate,suffix:'%'},
          {label:'Time horizon',min:1,max:30,step:1,val:years,set:setYears,suffix:' yrs'},
        ].map(s=>(
          <div key={s.label}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>{s.label}</span>
              <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.gold}}>
                {s.prefix||''}{s.fmt?parseInt(s.val).toLocaleString('en-GB'):s.val}{s.suffix||''}
              </span>
            </div>
            <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
              onChange={e=>s.set(parseFloat(e.target.value))} style={{width:'100%'}}/>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        {[
          {label:'Today',value:f(currentIncome)+'/yr',sub:f(currentValue)+' portfolio',color:T.muted},
          {label:'After buying '+extraProps+' more',value:f(totalIncome)+'/yr',sub:f(totalValue)+' portfolio',color:'#2ECC8A'},
          {label:'In '+years+' years',value:f(futureIncome)+'/yr',sub:f(futureValue)+' portfolio',color:'#C8A84B'},
        ].map(k=>(
          <div key={k.label} style={{background:T.bg,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${k.color}`}}>
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:800,color:k.color}}>{k.value}</div>
            <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}


export default function App() {
  const {session,user,loading: authLoading} = useAuth()
  const confirmDialog = useConfirm()
  const [properties,  setProperties]  = useState([])
  // Deals loaded at App level so the Dashboard cashflow widget can read them.
  // DealsPage still owns its OWN local deals state for its own list/CRUD —
  // it pushes updates back here via onDealsChange so the dashboard stays
  // in sync without us having to fully lift state.
  const [dashboardDeals, setDashboardDeals] = useState([])
  // Insurance policies loaded at App level for the dashboard widget +
  // per-property indicators. The InsurancePage manages its own local copy
  // for CRUD; we don't try to keep them in sync constantly (re-fetched on
  // page mount). This is acceptable for slowly-changing data like policies.
  const [insurancePolicies, setInsurancePolicies] = useState([])
  const [companies,        setCompanies]        = useState([])
  const [companySettings,  setCompanySettings]   = useState({})  // companyId -> settings
  const [loading,     setLoading]      = useState(true)
  const [view,        setView]         = useState('dashboard')
  const [selectedId,  setSelectedId]   = useState(null)
  const [detailTab,   setDetailTab]    = useState('overview')
  // Selected report id when drilled into a specific report. Lifted up here
  // so it can participate in browser history (back/forward) instead of
  // being purely local state inside ReportsPage. null = catalogue view.
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [portfolioTab, setPortfolioTab] = useState('properties')
  const [coFilter,    setCoFilter]     = useState('all')
  const [dashCoFilter, setDashCoFilter] = useState([]) // [] = all companies
  const [statusFilter,setStatusFilter] = useState('all')
  const [searchQ,     setSearchQ]      = useState('')
  const [sortBy,      setSortBy]       = useState('company-name')
  const [showArchived,setShowArchived] = useState(false)
  const [activeCoTab, setActiveCoTab]  = useState(null)
  const [showAddProp, setShowAddProp]  = useState(false)
  const [showAddBulk, setShowAddBulk]  = useState(false)
  const [showAddCo,   setShowAddCo]    = useState(false)
  const [renameCoTarget, setRenameCoTarget] = useState(null)
  const [renameCo, setRenameCo]        = useState({ name:'', abbr:'' })
  const [renameCoPassword, setRenameCoPassword] = useState('')
  const [renameCoError, setRenameCoError] = useState('')
  const [renameCoSaving, setRenameCoSaving] = useState(false)
  const [deleteCoTarget, setDeleteCoTarget] = useState(null)  // company being soft-deleted
  const [showNewMenu, setShowNewMenu]  = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showPalette, setShowPalette]   = useState(false)
  const [showReferencing, setShowReferencing] = useState(false)
  const [editProp,    setEditProp]     = useState(null)
  const [toast,       setToast]        = useState(null)
  const [editingPayment, setEditingPayment] = useState(null)  // {payment, propId}
  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(null)
  const [showSellModal,      setShowSellModal]      = useState(null) // property id
  const [propertyActionBusy, setPropertyActionBusy] = useState(false)
  const [showImporter,       setShowImporter]       = useState(false)
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [isTenant, setIsTenant] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  // Dashboard widget customization
  const [widgetPrefs, setWidgetPrefs] = useState(null) // null = defaults
  // Dashboard section reordering & show/hide. Stored per-user in localStorage.
  // Format: [{ key: 'kpi_grid', enabled: true }, ...]
  // Keyed by user id so multiple users on the same browser don't share prefs.
  const [sectionPrefs, setSectionPrefs] = useState(null)
  // Customize-dashboard modal has two tabs: 'sections' and 'widgets'
  const [showCustomizeDash, setShowCustomizeDash] = useState(false)
  const [customizeDashTab, setCustomizeDashTab] = useState('sections')

  // ── Metadata for the customize modal ────────────────────────────────────
  // The actual render functions live inside the dashboard render block (so
  // they close over dashProps, companies, etc). These metadata constants are
  // used by CustomizeDashModal for display only.
  const SECTION_META = {
    kpi_grid:           { icon:'📊', label:'KPI cards',                   description:'Portfolio value, monthly rent, arrears, and other key metrics' },
    by_company:         { icon:'🏢', label:'By Company',                  description:'A card per company with its property/rent stats' },
    smart_alerts:       { icon:'⚠',  label:'Items needing attention',     description:'Smart alerts: overdue rent, expiring compliance, vacant properties' },
    tenant_inbox:       { icon:'📬', label:'Tenant Inbox',                description:'Latest messages and repair requests from tenants' },
    property_map:       { icon:'🗺', label:'Property Map',                description:'Compact map showing all your properties' },
    portfolio_modeller: { icon:'📈', label:'Portfolio What-If Modeller',  description:'Model rent changes, refinancing, and other scenarios' },
    company_documents:  { icon:'📁', label:'Company Documents',           description:'Documents stored at company level (only shows when a company is selected)' },
  }
  const SECTION_DEFAULT_ORDER   = ['kpi_grid','by_company','smart_alerts','tenant_inbox','property_map','portfolio_modeller','company_documents']
  const SECTION_DEFAULT_ENABLED = { kpi_grid:true, by_company:true, smart_alerts:true, tenant_inbox:true, property_map:true, portfolio_modeller:false, company_documents:true }

  const WIDGET_META = {
    portfolio_value:    { icon:'🏡', label:'Portfolio Value',         description:'Total property value and unrealised gains' },
    monthly_rent:       { icon:'💷', label:'Monthly Rental Income',   description:'Rent per month, occupancy, annualised' },
    arrears:            { icon:'⚠',  label:'Total Arrears',           description:'Overdue rent and vacant properties' },
    refurb:             { icon:'🔨', label:'In Refurbishment',        description:'Properties under renovation' },
    mortgages:          { icon:'🏦', label:'Mortgages Outstanding',   description:'Debt, equity and repayment costs' },
    cashflow_forecast:  { icon:'💰', label:'Cash Committed', description:'Total cash out across deals + properties, with 90-day urgency split' },
    insurance_renewals: { icon:'🛡', label:'Insurance Renewals',      description:'Policies expiring soon with annual premium totals' },
    property_count:     { icon:'🏠', label:'Property Count',          description:'Total properties with rented/vacant split' },
    occupancy_rate:     { icon:'📊', label:'Occupancy Rate',          description:'Occupancy % and vacancy cost' },
  }
  const WIDGET_DEFAULT_ORDER   = ['portfolio_value','monthly_rent','arrears','refurb','mortgages','cashflow_forecast','insurance_renewals','property_count','occupancy_rate']
  const WIDGET_DEFAULT_ENABLED = { portfolio_value:true, monthly_rent:true, arrears:true, refurb:true, mortgages:true, cashflow_forecast:true, insurance_renewals:true, property_count:false, occupancy_rate:false }

  // Developer mode toggle — lets a platform admin choose to "see everything"
  // (bypasses per-company permissions). Default OFF on every login: more
  // accurate preview of what a regular user sees, and avoids accidental
  // data exposure if the admin is screen-sharing.
  //
  // Persistence: stored in sessionStorage, OPT-IN. The flag records when
  // the user explicitly turned dev mode ON. Closing the tab / new login
  // clears it. (Previously this was inverted — default ON, opt-out — which
  // surprised admins on every login.)
  const [devModeEnabled, setDevModeEnabledState] = useState(() => {
    try { return sessionStorage.getItem('ownproperly_dev_mode_on') === '1' } catch(e) { return false }
  })
  const setDevModeEnabled = (v) => {
    try {
      if (v) sessionStorage.setItem('ownproperly_dev_mode_on', '1')
      else sessionStorage.removeItem('ownproperly_dev_mode_on')
    } catch(e) {}
    setDevModeEnabledState(v)
  }
  // Backwards-compat aliases for any code still using the old names —
  // these export the inverted semantics so callers don't need updating.
  const devModeDisabled = !devModeEnabled
  const setDevModeDisabled = (v) => setDevModeEnabled(!v)
  // Effective "see everything" flag — true ONLY when platform admin has
  // explicitly opted into dev mode for this session.
  const devModeActive = isPlatformAdmin && devModeEnabled
  // Per-company permission map: { [companyId]: { view_rent: true, edit_financial: false, ... } }
  const [permissionsMap, setPermissionsMap] = useState({})
  // Active feature flags for current user
  const [activeFlags, setActiveFlags] = useState(new Set())
  // Impersonation: when set, platform admin sees the app filtered to this user's data (read-only)
  const [impersonatingUser, setImpersonatingUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('ownproperly_impersonate') || 'null') } catch(e) { return null }
  })
  const [userNavPrefs, setUserNavPrefs] = useState(['dashboard','properties','companies','rent','deals','insurance','reports','contractors','settings'])
  const [yieldBasis, setYieldBasis]      = useState('cost') // 'cost' = purchase+refurb, 'value' = current value
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginMode, setLoginMode] = useState('login')
  const [trialWarning, setTrialWarning] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [announcements, setAnnouncements] = useState([])
  const [dismissedAnns, setDismissedAnns] = useState(() => { try { return JSON.parse(localStorage.getItem('dismissed_anns')||'[]') } catch(e) { return [] } })
  const { T, darkMode, setDarkMode, loadUserTheme } = useTheme()

  const CSS = `
  html,body,#root{width:100%;max-width:100%;overflow-x:hidden;}
  *{box-sizing:border-box;margin:0;padding:0;}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
  input,select,textarea{font-family:'DM Mono',monospace;background:${T.surface};border:1px solid ${T.border};color:${T.text};border-radius:8px;padding:8px 12px;width:100%;font-size:13px;outline:none;transition:border-color 0.2s;}
  input:focus,select:focus,textarea:focus{border-color:${T.gold};}
  select option{background:${T.surface};}
  label{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:${T.muted};display:block;margin-bottom:5px;}
  .btn{font-family:'DM Mono',monospace;font-weight:500;border:none;cursor:pointer;border-radius:8px;padding:8px 18px;font-size:12px;transition:all 0.18s;letter-spacing:0.03em;}
  .btn-gold{background:${T.gold};color:${T.bg};}.btn-gold:hover{background:${T.gold}dd;}
  .btn-ghost{background:transparent;color:${T.text};border:1px solid ${T.border};}.btn-ghost:hover{border-color:${T.gold};color:${T.gold};}
  .btn-danger{background:#2B1010;color:#E05555;border:1px solid #3D1A1A;}.btn-danger:hover{background:#3D1A1A;}
  .card{background:${T.card};border:1px solid ${T.border};border-radius:14px;}
  .pcard{cursor:pointer;transition:border-color 0.18s,transform 0.18s;}.pcard:hover{border-color:#C8A84B55;transform:translateY(-1px);}
  @media(max-width:768px){
    .nav-desktop{display:none!important;visibility:hidden!important;width:0!important;overflow:hidden!important;}
    .mobile-nav{display:flex!important;}
    .detail-grid{grid-template-columns:1fr!important;}
    .stat-grid{grid-template-columns:1fr 1fr!important;}
    .hide-mobile{display:none!important;}
    .stat-cards-grid{grid-template-columns:1fr 1fr!important;gap:8px!important;}
    .company-stats-grid{grid-template-columns:1fr 1fr!important;}
    .kpi-grid{grid-template-columns:1fr 1fr!important;}
    .summary-cards{grid-template-columns:1fr 1fr!important;}
    h1{font-size:20px!important;}
    h2{font-size:16px!important;}
    .pcard{padding:12px 14px!important;}
    main{padding:16px 12px 90px!important;}
    .tab{padding:6px 10px!important;font-size:11px!important;}
    .modal{margin:8px!important;max-height:95vh!important;overflow-y:auto!important;}
    .overlay{padding:0!important;align-items:flex-end!important;}
    .card{border-radius:10px!important;}
    input,select,textarea{font-size:16px!important;}
  }
  @media(min-width:769px){
    .mobile-nav{display:none!important;}
    .show-mobile{display:none!important;}
    .hide-mobile{display:flex!important;}
  }
  .mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:${T.surface};border-top:1px solid ${T.border};z-index:100;padding:8px 0 max(8px,env(safe-area-inset-bottom));}
  .fade{animation:fadeIn 0.25s ease;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px;backdrop-filter:blur(4px);}
  .modal{background:${T.surface};border:1px solid ${T.border};border-radius:18px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;}
  .tab{font-family:'DM Mono',monospace;font-size:11px;background:none;border:none;color:${T.muted};cursor:pointer;padding:8px 14px;border-radius:8px;transition:all 0.18s;letter-spacing:0.05em;}
  .tab.active{background:${T.border};color:${T.gold};}.tab:hover{color:${T.text};}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media(max-width:700px){.g2{grid-template-columns:1fr}}
`


  const isMobile = useIsMobile(769)
  const [showDrawer, setShowDrawer] = useState(false)
  const [userAccess,  setUserAccess]  = useState([])  // company_ids this user can see

  useEffect(()=>{
    const handler = () => setShowTour(true)
    window.addEventListener('ownproperly:restart-tour', handler)
    return () => window.removeEventListener('ownproperly:restart-tour', handler)
  }, [])

  // ── BROWSER HISTORY INTEGRATION ────────────────────────────────────────────
  // URLs map to state:
  //   #/dashboard                         → view=dashboard
  //   #/properties                        → view=properties, portfolioTab=properties
  //   #/properties/companies              → view=properties, portfolioTab=companies
  //   #/rent                              → view=rent
  //   #/rent/day                          → view=daytracker
  //   #/detail/<id>                       → view=detail, selectedId=<id>
  //   #/detail/<id>/<tab>                 → view=detail, selectedId=<id>, detailTab=<tab>
  //   #/settings                          → view=settings
  //   #/settings/<tab>                    → view=settings, settingsTab=<tab>
  //   #/admin/<tab>                       → open admin on a specific tab
  //   #/<anything-else>                   → view=<anything-else>
  useEffect(() => {
    const parseHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '')
      if (!h) return { view: 'dashboard' }
      const parts = h.split('/').filter(Boolean)
      if (parts[0] === 'detail' && parts[1]) {
        return { view: 'detail', selectedId: parts[1], detailTab: parts[2] || 'overview' }
      }
      if (parts[0] === 'settings') {
        return { view: 'settings', settingsTab: parts[1] || null }
      }
      if (parts[0] === 'admin') {
        return { view: 'admin', adminTab: parts[1] || null }
      }
      if (parts[0] === 'properties' && parts[1] === 'companies') {
        return { view: 'properties', portfolioTab: 'companies' }
      }
      if (parts[0] === 'rent' && parts[1] === 'day') {
        return { view: 'daytracker' }
      }
      // /reports                — catalogue
      // /reports/<reportId>     — drilled into a specific report
      if (parts[0] === 'reports' && parts[1]) {
        return { view: 'reports', selectedReportId: parts[1] }
      }
      return { view: parts[0] || 'dashboard' }
    }

    // Restore on first load
    const initial = parseHash()
    if (initial.view && initial.view !== 'dashboard') setView(initial.view === 'admin' ? 'dashboard' : initial.view)
    if (initial.selectedId) setSelectedId(initial.selectedId)
    if (initial.detailTab) setDetailTab(initial.detailTab)
    if (initial.portfolioTab) setPortfolioTab(initial.portfolioTab)
    if (initial.selectedReportId) setSelectedReportId(initial.selectedReportId)
    if (initial.view === 'admin') {
      setShowAdmin(true)
      if (initial.adminTab) window.dispatchEvent(new CustomEvent('ownproperly:set-admin-tab', { detail: { tab: initial.adminTab } }))
    }
    if (initial.settingsTab) window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab: initial.settingsTab } }))

    // Listen for browser back/forward
    const handlePopState = () => {
      const parsed = parseHash()
      if (parsed.view === 'admin') {
        setShowAdmin(true)
        if (parsed.adminTab) window.dispatchEvent(new CustomEvent('ownproperly:set-admin-tab', { detail: { tab: parsed.adminTab } }))
        return
      }
      setShowAdmin(false)
      setView(parsed.view || 'dashboard')
      setSelectedId(parsed.selectedId || null)
      // Always reflect the report id from the URL (including clearing it
      // when the user pops back from a specific report to the catalogue).
      setSelectedReportId(parsed.selectedReportId || null)
      if (parsed.detailTab) setDetailTab(parsed.detailTab)
      if (parsed.portfolioTab) setPortfolioTab(parsed.portfolioTab)
      if (parsed.settingsTab) window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab: parsed.settingsTab } }))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Sync to URL whenever navigation state changes
  useEffect(() => {
    if (!user) return
    // Leaving the reports view? Drop any selected report id so we don't
    // carry stale state into the next visit.
    if (view !== 'reports' && selectedReportId) {
      setSelectedReportId(null)
      return  // re-trigger this effect with the cleared id
    }
    let target = `#/${view}`
    if (view === 'detail' && selectedId) {
      target = `#/detail/${selectedId}`
      if (detailTab && detailTab !== 'overview') target += `/${detailTab}`
    } else if (view === 'properties' && portfolioTab === 'companies') {
      target = '#/properties/companies'
    } else if (view === 'daytracker') {
      target = '#/rent/day'
    } else if (view === 'reports' && selectedReportId) {
      // When drilled into a specific report, encode its id so browser
      // back returns to the catalogue (the bare /reports URL).
      target = `#/reports/${selectedReportId}`
    }
    if (window.location.hash !== target) {
      window.history.pushState({ view, selectedId, detailTab, portfolioTab, selectedReportId }, '', target)
    }
  }, [view, selectedId, detailTab, portfolioTab, selectedReportId, user])

  useEffect(()=>{
    if (!user) return
    async function loadData() {
      setLoading(true)
      try {
        const [cos, props, accessById, accessByEmail] = await Promise.all([
          api.fetchCompanies(),
          api.fetchProperties(),
          api.fetchUserAccess(user.id),
          api.fetchUserAccessByEmail(user.email)
        ])
        // Load deals separately and non-blocking — if it fails, the
        // dashboard widget falls back to "no data". Deals are not critical
        // to App boot.
        api.fetchDeals(user.id).then(setDashboardDeals).catch(()=>setDashboardDeals([]))
        // Load insurance policies for the dashboard widget. Non-blocking.
        api.fetchInsurancePolicies().then(setInsurancePolicies).catch(()=>setInsurancePolicies([]))
        // Merge access by ID and by email
        const allAccess = [...accessById, ...accessByEmail.filter(a=>!accessById.find(b=>b.company_id===a.company_id))]
        // If user was found by email but not ID, update their user_id
        if (accessByEmail.length > 0 && accessById.length === 0) {
          await api.updateUserIdByEmail(user.email, user.id)
        }
        const access = allAccess
        const accessIds = access.map(a=>a.company_id)
        // "isAdmin" here means "can see data for their companies" — NOT "can see all companies"
        // Only platform_admin should bypass filtering (handled separately below)
        const ownedCompanies = cos.filter(c => c.owner_id === user.id)
        const ownedIds = ownedCompanies.map(c => c.id)
        // A user has access to companies they own OR have been granted access to
        const isAdminUser = access.some(a=>a.is_admin || a.is_owner) || ownedCompanies.length > 0
        setIsAdmin(isAdminUser)
        setUserAccess(accessIds)

        // Check developer status EARLY — developers see everything (site owner / devs only)
        let isPlatformAdminFlag = false
        try {
          const { data: profileData } = await supabase.from('user_profiles').select('is_developer, platform_admin').eq('user_id', user.id).single()
          // Accept either is_developer (new) or platform_admin (legacy) for backwards compat
          isPlatformAdminFlag = profileData?.is_developer === true || profileData?.platform_admin === true
          setIsPlatformAdmin(isPlatformAdminFlag)
        } catch(e) { setIsPlatformAdmin(false) }

        // Load permissions map and active feature flags in parallel
        const devActiveEarly = isPlatformAdminFlag && !devModeDisabled
        try {
          const [permMap, flags, widgets] = await Promise.all([
            api.fetchMyPermissionsMap(devActiveEarly),
            api.fetchMyActiveFlags().catch(()=>new Set()),
            api.fetchWidgetPrefs().catch(()=>null),
          ])
          setPermissionsMap(permMap)
          setActiveFlags(flags)
          setWidgetPrefs(widgets)
        } catch(e) { logError('loadData:permissions+flags', e) }
        // Load dashboard section preferences from localStorage (per-user keyed)
        try {
          const raw = localStorage.getItem(`ownproperly_section_prefs_${user.id}`)
          if (raw) setSectionPrefs(JSON.parse(raw))
        } catch(e) { /* non-fatal — fall back to defaults */ }

        // If a pending invite token was stashed at signup (because the user
        // had to confirm their email before signing in), redeem it now while
        // we have a valid session. Clear the stash regardless of outcome so
        // we don't try forever on a bad token.
        try {
          const pending = localStorage.getItem('pending_invite_token')
          if (pending) {
            const isCode = looksLikeCompanyInviteCode(pending)
            try {
              if (isCode) {
                const result = await api.redeemCompanyInvite(pending)
                showToast(`Joined ${result?.company_name || 'company'} ✓`)
              } else {
                await api.acceptInvitation(pending)
                showToast('Invitation accepted ✓')
              }
            } catch(e) {
              if (e.message) showToast(e.message, 'error')
            }
            localStorage.removeItem('pending_invite_token')
          }
        } catch(e) { /* non-fatal */ }
        // Load user's saved theme preference from Supabase
        await loadUserTheme(user.id, user.email)
        // Load nav preferences
        try {
          const { data: prof } = await supabase.from('user_profiles').select('nav_items, yield_basis').eq('user_id', user.id).single()
          if (prof?.nav_items && prof.nav_items.length > 0) setUserNavPrefs(prof.nav_items)
          else setUserNavPrefs(['dashboard','properties','companies','rent','deals','insurance','reports','contractors','settings'])
          if (prof?.yield_basis) setYieldBasis(prof.yield_basis)
        } catch(e) { logError('loadData:nav_prefs', e) }
        // Load platform announcements
        try {
          const anns = await api.fetchAnnouncements()
          setAnnouncements(anns)
        } catch(e) { logError('loadData:announcements', e) }
        // Check if new user needs onboarding tour
        const onboarded = await api.fetchOnboardingStatus(user.id)
        if (!onboarded) setShowTour(true)
        // Build the set of company IDs this user has access to
        // = owned + shared-access rows
        const accessibleCompanyIds = new Set([...ownedIds, ...accessIds])

        // Check if developer mode is currently active (dev flag + toggle not disabled)
        const devActive = isPlatformAdminFlag && !devModeDisabled

        // Filter companies and properties:
        //   - Developers in active mode see EVERYTHING
        //   - Regular users (and devs who toggled dev mode off) see only companies they own or have shared access to
        let visibleCos = devActive ? cos : cos.filter(c => accessibleCompanyIds.has(c.id))
        let visibleProps = devActive ? props : props.filter(p => accessibleCompanyIds.has(p.company_id))

        // If impersonating, filter everything to only that user's data
        if (impersonatingUser) {
          try {
            const [targetAccess, targetAccessEmail] = await Promise.all([
              api.fetchUserAccess(impersonatingUser.id),
              api.fetchUserAccessByEmail(impersonatingUser.email)
            ])
            const targetCompanyIds = new Set([
              ...cos.filter(c => c.owner_id === impersonatingUser.id).map(c => c.id),
              ...targetAccess.map(a => a.company_id),
              ...targetAccessEmail.map(a => a.company_id),
            ])
            visibleProps = props.filter(p => targetCompanyIds.has(p.company_id))
          } catch(e) { console.error('Impersonation filter failed', e) }
        }
        setCompanies(visibleCos)
        setProperties(visibleProps)
        if(visibleCos.length>0) setActiveCoTab(visibleCos[0].id)
        // Show onboarding for brand new users with no companies
        if (visibleCos.length === 0) setShowOnboarding(true)
        try { api.sendOnboardingEmail(user.email, '', 'welcome').catch(()=>{}) } catch(e) {}
        // Drop trial-expiring notifications into the bell (deduped daily
        // per company via localStorage). Fire-and-forget; failure is fine.
        api.maybeWarnTrialsExpiring(visibleCos).catch(() => {})
        // Check for tenant invite link param
        const urlParams = new URLSearchParams(window.location.search)
        const tenantPropertyId = urlParams.get('tenant_property')
        if (tenantPropertyId) {
          try {
            await api.registerTenantProfile(user.id, tenantPropertyId)
            window.history.replaceState({}, '', window.location.pathname)
          } catch(e) { logError('loadData:registerTenantProfile', e) }
        }
        // Check if this user is a tenant (not a landlord)
        // Skip tenant portal if user has their own companies or is platform admin
        try {
          const tenantProfiles = await api.checkIsTenant(user.id)
          const myCompanies = await api.fetchMyCompanies().catch(()=>[])
          const isLandlord = myCompanies.length > 0 || devActive
          if (tenantProfiles.length > 0 && !isLandlord) { setIsTenant(true); return }
        } catch(e) { logError('loadData:tenantDetection', e) }
        // Auto-generate future rent months silently in background
        api.ensureFutureRentMonths(visibleProps, 6).then(count=>{
          if(count>0){
            api.fetchProperties().then(refreshed=>{
              const vis = devActive ? refreshed : refreshed.filter(p=>accessibleCompanyIds.has(p.company_id))
              setProperties(vis)
            })
          }
        }).catch(()=>{})
        // Load company settings
        const settingsMap = {}
        const settingsResults = await Promise.all(visibleCos.map(c=>api.fetchCompanySettings(c.id)))
        visibleCos.forEach((c,i)=>{
          settingsMap[c.id] = settingsResults[i] || {
            feature_compliance:true, feature_tenancy:true,
            feature_maintenance:true, feature_documents:true,
            feature_expenses:true, feature_reports:true
          }
        })
        setCompanySettings(settingsMap)
      } catch(e) {
        // Data load failed — DO NOT fall back to showing everything. Show an error state.
        console.error('Data load failed:', e)
        setCompanies([])
        setProperties([])
        setIsAdmin(false)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  },[user])

  // Expose loadData for refresh after import
  const refreshData = useCallback(async () => {
    try {
      const [props, cos] = await Promise.all([
        api.fetchProperties(),
        api.fetchCompanies(),
      ])
      // Apply same access filter — use userAccess + owned
      const { data: ownedCos } = await supabase.from('companies').select('id').eq('owner_id', user.id).is('deleted_at', null)
      const ownedIds = (ownedCos || []).map(c => c.id)
      const accessibleIds = new Set([...ownedIds, ...userAccess])
      if (isPlatformAdmin) {
        setProperties(props)
        setCompanies(cos)
      } else {
        setProperties(props.filter(p => accessibleIds.has(p.company_id)))
        setCompanies(cos.filter(c => accessibleIds.has(c.id)))
      }
      // If the user was viewing a tab for a company that no longer exists, clear it
      setActiveCoTab(prev => {
        if (!prev) return prev
        const stillExists = cos.some(c => c.id === prev)
        return stillExists ? prev : null
      })
    } catch(e) {}
  }, [userAccess, isPlatformAdmin, user])

  const filtered = useMemo(()=>{
    const f = properties.filter(p=>{
      if(!showArchived && p.archived_at) return false
      if(coFilter!=='all'&&p.company_id!==coFilter) return false
      if(statusFilter!=='all'&&p.status!==statusFilter) return false
      if(searchQ&&!p.name.toLowerCase().includes(searchQ.toLowerCase())&&!p.address.toLowerCase().includes(searchQ.toLowerCase())) return false
      return true
    })
    // Sort
    // Natural sort: handles "Room 2" < "Room 10" correctly
    const natSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    // Building-aware sort: properties in the same building cluster together,
    // then within a building they're ordered by flat/room number.
    const byBuilding = (a, b) => {
      const ka = groupKeyForAddress(a.address) || ''
      const kb = groupKeyForAddress(b.address) || ''
      if (ka !== kb) return natSort(ka, kb)
      return natSort(flatKeyWithinBuilding(a.name), flatKeyWithinBuilding(b.name))
    }
    return [...f].sort((a,b)=>{
      switch(sortBy) {
        case 'company-name': {
          const coA = a.company?.name||''; const coB = b.company?.name||''
          if(coA!==coB) return natSort(coA, coB)
          return byBuilding(a, b)
        }
        case 'name':         return byBuilding(a, b)
        case 'status':       return (a.status||'').localeCompare(b.status||'')
        case 'rent-high':    return (b.rent_pcm||0)-(a.rent_pcm||0)
        case 'rent-low':     return (a.rent_pcm||0)-(b.rent_pcm||0)
        case 'yield-high':   return calcGrossYield(b, yieldBasis)-calcGrossYield(a, yieldBasis)
        case 'arrears':      return (b.arrears||0)-(a.arrears||0)
        case 'value-high':   return (b.est_value||0)-(a.est_value||0)
        case 'custom':       return (a.sort_order||0)-(b.sort_order||0)
        default:             return 0
      }
    })
  },[properties,coFilter,statusFilter,searchQ,sortBy,showArchived])

  // Dashboard counts/widgets exclude archived properties unconditionally —
  // archived = "not actively managing." If you sold a flat 2 years ago you
  // don't want it inflating your Total Invested figure.
  const activeProperties = useMemo(() => properties.filter(p => !p.archived_at), [properties])
  const archivedCount = properties.length - activeProperties.length

  const dashProps = useMemo(()=>
    dashCoFilter.length === 0 ? activeProperties : activeProperties.filter(p => dashCoFilter.includes(p.company_id))
  , [activeProperties, dashCoFilter])

  const dashCos = useMemo(()=>
    dashCoFilter.length === 0 ? companies : companies.filter(c => dashCoFilter.includes(c.id))
  , [companies, dashCoFilter])

  // Stats computed from dashProps (filtered by selected companies).
  // Uses isPropertyEarningRent/isPropertyOccupied helpers so 'notice_given'
  // counts toward income and occupancy (tenant is still paying), while
  // 'let_agreed' does NOT (no tenant has moved in yet).
  const stats = useMemo(()=>({
    totalInvested:       dashProps.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
    totalEstVal:         dashProps.reduce((s,p)=>s+(p.est_value||0),0),
    monthlyRent:         dashProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0),
    totalArrears:        dashProps.reduce((s,p)=>s+(p.arrears||0),0),
    totalMortgage:       dashProps.reduce((s,p)=>s+(p.mortgage_amount||0),0),
    totalEquity:         dashProps.reduce((s,p)=>s+(p.est_value||0)-(p.mortgage_amount||0),0),
    monthlyMortgageCost: dashProps.reduce((s,p)=>{
      if(!p.mortgage_rate||!p.mortgage_amount) return s
      const r=p.mortgage_rate/12, n=(p.mortgage_term||25)*12
      return s+p.mortgage_amount*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1)
    },0),
    mortgaged:           dashProps.filter(p=>(p.mortgage_amount||0)>0).length,
    rented:              dashProps.filter(p=>isPropertyOccupied(p.status)).length,
    noticeGiven:         dashProps.filter(p=>p.status==='notice_given').length,
    letAgreed:           dashProps.filter(p=>p.status==='let_agreed').length,
    vacant:              dashProps.filter(p=>p.status==='vacant').length,
    inRefurb:            dashProps.filter(p=>p.refurb_status==='in-progress').length,
    total:               dashProps.length,
  }),[dashProps])

  const companyStats = useMemo(()=>dashCos.map(c=>{
    const ps=dashProps.filter(p=>p.company_id===c.id)
    return {...c, count:ps.length,
      invested:    ps.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
      estVal:      ps.reduce((s,p)=>s+(p.est_value||0),0),
      monthlyRent: ps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0),
      arrears:     ps.reduce((s,p)=>s+(p.arrears||0),0),
      rented:      ps.filter(p=>isPropertyOccupied(p.status)).length,
      vacant:      ps.filter(p=>p.status==='vacant').length,
    }
  }),[dashCos, dashProps])


  const showToast = useCallback((msg,type='success')=>{setToast({msg,type});setTimeout(()=>setToast(null),3500)},[])

  // Listen for global toast events so deep-tree components can trigger a
  // toast without receiving showToast as a prop. See src/lib/toast.js.
  useEffect(() => {
    function handler(e) { showToast(e.detail?.message, e.detail?.kind || 'success') }
    window.addEventListener('ownproperly:toast', handler)
    return () => window.removeEventListener('ownproperly:toast', handler)
  }, [showToast])

  // Global keyboard shortcut to open the command palette. Cmd+K on Mac,
  // Ctrl+K elsewhere. We skip when the user is typing into an input/textarea
  // or contenteditable to avoid hijacking their typing, EXCEPT when the
  // modifier is held (Cmd/Ctrl) — those combos should always open the
  // palette since the user is asking for the shortcut explicitly.
  useEffect(() => {
    function onKey(e) {
      const isPaletteKey = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (!isPaletteKey) return
      e.preventDefault()
      setShowPalette(o => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Commands list for the palette. Rebuilt whenever the underlying data
  // changes (properties / companies / view); cheap enough to recompute.
  const paletteCommands = useMemo(() => {
    const cmds = []
    // Navigation
    const navCmds = [
      { key:'dashboard',  icon:'🏠', label:'Dashboard' },
      { key:'properties', icon:'🏘', label:'Portfolio' },
      { key:'rent',       icon:'💰', label:'Rent Tracker' },
      { key:'deals',      icon:'🎯', label:'Deals' },
      { key:'insurance',  icon:'🛡', label:'Insurance' },
      { key:'reports',    icon:'📊', label:'Reports' },
      { key:'settings',   icon:'⚙',  label:'Settings' },
      { key:'feedback',   icon:'💬', label:'Send Feedback' },
    ]
    for (const n of navCmds) {
      cmds.push({
        id: `nav:${n.key}`, icon: n.icon, label: `Go to ${n.label}`,
        group: 'navigate', keywords: n.label,
        action: () => { setView(n.key); setSelectedId(null) },
      })
    }
    // Open property by name/address
    for (const p of properties) {
      cmds.push({
        id: `prop:${p.id}`, icon: '🏠', label: p.name || p.address || 'Untitled property',
        keywords: `${p.address || ''} ${p.company?.name || ''} ${p.company?.abbr || ''}`.trim(),
        group: 'open',
        hint: p.company?.abbr,
        action: () => { setSelectedId(p.id); setDetailTab('overview'); setView('detail') },
      })
    }
    // Open company by name
    for (const c of companies) {
      cmds.push({
        id: `co:${c.id}`, icon: '🏢', label: c.name,
        keywords: c.abbr,
        group: 'open',
        hint: 'Company',
        action: () => { setActiveCoTab(c.id); setView('properties'); setPortfolioTab('companies') },
      })
    }
    // Quick actions (matches the "+ New" menu)
    cmds.push(
      { id:'act:add-prop',   icon:'🏠', label:'Add Property',         group:'create', action:()=>{ setEditProp(null); setShowAddProp(true) } },
      { id:'act:add-bulk',   icon:'🏘', label:'Add Block of Flats',   group:'create', action:()=>setShowAddBulk(true) },
      { id:'act:add-co',     icon:'🏢', label:'Add Company',          group:'create', action:()=>setShowAddCo(true) },
      { id:'act:import',     icon:'📄', label:'Import Statement',     group:'create', action:()=>setShowImporter(true) },
      { id:'act:dark',       icon:'🌙', label: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        group:'action', keywords: 'theme toggle', action:()=>setDarkMode(!darkMode) },
      { id:'act:signout',    icon:'↗', label:'Sign Out',              group:'action', action:()=>supabase.auth.signOut() },
    )
    return cmds
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, companies, darkMode])

  // Early returns AFTER all hooks
  if (authLoading) return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style><div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>
  if (!session) return (
    <>
      <MarketingSite
        onSignIn={()=>{ setLoginMode('login'); setShowLoginModal(true) }}
        onSignUp={()=>{ setLoginMode('signup'); setShowLoginModal(true) }}
        onPrivacy={()=>setShowPrivacy(true)}
      />
      {showLoginModal && (
        <div onClick={e=>e.target===e.currentTarget&&setShowLoginModal(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16,backdropFilter:'blur(4px)'}}>
          <LoginPage key={`login-${loginMode}`} initialMode={loginMode} onClose={()=>setShowLoginModal(false)}/>
        </div>
      )}
    </>
  )
  if (showPrivacy) return <PrivacyPolicy onBack={()=>setShowPrivacy(false)}/>
  if (isTenant) return (
    <TenantPortal user={user}
      onSignOut={()=>supabase.auth.signOut()}
      onSwitchToLandlord={()=>setIsTenant(false)}
    />
  )

  if (showOnboarding) return <OnboardingWizard user={user} onComplete={()=>{ setShowOnboarding(false); refreshData() }}/>


  const selected = properties.find(p=>p.id===selectedId)

  function openDetail(p){setSelectedId(p.id);setDetailTab('overview');setView('detail')}

  async function handleSaveProp(formData){
    try{
      if(editProp?.id){
        const updated=await api.updateProperty(editProp.id,formData)
        setProperties(prev=>prev.map(p=>p.id===editProp.id?{...p,...updated}:p))
        showToast('Property updated')
      }else{
        const created=await api.createProperty({...formData,user_id:user.id})
        setProperties(prev=>[...prev,created])
        showToast('Property added')
      }
      setShowAddProp(false);setEditProp(null)
    }catch(e){showToast(e.message,'error')}
  }

  async function handleDeleteProp(id, password){
    try{
      // Re-authenticate with password before deleting
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email, password
      })
      if (error) { showToast('Incorrect password - property not deleted', 'error'); return false }
      // Soft-delete: flips deleted_at instead of hard-deleting. The property
      // moves to Trash where it can be restored within 30 days; the auto-purge
      // handles permanent removal. This means accidental deletes are
      // recoverable, and the row keeps existing for any FK-linked children
      // (refurb, expenses, compliance, etc) until the user explicitly purges.
      await api.softDeleteProperty(id, user.id)
      setProperties(prev=>prev.filter(p=>p.id!==id))
      setView('properties')
      setSelectedId(null)
      setShowDeleteConfirm(null)
      showToast('Property moved to Trash')
      return true
    }catch(e){showToast(e.message,'error'); return false}
  }

  async function handleDuplicateProp(id) {
    setPropertyActionBusy(true)
    try {
      const created = await api.duplicateProperty(id)
      setProperties(prev => [...prev, created])
      showToast(`Duplicated as "${created.name}"`)
      // Navigate to the new property
      setSelectedId(created.id)
      setView('detail')
      setDetailTab('overview')
    } catch (e) { showToast(e.message, 'error') }
    setPropertyActionBusy(false)
  }

  async function handleArchiveProp(id, archive = true) {
    setPropertyActionBusy(true)
    try {
      const updated = archive
        ? await api.archiveProperty(id)
        : await api.unarchiveProperty(id)
      setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
      showToast(archive ? 'Property archived' : 'Property restored')
      if (archive) {
        // Send the user back to the list — archived items are hidden by default
        setView('properties'); setSelectedId(null)
      }
    } catch (e) { showToast(e.message, 'error') }
    setPropertyActionBusy(false)
  }

  async function handleMarkSold(id, salePrice, saleDate) {
    setPropertyActionBusy(true)
    try {
      const updated = await api.markPropertyAsSold(id, salePrice, saleDate)
      setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
      setShowSellModal(null)
      showToast('Marked as sold')
    } catch (e) { showToast(e.message, 'error') }
    setPropertyActionBusy(false)
  }

  async function handleSaveCo(formData){
    try{
      const coId=await api.createCompanyForOwner(formData.name, formData.abbr, formData.color)
      // Fetch the newly created company to get the full row
      const { data: co } = await supabase.from('companies').select('*').eq('id', coId).single()
      if (!co) throw new Error('Company created but could not be loaded')
      // Auto-generate and save subdomain
      try {
        const sub = (formData.name||'')
          .toLowerCase()
          .replace(/\s+(property|group|ltd|limited|co|company|management|properties)\s*/gi,'')
          .replace(/[^a-z0-9]+/g,'-')
          .replace(/^-+|-+$/g,'')
          .slice(0,30)
        if (sub && co.id) await api.saveCompanySubdomain(co.id, sub)
      } catch(e) {}
      setCompanies(prev=>[...prev,co]);setActiveCoTab(co.id)
      showToast('Company added');setShowAddCo(false)
    }catch(e){showToast(e.message,'error')}
  }

  async function handleRenameCompany() {
    if (!renameCo.name.trim()) { setRenameCoError('Name is required'); return }
    if (!renameCoPassword) { setRenameCoError('Please enter your password to confirm'); return }
    setRenameCoSaving(true)
    setRenameCoError('')
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: renameCoPassword })
      if (authError) { setRenameCoError('Incorrect password'); setRenameCoSaving(false); return }
      const { error } = await supabase.from('companies')
        .update({ name: renameCo.name.trim(), abbr: renameCo.abbr.trim() || renameCo.name.trim().slice(0,5).toUpperCase() })
        .eq('id', renameCoTarget.id)
      if (error) throw error
      setCompanies(prev => prev.map(c => c.id === renameCoTarget.id ? { ...c, name: renameCo.name.trim(), abbr: renameCo.abbr.trim() || c.abbr } : c))
      showToast('Company renamed successfully')
      setRenameCoTarget(null)
      setRenameCo({ name: '', abbr: '' })
      setRenameCoPassword('')
    } catch(e) { setRenameCoError(e.message || 'Something went wrong') }
    setRenameCoSaving(false)
  }

  async function handleAddPhase(propId,phase){
    try{
      const created=await api.createRefurbPhase(propId,phase)
      setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_phases:[...(p.refurb_phases||[]),created]}:p))
    }catch(e){showToast(e.message,'error')}
  }

  async function handleAddCost(propId,cost){
    try{
      const created=await api.createRefurbCost(propId,cost)
      setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_costs:[...(p.refurb_costs||[]),created]}:p))
    }catch(e){showToast(e.message,'error')}
  }

  async function handleUpdatePhase(propId, phaseId, fields){
    try{
      const updated=await api.updateRefurbPhase(phaseId, fields)
      setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_phases:(p.refurb_phases||[]).map(ph=>ph.id===phaseId?updated:ph)}:p))
    }catch(e){showToast(e.message,'error')}
  }
  async function handleDeletePhase(propId, phaseId){
    if(!await confirmDialog({ title: 'Delete refurb phase?', confirmLabel: 'Delete', destructive: true })) return
    try{
      await api.deleteRefurbPhase(phaseId)
      setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_phases:(p.refurb_phases||[]).filter(ph=>ph.id!==phaseId)}:p))
    }catch(e){showToast(e.message,'error')}
  }
  async function handleUpdateCost(propId, costId, fields){
    try{
      const updated=await api.updateRefurbCost(costId, fields)
      setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_costs:(p.refurb_costs||[]).map(c=>c.id===costId?updated:c)}:p))
    }catch(e){showToast(e.message,'error')}
  }
  async function handleDeleteCost(propId, costId){
    if(!await confirmDialog({ title: 'Delete cost entry?', confirmLabel: 'Delete', destructive: true })) return
    try{
      await api.deleteRefurbCost(costId)
      setProperties(prev=>prev.map(p=>p.id===propId?{...p,refurb_costs:(p.refurb_costs||[]).filter(c=>c.id!==costId)}:p))
    }catch(e){showToast(e.message,'error')}
  }

  async function handleUpdatePropField(id,field,value){
    try{
      await api.updateProperty(id,{[field]:value})
      setProperties(prev=>prev.map(p=>p.id===id?{...p,[field]:value}:p))
    }catch(e){showToast(e.message,'error')}
  }

  async function handleUpdatePayment(payment, newStatus){
    try{
      await api.upsertRentPayment(payment.property_id, payment.year, payment.month, newStatus, payment.amount, payment.notes)
      setProperties(prev=>prev.map(p=>{
        if(p.id!==payment.property_id) return p
        return {...p, rent_payments: p.rent_payments.map(rp=>
          rp.id===payment.id ? {...rp, status:newStatus} : rp
        )}
      }))
      setEditingPayment(null)
      showToast(`${payment.month_label} marked as ${newStatus}`)
    }catch(e){showToast(e.message,'error')}
  }

  // Top-level navigation tabs. Feedback used to live here as a required tab,
  // but it's not a daily-use page — moved to the "⋯ More" menu in the
  // top-right so it doesn't clutter the primary navigation. Settings stays
  // as a tab because its sub-pages (billing, branding, team, notifications,
  // etc.) are deep and benefit from a dedicated landmark.
  const ALL_NAV=[
    {key:'dashboard',  label:'Dashboard',    icon:'🏠', short:'Home',     required:true},
    {key:'properties', label:'Portfolio',    icon:'🏘', short:'Portfolio',required:true},
    {key:'rent',       label:'Rent Tracker', icon:'💰', short:'Rent',     required:false},
    {key:'deals',      label:'Deals',        icon:'🎯', short:'Deals',    required:false},
    {key:'insurance',  label:'Insurance',    icon:'🛡', short:'Insurance',required:false},
    {key:'reports',    label:'Reports',      icon:'📊', short:'Reports',  required:false},
    {key:'settings',   label:'Settings',     icon:'⚙',  short:'Settings', required:true},
  ]
  const navItems = ALL_NAV.filter(n => n.required || userNavPrefs.includes(n.key))

  function CompaniesPanel({ companies, setCompanies, user, showToast, companySettings, setCompanySettings, T }) {
    const mono = "'DM Mono',monospace"

    function openRename(c) {
      setRenameCoTarget(c)
      setRenameCo({ name: c.name, abbr: c.abbr||'' })
      setRenameCoPassword('')
      setRenameCoError('')
    }

    return (
      <div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',margin:0}}>Companies</h2>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowAddCo(true)}>+ Add Company</button>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:22}}>
          {companies.map(c=>(
            <button key={c.id} className={`tab ${activeCoTab===c.id?'active':''}`}
              style={{border:`1px solid ${activeCoTab===c.id?c.color:T.border}`,color:activeCoTab===c.id?c.color:T.muted,background:activeCoTab===c.id?c.color+'11':'transparent'}}
              onClick={()=>setActiveCoTab(c.id)}>{c.name}</button>
          ))}
        </div>
        {companies.filter(c=>c.id===activeCoTab).map(c=>{
          const cs=companyStats.find(x=>x.id===c.id)||{count:0,rented:0,vacant:0,monthlyRent:0,invested:0,estVal:0,arrears:0}
          const cProps=activeProperties.filter(p=>p.company_id===c.id)
          return <div key={c.id}>
            {/* Company header with rename button */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:c.color||T.gold}}/>
                <span style={{fontSize:16,fontWeight:700,color:T.text}}>{c.name}</span>
                <span style={{fontFamily:mono,fontSize:10,fontWeight:700,background:(c.color||T.gold)+'22',color:c.color||T.gold,padding:'2px 8px',borderRadius:4}}>{c.abbr}</span>
              </div>
              {(canDo(permissionsMap, c.id, 'edit_company_settings') || devModeActive) && (
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>openRename(c)}
                    style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
                    ✏ Rename
                  </button>
                  {(c.owner_id === user?.id || devModeActive) && (
                    <button onClick={()=>setDeleteCoTarget(c)}
                      style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:`1px solid ${T.red}33`,background:'transparent',color:T.red,cursor:'pointer'}}>
                      🗑 Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:12,marginBottom:22}}>
              <StatCard icon="🏠" label="Properties" value={cs.count} sub={`${cs.rented} rented · ${cs.vacant} vacant`}/>
              <StatCard icon="💷" label="Monthly Rent" value={fmt(cs.monthlyRent)} sub={fmt(cs.monthlyRent*12)+'/yr'} accent={T.green}/>
              <StatCard icon="📊" label="Total Invested" value={fmt(cs.invested)} sub={`Est. ${fmt(cs.estVal)}`}/>
              <StatCard icon="⚠" label="Arrears" value={fmt(cs.arrears)} accent={cs.arrears>0?T.red:T.green}/>
            </div>
            <div style={{display:'grid',gap:10}}>
              {cProps.map(p=>{
                const canFin = canDo(permissionsMap, p.company_id, 'view_financial') || devModeActive
                return (
                <div key={p.id} className="card pcard" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}} onClick={()=>openDetail(p)}>
                  <div style={{flex:1,minWidth:150}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{p.name}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{p.prop_type} · {p.address}</div>
                  </div>
                  {p.arrears>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.red}}>⚠ {fmt(p.arrears)}</div>}
                  {canFin && <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:T.gold}}>{calcGrossYield(p, yieldBasis).toFixed(1)}%</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'0.05em'}}>{yieldBasis==='value'?'on value':'on cost'}</div>
                    </div>}
                  {canFin && <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted}}>{fmt(p.rent_pcm)+'/mo'}</div>}
                  <Badge status={p.status}/>
                </div>
              )})}
              {cProps.length===0&&<div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,padding:'32px',textAlign:'center'}}>No properties for this company yet.{(canDo(permissionsMap, activeCoTab, 'edit_properties') || devModeActive) && <><br/><button className="btn btn-gold" style={{fontSize:11,marginTop:12}} onClick={()=>{setEditProp({company_id:activeCoTab});setShowAddProp(true)}}>+ Add Property</button></>}</div>}
            </div>
          </div>
        })}


      </div>
    )
  }

  return (
    <div style={{fontFamily:"'Fraunces',Georgia,serif",minHeight:'100vh',width:'100%',maxWidth:'100vw',overflowX:'hidden',background:T.bg,color:T.text,transition:'background 0.3s, color 0.3s'}}>
      <style>{CSS}</style>
      {/* ── IMPERSONATION BANNER ── */}
      {impersonatingUser && (
        <div style={{background:'#8B1F1F',color:'white',padding:'10px 16px',textAlign:'center',fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:600,position:'sticky',top:0,zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',gap:16,flexWrap:'wrap'}}>
          <span>🎭 <strong>Impersonating {impersonatingUser.name || impersonatingUser.email}</strong> — viewing their data (read-only for safety)</span>
          <button onClick={()=>{
            sessionStorage.removeItem('ownproperly_impersonate')
            setImpersonatingUser(null)
            window.location.reload()
          }} style={{background:'white',color:'#8B1F1F',border:'none',padding:'5px 14px',borderRadius:5,fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer'}}>
            ✕ Stop impersonating
          </button>
        </div>
      )}
      {/* ── DEVELOPER MODE BANNER (with toggle) ── */}
      {isPlatformAdmin && !impersonatingUser && (
        <div style={{
          background: devModeActive ? '#1A2530' : '#2a4a2a',
          color: devModeActive ? '#C8A84B' : '#9ecb9e',
          padding:'6px 16px',
          textAlign:'center',
          fontFamily:"'DM Mono',monospace",
          fontSize:10,
          fontWeight:700,
          letterSpacing:'0.1em',
          borderBottom: devModeActive ? '1px solid #C8A84B44' : '1px solid #9ecb9e44',
          display:'flex',
          alignItems:'center',
          justifyContent:'center',
          gap:16,
          flexWrap:'wrap'
        }}>
          {devModeActive ? (
            <>
              <span>🔐 DEVELOPER MODE — you see all user data across the platform</span>
              <button onClick={()=>{ setDevModeDisabled(true); window.location.reload() }}
                style={{background:'#C8A84B',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:9,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                👤 VIEW AS REGULAR USER
              </button>
            </>
          ) : (
            <>
              <span>👤 REGULAR USER VIEW — permission gates active (data-level access unchanged)</span>
              <button onClick={()=>{ setDevModeDisabled(false); window.location.reload() }}
                style={{background:'#9ecb9e',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:9,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                🔐 ENABLE DEVELOPER MODE
              </button>
            </>
          )}
        </div>
      )}
      {/* ── HEADER ── */}
      <a href='#main-content' style={{position:'absolute',left:'-9999px',top:'auto',width:1,height:1,overflow:'hidden'}} onFocus={e=>{e.target.style.left='16px';e.target.style.width='auto';e.target.style.height='auto'}} onBlur={e=>{e.target.style.left='-9999px';e.target.style.width='1px';e.target.style.height='1px'}}>Skip to main content</a>
      <header role='banner' style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 16px',position:'sticky',top:0,zIndex:100,width:'100%'}}>
        <div style={{maxWidth:1240,margin:'0 auto',height:52,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          {/* Logo */}
          <div style={{display:'flex',alignItems:'center',flexShrink:0}}>
            <img src="/logo.svg" alt="OwnProperly" style={{height:38,width:'auto'}}/>
          </div>

          {/* Desktop nav */}
          {!isMobile&&<nav style={{display:'flex',gap:2,flex:1,justifyContent:'center'}}>
            {navItems.map(n=>(
              <button key={n.key} className={`tab ${view===n.key||(view==='detail'&&n.key==='properties')?'active':''}`}
                onClick={()=>{setView(n.key);if(n.key!=='detail')setSelectedId(null)}} aria-current={view===n.key?'page':undefined}>
                {n.icon} {n.label}
              </button>
            ))}
          </nav>}

          {/* Mobile: current page title */}
          {isMobile&&<div style={{flex:1,textAlign:'center',fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>
            {navItems.find(n=>n.key===view)?.icon} {navItems.find(n=>n.key===view)?.label||'Dashboard'}
          </div>}

          {/* Right side */}
          <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
            {!isMobile&&(
              <div style={{position:'relative'}}>
                <button className="btn btn-gold" style={{fontSize:11,padding:'6px 14px',display:'flex',alignItems:'center',gap:6}}
                  onClick={()=>setShowNewMenu(m=>!m)}>
                  <span style={{fontSize:14,fontWeight:700}}>+</span> New
                  <span style={{fontSize:9,opacity:0.8}}>{showNewMenu?'▲':'▼'}</span>
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
                        {icon:'🏠',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true)}},
                        {icon:'🏘',label:'Add Block of Flats', action:()=>setShowAddBulk(true)},
                        {icon:'🏢',label:'Add Company',     action:()=>setShowAddCo(true)},
                        {icon:'📄',label:'Import Statement',action:()=>setShowImporter(true)},
                        {icon:'💰',label:'Log Expense',     action:()=>{setView('properties');showToast('Open a property and go to Expenses tab')}},
                        {icon:'📋',label:'Add Compliance',  action:()=>{setView('properties');showToast('Open a property and go to Compliance tab')}},
                        {icon:'🔧',label:'Log Maintenance', action:()=>{setView('properties');showToast('Open a property and go to Maintenance tab')}},
                      ].map((item,i,arr)=>(
                        <button key={item.label} onClick={()=>{item.action();setShowNewMenu(false)}}
                          style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                            background:'none',border:'none',borderRadius:8,cursor:'pointer',textAlign:'left',
                            borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',
                            transition:'background 0.15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}>
                          <span style={{fontSize:16,width:22,textAlign:'center'}}>{item.icon}</span>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,fontWeight:500}}>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <NotificationCentre/>
            {isPlatformAdmin&&<button className="btn btn-ghost" style={{fontSize:11,padding:'6px 12px',color:T.gold,borderColor:T.gold+'44'}} onClick={()=>setShowAdmin(true)}>⚙ Admin</button>}
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
                        {icon:'⌘', label:'Search & jump…', hint:'⌘K', action:()=>setShowPalette(true)},
                        {icon:'💬',label:'Feedback',  action:()=>{setView('feedback');setSelectedId(null)}},
                        {icon:'↗', label:'Sign Out',  action:()=>supabase.auth.signOut(), divider:true},
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
                          <span style={{fontSize:14,width:22,textAlign:'center'}}>{item.icon}</span>
                          <span style={{flex:1,fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,fontWeight:500}}>{item.label}</span>
                          {item.hint && <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,padding:'1px 5px'}}>{item.hint}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
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

      {/* ── MOBILE DRAWER ── */}
      {isMobile&&showDrawer&&(
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex'}}>
          {/* Backdrop */}
          <div style={{flex:1,background:'rgba(0,0,0,0.6)'}} onClick={()=>setShowDrawer(false)}/>
          {/* Drawer panel */}
          <div style={{width:260,background:T.surface,height:'100%',display:'flex',flexDirection:'column',borderLeft:`1px solid ${T.border}`}}>
            {/* Drawer header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:`1px solid ${T.border}`}}>
              <div style={{display:'flex',alignItems:'center'}}>
                <img src="/logo.svg" alt="OwnProperly" style={{height:32,width:'auto'}}/>
              </div>
              <button onClick={()=>setShowDrawer(false)}
                style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer',padding:'4px'}}>✕</button>
            </div>
            {/* Nav items */}
            <div style={{flex:1,overflowY:'auto',padding:'12px 0'}}>
              {navItems.map(n=>(
                <button key={n.key}
                  onClick={()=>{setView(n.key);setSelectedId(null);setShowDrawer(false)}}
                  style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 20px',
                    background:view===n.key?T.gold+'18':'none',
                    border:'none',borderLeft:view===n.key?`3px solid ${T.gold}`:'3px solid transparent',
                    cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}>
                  <span style={{fontSize:18,width:24,textAlign:'center'}}>{n.icon}</span>
                  <span style={{fontSize:14,fontWeight:view===n.key?600:400,color:view===n.key?T.gold:T.text}}>{n.label}</span>
                </button>
              ))}
            </div>
            {/* Drawer footer */}
            <div style={{padding:'16px 20px',borderTop:`1px solid ${T.border}`,display:'flex',flexDirection:'column',gap:6}}>
              {[
                {icon:'🏠',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true);setShowDrawer(false)}},
                {icon:'🏘',label:'Add Block of Flats', action:()=>{setShowAddBulk(true);setShowDrawer(false)}},
                {icon:'🏢',label:'Add Company',     action:()=>{setShowAddCo(true);setShowDrawer(false)}},
                {icon:'📄',label:'Import Statement',action:()=>{setShowImporter(true);setShowDrawer(false)}},
                {icon:'💰',label:'Log Expense',     action:()=>{setView('properties');showToast('Open a property → Expenses tab');setShowDrawer(false)}},
                {icon:'🔧',label:'Log Maintenance', action:()=>{setView('properties');showToast('Open a property → Maintenance tab');setShowDrawer(false)}},
              ].map(item=>(
                <button key={item.label} onClick={item.action}
                  style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
                    background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                  <span style={{fontSize:15}}>{item.icon}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.text,fontWeight:500}}>{item.label}</span>
                </button>
              ))}
              <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px',marginTop:4}}
                onClick={()=>{setView('feedback');setSelectedId(null);setShowDrawer(false)}}>
                💬 Send Feedback
              </button>
              <button className="btn btn-ghost" style={{width:'100%',fontSize:12,padding:'10px'}}
                onClick={()=>supabase.auth.signOut()}>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Platform announcement banner */}
      {announcements.filter(a=>!dismissedAnns.includes(a.id)).map(a=>{
        const colors={info:'#4B8FE0',warning:'#E0943A',success:'#2ECC8A'}
        const col=colors[a.type]||colors.info
        return (
          <div key={a.id} style={{background:col+'18',borderBottom:`1px solid ${col}33`,padding:'10px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:col}}>
              {a.message}{a.link_url&&a.link_text&&<a href={a.link_url} target="_blank" rel="noreferrer" style={{color:col,marginLeft:12,fontWeight:700}}>{a.link_text} →</a>}
            </span>
            <button onClick={()=>{const n=[...dismissedAnns,a.id];setDismissedAnns(n);localStorage.setItem('dismissed_anns',JSON.stringify(n))}}
              style={{background:'none',border:'none',color:col,cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:11,flexShrink:0}}>Dismiss ✕</button>
          </div>
        )
      })}
      <main style={{maxWidth:1240,margin:'0 auto',padding:isMobile?'16px 12px 90px':'28px 24px',width:'100%'}}>
        {loading?<Spinner/>:<>

          {view==='dashboard'&&<div className="fade">
            <div style={{marginBottom:isMobile?14:20}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:isMobile?10:16}}>
                <div>
                  <h1 style={{fontSize:isMobile?20:28,fontWeight:700,letterSpacing:'-0.03em',marginBottom:isMobile?2:4}}>Portfolio Overview</h1>
                  <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:isMobile?11:12,lineHeight:1.5}}>
                    {stats.total} properties · {stats.rented} rented{stats.noticeGiven>0?` (${stats.noticeGiven} on notice)`:''}{stats.letAgreed>0?` · ${stats.letAgreed} let agreed`:''} · {stats.vacant} vacant{dashCoFilter.length>0?` · ${dashCoFilter.length} of ${companies.length} companies`:` · ${companies.length} companies`}
                    {dashProps.some(p=>p.current_value>0) && <>
                      {/* On mobile drop to a new line so the value/equity pair has its own row */}
                      {isMobile ? <br/> : ' · '}
                      <span style={{color:T.muted}}>Value </span>
                      <span style={{color:T.green,fontWeight:700}}>
                        {new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(dashProps.reduce((s,p)=>s+(p.current_value||0),0))}
                      </span>
                      {' · '}
                      <span style={{color:T.muted}}>Equity </span>
                      <span style={{color:T.green,fontWeight:700}}>
                        {new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(dashProps.reduce((s,p)=>s+(p.current_value||0)-(p.mortgage_amount||0),0))}
                      </span>
                    </>}
                  </p>
                </div>
              </div>
              {/* Company filter pills */}
              {companies.length > 1 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
                  <button
                    onClick={()=>setDashCoFilter([])}
                    style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                      border:`1px solid ${dashCoFilter.length===0?T.gold:T.border}`,
                      background:dashCoFilter.length===0?T.gold+'22':'transparent',
                      color:dashCoFilter.length===0?T.gold:T.muted,fontWeight:dashCoFilter.length===0?700:400}}>
                    All companies
                  </button>
                  {companies.map(c=>{
                    const sel = dashCoFilter.includes(c.id)
                    return (
                      <button key={c.id}
                        onClick={()=>setDashCoFilter(prev=>{
                          if(prev.length===0) {
                            // Was 'all' — switch to just this one
                            return [c.id]
                          }
                          if(prev.includes(c.id)) {
                            // Already selected — deselect. If empty after, go back to 'all'
                            const next = prev.filter(id=>id!==c.id)
                            return next
                          }
                          // Add to selection
                          const next = [...prev, c.id]
                          // If all companies selected, snap back to 'all'
                          return next.length===companies.length ? [] : next
                        })}
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                          border:`1px solid ${sel?(c.color||T.gold):T.border}`,
                          background:sel?(c.color||T.gold)+'22':'transparent',
                          color:sel?(c.color||T.gold):T.muted}}>
                        {sel?'✓ ':''}{c.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {(() => {
              // ───────────────────────────────────────────────────────────────
              // Dashboard sections registry — each section is a labelled chunk
              // that the user can reorder and show/hide. Section content is
              // rendered by the function below. The KPI grid is one of these
              // sections too, with its own internal customisation preserved.
              // ───────────────────────────────────────────────────────────────

              const SECTION_DEFS = {
                kpi_grid: {
                  icon: '📊',
                  label: 'KPI cards',
                  description: 'Portfolio value, monthly rent, arrears, and other key metrics',
                  render: () => renderKpiGrid(),
                },
                by_company: {
                  icon: '🏢',
                  label: 'By Company',
                  description: 'A card per company with its property/rent stats',
                  render: () => renderByCompany(),
                },
                smart_alerts: {
                  icon: '⚠',
                  label: 'Items needing attention',
                  description: 'Smart alerts: overdue rent, expiring compliance, vacant properties',
                  render: () => <SmartAlerts properties={dashProps} companies={dashCos} fmt={fmt} openDetail={openDetail}/>,
                },
                tenant_inbox: {
                  icon: '📬',
                  label: 'Tenant Inbox',
                  description: 'Latest messages and repair requests from tenants',
                  render: () => <TenantInbox user={user} companies={companies} showToast={showToast} companySettings={companySettings}/>,
                },
                portfolio_insights: {
                  icon: '✨',
                  label: 'AI Portfolio Insights',
                  description: 'Observations and opportunities generated by Claude (refreshable every 30 min)',
                  render: () => <PortfolioInsightsWidget/>,
                },
                property_map: {
                  icon: '🗺',
                  label: 'Property Map',
                  description: 'Compact map showing all your properties',
                  render: () => (
                    <div style={{ marginTop: 28 }}>
                      <PropertyMap
                        compact
                        properties={dashProps}
                        setProperties={setProperties}
                        showToast={showToast}
                        onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}
                        onViewFullMap={()=>{ setView('properties'); setPortfolioTab('map') }}
                      />
                    </div>
                  ),
                },
                portfolio_modeller: {
                  icon: '📈',
                  label: 'Portfolio What-If Modeller',
                  description: 'Model rent changes, refinancing, and other scenarios',
                  render: () => <PortfolioModellerWidget properties={dashProps}/>,
                },
                company_documents: {
                  icon: '📁',
                  label: 'Company Documents',
                  description: 'Documents stored at company level (only shows when a company is selected)',
                  render: () => (
                    activeCoTab && (companySettings[activeCoTab]||{}).feature_documents
                      ? <div style={{marginTop:28}}>
                          <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:6}}>Company Documents</h2>
                          <p style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginBottom:14}}>
                            Documents stored at company level — for items that apply across all properties (e.g. company insurance, bank letters)
                          </p>
                          <CompanyDocumentsTab companyId={activeCoTab} showToast={showToast} isAdmin={isAdmin} user={user}/>
                        </div>
                      : null
                  ),
                },
              }

              // Default order — applied when user has no saved prefs.
              // Mobile-first: attention-needed sections appear first so the
              // "what do I need to do today?" view is visible without
              // scrolling. Power users on desktop can reorder via the
              // Customize Dashboard modal — saved prefs always win.
              const SECTION_DEFAULT_ORDER = ['smart_alerts','tenant_inbox','portfolio_insights','kpi_grid','by_company','property_map','portfolio_modeller','company_documents']
              const SECTION_DEFAULT_ENABLED = { kpi_grid:true, by_company:true, smart_alerts:true, tenant_inbox:true, portfolio_insights:true, property_map:true, portfolio_modeller:false, company_documents:true }

              // Resolve current section prefs, filling in any missing keys from defaults
              const savedSections = sectionPrefs || []
              const savedKeys = new Set(savedSections.map(s => s.key))
              const resolvedSections = [
                ...savedSections.filter(s => SECTION_DEFS[s.key]),       // saved order, drop unknown keys
                ...SECTION_DEFAULT_ORDER.filter(k => !savedKeys.has(k))  // append any new keys at end
                  .map(k => ({ key: k, enabled: SECTION_DEFAULT_ENABLED[k] !== false })),
              ]

              // ── Renderers for each section. Defined here to keep closures
              //    over dashProps/companies/etc lexically simple.

              function renderKpiGrid() {
                // Widget definitions — each returns a StatCard JSX element
                const WIDGET_DEFS = {
                  portfolio_value: { icon:'🏡', label:'Portfolio Value', render: () => (
                    <StatCard icon="🏡" label="Portfolio Value" value={fmt(stats.totalEstVal)} sub={`Invested ${fmt(stats.totalInvested)}`}
                      breakdown={[
                        {label:'Estimated portfolio value', value:fmt(stats.totalEstVal), color:T.gold},
                        {label:'Total invested (purchase + refurb)', value:fmt(stats.totalInvested)},
                        {label:'Purchase prices', value:fmt(dashProps.reduce((s,p)=>s+(p.purchase_price||0),0)), indent:true},
                        {label:'Refurb costs', value:fmt(dashProps.reduce((s,p)=>s+(p.refurb_cost||0),0)), indent:true},
                        {label:'Unrealised gain', value:fmt(stats.totalEstVal-stats.totalInvested), color:stats.totalEstVal>stats.totalInvested?T.green:T.red, separator:true, note:'Est. portfolio value minus total invested (purchase + refurb)'},
                        {label:'Transaction costs', value:fmt(dashProps.reduce((s,p)=>s+(p.stamp_duty||0)+(p.legal_fees||0),0)), separator:true},
                        {label:'Stamp duty', value:fmt(dashProps.reduce((s,p)=>s+(p.stamp_duty||0),0)), indent:true},
                        {label:'Legal fees', value:fmt(dashProps.reduce((s,p)=>s+(p.legal_fees||0),0)), indent:true},
                      ]}
                    />
                  )},
                  monthly_rent: { icon:'💷', label:'Monthly Rental Income', render: () => (
                    <StatCard icon="💷" label="Monthly Rental Income" value={fmt(stats.monthlyRent)} sub={fmt(stats.monthlyRent*12)+'/yr'} accent={T.green}
                      breakdown={[
                        ...companyStats.map(c=>({label:c.name, value:fmt(c.monthlyRent), color:c.color})),
                        {label:'Annual total', value:fmt(stats.monthlyRent*12), color:T.green},
                        {label:'Rented units', value:`${stats.rented} of ${stats.total}`},
                        {label:'Occupancy rate', value:`${Math.round((stats.rented/Math.max(stats.total,1))*100)}%`, color:T.green},
                      ]}
                    />
                  )},
                  arrears: { icon:'⚠', label:'Total Arrears', render: () => (
                    <StatCard icon="⚠" label="Total Arrears" value={fmt(stats.totalArrears)} sub={`${stats.vacant} vacant`} accent={stats.totalArrears>0?T.red:T.green}
                      breakdown={[
                        ...dashProps.filter(p=>(p.arrears||0)>0).map(p=>({label:p.name, value:fmt(p.arrears), color:T.red})),
                        ...(dashProps.filter(p=>(p.arrears||0)>0).length===0?[{label:'No arrears - all clear!', value:'✓', color:T.green}]:[]),
                        {label:'Vacant units', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                      ]}
                    />
                  )},
                  refurb: { icon:'🔨', label:'In Refurbishment', render: () => (
                    <StatCard icon="🔨" label="In Refurbishment" value={stats.inRefurb} sub={`of ${stats.total} total`} accent={T.blue}
                      breakdown={[
                        ...dashProps.filter(p=>p.refurb_status==='in-progress').map(p=>({label:p.name, value:p.company?.abbr||'', color:T.blue})),
                        ...(stats.inRefurb===0?[{label:'No active refurbs', value:'✓', color:T.green}]:[]),
                        {label:'Planned refurbs', value:dashProps.filter(p=>p.refurb_status==='planned').length},
                        {label:'Completed refurbs', value:dashProps.filter(p=>p.refurb_status==='complete').length, color:T.green},
                      ]}
                    />
                  )},
                  mortgages: { icon:'🏦', label:'Mortgages Outstanding', render: () => (
                    <StatCard icon="🏦" label="Mortgages Outstanding" value={fmt(stats.totalMortgage)} sub={`${stats.mortgaged} mortgaged properties`} accent="#9B59B6"
                      breakdown={[
                        {label:'Total mortgage debt', value:fmt(stats.totalMortgage), color:'#9B59B6'},
                        {label:'Total portfolio equity', value:fmt(stats.totalEquity), color:stats.totalEquity>0?T.green:T.red},
                        {label:'Monthly repayments', value:fmt(stats.monthlyMortgageCost)},
                        {label:'Annual repayments', value:fmt(stats.monthlyMortgageCost*12)},
                        {label:'Average LTV', value:stats.totalEstVal>0?((stats.totalMortgage/stats.totalEstVal)*100).toFixed(1)+'%':'-'},
                        ...companyStats.map(c=>({
                          label:c.name+' debt',
                          value:fmt(dashProps.filter(p=>p.company_id===c.id).reduce((s,p)=>s+(p.mortgage_amount||0),0)),
                          color:c.color
                        })),
                      ]}
                    />
                  )},
                  cashflow_forecast: { icon:'💰', label:'Cash Committed', render: () => {
                    // Filter deals by the dashboard's company filter so the
                    // widget stays in sync with the rest of the page. Properties
                    // are already filtered (dashProps).
                    const filteredDeals = dashCoFilter.length === 0
                      ? dashboardDeals
                      : dashboardDeals.filter(d => dashCoFilter.includes(d.company_id))
                    const cashAgg = aggregateDeals(filteredDeals, dashProps)
                    // Big number is total cash out across ALL live items
                    // (committed AND pipeline). The sub-line and breakdown
                    // give the urgency split. Earlier we tried "next 90 days"
                    // as the headline but it was £0 for users without dates
                    // set — useless out of the box. Total exposure is more
                    // honest as a glanceable headline.
                    const next90 = (cashAgg.byBucket.overdue?.cashOut || 0)
                                 + (cashAgg.byBucket['0-30']?.cashOut || 0)
                                 + (cashAgg.byBucket['31-60']?.cashOut || 0)
                                 + (cashAgg.byBucket['61-90']?.cashOut || 0)
                    const next90Count = (cashAgg.byBucket.overdue?.count || 0)
                                      + (cashAgg.byBucket['0-30']?.count || 0)
                                      + (cashAgg.byBucket['31-60']?.count || 0)
                                      + (cashAgg.byBucket['61-90']?.count || 0)
                    const overdueCash = cashAgg.byBucket.overdue?.cashOut || 0
                    const overdueCount = cashAgg.byBucket.overdue?.count || 0
                    const pipelineCash = cashAgg.byGroup.pipeline?.cashOut || 0
                    // Accent: red if overdue, amber if anything due in 30d,
                    // gold otherwise (purely planning view).
                    const accent = overdueCash > 0 ? T.red
                                 : (cashAgg.byBucket['0-30']?.cashOut || 0) > 0 ? T.amber
                                 : T.gold
                    // Sub-line gives the urgency split at a glance:
                    //   "£X due in 90d · £Y in pipeline"
                    // Falls back to a friendly hint if there's nothing live.
                    const sub = cashAgg.totalCount === 0
                      ? 'No live deals or properties'
                      : `${fmt(next90)} due in 90d · ${fmt(pipelineCash)} in pipeline`
                    return (
                      <StatCard icon="💰" label="Cash Committed" value={fmt(cashAgg.totalCashOut)} sub={sub} accent={accent}
                        breakdown={[
                          ...(overdueCash > 0 ? [{label:`Overdue (${overdueCount} ${overdueCount===1?'item':'items'})`, value:fmt(overdueCash), color:T.red, separator:true}] : []),
                          {label:'Next 30 days', value:fmt(cashAgg.byBucket['0-30']?.cashOut || 0), color:(cashAgg.byBucket['0-30']?.cashOut || 0) > 0 ? T.amber : T.muted, note:`${cashAgg.byBucket['0-30']?.count || 0} item(s) needing cash this month`},
                          {label:'31-60 days',   value:fmt(cashAgg.byBucket['31-60']?.cashOut || 0), color:T.text},
                          {label:'61-90 days',   value:fmt(cashAgg.byBucket['61-90']?.cashOut || 0), color:T.text},
                          {label:'Subtotal: due in next 90 days', value:fmt(next90), color:next90 > 0 ? T.gold : T.muted, separator:true, note:`${next90Count} item(s) with completion or refurb dates set`},
                          {label:'Later (90+ days)', value:fmt(cashAgg.byBucket['91+']?.cashOut || 0), color:T.muted, separator:true},
                          {label:'Pipeline (no date set)', value:fmt(pipelineCash), color:T.muted, note:'Deals still being analysed/offered. Set expected completion dates to move these into the dated buckets above.'},
                          {label:'Total cash out across all live items', value:fmt(cashAgg.totalCashOut), color:T.gold, separator:true},
                          ...(cashAgg.propertyRefurbBudgeted > 0 ? [{label:`${cashAgg.propertyRefurbBudgeted} property(ies) using budgeted fallback`, value:'⚠', color:T.amber, note:'Add itemised refurb costs (paid/unpaid) for more accuracy'}] : []),
                        ]}
                      />
                    )
                  }},
                  insurance_renewals: { icon:'🛡', label:'Insurance Renewals', render: () => {
                    // Filter policies by the dashboard's company filter, mirroring
                    // how the cashflow widget handles dashCoFilter. RLS already
                    // limits the user's visible set.
                    const visiblePolicies = dashCoFilter.length === 0
                      ? insurancePolicies
                      : insurancePolicies.filter(p => dashCoFilter.includes(p.company_id))
                    const today = new Date(); today.setHours(0, 0, 0, 0)
                    const daysUntil = (d) => Math.floor((new Date(d) - today) / (1000 * 60 * 60 * 24))
                    // Buckets:
                    //   expired   — already past expiry, needs urgent action
                    //   d30       — renewing in next 30 days (amber alert)
                    //   d60       — renewing in 31-60 days
                    //   d90       — renewing in 61-90 days
                    //   later     — beyond 90 days
                    // For each bucket we sum premiums so the user sees what
                    // money is committed and roughly when.
                    const bucketed = { expired: [], d30: [], d60: [], d90: [], later: [] }
                    visiblePolicies.forEach(p => {
                      if (!p.expiry_date) return
                      const d = daysUntil(p.expiry_date)
                      if (d < 0)       bucketed.expired.push(p)
                      else if (d <= 30) bucketed.d30.push(p)
                      else if (d <= 60) bucketed.d60.push(p)
                      else if (d <= 90) bucketed.d90.push(p)
                      else              bucketed.later.push(p)
                    })
                    const sumP = (arr) => arr.reduce((s, p) => s + (Number(p.premium) || 0), 0)
                    // Big number = total annual premium across all active
                    // policies (anything not yet expired). Catches the eye and
                    // tells the user their total insurance bill.
                    const totalAnnual = visiblePolicies
                      .filter(p => p.expiry_date && daysUntil(p.expiry_date) >= 0)
                      .reduce((s, p) => s + (Number(p.premium) || 0), 0)
                    const activeCount = visiblePolicies.filter(p => p.expiry_date && daysUntil(p.expiry_date) >= 0).length
                    // Accent: red if anything's expired, amber if renewing
                    // in 30 days, gold otherwise.
                    const accent = bucketed.expired.length > 0 ? T.red
                                 : bucketed.d30.length > 0 ? T.amber
                                 : T.gold
                    const sub = visiblePolicies.length === 0
                      ? 'No policies tracked'
                      : bucketed.expired.length > 0
                        ? `${bucketed.expired.length} expired · ${activeCount} active`
                        : bucketed.d30.length > 0
                          ? `${bucketed.d30.length} renewing in 30 days · ${activeCount} active`
                          : `${activeCount} active ${activeCount === 1 ? 'policy' : 'policies'}`
                    return (
                      <StatCard icon="🛡" label="Insurance Renewals" value={fmt(totalAnnual)} sub={sub} accent={accent}
                        breakdown={[
                          ...(bucketed.expired.length > 0 ? [{label:`Expired (${bucketed.expired.length})`, value:fmt(sumP(bucketed.expired)), color:T.red, separator:true, note:'Policies past their expiry date. Renew immediately.'}] : []),
                          {label:'Next 30 days', value:fmt(sumP(bucketed.d30)), color:bucketed.d30.length > 0 ? T.amber : T.muted, note:`${bucketed.d30.length} ${bucketed.d30.length === 1 ? 'policy' : 'policies'} renewing this month`},
                          {label:'31-60 days',   value:fmt(sumP(bucketed.d60)), color:T.text, note:bucketed.d60.length > 0 ? `${bucketed.d60.length} ${bucketed.d60.length === 1 ? 'policy' : 'policies'}` : null},
                          {label:'61-90 days',   value:fmt(sumP(bucketed.d90)), color:T.text, note:bucketed.d90.length > 0 ? `${bucketed.d90.length} ${bucketed.d90.length === 1 ? 'policy' : 'policies'}` : null},
                          {label:'Later',        value:fmt(sumP(bucketed.later)), color:T.muted, note:`${bucketed.later.length} ${bucketed.later.length === 1 ? 'policy' : 'policies'} beyond 90 days`, separator:true},
                          {label:'Total annual premium (all active)', value:fmt(totalAnnual), color:T.gold, separator:true},
                        ]}
                      />
                    )
                  }},
                  property_count: { icon:'🏠', label:'Property Count', render: () => (
                    <StatCard icon="🏠" label="Property Count" value={stats.total} sub={`${stats.rented} rented · ${stats.vacant} vacant`} accent={T.gold}
                      breakdown={[
                        {label:'Total properties', value:stats.total},
                        {label:'Rented', value:stats.rented, color:T.green},
                        {label:'Vacant', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                        {label:'In refurbishment', value:stats.inRefurb, color:T.blue},
                        ...companyStats.map(c=>({label:c.name, value:c.count, color:c.color})),
                      ]}
                    />
                  )},
                  occupancy_rate: { icon:'📊', label:'Occupancy Rate', render: () => {
                    const rate = stats.total > 0 ? Math.round((stats.rented/stats.total)*100) : 0
                    return (
                      <StatCard icon="📊" label="Occupancy Rate" value={rate+'%'} sub={`${stats.rented} of ${stats.total} rented`} accent={rate>=90?T.green:rate>=75?T.amber:T.red}
                        breakdown={[
                          {label:'Occupied', value:stats.rented, color:T.green},
                          {label:'Vacant', value:stats.vacant, color:T.amber},
                          {label:'Occupancy %', value:rate+'%', color:rate>=90?T.green:T.amber},
                          {label:'Vacancy cost (est)', value:fmt(dashProps.filter(p=>p.status==='vacant').reduce((s,p)=>s+(p.rent_pcm||0),0))+'/mo lost', color:T.red},
                        ]}
                      />
                    )
                  }},
                }
                // Default widget config
                const DEFAULT_WIDGETS = [
                  { key:'portfolio_value', enabled:true },
                  { key:'monthly_rent', enabled:true },
                  { key:'arrears', enabled:true },
                  { key:'refurb', enabled:true },
                  { key:'mortgages', enabled:true },
                  { key:'cashflow_forecast', enabled:true },
                  { key:'insurance_renewals', enabled:true },
                  { key:'property_count', enabled:false },
                  { key:'occupancy_rate', enabled:false },
                ]
                const currentWidgets = widgetPrefs || DEFAULT_WIDGETS
                // Add any new widget keys that aren't in saved prefs (default to disabled so existing users aren't surprised)
                const knownKeys = new Set(currentWidgets.map(w=>w.key))
                Object.keys(WIDGET_DEFS).forEach(k => {
                  if (!knownKeys.has(k)) currentWidgets.push({ key:k, enabled:false })
                })
                const enabledWidgets = currentWidgets.filter(w => w.enabled && WIDGET_DEFS[w.key])
                const count = enabledWidgets.length
                return (
                  <div style={{marginBottom:20}}>
                    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':`repeat(${Math.min(count,5)},1fr)`,gap:10}}>
                      {enabledWidgets.map(w => (
                        <div key={w.key} style={{display:'contents'}}>{WIDGET_DEFS[w.key].render()}</div>
                      ))}
                    </div>
                  </div>
                )
              }

              function renderByCompany() {
                return (
                  <>
                    <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:14}}>By Company</h2>
                    {companies.length===0
                      ?<div className="card" style={{padding:32,textAlign:'center'}}>
                          <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,marginBottom:16}}>No companies yet. Add your first one to get started.</div>
                          <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>+ Add Company</button>
                        </div>
                      :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:14,marginBottom:28}}>
                          {companyStats.map(c=>(
                            <div key={c.id} className="card" style={{padding:'20px 22px',borderLeft:`3px solid ${c.color}`}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:c.color,background:c.color+'22',padding:'3px 10px',borderRadius:4}}>{c.abbr}</div>
                                <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                              </div>
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                                {[{l:'Properties',v:c.count},{l:'Rented',v:`${c.rented}/${c.count}`},{l:'Monthly Income',v:fmt(c.monthlyRent)},{l:'Arrears',v:fmt(c.arrears),red:c.arrears>0}].map((item,i)=>(
                                  <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>{item.l}</div>
                                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:700,color:item.red?T.red:T.gold}}>{item.v}</div>
                                  </div>
                                ))}
                              </div>
                              <button className="btn btn-ghost" style={{width:'100%',marginTop:12,fontSize:11}} onClick={()=>{setActiveCoTab(c.id);setView('companies')}}>View Properties -&gt;</button>
                            </div>
                          ))}
                        </div>
                    }
                  </>
                )
              }

              // ── Render the visible sections in their preferred order ──
              const visibleSections = resolvedSections.filter(s => s.enabled)
              return (
                <>
                  {/* Customize Dashboard button — single source of truth for both sections and widget toggles */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:8}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                      Dashboard · {visibleSections.length} sections shown
                    </div>
                    <button onClick={()=>{ setCustomizeDashTab('sections'); setShowCustomizeDash(true) }}
                      style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
                      ⚙ Customize
                    </button>
                  </div>
                  {visibleSections.map(s => {
                    const def = SECTION_DEFS[s.key]
                    if (!def) return null
                    return <div key={s.key}>{def.render()}</div>
                  })}
                </>
              )
            })()}
          </div>}

          {view==='deals'&&<div className="fade">
            <DealsPage user={user} companies={companies} properties={properties} showToast={showToast} activeFlags={activeFlags}
              onDealsChange={setDashboardDeals}
              onConvertToProperty={(deal)=>{
                // Map deal fields to property fields so the user doesn't
                // have to retype everything. Fields without a clean 1:1
                // mapping (e.g. timeline dates, deal_type) are dropped —
                // they live on the deal record. The user just fills in
                // anything that's specific to the property going forward
                // (estimated value, rent, tenancy details).
                //
                // Computed fields:
                //   mortgage_amount = purchase * (1 - deposit_percent/100)
                //   deposit         = purchase * deposit_percent/100
                // Cash deals get mortgage_amount=0, deposit=full price.
                const num = (v) => Number(v) || 0
                const price = num(deal.purchase_price)
                const depPct = num(deal.deposit_percent) || 25
                const isCash = deal.purchase_type === 'cash'
                const mortgageAmount = isCash ? 0 : Math.round(price * (1 - depPct / 100))
                const depositAmount  = isCash ? price : Math.round(price * depPct / 100)
                // Stamp duty: use the user's override if they set one,
                // otherwise use whatever's stored in stamp_duty (calculator
                // writes the auto-computed value here on save).
                const sd = deal.stamp_duty_override != null
                  ? num(deal.stamp_duty_override)
                  : num(deal.stamp_duty)
                const prefill = {
                  // Identity
                  name:        deal.name || deal.address || '',
                  address:     deal.address || '',
                  company_id:  deal.company_id || '',
                  // Money
                  purchase_price:  price || '',
                  refurb_cost:     num(deal.refurb_cost) || '',
                  stamp_duty:      sd || '',
                  legal_fees:      num(deal.legal_fees) || '',
                  mortgage_amount: mortgageAmount || '',
                  deposit:         depositAmount || '',
                  // Mortgage terms
                  mortgage_rate:   num(deal.mortgage_rate) || '',
                  mortgage_term:   num(deal.mortgage_term) || 25,
                  // Status: 'purchased' makes sense for a freshly converted
                  // deal — the user will switch it to 'refurb' or 'rented'
                  // once that phase begins.
                  status:          'purchased',
                  // Notes carry across — useful context for property
                  notes:           deal.notes || '',
                  // Source link — once we add a deal_id column on properties
                  // this would be deal.id. For now we just store a
                  // breadcrumb in notes if there isn't already a notes
                  // value, so the user can find their way back to the deal.
                  // Skipped to avoid clobbering — left as a TODO.
                }
                setEditProp(prefill)
                setShowAddProp(true)
                showToast('Deal data pre-filled — review and save')
              }}/>
          </div>}

          {view==='properties'&&<div className="fade">
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:16}}>
              <div>
                <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Portfolio</h1>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{filtered.length} of {properties.length} properties shown</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                {[['properties','🏘 Properties'],['companies','🏢 Companies'],['map','🗺 Map'],['contractors','🔧 Contractors']].map(([k,l])=>(
                  <button key={k} onClick={()=>setPortfolioTab(k)}
                    style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'6px 14px',borderRadius:8,cursor:'pointer',
                      border:`1px solid ${portfolioTab===k?T.gold:T.border}`,
                      background:portfolioTab===k?T.gold+'22':'transparent',
                      color:portfolioTab===k?T.gold:T.muted,fontWeight:portfolioTab===k?700:400}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {portfolioTab==='companies'&&<CompaniesPanel companies={companies} setCompanies={setCompanies} user={user} showToast={showToast} companySettings={companySettings} setCompanySettings={setCompanySettings} T={T}/>}
            {portfolioTab==='contractors'&&<ContractorsPage user={user} companies={companies} showToast={showToast}/>}
            {portfolioTab==='map'&&<>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
                {[{id:'all',abbr:'All',color:T.gold},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.gold):T.muted,transition:'all 0.18s'}}>{c.abbr}</button>
                ))}
              </div>
              <PropertyMap
                properties={filtered}
                setProperties={setProperties}
                showToast={showToast}
                onOpenProperty={(id)=>{ setSelectedId(id); setView('detail'); setDetailTab('overview') }}/>
            </>}
            {portfolioTab==='properties'&&<div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,marginBottom:16}}>
              <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={()=>setShowAddBulk(true)} disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive} title="Add a block of flats (multiple units in one building)">🏘 + Add Block</button>
              <button className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive} title={!canDo(permissionsMap, activeCoTab, 'edit_properties') && !devModeActive ? 'You don\'t have permission to add properties to this company' : ''}>+ Add Property</button>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search name or address…" style={{width:230,padding:'7px 12px',fontSize:12}}/>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[{id:'all',abbr:'All',color:T.gold},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.gold):T.muted,transition:'all 0.18s'}}>{c.abbr}</button>
                ))}
                <div style={{width:1,background:T.border,margin:'0 2px'}}/>
                {['all', ...PROPERTY_STATUSES].map(f=>(
                  <button key={f} onClick={()=>setStatusFilter(f)} style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold+'22':'transparent',color:statusFilter===f?T.gold:T.muted,transition:'all 0.18s'}}>{f==='all'?'All Status':(PROPERTY_STATUS_LABELS[f] || STATUS_CFG[f]?.label || f)}</button>
                ))}
                {archivedCount > 0 && (
                  <>
                    <div style={{width:1,background:T.border,margin:'0 2px'}}/>
                    <button onClick={()=>setShowArchived(v=>!v)}
                      title={showArchived ? `Hide ${archivedCount} archived` : `Show ${archivedCount} archived`}
                      style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                        border:`1px solid ${showArchived?T.muted:T.border}`,
                        background:showArchived?T.muted+'22':'transparent',
                        color:showArchived?T.text:T.muted,transition:'all 0.18s'}}>
                      📦 {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* Sort control */}
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',flexShrink:0}}>Sort by:</span>
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
                <button key={opt.v} onClick={()=>setSortBy(opt.v)}
                  style={{fontFamily:"'DM Mono',monospace",fontSize:isMobile?9:10,padding:isMobile?'3px 8px':'4px 12px',borderRadius:20,cursor:'pointer',
                    border:`1px solid ${sortBy===opt.v?T.gold:T.border}`,
                    background:sortBy===opt.v?T.gold+'22':'transparent',
                    color:sortBy===opt.v?T.gold:T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
                  {opt.l}
                </button>
              ))}
            </div>
            <DraggablePropertyList filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} setProperties={setProperties} properties={properties} sortBy={sortBy} yieldBasis={yieldBasis}/>
            </div>}
          </div>}

          {view==='companies'&&<div className="fade">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em'}}>Companies</h1>
              <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowAddCo(true)}>+ Add Company</button>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:22}}>
              {companies.map(c=>(
                <button key={c.id} className={`tab ${activeCoTab===c.id?'active':''}`} style={{border:`1px solid ${activeCoTab===c.id?c.color:T.border}`,color:activeCoTab===c.id?c.color:T.muted,background:activeCoTab===c.id?c.color+'11':'transparent'}} onClick={()=>setActiveCoTab(c.id)}>{c.name}</button>
              ))}
            </div>
            {companies.filter(c=>c.id===activeCoTab).map(c=>{
              const cs=companyStats.find(x=>x.id===c.id)
              const cProps=activeProperties.filter(p=>p.company_id===c.id)
              return <div key={c.id}>
                <div className="company-stats-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:12,marginBottom:22}}>
                  <StatCard icon="🏠" label="Properties" value={cs.count} sub={`${cs.rented} rented · ${cs.vacant} vacant`}/>
                  <StatCard icon="💷" label="Monthly Rent" value={fmt(cs.monthlyRent)} sub={fmt(cs.monthlyRent*12)+'/yr'} accent={T.green}/>
                  <StatCard icon="📊" label="Total Invested" value={fmt(cs.invested)} sub={`Est. ${fmt(cs.estVal)}`}/>
                  <StatCard icon="⚠" label="Arrears" value={fmt(cs.arrears)} accent={cs.arrears>0?T.red:T.green}/>
                </div>
                <div style={{display:'grid',gap:10}}>
                  {cProps.map(p=>(
                    <div key={p.id} className="card pcard" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}} onClick={()=>openDetail(p)}>
                      <div style={{flex:1,minWidth:150}}>
                        <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{p.name}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{p.prop_type} · {p.address}{p.managed_by&&<span style={{marginLeft:8,color:'#5A5E72'}}>· 🏢 {p.managed_by}</span>}</div>
                      </div>
                      {p.arrears>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.red}}>⚠ {fmt(p.arrears)}</div>}
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:T.gold}}>{calcGrossYield(p, yieldBasis).toFixed(1)}%</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'0.05em'}}>{yieldBasis==='value'?'on value':'on cost'}</div>
                    </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted}}>{fmt(p.rent_pcm) + "/mo"}</div>
                      <Badge status={p.status}/>
                      <HealthBadge property={p}/>
                    </div>
                  ))}
                  {cProps.length===0&&<div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,padding:'32px',textAlign:'center'}}>No properties for this company yet.<br/><button className="btn btn-gold" style={{fontSize:11,marginTop:12}} onClick={()=>{setEditProp({company_id:activeCoTab});setShowAddProp(true)}}>+ Add Property</button></div>}
                </div>
              </div>
            })}
          </div>}

          {view==='rent'&&<RentTrackerOverview companies={companies} properties={activeProperties} fmt={fmt} openDetail={openDetail} onDayTracker={()=>setView('daytracker')} yieldBasis={yieldBasis}/>}
          {view==='daytracker'&&<DayTrackerPage companies={companies} properties={activeProperties} setProperties={setProperties} showToast={showToast} onBack={()=>setView('rent')}/>}
          {view==='settings'&&<SettingsPage companies={companies} setCompanies={setCompanies} companySettings={companySettings} setCompanySettings={setCompanySettings} user={user} showToast={showToast} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} darkMode={darkMode} setDarkMode={setDarkMode} userNavPrefs={userNavPrefs} setUserNavPrefs={setUserNavPrefs} yieldBasis={yieldBasis} setYieldBasis={setYieldBasis}/>}
          {view==='reports'&&<div className="fade"><ReportsPage properties={properties} companies={companies} companySettings={companySettings} user={user} activeFlags={activeFlags} selectedReportId={selectedReportId} onSelectReport={setSelectedReportId}/></div>}
          {view==='insurance'&&<div className="fade"><InsurancePage user={user} companies={companies} properties={activeProperties} showToast={showToast}/></div>}
          {view==='feedback'&&<div className="fade"><FeedbackPage user={user} showToast={showToast}/></div>}
          {view==='contractors'&&<ContractorsPage companies={companies} showToast={showToast}/>}

          {view==='detail'&&!selected&&<div className="fade" style={{padding:40,textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔒</div>
            <h2 style={{fontSize:20,color:T.text,marginBottom:8}}>Property not found</h2>
            <p style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted,marginBottom:20}}>
              This property doesn't exist or you don't have access to it.
            </p>
            <button className="btn btn-gold" onClick={()=>{setView('properties');setSelectedId(null)}}>&lt;- Back to Properties</button>
          </div>}

          {view==='detail'&&selected&&<div className="fade">
            <button className="btn btn-ghost" style={{marginBottom:20,fontSize:11}} onClick={()=>setView('properties')}>&lt;- Back</button>
            <div style={{display:'grid',gridTemplateColumns:'1fr 280px',gap:18,alignItems:'start'}}>
              <div>
                <div className="card" style={{padding:'24px 28px',marginBottom:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:16}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}><CompanyPill company={selected.company}/><Badge status={selected.status}/></div>
                      <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',marginBottom:3}}>{selected.name}</h1>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{selected.address}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint}}>{selected.prop_type}</div>
                      {selected.managed_by&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,padding:'2px 10px',borderRadius:20,background:'#1A1D27',border:'1px solid #2E3044',fontFamily:"'DM Mono',monospace",fontSize:10,color:'#8B8FA8'}}>🏢 {selected.managed_by}</div>}
                      {selected.archived_at&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,marginLeft:6,padding:'2px 10px',borderRadius:20,background:T.bg,border:`1px solid ${T.border}`,fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>📦 Archived {new Date(selected.archived_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>}
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      {(canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive) && (
                        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditProp(selected);setShowAddProp(true)}}>Edit</button>
                      )}
                      {(() => {
                        const canEdit = canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive
                        return (
                          <ActionMenu items={[
                            // Duplicate / Mark sold / Archive / Delete all mutate the property — gate by edit permission
                            ...(canEdit ? [{ label: 'Duplicate property', icon: '⊕',
                              onSelect: () => handleDuplicateProp(selected.id) }] : []),
                            ...(canEdit && selected.status !== 'sold' ? [{
                              label: 'Mark as sold', icon: '£',
                              onSelect: () => setShowSellModal(selected.id) }] : []),
                            // Export PDF is read-only — available to anyone who can see the property
                            { label: 'Export PDF summary', icon: '⤓',
                              onSelect: async () => {
                                try { await api.exportPropertySummaryPDF(selected) }
                                catch(e) { showToast(e.message, 'error') }
                              }},
                            ...(canEdit ? [
                              { divider: true },
                              ...(selected.archived_at
                                ? [{ label: 'Restore from archive', icon: '↩',
                                     onSelect: () => handleArchiveProp(selected.id, false) }]
                                : [{ label: 'Archive property', icon: '📦',
                                     onSelect: async () => {
                                       if (await confirmDialog({
                                         title: 'Archive this property?',
                                         body: 'It will be hidden from the active list and dashboard. You can restore it later.',
                                         confirmLabel: 'Archive',
                                       }))
                                         handleArchiveProp(selected.id, true)
                                     }}]
                              ),
                              { label: 'Delete property', icon: '🗑',
                                destructive: true,
                                onSelect: () => setShowDeleteConfirm(selected.id) },
                            ] : []),
                          ]}/>
                        )
                      })()}
                    </div>
                  </div>
                </div>
                {(()=>{
                  const co = selected?.company_id
                  const cs = companySettings[co] || {}
                  // Top-level tabs: 9 max. Tenancy-related sub-views (Right to Rent / Deposit /
                  // Notices / Rent History) are now nested inside Tenancy as sub-tabs to keep
                  // the top row scannable. Old deep-link URLs (#/detail/<id>/deposit etc.) still
                  // work because the tenancy section detects sub-tab URLs and switches accordingly.
                  const tabs = ['overview','refurb','rent','financials']
                  if(cs.feature_compliance)  tabs.push('compliance')
                  if(cs.feature_tenancy)     tabs.push('tenancy')
                  if(cs.feature_maintenance) tabs.push('maintenance')
                  if(cs.feature_documents)   tabs.push('documents')
                  if(cs.feature_expenses)    tabs.push('expenses')
                  // Treat tenancy sub-tab URLs as if "tenancy" is the active top-level tab
                  const TENANCY_SUB = ['right to rent','deposit','notices','rent history']
                  const activeTop = TENANCY_SUB.includes(detailTab) ? 'tenancy' : detailTab
                  return (
                    <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
                      {tabs.map(t=>(
                        <button key={t} className={`tab ${activeTop===t?'active':''}`} onClick={()=>setDetailTab(t)} style={{textTransform:'capitalize'}}>{t}</button>
                      ))}
                    </div>
                  )
                })()}
                {detailTab==='overview'&&<OverviewTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditProperty={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
                {detailTab==='overview' && (() => {
                  // Insurance summary: find policies covering THIS property.
                  // Includes:
                  //  - policies with an explicit property link
                  //  - company-wide policies (no property links) belonging to
                  //    the same company as this property
                  const myPolicies = insurancePolicies.filter(pol => {
                    if (pol.company_id !== selected.company_id) return false
                    const links = pol.properties || []
                    return links.length === 0 || links.some(p => p.id === selected.id)
                  })
                  if (myPolicies.length === 0) {
                    return (
                      <div className="card" style={{padding:'14px 20px',marginTop:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                        <div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>🛡 Insurance</div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted}}>No policies cover this property yet.</div>
                        </div>
                        <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setView('insurance')}>Add policy →</button>
                      </div>
                    )
                  }
                  // Show the next-expiring policy prominently, with a small
                  // list of any others. Sorted by expiry date ascending.
                  const sorted = [...myPolicies].sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date))
                  const today = new Date(); today.setHours(0,0,0,0)
                  return (
                    <div className="card" style={{padding:'16px 20px',marginTop:14}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                          🛡 Insurance · {myPolicies.length} {myPolicies.length===1?'policy':'policies'}
                        </div>
                        <button className="btn btn-ghost" style={{fontSize:10}} onClick={()=>setView('insurance')}>Manage →</button>
                      </div>
                      <div style={{display:'grid',gap:6}}>
                        {sorted.map(pol => {
                          const expiry = new Date(pol.expiry_date)
                          const days = Math.floor((expiry - today) / (1000*60*60*24))
                          const color = days < 0 ? T.red : days <= 30 ? T.amber : days <= 90 ? T.gold : T.green
                          const status = days < 0
                            ? `Expired ${Math.abs(days)} ${Math.abs(days)===1?'day':'days'} ago`
                            : `Renews in ${days} ${days===1?'day':'days'}`
                          const isCompanyWide = (pol.properties || []).length === 0
                          return (
                            <div key={pol.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:12,alignItems:'center',padding:'8px 10px',background:T.bg,borderRadius:8,borderLeft:`3px solid ${color}`}}>
                              <div style={{minWidth:0}}>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                                  {pol.policy_name}
                                  {isCompanyWide && <span style={{fontSize:9,color:T.muted,marginLeft:6,fontWeight:400}}>· company-wide</span>}
                                </div>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{pol.provider || '—'} · expires {pol.expiry_date}</div>
                              </div>
                              <div style={{textAlign:'right',fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:color}}>{status}</div>
                              <div style={{textAlign:'right',fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:T.text}}>{fmt(pol.premium)}/yr</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
                {false&&detailTab==='overview-old'&&<div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:14}}>
                    {[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)},{l:'Total Invested',v:fmt((selected.purchase_price||0)+(selected.refurb_cost||0)),gold:true},{l:'Est. Value',v:fmt(selected.est_value)},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(1)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0}].map((item,i)=>(
                      <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:item.gold?T.gold:item.green?T.green:T.text}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  {selected.notes&&<div className="card" style={{padding:'16px 20px'}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Notes</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
                  </div>}
                </div>}
                {detailTab==='refurb'&&<RefurbTab prop={selected} onAddPhase={handleAddPhase} onAddCost={handleAddCost} onUpdatePhase={handleUpdatePhase} onDeletePhase={handleDeletePhase} onUpdateCost={handleUpdateCost} onDeleteCost={handleDeleteCost} onUpdateField={handleUpdatePropField} isAdmin={isAdmin} user={user}/>}
                {detailTab==='rent'&&<RentTab selected={selected} fmt={fmt} setEditingPayment={setEditingPayment} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties} onDayTracker={()=>setView('daytracker')}/>}
                {detailTab==='financials'&&<FinancialsTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} calcMonthlyProfit={calcMonthlyProfit} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditFinancial={canDo(permissionsMap, selected.company_id, 'edit_financial') || devModeActive}/>}
                {false&&<div style={{display:'grid',gap:12}}>
                  {[{title:'Purchase & Costs',items:[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Deposit',v:fmt(selected.deposit)},{l:'Mortgage Amount',v:fmt(selected.mortgage_amount)},{l:'Stamp Duty',v:fmt(selected.stamp_duty)},{l:'Legal Fees',v:fmt(selected.legal_fees)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)}]},{title:'Mortgage',items:[{l:'Rate',v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'-'},{l:'Term',v:selected.mortgage_term?selected.mortgage_term+' years':'-'},{l:'Monthly (Repay)',v:fmt(calcMonthlyMortgage(selected))},{l:'Monthly (IO)',v:selected.mortgage_amount&&selected.mortgage_rate?fmt(selected.mortgage_amount*selected.mortgage_rate/12):'-'}]},{title:'Returns',items:[{l:'Monthly Rent',v:fmt(selected.rent_pcm),gold:true},{l:'Annual Rent',v:fmt((selected.rent_pcm||0)*12),gold:true},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(2)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0},{l:'Annual Profit',v:fmt(calcMonthlyProfit(selected)*12),green:calcMonthlyProfit(selected)>0}]}].map((section,si)=>(
                    <div key={si} className="card" style={{padding:'18px 22px'}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>{section.title}</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        {section.items.map((item,i)=>(
                          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8}}>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{item.l}</span>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:item.gold?T.gold:item.green?T.green:T.text}}>{item.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>}
                {detailTab==='contractors'&&<ContractorsPage propertyFilter={selected.id} showToast={showToast} user={user} compact={true}/>}
                {(detailTab==='overview'||detailTab==='tenancy'||['right to rent','deposit','notices','rent history'].includes(detailTab))&&<TenancyRenewalAlert propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                {detailTab==='compliance'&&<ComplianceTab propertyId={selected.id} showToast={showToast} isAdmin={isAdmin} user={user} category="compliance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_compliance') || devModeActive}/>}
                {(detailTab==='tenancy'||['right to rent','deposit','notices','rent history'].includes(detailTab))&&(()=>{
                  // The four legacy values map to themselves as sub-tabs; "tenancy" => "details".
                  const subTab = detailTab==='tenancy' ? 'details' : detailTab
                  const SUBS = [
                    ['details',       'Details'],
                    ['right to rent', 'Right to Rent'],
                    ['deposit',       'Deposit'],
                    ['notices',       'Notices'],
                    ['rent history',  'Rent History'],
                  ]
                  return (
                    <div>
                      <div style={{display:'flex',gap:2,marginBottom:14,flexWrap:'wrap',borderBottom:`1px solid ${T.border}`,paddingBottom:0,alignItems:'center'}}>
                        {SUBS.map(([k,label])=>(
                          <button key={k}
                            onClick={()=>setDetailTab(k==='details' ? 'tenancy' : k)}
                            style={{
                              fontFamily:"'DM Mono',monospace",fontSize:11,padding:'8px 14px',
                              border:'none',borderBottom:`2px solid ${subTab===k?T.gold:'transparent'}`,
                              background:'transparent',cursor:'pointer',
                              color:subTab===k?T.text:T.muted,
                              fontWeight:subTab===k?700:400,
                              transition:'all 0.15s',
                              marginBottom:-1,
                            }}>
                            {label}
                          </button>
                        ))}
                        <button onClick={()=>setShowReferencing(true)}
                          style={{
                            marginLeft:'auto',marginBottom:6,
                            fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
                            padding:'5px 12px',borderRadius:6,
                            border:`1px solid ${T.gold}66`,background:T.gold+'14',color:T.gold,
                            cursor:'pointer',display:'flex',alignItems:'center',gap:6,
                          }}>
                          🪪 Tenant Referencing
                          <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',padding:'1px 5px',borderRadius:3,background:T.gold+'33',color:T.gold}}>EARLY</span>
                        </button>
                      </div>
                      {subTab==='details'      &&<TenancyTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="tenancy" canEdit={canDo(permissionsMap, selected.company_id, 'edit_tenancies') || devModeActive} canViewPersonal={canDo(permissionsMap, selected.company_id, 'view_tenant_personal') || devModeActive}/>}
                      {subTab==='right to rent'&&<RightToRentTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                      {subTab==='deposit'      &&<DepositProtectionTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                      {subTab==='notices'      &&<NoticeTrackerTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T} property={selected}/>}
                      {subTab==='rent history' &&<RentHistoryTab propertyId={selected.id} userId={user?.id} currentRent={selected.rent_pcm} showToast={showToast} T={T}/>}
                    </div>
                  )
                })()}
                {detailTab==='maintenance'&&<MaintenanceTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="maintenance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_maintenance') || devModeActive}/>}
                {detailTab==='expenses'&&<ExpensesTab propertyId={selected.id} showToast={showToast} fmt={fmt} rentPcm={selected.rent_pcm||0} isAdmin={isAdmin} user={user} category="expenses" canEdit={canDo(permissionsMap, selected.company_id, 'edit_expenses') || devModeActive} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive}/>}
                {detailTab==='documents'&&<DocumentsTab propertyId={selected.id} propertyName={selected.name} showToast={showToast} isAdmin={isAdmin} user={user}/>}
              </div>
              <div style={{display:'grid',gap:12}}>
                <div className="card" style={{padding:'18px 20px'}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Quick Stats</div>
                  {(() => {
                    const cv = selected.current_value || selected.est_value || 0
                    const totalCapIn = (selected.deposit||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)+(selected.refurb_cost||0)
                    const eq = cv - (selected.mortgage_amount||0)
                    const ltvNum = cv && selected.mortgage_amount ? (selected.mortgage_amount/cv)*100 : null
                    return [
                      {l:'Total Capital In', v:fmt(totalCapIn),
                        explain: {
                          title: 'Total Capital In',
                          formula: 'Deposit + Stamp Duty + Legal Fees + Refurb Cost',
                          inputs: [
                            { label: 'Deposit',     value: fmt(selected.deposit) },
                            { label: 'Stamp Duty',  value: fmt(selected.stamp_duty) },
                            { label: 'Legal Fees',  value: fmt(selected.legal_fees) },
                            { label: 'Refurb Cost', value: fmt(selected.refurb_cost) },
                          ],
                          result: fmt(totalCapIn),
                          note: !selected.mortgage_amount
                            ? "Heads up: this property has no mortgage recorded. For cash purchases, you may want to add the Purchase Price into Deposit so this number reflects the true cash you put in."
                            : "Cash you actually put in (excluding the mortgage). For mortgage purchases this is your real out-of-pocket.",
                        }},
                      {l:'Current Value', v:fmt(cv),
                        explain: {
                          title: 'Current Value',
                          formula: 'Current Value (or Estimated Value as fallback)',
                          inputs: [
                            { label: 'Current Value',   value: selected.current_value ? fmt(selected.current_value) : '— (not set)' },
                            { label: 'Estimated Value', value: fmt(selected.est_value) },
                          ],
                          result: fmt(cv),
                          note: 'Set Current Value separately on Overview to track market changes vs. your initial estimate.',
                        }},
                      {l:'Equity', v:fmt(eq),
                        explain: {
                          title: 'Equity',
                          formula: 'Current Value − Mortgage Amount',
                          inputs: [
                            { label: 'Current Value',   value: fmt(cv) },
                            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
                          ],
                          result: fmt(eq),
                          note: 'Your stake today. Goes negative if mortgage > value.',
                        }},
                      {l:'LTV', v: ltvNum !== null ? ltvNum.toFixed(0)+'%' : '-',
                        explain: {
                          title: 'Loan to Value (LTV)',
                          formula: 'Mortgage Amount ÷ Current Value × 100',
                          inputs: [
                            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
                            { label: 'Current Value',   value: fmt(cv) },
                          ],
                          result: ltvNum !== null ? ltvNum.toFixed(1)+'%' : '— (no mortgage or value)',
                        }},
                    ]
                  })().map((item,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8,marginBottom:6}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{item.l}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:T.gold,display:'inline-flex',alignItems:'center',gap:2}}>
                        {item.v}
                        {item.explain && <CalcExplain {...item.explain}/>}
                      </span>
                    </div>
                  ))}
                </div>
                {(selected.arrears||0)>0&&<div className="card" style={{padding:'16px 18px',borderLeft:`3px solid ${T.red}`}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.red,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>⚠ Rent Arrears</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,fontWeight:700,color:T.red,marginBottom:4}}>{fmt(selected.arrears)}</div>
                  {selected.notes&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,lineHeight:1.6}}>{selected.notes}</div>}
                </div>}
              </div>
            </div>
          </div>}
        </>}
      </main>

      <CommandPalette open={showPalette} commands={paletteCommands} onClose={()=>setShowPalette(false)}/>
      {showReferencing && selected && <TenantReferenceModal property={selected} onClose={()=>setShowReferencing(false)}/>}
      {showAddProp&&<PropertyModal prop={editProp} companies={companies} onClose={()=>{setShowAddProp(false);setEditProp(null)}} onSave={handleSaveProp}/>}
      {showAddBulk&&<BulkAddPropertyModal
        companies={companies}
        onClose={()=>setShowAddBulk(false)}
        onSaved={(created)=>{
          setProperties(prev => [...prev, ...created])
          setShowAddBulk(false)
        }}
        showToast={showToast}
      />}
      {showAddCo&&<CompanyModal onClose={()=>setShowAddCo(false)} onSave={handleSaveCo}/>}
      {showCustomizeDash && <CustomizeDashModal
        initialTab={customizeDashTab}
        sectionDefs={SECTION_META}
        currentSectionPrefs={sectionPrefs}
        defaultSectionOrder={SECTION_DEFAULT_ORDER}
        defaultSectionEnabled={SECTION_DEFAULT_ENABLED}
        onSaveSections={(newPrefs) => {
          setSectionPrefs(newPrefs)
          try { localStorage.setItem(`ownproperly_section_prefs_${user.id}`, JSON.stringify(newPrefs)) } catch(e) {}
        }}
        widgetDefs={WIDGET_META}
        currentWidgetPrefs={widgetPrefs}
        defaultWidgetOrder={WIDGET_DEFAULT_ORDER}
        defaultWidgetEnabled={WIDGET_DEFAULT_ENABLED}
        onSaveWidgets={async (newPrefs) => {
          setWidgetPrefs(newPrefs)
          await api.saveWidgetPrefs(newPrefs).catch(()=>{})
          showToast('Dashboard saved')
        }}
        onClose={() => setShowCustomizeDash(false)}
        T={T}
      />}
      {renameCoTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:600,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:420,padding:'32px 28px',border:`1px solid ${T.border}`}}>
            <div style={{fontSize:32,marginBottom:12,textAlign:'center'}}>✏️</div>
            <h2 style={{fontSize:18,fontWeight:700,textAlign:'center',marginBottom:6}}>Rename company</h2>
            <p style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted,textAlign:'center',marginBottom:24}}>Currently: <strong style={{color:T.text}}>{renameCoTarget.name}</strong></p>
            <div style={{display:'grid',gap:14,marginBottom:20}}>
              <div>
                <label style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>New company name</label>
                <input value={renameCo.name} onChange={e=>setRenameCo(p=>({...p,name:e.target.value}))} autoFocus
                  style={{width:'100%',fontFamily:"'DM Mono',monospace",fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Abbreviation (up to 5 chars)</label>
                <input value={renameCo.abbr} onChange={e=>setRenameCo(p=>({...p,abbr:e.target.value.toUpperCase().slice(0,5)}))} placeholder="e.g. ACME"
                  style={{width:'100%',fontFamily:"'DM Mono',monospace",fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your password to confirm</label>
                <input type="password" value={renameCoPassword} onChange={e=>{setRenameCoPassword(e.target.value);setRenameCoError('')}}
                  placeholder="Enter your password"
                  style={{width:'100%',fontFamily:"'DM Mono',monospace",fontSize:13,background:T.bg,border:`1.5px solid ${renameCoError?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
                {renameCoError&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.red,marginTop:6}}>{renameCoError}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setRenameCoTarget(null)}
                style={{flex:1,fontFamily:"'DM Mono',monospace",fontSize:12,padding:'11px',borderRadius:10,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
                Cancel
              </button>
              <button onClick={handleRenameCompany} disabled={renameCoSaving}
                style={{flex:2,fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,padding:'11px',borderRadius:10,border:'none',background:renameCoSaving?T.border:T.gold,color:'#1A2530',cursor:'pointer'}}>
                {renameCoSaving?'Saving…':'Save new name'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editingPayment&&<PaymentModal payment={editingPayment.payment} onClose={()=>setEditingPayment(null)} onSave={handleUpdatePayment}/>}
      {/* Access modal now lives inside Settings page */}
      {showImporter&&<StatementImporter properties={activeProperties} companies={companies} showToast={showToast} onClose={()=>{setShowImporter(false); refreshData()}}/>}
      {showDeleteConfirm&&<DeleteConfirmModal propName={properties.find(p=>p.id===showDeleteConfirm)?.name||''} onClose={()=>setShowDeleteConfirm(null)} onConfirm={pwd=>handleDeleteProp(showDeleteConfirm,pwd)}/>}
      {showSellModal&&<SellPropertyModal
        property={properties.find(p=>p.id===showSellModal)}
        onClose={()=>setShowSellModal(null)}
        onConfirm={(price, date)=>handleMarkSold(showSellModal, price, date)}
        busy={propertyActionBusy}/>}
      {deleteCoTarget&&<DeleteCompanyModal
        company={deleteCoTarget}
        userId={user?.id}
        onClose={()=>setDeleteCoTarget(null)}
        onDeleted={()=>{
          setDeleteCoTarget(null)
          refreshData()
          showToast(`${deleteCoTarget.name} deleted — restore from Trash within 30 days`)
        }}/>}

      {toast&&<div style={{position:'fixed',bottom:24,right:24,zIndex:999,background:toast.type==='error'?'#2B1010':'#0D2B1F',border:`1px solid ${toast.type==='error'?T.red:T.green}`,color:toast.type==='error'?T.red:T.green,fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,padding:'12px 20px',borderRadius:10,animation:'fadeIn 0.2s ease'}}>{toast.msg}</div>}

      {/* Mobile bottom nav - consistent icons, + More opens drawer */}
      <nav className="mobile-nav" style={{display:'flex',justifyContent:'space-around',alignItems:'center'}}>
        {navItems.filter(n=>n.key!=='companies'&&n.key!=='contractors').slice(0,5).map(n=>{
          const key = n.key
          const active = view===key||(view==='detail'&&key==='properties')
          return (
            <button key={key} onClick={()=>{setView(key);setSelectedId(null)}}
              style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
                alignItems:'center',gap:2,padding:'4px 8px',flex:1,
                color:active?T.gold:T.muted,fontFamily:"'DM Mono',monospace"}}>
              <span style={{fontSize:20}}>{n.icon}</span>
              <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.04em'}}>{n.short}</span>
            </button>
          )
        })}
        <button onClick={()=>setShowDrawer(true)}
          style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
            alignItems:'center',gap:2,padding:'4px 8px',flex:1,
            color:T.muted,fontFamily:"'DM Mono',monospace"}}>
          <span style={{fontSize:20}}>☰</span>
          <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.04em'}}>More</span>
        </button>
      </nav>

      {/* ── ADMIN DASHBOARD OVERLAY ── */}
      {showAdmin && isPlatformAdmin && (
        <AdminDashboard onClose={()=>setShowAdmin(false)} user={user}/>
      )}

      {/* ── ONBOARDING TOUR ── */}
      {showTour && (
        <OnboardingTour user={user} onComplete={()=>setShowTour(false)}/>
      )}
    </div>
  )
}

function RefurbTab({prop,onAddPhase,onAddCost,onUpdatePhase,onDeletePhase,onUpdateCost,onDeleteCost,onUpdateField,isAdmin,user}){
  const { T } = useTheme()
  const [phaseForm,setPhaseForm]=useState({name:'',start_date:'',end_date:'',done:false,notes:''})
  const [costForm,setCostForm]=useState({trade:'',cost:'',paid:false,date:'',notes:''})
  const [showPF,setShowPF]=useState(false)
  const [showCF,setShowCF]=useState(false)
  const [editingPhaseId,setEditingPhaseId]=useState(null)
  const [editingCostId,setEditingCostId]=useState(null)
  const [phaseEdit,setPhaseEdit]=useState({})
  const [costEdit,setCostEdit]=useState({})
  const phases=prop.refurb_phases||[]
  const costs=prop.refurb_costs||[]
  const totalCost=costs.reduce((s,i)=>s+(parseFloat(i.cost)||0),0)
  const paidCost=costs.filter(i=>i.paid).reduce((s,i)=>s+(parseFloat(i.cost)||0),0)

  function startEditPhase(ph){ setEditingPhaseId(ph.id); setPhaseEdit({name:ph.name||'',start_date:ph.start_date||'',end_date:ph.end_date||'',done:!!ph.done,notes:ph.notes||''}) }
  function startEditCost(c){ setEditingCostId(c.id); setCostEdit({trade:c.trade||'',cost:c.cost||'',paid:!!c.paid,date:c.date||'',notes:c.notes||''}) }
  function savePhaseEdit(){ if(phaseEdit.name){ onUpdatePhase(prop.id, editingPhaseId, phaseEdit); setEditingPhaseId(null) } }
  function saveCostEdit(){ if(costEdit.trade){ onUpdateCost(prop.id, editingCostId, {...costEdit, cost:parseFloat(costEdit.cost)||0}); setEditingCostId(null) } }

  const iconBtn = {fontFamily:"'DM Mono',monospace",fontSize:11,padding:'4px 8px',background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,cursor:'pointer',color:T.muted}

  return <div>
    <div className="card" style={{padding:'14px 18px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
      <div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Refurb Status</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:REFURB_CFG[prop.refurb_status]?.color||'#C8A84B'}}>{REFURB_CFG[prop.refurb_status]?.label||prop.refurb_status}</div>
      </div>
      <div style={{display:'flex',gap:20}}>
        <div style={{textAlign:'right'}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>Total Cost</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:T.amber}}>{fmt(totalCost)}</div></div>
        <div style={{textAlign:'right'}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>Paid Out</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:T.green}}>{fmt(paidCost)}</div></div>
      </div>
      <select value={prop.refurb_status} onChange={e=>onUpdateField(prop.id,'refurb_status',e.target.value)} style={{width:'auto',fontSize:11,padding:'6px 10px'}}>
        <option value="planned">Planned</option><option value="in-progress">In Progress</option><option value="complete">Complete</option>
      </select>
    </div>
    <div style={{marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Phases</div>
        <button className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px'}} onClick={()=>setShowPF(v=>!v)}>+ Add Phase</button>
      </div>
      {showPF&&<div className="card" style={{padding:'14px 16px',marginBottom:10}}>
        <div className="g2" style={{marginBottom:10}}>
          <div><label>Phase Name</label><input value={phaseForm.name} onChange={e=>setPhaseForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Strip Out"/></div>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingTop:18}}><input type="checkbox" checked={phaseForm.done} onChange={e=>setPhaseForm(f=>({...f,done:e.target.checked}))} style={{width:'auto'}}/><label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>Complete</label></div>
        </div>
        <div className="g2" style={{marginBottom:10}}>
          <div><label>Start Date</label><input type="date" value={phaseForm.start_date} onChange={e=>setPhaseForm(f=>({...f,start_date:e.target.value}))}/></div>
          <div><label>End Date</label><input type="date" value={phaseForm.end_date} onChange={e=>setPhaseForm(f=>({...f,end_date:e.target.value}))}/></div>
        </div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{if(phaseForm.name){onAddPhase(prop.id,phaseForm);setPhaseForm({name:'',start_date:'',end_date:'',done:false,notes:''});setShowPF(false)}}}>Add Phase</button>
      </div>}
      {phases.length===0&&!showPF&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,padding:'12px 0'}}>No phases yet.</div>}
      {phases.map(ph=>(
        editingPhaseId===ph.id ? (
          <div key={ph.id} className="card" style={{padding:'14px 16px',marginBottom:8,border:`1px solid ${T.gold}44`}}>
            <div className="g2" style={{marginBottom:10}}>
              <div><label>Phase Name</label><input value={phaseEdit.name} onChange={e=>setPhaseEdit(f=>({...f,name:e.target.value}))}/></div>
              <div style={{display:'flex',alignItems:'center',gap:8,paddingTop:18}}><input type="checkbox" checked={phaseEdit.done} onChange={e=>setPhaseEdit(f=>({...f,done:e.target.checked}))} style={{width:'auto'}}/><label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>Complete</label></div>
            </div>
            <div className="g2" style={{marginBottom:10}}>
              <div><label>Start Date</label><input type="date" value={phaseEdit.start_date} onChange={e=>setPhaseEdit(f=>({...f,start_date:e.target.value}))}/></div>
              <div><label>End Date</label><input type="date" value={phaseEdit.end_date} onChange={e=>setPhaseEdit(f=>({...f,end_date:e.target.value}))}/></div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-gold" style={{fontSize:11}} onClick={savePhaseEdit}>Save</button>
              <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setEditingPhaseId(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={ph.id} className="card" style={{padding:'12px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:ph.done?'#2ECC8A':'#E0943A',flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{ph.name}</div>{(ph.start_date||ph.end_date)&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{ph.start_date||'?'} -&gt; {ph.end_date||'ongoing'}</div>}</div>
            <button onClick={()=>onUpdatePhase(prop.id, ph.id, {done:!ph.done})} title={ph.done?'Mark in progress':'Mark complete'}
              style={{...iconBtn,color:ph.done?'#2ECC8A':'#E0943A',borderColor:(ph.done?'#2ECC8A':'#E0943A')+'44'}}>
              {ph.done?'✓ Done':'In Progress'}
            </button>
            {isAdmin&&<>
              <button onClick={()=>startEditPhase(ph)} style={iconBtn} title="Edit">✎</button>
              <button onClick={()=>onDeletePhase(prop.id, ph.id)} style={iconBtn} title="Delete"
                onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'66'}}
                onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>🗑</button>
            </>}
          </div>
        )
      ))}
    </div>
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Trade Costs</div>
        <button className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px'}} onClick={()=>setShowCF(v=>!v)}>+ Add Cost</button>
      </div>
      {showCF&&<div className="card" style={{padding:'14px 16px',marginBottom:10}}>
        <div className="g2" style={{marginBottom:10}}>
          <div><label>Trade / Description</label><input value={costForm.trade} onChange={e=>setCostForm(f=>({...f,trade:e.target.value}))} placeholder="e.g. Plumber"/></div>
          <div><label>Cost</label><MoneyInput prefix="£" value={costForm.cost} onChange={v=>setCostForm(f=>({...f,cost:v}))} placeholder="0"/></div>
        </div>
        <div className="g2" style={{marginBottom:10}}>
          <div><label>Date</label><input type="date" value={costForm.date} onChange={e=>setCostForm(f=>({...f,date:e.target.value}))}/></div>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingTop:18}}><input type="checkbox" checked={costForm.paid} onChange={e=>setCostForm(f=>({...f,paid:e.target.checked}))} style={{width:'auto'}}/><label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>Paid</label></div>
        </div>
        <div style={{marginBottom:10}}><label>Notes</label><input value={costForm.notes} onChange={e=>setCostForm(f=>({...f,notes:e.target.value}))} placeholder="Optional"/></div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{if(costForm.trade){onAddCost(prop.id,{...costForm,cost:parseFloat(costForm.cost)||0});setCostForm({trade:'',cost:'',paid:false,date:'',notes:''});setShowCF(false)}}}>Add Cost</button>
      </div>}
      {costs.length===0&&!showCF&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,padding:'12px 0'}}>No costs logged yet.</div>}
      {costs.map(item=>(
        editingCostId===item.id ? (
          <div key={item.id} className="card" style={{padding:'14px 16px',marginBottom:8,border:`1px solid ${T.gold}44`}}>
            <div className="g2" style={{marginBottom:10}}>
              <div><label>Trade / Description</label><input value={costEdit.trade} onChange={e=>setCostEdit(f=>({...f,trade:e.target.value}))}/></div>
              <div><label>Cost</label><MoneyInput prefix="£" value={costEdit.cost} onChange={v=>setCostEdit(f=>({...f,cost:v}))}/></div>
            </div>
            <div className="g2" style={{marginBottom:10}}>
              <div><label>Date</label><input type="date" value={costEdit.date} onChange={e=>setCostEdit(f=>({...f,date:e.target.value}))}/></div>
              <div style={{display:'flex',alignItems:'center',gap:8,paddingTop:18}}><input type="checkbox" checked={costEdit.paid} onChange={e=>setCostEdit(f=>({...f,paid:e.target.checked}))} style={{width:'auto'}}/><label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>Paid</label></div>
            </div>
            <div style={{marginBottom:10}}><label>Notes</label><input value={costEdit.notes} onChange={e=>setCostEdit(f=>({...f,notes:e.target.value}))}/></div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-gold" style={{fontSize:11}} onClick={saveCostEdit}>Save</button>
              <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setEditingCostId(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={item.id} className="card" style={{padding:'12px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{item.trade}</div>{item.notes&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{item.notes}</div>}{item.date&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint}}>{item.date}</div>}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:item.paid?'#2ECC8A':'#E0943A'}}>{fmt(item.cost)}</div>
            <button onClick={()=>onUpdateCost(prop.id, item.id, {paid:!item.paid})} title={item.paid?'Mark unpaid':'Mark paid'}
              style={{...iconBtn,color:item.paid?'#2ECC8A':'#E0943A',borderColor:(item.paid?'#2ECC8A':'#E0943A')+'44'}}>
              {item.paid?'✓ Paid':'Unpaid'}
            </button>
            {isAdmin&&<>
              <button onClick={()=>startEditCost(item)} style={iconBtn} title="Edit">✎</button>
              <button onClick={()=>onDeleteCost(prop.id, item.id)} style={iconBtn} title="Delete"
                onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'66'}}
                onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>🗑</button>
            </>}
          </div>
        )
      ))}
    </div>
    <div style={{marginTop:20}}>
      <NotesTimeline propertyId={prop.id} isAdmin={isAdmin} user={user} showToast={()=>{}} category="refurb"/>
    </div>
  </div>
}
// ─── DRAGGABLE PROPERTY LIST ─────────────────────────────────────────────────
function DraggablePropertyList({filtered, fmt, openDetail, calcGrossYield, setProperties, properties, sortBy, yieldBasis}) {
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
    <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,textAlign:'center',padding:40}}>No properties match this filter.</div>
  )

  const isCustomSort = sortBy === 'custom' || !sortBy
  const isByCompany  = sortBy === 'company-name'

  // Precompute building counts so we only show a building header when a
  // building actually has 2+ adjacent items in the current sort. We skip
  // grouping in custom-sort mode to keep drag-and-drop semantics simple.
  const buildingCounts = new Map()
  if (!isCustomSort) {
    for (const p of items) {
      const tail = buildingTailFromName(p.name)
      if (tail) buildingCounts.set(tail, (buildingCounts.get(tail) || 0) + 1)
    }
  }

  return (
    <div style={{display:'grid',gap:8}}>
      {items.map((p, idx) => {
        // Company group header when sorted by company
        const showCompanyHeader = isByCompany && (idx===0 || items[idx-1].company_id !== p.company_id)
        const co = p.company

        // Building grouping: header when the *previous* item had a different
        // building tail and this building has 2+ properties in the visible
        // list. Indent the row itself if it belongs to a multi-unit building.
        const tail = !isCustomSort ? buildingTailFromName(p.name) : null
        const buildingSize = tail ? (buildingCounts.get(tail) || 0) : 0
        const inBuilding = buildingSize > 1
        const prevTail = idx > 0 ? buildingTailFromName(items[idx-1].name) : null
        const showBuildingHeader = inBuilding && tail !== prevTail
        // Inside a multi-unit building, drop the redundant suffix from the
        // displayed name (so "Room 1, Watts Moses House" → "Room 1").
        const displayName = inBuilding ? (String(p.name||'').split(',')[0].trim() || p.name) : p.name

        return (
        <div key={p.id}>
          {showCompanyHeader&&co&&(
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:idx>0?16:0,marginBottom:8}}>
              <div style={{width:3,height:18,background:co.color||T.gold,borderRadius:2,flexShrink:0}}/>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:co.color||T.gold}}>{co.abbr}</span>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>{co.name}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                {items.filter(x=>x.company_id===co.id).length} properties
              </span>
            </div>
          )}
          {showBuildingHeader&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:showCompanyHeader?6:10,marginBottom:6,paddingLeft:8}}>
              <span style={{fontSize:13}} aria-hidden="true">🏘</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:T.text}}>{tail}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>· {buildingSize} units</span>
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
            <div style={{flex:1,minWidth:180,cursor:'pointer'}} onClick={()=>openDetail(p)}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                <span style={{fontSize:15,fontWeight:700}}>{displayName}</span>
                <CompanyPill company={p.company}/>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>
                {p.prop_type} · {p.address}
                {p.managed_by&&<span style={{marginLeft:8,color:'#5A5E72'}}>· 🏢 {p.managed_by}</span>}
              </div>
            </div>
            {/* Stats */}
            <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap',cursor:'pointer'}} onClick={()=>openDetail(p)}>
              {p.arrears>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.red,fontWeight:700}}>⚠ {fmt(p.arrears)}</div>}
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:T.gold}}>{calcGrossYield(p, yieldBasis).toFixed(1)}% yield</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{fmt(p.rent_pcm) + "/mo"}</div>
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

// ─── RENT TRACKER OVERVIEW PAGE ──────────────────────────────────────────────
function RentTrackerOverview({companies, properties, fmt, openDetail, onDayTracker, yieldBasis}) {
  const { T } = useTheme()
  const [showRentReview, setShowRentReview] = useState(false)

  // Global year filter - applies to all properties
  const allPayments = properties.flatMap(p=>p.rent_payments||[])
  const allYears = [...new Set(allPayments.map(p=>p.year))].sort()
  const [globalYear, setGlobalYear] = useState(allYears[allYears.length-1]||null)
  const [expandedCompanies, setExpandedCompanies] = useState({})

  function toggleCompany(id) {
    setExpandedCompanies(prev=>({...prev,[id]:!prev[id]}))
  }

  // Per-property year stats
  function getStats(payments, year, rentPcm) {
    const filtered = year ? payments.filter(p=>p.year===year) : payments
    const paid    = filtered.filter(p=>p.status==='paid').length
    const missed  = filtered.filter(p=>p.status==='missed').length
    const late = filtered.filter(p=>p.status==='late').length
    const refurb  = filtered.filter(p=>p.status==='refurb').length
    const voidM   = filtered.filter(p=>p.status==='void').length
    const lateIncome = late * (rentPcm||0)
    const income  = paid * (rentPcm||0)
    return {paid, missed, late, refurb, voidM, income}
  }

  // Company totals for selected year
  function getCompanyTotals(companyProps, year) {
    return companyProps.reduce((acc, p) => {
      const s = getStats(p.rent_payments||[], year, p.rent_pcm)
      acc.paid    += s.paid
      acc.missed  += s.missed
      acc.late += s.late
      acc.refurb  += s.refurb
      acc.income  += s.income
      return acc
    }, {paid:0, missed:0, late:0, refurb:0, income:0})
  }

  return (
    <div className="fade">
      {/* Header + global year filter */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:24}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:8}}>Rent Tracker</h1>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {[{c:T.green,l:'Paid'},{c:T.red,l:'Missed'},{c:T.amber,l:'Late'},{c:T.blue,l:'Refurb'},{c:T.faint,l:'Void'}].map(x=>(
              <span key={x.l} style={{display:'flex',alignItems:'center',gap:4,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>
                <span style={{width:10,height:10,borderRadius:2,background:x.c,display:'inline-block'}}/>{x.l}
              </span>
            ))}
          </div>
        </div>
        {/* Right side: year filter + day tracker button */}
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginRight:4}}>FILTER YEAR:</span>
            {[null,...allYears].map(yr=>(
              <button key={yr||'all'} onClick={()=>setGlobalYear(yr)}
                style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${globalYear===yr?T.gold:T.border}`,
                  background:globalYear===yr?T.gold+'22':'transparent',
                  color:globalYear===yr?T.gold:T.muted,transition:'all 0.18s'}}>
                {yr||'All'}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowRentReview(true)}
            style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.green}`,background:T.green+'22',color:T.green,whiteSpace:'nowrap'}}>
            📈 Plan rent review
          </button>
          <button onClick={onDayTracker}
            style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${'#C8A84B'}`,background:'#C8A84B22',color:'#C8A84B',whiteSpace:'nowrap'}}>
            📅 Day view
          </button>
        </div>
      </div>

      {/* Companies */}
      {companies.map(c=>{
        const cps = properties.filter(p=>p.company_id===c.id&&(p.rent_payments?.length>0||isPropertyEarningRent(p.status)))
        if (!cps.length) return null
        const totals = getCompanyTotals(cps, globalYear)
        const isOpen = expandedCompanies[c.id] !== false // default open

        return (
          <div key={c.id} style={{marginBottom:20}}>
            {/* Company header - clickable to collapse */}
            <div onClick={()=>toggleCompany(c.id)}
              style={{display:'flex',alignItems:'center',gap:10,marginBottom:isOpen?12:0,cursor:'pointer',
                background:T.card,border:`1px solid ${T.border}`,borderRadius:isOpen?'12px 12px 0 0':'12px',
                padding:'14px 18px',transition:'border-radius 0.2s'}}>
              <div style={{width:3,height:20,background:c.color,borderRadius:2,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <h2 style={{fontSize:15,fontWeight:700}}>{c.name}</h2>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{cps.length} properties</span>
                </div>
              </div>
              {/* Company summary for selected year */}
              <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
                {[
                  {v:totals.paid,   c:T.green, l:'paid'},
                  {v:totals.missed, c:T.red,   l:'missed'},
                  {v:totals.late,c:T.amber, l:'late'},
                  {v:totals.refurb, c:T.blue,  l:'refurb'},
                ].filter(x=>x.v>0).map(x=>(
                  <span key={x.l} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:x.c,fontWeight:600}}>
                    {x.v} {x.l}
                  </span>
                ))}
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:T.gold}}>{fmt(totals.income)}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted}}>{isOpen?'▲':'▼'}</span>
              </div>
            </div>

            {/* Property rows — grouped by building when 2+ units share a
                name suffix (e.g. "Room 1, Piers View" + "Room 10, Piers
                View"). Single properties render flat as before. */}
            {isOpen&&<div style={{border:`1px solid ${T.border}`,borderTop:'none',borderRadius:'0 0 12px 12px',overflow:'hidden'}}>
              {(() => {
                // Group consecutive properties by shared building tail
                const groups = []
                const indexByTail = new Map()
                for (const p of cps) {
                  const tail = buildingTailFromName(p.name)
                  const key = tail || `__solo__${p.id}`
                  if (!indexByTail.has(key)) {
                    indexByTail.set(key, groups.length)
                    groups.push({ key, name: tail, items: [] })
                  }
                  groups[indexByTail.get(key)].items.push(p)
                }

                // Flat index for row striping across the whole company
                let rowIdx = 0
                const totalRows = cps.length

                return groups.map((group) => {
                  const isBuilding = group.items.length > 1
                  // Sum building-level totals for the header
                  const bgRent = group.items.reduce((s,p) => s + (Number(p.rent_pcm)||0), 0)
                  return (
                    <div key={group.key}>
                      {isBuilding && (
                        <div style={{
                          padding: '10px 18px', background: T.bg,
                          borderBottom: `1px solid ${T.border}`,
                          display: 'flex', alignItems: 'center', gap: 10,
                          fontFamily: "'DM Mono',monospace",
                        }}>
                          <span style={{ fontSize: 14 }} aria-hidden="true">🏘</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
                            {group.name}
                          </span>
                          <span style={{ fontSize: 10, color: T.muted }}>
                            · {group.items.length} units · {fmt(bgRent)}/mo
                          </span>
                        </div>
                      )}
                      {group.items.map((p) => {
                        const pi = rowIdx++
                        const s = getStats(p.rent_payments||[], globalYear, p.rent_pcm)
                        return (
                          <div key={p.id}
                            style={{padding:`14px 18px 14px ${isBuilding ? 38 : 18}px`,borderBottom:pi<totalRows-1?`1px solid ${T.border}`:'none',
                              background:pi%2===0?T.card:T.surface,cursor:'pointer',transition:'background 0.15s',
                              borderLeft: isBuilding ? `2px solid ${T.gold}33` : 'none',
                              marginLeft: isBuilding ? 18 : 0,
                            }}
                            onClick={()=>openDetail(p)}
                            onMouseEnter={e=>e.currentTarget.style.background=T.border}
                            onMouseLeave={e=>e.currentTarget.style.background=pi%2===0?T.card:T.surface}>
                            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                              {/* Left: name + dots */}
                              <div style={{flex:1,minWidth:200}}>
                                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                                  <span style={{fontSize:13,fontWeight:600}}>
                                    {/* When grouped under a building, drop the redundant
                                        building suffix from each row's display name. */}
                                    {isBuilding ? (p.name.split(',')[0].trim() || p.name) : p.name}
                                  </span>
                                  {(p.arrears||0)>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.red,fontWeight:700}}>⚠ {fmt(p.arrears)}</span>}
                                </div>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:6}}>
                                  {`${fmt(p.rent_pcm)}/mo`} · Due {p.rent_due_day||'-'}
                                </div>
                                <RentDots payments={p.rent_payments||[]} filterYear={globalYear} onDayTracker={onDayTracker}/>
                              </div>
                              {/* Right: stats + badge */}
                              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                                <Badge status={p.status}/>
                                <div style={{display:'flex',gap:10,flexWrap:'wrap',justifyContent:'flex-end'}}>
                                  {[
                                    {v:s.paid,    c:T.green, l:'P'},
                                    {v:s.missed,  c:T.red,   l:'M'},
                                    {v:s.late, c:T.amber, l:'L'},
                                    {v:s.refurb,  c:T.blue,  l:'R'},
                                  ].map(x=>(
                                    <span key={x.l} style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:x.v>0?x.c:T.faint}}>
                                      {x.v} {x.l}
                                    </span>
                                  ))}
                                </div>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:T.gold}}>
                                  {fmt(s.income)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              })()}
            </div>}
          </div>
        )
      })}

      {companies.every(c=>!properties.some(p=>p.company_id===c.id))&&
        <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,textAlign:'center',padding:40}}>
          No properties found.
        </div>}

      {showRentReview && (
        <RentReviewModal
          properties={properties}
          companies={companies}
          fmt={fmt}
          yieldBasis={yieldBasis}
          onClose={()=>setShowRentReview(false)}
        />
      )}
    </div>
  )
}

// ─── RENT TAB ────────────────────────────────────────────────────────────────
function RentTab({selected, fmt, setEditingPayment, isAdmin, user, showToast, setProperties, onDayTracker}) {
  const { T } = useTheme()
  const payments = selected.rent_payments || []
  const years = [...new Set(payments.map(p=>p.year))].sort()
  const [filterYear, setFilterYear] = useState(years[years.length-1] || null)

  const filtered = filterYear ? payments.filter(p=>p.year===filterYear) : payments

  // Stats for selected year
  const paid    = filtered.filter(p=>p.status==='paid').length
  const missed  = filtered.filter(p=>p.status==='missed').length
  const late = filtered.filter(p=>p.status==='late').length
  const refurb  = filtered.filter(p=>p.status==='refurb').length
  const voidM   = filtered.filter(p=>p.status==='void').length
  const totalIncome = paid * (selected.rent_pcm||0)
  const lateIncome = late * (selected.rent_pcm||0)

  return (
    <div>
      {/* Key stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
        {[
          {l:'Monthly Rent', v:fmt(selected.rent_pcm), accent:T.green},
          {l:'Rent Due',     v:selected.rent_due_day||'-'},
          {l:'Tenancy End',  v:selected.tenancy_end||'-'},
          {l:'Arrears',      v:fmt(selected.arrears||0), accent:selected.arrears>0?T.red:T.green},
        ].map((item,i)=>(
          <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:item.accent||T.text}}>{item.v}</div>
          </div>
        ))}
      </div>

      {/* Payment history with year filter */}
      {payments.length>0&&<div className="card" style={{padding:'16px 20px',marginBottom:14}}>
        {/* Year filter buttons */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
            Payment History <span style={{fontSize:9}}>(click dot to update)</span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setFilterYear(null)}
              style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${filterYear===null?T.gold:T.border}`,
                background:filterYear===null?T.gold+'22':'transparent',
                color:filterYear===null?T.gold:T.muted}}>All</button>
            {years.map(yr=>(
              <button key={yr} onClick={()=>setFilterYear(yr)}
                style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${filterYear===yr?T.gold:T.border}`,
                  background:filterYear===yr?T.gold+'22':'transparent',
                  color:filterYear===yr?T.gold:T.muted}}>{yr}</button>
            ))}
          </div>
        </div>

        {/* Dots */}
        <RentDots payments={payments} onUpdate={m=>setEditingPayment({payment:m,propId:selected.id})} filterYear={filterYear} onDayTracker={onDayTracker}/>

        {/* Legend */}
        <div style={{display:'flex',gap:12,marginTop:10,flexWrap:'wrap'}}>
          {[{c:T.green,l:'Paid'},{c:T.red,l:'Missed'},{c:T.amber,l:'Late'},{c:T.blue,l:'Refurb'},{c:T.faint,l:'Void'}].map(x=>(
            <span key={x.l} style={{display:'flex',alignItems:'center',gap:4,fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
              <span style={{width:8,height:8,borderRadius:2,background:x.c,display:'inline-block'}}/>{x.l}
            </span>
          ))}
        </div>

        {/* Year summary */}
        <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>
            {filterYear ? `${filterYear} Summary` : 'All Time Summary'}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
            {[
              {l:'Months Paid',    v:paid,    c:T.green,  sub:fmt(totalIncome)},
              {l:'Months Missed',  v:missed,  c:T.red,    sub:fmt(missed*(selected.rent_pcm||0))},
              {l:'Months Late', v:late, c:T.amber,  sub:fmt(lateIncome)},
              {l:'Months Refurb',  v:refurb,  c:T.blue,   sub:''},
              {l:'Months Void',    v:voidM,   c:T.faint,  sub:''},
              {l:'Total Received', v:fmt(totalIncome), c:T.gold, sub:`${paid} months`, big:true},
            ].map((item,i)=>(
              <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{item.l}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:item.big?15:17,fontWeight:700,color:item.c}}>{item.v}</div>
                {item.sub&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.faint,marginTop:2}}>{item.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>}

      {/* Notes Timeline */}
      <NotesTimeline propertyId={selected.id} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties} category="rent"/>
    </div>
  )
}
