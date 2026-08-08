
import { useState, useEffect, useMemo, useCallback, useRef, memo, lazy, Suspense, Fragment } from 'react'
import { useTheme } from './lib/ThemeContext'
import { useIsMobile } from './lib/useWindowSize'
import { getSubdomain } from './lib/subdomain'
import { ALL_NAV, DEFAULT_NAV_KEYS, VIEW_LABELS, SETTINGS_TABS } from './lib/nav'
import { REPORT_CATALOGUE } from './lib/reportCatalogue'
// FeatureComponents (4k+ lines, pulls in HelpCenter) and the tenancy/
// maintenance tab modules (which pull in NoticeGenerator) only render on
// the property-detail / settings / companies views — lazy-load them so
// they drop out of the entry chunk. Logged-out marketing visitors and the
// first dashboard paint no longer pay for them. lazyNamed() adapts a
// named export to React.lazy's default-export contract; repeated imports
// of the same module share one chunk/fetch.
const lazyNamed = (loader, name) => lazy(() => loader().then(m => ({ default: m[name] })))
const featureModule = () => import('./components/FeatureComponents')
const ComplianceTab       = lazyNamed(featureModule, 'ComplianceTab')
const TenancyTab          = lazyNamed(featureModule, 'TenancyTab')
const ExpensesTab         = lazyNamed(featureModule, 'ExpensesTab')
const SettingsPage        = lazyNamed(featureModule, 'SettingsPage')
const NotesTimeline       = lazyNamed(featureModule, 'NotesTimeline')
const OverviewTab         = lazyNamed(featureModule, 'OverviewTab')
const FinancialsTab       = lazyNamed(featureModule, 'FinancialsTab')
const DocumentsTab        = lazyNamed(featureModule, 'DocumentsTab')
const CompanyDocumentsTab = lazyNamed(featureModule, 'CompanyDocumentsTab')
const maintenanceModule = () => import('./components/maintenance')
const MaintenanceTab = lazyNamed(maintenanceModule, 'MaintenanceTab')
const tenancyModule = () => import('./components/tenancy')
const RightToRentTab       = lazyNamed(tenancyModule, 'RightToRentTab')
const DepositProtectionTab = lazyNamed(tenancyModule, 'DepositProtectionTab')
const NoticeTrackerTab     = lazyNamed(tenancyModule, 'NoticeTrackerTab')
const RentHistoryTab       = lazyNamed(tenancyModule, 'RentHistoryTab')
const TenancyRenewalAlert  = lazyNamed(tenancyModule, 'TenancyRenewalAlert')
import { SmartAlerts, ContractorsPage, RentReviewModal } from './components/DashboardComponents'
import TenantInbox from './components/TenantInbox'
// Heavy / rarely-on-first-paint pages — code-split via React.lazy so they
// don't bloat the initial bundle. Each one drops into its own chunk and
// only fetches when the user navigates there.
const ReportsPage     = lazy(() => import('./components/ReportsPage'))
const AdminDashboard  = lazy(() => import('./components/AdminDashboard'))
const MarketingSite   = lazy(() => import('./components/MarketingSite'))
const TenantPortal    = lazy(() => import('./components/TenantPortal'))
const DealsPage       = lazy(() => import('./components/DealsPage'))
const DayTrackerPage  = lazy(() => import('./components/DayTrackerPage'))
const PropertyMap     = lazy(() => import('./components/PropertyMap'))
const InsurancePage   = lazy(() => import('./components/InsurancePage'))
const MtdItsaPage     = lazy(() => import('./components/MtdItsaPage'))
const AutopilotWidget = lazyNamed(() => import('./components/AutopilotPanel'), 'AutopilotWidget')
const AutopilotPage   = lazyNamed(() => import('./components/AutopilotPanel'), 'AutopilotPage')
const RentersRightsCopilot = lazyNamed(() => import('./components/RentersRightsCopilot'), 'RentersRightsCopilot')
const HmoRoomsPanel   = lazy(() => import('./components/HmoRoomsPanel'))
const EpcPlanner      = lazy(() => import('./components/EpcPlanner'))
const RentCollectionPanel = lazyNamed(() => import('./components/RentCollectionPanel'), 'RentCollectionPanel')
const ESignPanel      = lazy(() => import('./components/ESignPanel'))
const ReferencingPanel = lazy(() => import('./components/ReferencingPanel'))
const StatementImporter = lazyNamed(() => import('./components/StatementImporter'), 'StatementImporter')
import { supabase } from './lib/supabase'
import { useAuth } from './lib/AuthContext'
import * as api from './lib/api'
import LoginPage from './components/LoginPage'
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard'))
import BillingPage from './components/BillingPage'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsOfService from './components/TermsOfService'
import SecurityPage from './components/SecurityPage'
const OnboardingTour = lazy(() => import('./components/OnboardingTour'))
import CalcExplain from './components/CalcExplain'
import ActionMenu from './components/ActionMenu'
const BulkAddPropertyModal = lazy(() => import('./components/BulkAddPropertyModal'))
import MoneyInput from './lib/MoneyInput'
import { aggregateDeals } from './lib/dealCashflow'
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS, isPropertyEarningRent, isPropertyOccupied } from './lib/propertyStatus'
import { groupKeyForAddress, flatKeyWithinBuilding, buildingTailFromName, naturalCompare, groupPropertiesByBuilding } from './lib/addressUtils'
import { ChromeLogo, ChromeIcon } from './components/Logo'
import { complianceStatusFor, complianceBadge, certTypeStatus } from './lib/complianceStatus'
import { useConfirm } from './lib/ConfirmContext'
import { looksLikeCompanyInviteCode } from './lib/inviteUtils'
import { logError } from './lib/logError'
import { MONO, SANS, statusColors } from './lib/styles'
import { Skeleton } from './lib/Skeleton'
import { Icon, ICON_NAMES } from './lib/icons'
import FeedbackPage from './components/FeedbackPage'
import NotificationCentre from './components/NotificationCentre'
import CommandPalette from './components/CommandPalette'
import PortfolioInsightsWidget from './components/PortfolioInsightsWidget'
import TenantReferenceModal from './components/TenantReferenceModal'
import BankConnectionsModal from './components/BankConnectionsModal'
import BankInboxModal from './components/BankInboxModal'
import TrialExpiredGate, { getOverdueCompanies } from './components/TrialExpiredGate'
import SuspendedAccessBanner from './components/SuspendedAccessBanner'
import BuildingMortgageModal from './components/BuildingMortgageModal'
const ReceiptScanModal = lazy(() => import('./components/ReceiptScanModal'))
import { canUseInvestorFeatures } from './lib/tierGating'
import PropertyModal from './components/modals/PropertyModal'
import CompanyModal from './components/modals/CompanyModal'
import DeleteConfirmModal from './components/modals/DeleteConfirmModal'
import SellPropertyModal from './components/modals/SellPropertyModal'
import DeleteCompanyModal from './components/modals/DeleteCompanyModal'
import PaymentModal from './components/modals/PaymentModal'
import AccessModal from './components/modals/AccessModal'
import CustomizeDashModal from './components/modals/CustomizeDashModal'



const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

// Allow only http(s) destinations into href/location sinks. Relative URLs
// resolve against the app origin and pass; javascript:/data:/etc. are blocked.
function isSafeUrl(url) {
  try {
    const proto = new URL(String(url), window.location.origin).protocol
    return proto === 'http:' || proto === 'https:'
  } catch (e) { return false }
}

function calcMonthlyMortgage(p) {
  // Priority 1: user-entered actual monthly payment (any positive number).
  // Real mortgages have fees, part-and-part splits, product transitions
  // etc that the textbook formula can't model. When the user knows their
  // actual direct debit, store it and trust it.
  if (p.mortgage_monthly_payment && Number(p.mortgage_monthly_payment) > 0) {
    return Number(p.mortgage_monthly_payment)
  }
  if (!p.mortgage_rate || !p.mortgage_amount) return 0
  const amount = Number(p.mortgage_amount), rate = Number(p.mortgage_rate)
  // Priority 2: honour mortgage_type when set. Interest-only is much
  // simpler than the repayment annuity formula.
  if (p.mortgage_type === 'interest_only') {
    return amount * rate / 12
  }
  // Priority 3 (default): repayment annuity. Same as before this rewrite.
  const r = rate / 12, n = (p.mortgage_term || 25) * 12
  return amount * r * Math.pow(1+r, n) / (Math.pow(1+r, n) - 1)
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
// Fail-CLOSED: if we have no permission record for the company, deny the action.
// The map is loaded together with the user's companies; once it's loaded but
// missing a company entry that means the user is not a collaborator on it.
// (The OWNER of a company gets an implicit allow via `permissionsMap.__owner`
// — see loader. For platform admins, callers should bypass canDo entirely.)
function canDo(permissionsMap, companyId, permissionKey) {
  if (!companyId) return true  // no company context = global / personal action
  if (!permissionsMap) return false  // not loaded yet → deny by default
  if (permissionsMap.__owner?.[companyId]) return true  // owner can do anything
  const perms = permissionsMap[companyId]
  if (!perms) return false  // collaborator row missing → no access
  return perms[permissionKey] === true
}

const STATUS_CFG = {
  rented:       {label:'Rented',       bg:'#0D2B1F',fg:'#2ECC8A',dot:'#2ECC8A'},
  short_term_let:{label:'Short-Term Let',bg:'#1E142B',fg:'#9B6FDE',dot:'#9B6FDE'}, // purple — matches STL_COLOR booking segments
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
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:20,background:c.fg+'22',border:`1px solid ${c.fg}44`,color:c.fg,fontSize:11,fontFamily:MONO,fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.dot,flexShrink:0}}/>{c.label}
  </span>
})

const HealthBadge = memo(({property, tenancy=null}) => {
  const h = api.calcPropertyHealthScore(property, property.compliance_items||[], tenancy||property.tenancy||null, property.maintenance_jobs||[], property.rent_payments||[])
  return (
    <span title={`Health: ${h.score}/100${h.issues.length ? ' · ' + h.issues[0].text : ''}`}
      style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:20,
        background:h.color+'22',color:h.color,fontSize:11,fontFamily:MONO,fontWeight:700,cursor:'default'}}>
      {h.grade} {h.score}
    </span>
  )
})

const CompanyPill = memo(({company}) => {
  if (!company) return null
  return <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(company.color||'#C8A84B')+'22',color:company.color||'#C8A84B',border:`1px solid ${(company.color||'#C8A84B')}44`}}>{company.abbr}</span>
})

const StatCard = memo(({icon,label,value,sub,accent,breakdown,onNavigate,navLabel}) => {
  const [open,setOpen] = useState(false)
  const { T } = useTheme()
  // Cards with a breakdown keep click = expand; navigation gets its own
  // explicit link so the two affordances never fight. Cards without a
  // breakdown navigate on click directly.
  const clickable = breakdown || onNavigate
  return (
    <div style={{background:T.card,border:`1px solid ${open?T.gold:T.border}`,borderRadius:12,padding:'20px 22px',transition:'border-color 0.2s',cursor:clickable?'pointer':'default'}}
      onClick={breakdown?()=>setOpen(o=>!o):(onNavigate||undefined)}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        {/* Redesign: a known icon name renders the hairline glyph in a tinted
            accent tile; legacy emoji strings still render as-is. */}
        {ICON_NAMES.includes(icon)
          ? <div style={{width:34,height:34,borderRadius:9,background:(accent||T.gold)+'1A',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:8}}><Icon name={icon} size={18} color={accent||T.gold}/></div>
          : <div style={{fontSize:20,marginBottom:8}}>{icon}</div>}
        <span style={{display:'inline-flex',alignItems:'center',gap:10,marginTop:2}}>
          {onNavigate&&(
            <button onClick={e=>{e.stopPropagation();onNavigate()}}
              aria-label={navLabel||`Open ${label}`}
              style={{background:'none',border:'none',cursor:'pointer',padding:0,fontFamily:MONO,fontSize:9,color:T.muted,letterSpacing:'0.1em',display:'inline-flex',alignItems:'center',gap:3}}
              onMouseEnter={e=>e.currentTarget.style.color=T.gold} onMouseLeave={e=>e.currentTarget.style.color=T.muted}>
              {(navLabel||'VIEW').toUpperCase()}<Icon name="arrow-right" size={11}/>
            </button>
          )}
          {breakdown&&<span style={{fontFamily:MONO,fontSize:9,color:open?T.gold:T.muted,letterSpacing:'0.1em',display:'inline-flex',alignItems:'center',gap:3}}>{open?'CLOSE':'DETAIL'}<Icon name={open?'chevron-down':'chevron-right'} size={11}/></span>}
        </span>
      </div>
      <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:accent||T.gold,letterSpacing:'-0.02em',marginBottom:2}}>{value}</div>
      {sub&&<div style={{fontFamily:MONO,fontSize:11,color:T.faint}}>{sub}</div>}
      {open&&breakdown&&(
        <div style={{marginTop:14,borderTop:`1px solid ${T.border}`,paddingTop:12,display:'grid',gap:4}}>
          {breakdown.map((item,i)=>(
            <div key={i}>
              {item.separator&&<div style={{borderTop:`1px solid ${T.border}`,margin:'4px 0'}}/>}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingLeft:item.indent?16:0}}>
                <span style={{fontFamily:MONO,fontSize:item.indent?9:10,color:item.indent?T.faint:T.muted,flex:1,display:'flex',alignItems:'center',gap:4}}>
                  {item.indent&&<span style={{color:T.border}}>└</span>}
                  {item.label}
                </span>
                <span style={{fontFamily:MONO,fontSize:item.indent?10:11,fontWeight:item.indent?400:700,color:item.color||(item.indent?T.muted:T.text)}}>{item.value}</span>
              </div>
              {item.note&&<div style={{fontFamily:MONO,fontSize:9,color:T.faint,marginTop:2,lineHeight:1.5,paddingLeft:2}}>{item.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// Portfolio health ring (redesign Dashboard hero). `score` is 0-100; the band
// label + colour follow the same thresholds the per-property HealthBadge uses.
const HealthRing = memo(({ score }) => {
  const { T } = useTheme()
  const s = Math.max(0, Math.min(100, Math.round(score)))
  const band = s >= 80 ? { label:'Good standing', color:T.green }
             : s >= 60 ? { label:'Needs attention', color:T.amber }
             : { label:'Action needed', color:T.red }
  const r = 30, c = 2 * Math.PI * r, dash = (s / 100) * c
  return (
    <div style={{display:'flex',alignItems:'center',gap:14}}>
      <div style={{position:'relative',width:74,height:74,flexShrink:0}}>
        <svg width="74" height="74" viewBox="0 0 74 74" style={{transform:'rotate(-90deg)'}}>
          <circle cx="37" cy="37" r={r} fill="none" stroke={T.border} strokeWidth="6"/>
          <circle cx="37" cy="37" r={r} fill="none" stroke={band.color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={`${dash} ${c}`}/>
        </svg>
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'}}>
          <span style={{fontFamily:MONO,fontSize:20,fontWeight:500,color:T.text,lineHeight:1}}>{s}</span>
        </div>
      </div>
      <div>
        <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>Portfolio health</div>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,fontWeight:600,color:band.color}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:band.color}}/>{band.label}
        </div>
      </div>
    </div>
  )
})

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getStatusColor(status) {
  if (status==='paid')    return '#2ECC8A'
  if (status==='overdue' || status==='missed')  return '#E05555'  // 'missed' kept for backward-compat (pre-2026-05-25 rows)
  if (status==='late' || status==='partial') return '#E0943A'  // partial = attention (amber)
  if (status==='pending') return '#9B6FDE'  // legacy pending rows (pre-2026-07 Lodgify sync wrote these)
  if (status==='refurb')  return '#4B8FE0'
  return '#888EA8' // void - visible in both themes
}

// AA text/tint pair for a rent status — the month grid renders the label in
// the status TEXT colour on the status TINT (the old raw-hue fill with white
// text sat at ~1.8:1 on paid-green). STL/pending keep their purple identity
// via a matching hand-tuned pair (purple isn't in the shared STATUS set).
const STL_PAIR = { light: { text:'#6E44B8', bg:'#F0EAFB' }, dark: { text:'#B89BEF', bg:'#241A38' } }
function rentStatusPair(status, darkMode) {
  if (status === 'pending') return darkMode ? STL_PAIR.dark : STL_PAIR.light
  const key = { paid:'ok', overdue:'bad', missed:'bad', late:'warn', partial:'warn', refurb:'info' }[status] || 'void'
  return statusColors(key, darkMode)
}

// Short-term-let revenue keeps its own colour so STL and long-term income
// read differently at a glance even though both are status 'paid'. A paid
// segment is "STL" when a Lodgify booking links to it (stl_bookings join
// on fetchProperties).
const STL_COLOR = '#9B6FDE'
function stlPaymentIds(property) {
  return new Set((property?.stl_bookings || []).map(b => b.rent_payment_id).filter(Boolean))
}

// A month can now hold several dated rent segments (tenant changeover, partial
// payment + balance). For the year-strip dot and per-month stat counts we
// collapse a month's segments to one "dominant" status. Problems surface first
// (overdue/late), otherwise paid > refurb > void > future.
const MONTH_STATUS_PRIORITY = ['overdue','missed','late','partial','paid','pending','refurb','void','future']
function monthDominantStatus(segs) {
  for (const s of MONTH_STATUS_PRIORITY) {
    if (segs.some(p => p.status === s)) return s
  }
  return segs[0]?.status || 'void'
}

// Default year for rent year-filters: the current year when it has data,
// otherwise the most recent year that does. Never blindly "latest year with
// rows": future months are pre-generated ~6 months ahead
// (ensureFutureRentMonths), so from July onwards the latest year is NEXT
// year, which made the Rent Tracker open on it.
function defaultRentYear(payments) {
  const years = [...new Set(payments.map(p => p.year))].sort()
  if (years.length === 0) return null
  const currentYear = new Date().getFullYear()
  return years.includes(currentYear) ? currentYear : years[years.length - 1]
}

// Month-level stats for a set of rent segments (optionally scoped to a year).
// Counts collapse a month's segments to its dominant status so a month split
// across several segments (tenant changeover, partial payment + balance)
// counts once. Income sums the actual paid amounts; the rent_pcm fallback for
// legacy amount-less paid rows applies once per month, never per segment.
// Shared by the Rent Tracker overview, the property Rent tab and the
// Overview "Rent at a glance" card so all three agree.
function getMonthlyRentStats(payments, year, rentPcm) {
  const scoped = year ? payments.filter(p => p.year === year) : payments
  const byMonth = {}
  for (const p of scoped) {
    const key = `${p.year}-${p.month}`
    ;(byMonth[key] ||= []).push(p)
  }
  // Time-aware counts: future months are pre-created as voids
  // (ensureFutureRentMonths) and STL bookings create future PAID months, so
  // anything feeding a "how are we collecting" rate must only look at months
  // up to the current one. voidM is past-months-only for the same reason —
  // an empty August that hasn't happened yet isn't a void.
  const _now = new Date()
  const _curKey = _now.getFullYear() * 12 + _now.getMonth() + 1
  let paid = 0, missed = 0, late = 0, refurb = 0, voidM = 0, income = 0, paidToDate = 0
  for (const key in byMonth) {
    const segs = byMonth[key]
    const dom = monthDominantStatus(segs)
    const [ky, km] = key.split('-').map(Number)
    const isFuture = (ky * 12 + km) > _curKey
    if (dom === 'paid') { paid++; if (!isFuture) paidToDate++ }
    else if (dom === 'overdue' || dom === 'missed') missed++
    else if (dom === 'late' || dom === 'partial') late++   // partial = attention bucket
    else if (dom === 'refurb') refurb++
    else if (dom === 'void') { if (!isFuture) voidM++ }
    // Income credits actual amounts from paid AND partial segments (matching the
    // Reports module); the rent_pcm fallback only covers a legacy amount-less
    // PAID row, never a partial (a partial without an amount contributes £0).
    const fullPaidSegs = segs.filter(p => p.status === 'paid')
    const incomeSegs = segs.filter(p => p.status === 'paid' || p.status === 'partial')
    const monthIncome = incomeSegs.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    income += monthIncome > 0 ? monthIncome : (fullPaidSegs.length ? (rentPcm || 0) : 0)
  }
  return { paid, missed, late, refurb, voidM, income, paidToDate }
}

// ── DAY POPOVER ──────────────────────────────────────────────────────────────
function DayPopover({ payment, allPayments, stlIds, onClose, onDayTracker }) {
  const { T, darkMode } = useTheme()
  const mono = MONO
  const year = payment.year, month = payment.month
  const days = new Date(year, month, 0).getDate()
  const firstDow = (new Date(year, month-1, 1).getDay() + 6) % 7

  // Paid STL segments render as the pseudo-status 'stl' (purple) so
  // short-term-let days read differently from long-term rent.
  const segStatus = p => (p.status === 'paid' && stlIds?.has(p.id)) ? 'stl' : p.status

  function getDayStatus(day) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    if (dateStr > todayStr) return 'future'
    // Dated segments win over legacy whole-month rows (two passes).
    for (const p of allPayments) {
      if (p.period_start && p.period_end && dateStr >= p.period_start && dateStr <= p.period_end) return segStatus(p)
    }
    for (const p of allPayments) {
      if (!p.period_start && p.year === year && p.month === month) return segStatus(p)
    }
    return 'void'
  }

  // Day cells share the month grid's AA tint/text pairs (this map used to
  // restate the legacy raw hues with white labels).
  const pairFor = (status) => status === 'stl'
    ? (darkMode ? STL_PAIR.dark : STL_PAIR.light)
    : rentStatusPair(status, darkMode)
  const monthName = new Date(year, month-1).toLocaleString('en-GB', {month:'long', year:'numeric'})
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  const statuses = Array.from({length:days},(_,i)=>getDayStatus(i+1))
  const paidDays = statuses.filter(s=>s==='paid'||s==='stl').length
  const voidDays = statuses.filter(s=>s==='void').length
  const missedDays = statuses.filter(s=>s==='overdue'||s==='missed').length

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={onClose}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:20,width:300,boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:T.text}}>{monthName}</div>
          <button onClick={onClose} aria-label="Close day view" style={{background:'none',border:'none',fontSize:18,color:T.muted,cursor:'pointer',lineHeight:1,padding:'6px 8px',margin:'-6px -8px'}}>×</button>
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
            const isFuture = status==='future'
            const pair = isFuture ? null : pairFor(status)
            return (
              <div key={d} title={`${d}: ${status}`} style={{
                aspectRatio:'1',borderRadius:3,
                background:isFuture?'transparent':pair.bg,
                border:isFuture?`1px dashed ${T.border}`:`1px solid ${pair.text}44`,
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>
                <span style={{fontFamily:mono,fontSize:8,color:isFuture?T.muted:pair.text,fontWeight:700}}>{d}</span>
              </div>
            )
          })}
        </div>
        <div style={{display:'flex',gap:14,marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${T.border}`,flexWrap:'wrap'}}>
          {[[paidDays,rentStatusPair('paid',darkMode).text,'paid'],[voidDays,rentStatusPair('void',darkMode).text,'void'],[missedDays,rentStatusPair('missed',darkMode).text,'missed']].map(([v,c,l])=>(
            <div key={l} style={{fontFamily:mono,fontSize:10}}>
              <span style={{color:c,fontWeight:700}}>{v}</span>
              <span style={{color:T.muted}}> {l}</span>
            </div>
          ))}
          {payment.period_start&&<div style={{fontFamily:mono,fontSize:9,color:T.muted,marginLeft:'auto'}}>{payment.period_start} → {payment.period_end}</div>}
        </div>
        <button onClick={()=>{onClose();if(onDayTracker)onDayTracker()}}
          style={{width:'100%',fontFamily:mono,fontSize:11,fontWeight:700,padding:'9px 0',borderRadius:8,
            border:'none',background:T.gold,color:'#1C2830',cursor:'pointer'}}>
          View full day tracker →
        </button>
      </div>
    </div>
  )
}

const RentDots = ({payments, onUpdate, filterYear, onDayTracker, stlIds}) => {
  const { darkMode } = useTheme()
  const [popover, setPopover] = useState(null)
  if (!payments?.length) return null
  const scoped = filterYear ? payments.filter(m=>m.year===filterYear) : payments
  // Collapse multiple segments per month into one representative dot.
  const byMonth = new Map()
  for (const p of scoped) {
    const key = `${p.year}-${p.month}`
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(p)
  }
  const filtered = [...byMonth.values()]
    .map(segs => ({ ...segs[0], status: monthDominantStatus(segs), isStl: !!stlIds && segs.some(s => stlIds.has(s.id)) }))
    .sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month)
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  return <>
    <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:8}}>
      {filtered.map(m=>{
        const isFuture = m.year > currentYear || (m.year === currentYear && m.month > currentMonth)
        const isCurrent = m.year === currentYear && m.month === currentMonth
        const isStlPaid = m.isStl && m.status === 'paid'
        // Redesign: full 3-letter month name in the cell, STATUS TINT as the
        // fill with the AA text colour for the label (the previous raw-hue
        // fill + white label read at ~1.8:1 on paid-green), gold outline for
        // the current month, hatched fill for future months.
        const pair = isStlPaid ? (darkMode ? STL_PAIR.dark : STL_PAIR.light) : rentStatusPair(m.status, darkMode)
        const name = MONTH_NAMES[(m.month||1)-1]
        const statusLabel = isFuture ? 'future' : (isStlPaid ? 'short-term let, paid' : (m.status || 'void'))
        const boxStyle = isFuture
          ? { background:'repeating-linear-gradient(135deg, rgba(128,128,128,0.10) 0 5px, transparent 5px 10px)', border:'1px dashed rgba(128,128,128,0.40)', cursor:'default' }
          : isCurrent
            ? { background:pair.bg, border:`2px solid #B8902F`, cursor:'pointer' }
            : { background:pair.bg, border:`1px solid ${pair.text}55`, cursor:'pointer' }
        const letterColor = isFuture ? 'rgba(128,128,128,0.6)' : pair.text
        return (
          // A real <button>: these cells are the primary interaction on the
          // Rent Tracker and were mouse-only divs whose title tooltip never
          // appeared on touch.
          <button key={m.id} type="button"
            aria-label={`${m.month_label || `${name} ${m.year}`}: ${statusLabel}${isFuture ? '' : ' — open day view'}`}
            title={isFuture ? `${m.month_label}: future` : `${m.month_label}: ${isStlPaid ? 'STL booked (paid)' : m.status} — click for day view`}
            disabled={isFuture}
            onClick={!isFuture ? (e)=>{e.stopPropagation();setPopover(m)} : undefined}
            style={{width:44,height:30,borderRadius:7,transition:'transform 0.15s, box-shadow 0.15s',padding:0,
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,...boxStyle}}
            onMouseEnter={e=>{if(!isFuture){e.currentTarget.style.transform='scale(1.12)';e.currentTarget.style.boxShadow=`0 2px 8px ${pair.text}55`}}}
            onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}
          >
            <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:letterColor,lineHeight:1,userSelect:'none',letterSpacing:'0.02em'}}>{name}</span>
          </button>
        )
      })}
    </div>
    {popover&&<DayPopover payment={popover} allPayments={payments} stlIds={stlIds} onClose={()=>setPopover(null)} onDayTracker={onDayTracker}/>}
  </>
}
const Spinner = () => {
  const { T } = useTheme()
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200}}>
    <div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
  </div>
}

// Full-viewport spinner used by Suspense fallbacks while a lazy-loaded
// page chunk is downloaded. Takes T directly because <Suspense> renders
// the fallback before any nested theme hooks resolve.
function PageLoadingSpinner({ T }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 32, height: 32, border: `3px solid ${T.border}`, borderTopColor: T.gold, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )
}

// Skeleton primitives live in lib/Skeleton.jsx (shared with page-level
// loading states across components).

// Dashboard loading state — greeting + health ring, 4 KPI tiles, two widget
// columns — mirrors the real layout so the page doesn't jump on load.
function DashboardSkeleton() {
  const { T } = useTheme()
  const tile = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }
  return (
    <div aria-busy="true" aria-label="Loading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <Skeleton w="240px" h={30} style={{ marginBottom: 10 }} />
          <Skeleton w="320px" h={12} />
        </div>
        <Skeleton w={74} h={74} r="50%" />
      </div>
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={tile}>
            <Skeleton w={34} h={34} r={9} style={{ marginBottom: 12 }} />
            <Skeleton w="60%" h={10} style={{ marginBottom: 10 }} />
            <Skeleton w="80%" h={20} />
          </div>
        ))}
      </div>
      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[0,1].map(col => (
          <div key={col} style={tile}>
            <Skeleton w="40%" h={12} style={{ marginBottom: 16 }} />
            {[0,1,2,3].map(r => (
              <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Skeleton w={32} h={32} r={8} />
                <div style={{ flex: 1 }}>
                  <Skeleton w="70%" h={11} style={{ marginBottom: 6 }} />
                  <Skeleton w="45%" h={9} />
                </div>
                <Skeleton w={54} h={12} />
              </div>
            ))}
          </div>
        ))}
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
  const mono = MONO
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
  // Set when the initial portfolio load fails — drives a dedicated error
  // screen with a Retry button instead of the misleading new-account
  // welcome zero-state. loadNonce re-runs loadData on Retry.
  const [loadError,   setLoadError]    = useState(null)
  const [loadNonce,   setLoadNonce]    = useState(0)
  // property_id -> tenancy_details row, for HealthBadge's tenancy deduction.
  // Loaded best-effort after boot; empty map degrades to "no deduction".
  const [tenanciesByProp, setTenanciesByProp] = useState({})
  const [view,        setView]         = useState('dashboard')
  const [selectedId,  setSelectedId]   = useState(null)
  const [detailTab,   setDetailTab]    = useState('overview')
  // Selected report id when drilled into a specific report. Lifted up here
  // so it can participate in browser history (back/forward) instead of
  // being purely local state inside ReportsPage. null = catalogue view.
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [portfolioTab, setPortfolioTab] = useState('properties')
  // Portfolio properties layout: dense list (default) or gradient card grid.
  const [propLayout, setPropLayout] = useState(() => { try { return localStorage.getItem('ef_prop_layout') || 'list' } catch(e) { return 'list' } })
  useEffect(() => { try { localStorage.setItem('ef_prop_layout', propLayout) } catch(e) {} }, [propLayout])
  const [coFilter,    setCoFilter]     = useState('all')
  const [dashCoFilter, setDashCoFilter] = useState([]) // [] = all companies
  const [statusFilter,setStatusFilter] = useState('all')
  const [searchQ,     setSearchQ]      = useState('')
  const [sortBy,      setSortBy]       = useState('company-name')
  const [showArchived,setShowArchived] = useState(false)
  const [activeCoTab, setActiveCoTab]  = useState(null)
  const [showAddProp, setShowAddProp]  = useState(false)
  const [showBuildingMortgage, setShowBuildingMortgage] = useState(false)
  const [showReceiptScan, setShowReceiptScan] = useState(false)
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
  // When a property is being created by converting a completed deal, this
  // holds that deal's id. On a successful save we soft-delete the deal so it
  // drops off the Deals page (it now lives in the portfolio as a property).
  // Bumping convertRefreshKey tells DealsPage to reload + return to its list.
  const [convertSourceDealId, setConvertSourceDealId] = useState(null)
  const [convertRefreshKey,   setConvertRefreshKey]   = useState(0)
  const [toast,       setToast]        = useState(null)
  const [editingPayment, setEditingPayment] = useState(null)  // {payment, propId}
  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(null)
  const [showSellModal,      setShowSellModal]      = useState(null) // property id
  const [propertyActionBusy, setPropertyActionBusy] = useState(false)
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [isTenant, setIsTenant] = useState(false)
  // /privacy and /terms render their own static pages, even when the
  // user isn't logged in. Detect from the URL on mount so HMRC reviewers
  // and Google can link to stable URLs.
  const [showPrivacy, setShowPrivacy] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/privacy')
  )
  const [showTerms, setShowTerms] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/terms')
  )
  const [showSecurity, setShowSecurity] = useState(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/security')
  )
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  // Subscription rows for the user's accessible companies. Loaded after
  // companies are known. Used by the trial-expired hard gate to decide
  // whether to lock the app. Empty array = "no subs yet" → only
  // trial_ends_at + is_free_tier on the company row matter.
  const [companySubs, setCompanySubs] = useState([])
  // Collaborator companies that were filtered out due to suspended billing
  // (owner stopped paying or trial expired). Surfaced via the
  // SuspendedAccessBanner when the user has no other accessible companies.
  const [suspendedAccess, setSuspendedAccess] = useState([])
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
  // Keep in sync with SECTION_DEFS inside the dashboard render block below.
  // We need both because the modal closure needs metadata in scope, but
  // the render closures need access to dashProps/companies/etc. If you
  // add a new section, add it in BOTH places (the render fn list at
  // ~line 1750, plus the three constants here).
  const SECTION_META = {
    kpi_grid:           { icon:'pie-chart',      label:'KPI cards',                   description:'Portfolio value, monthly rent, arrears, and other key metrics' },
    by_company:         { icon:'grid',           label:'By Company',                  description:'A card per company with its property/rent stats' },
    smart_alerts:       { icon:'alert-triangle', label:'Items needing attention',     description:'Smart alerts: overdue rent, expiring compliance, vacant properties' },
    tenant_inbox:       { icon:'inbox',          label:'Tenant Inbox',                description:'Latest messages and repair requests from tenants' },
    portfolio_insights: { icon:'sparkle',        label:'AI Portfolio Insights',       description:'Observations and opportunities generated by Claude (refreshable every 30 min)' },
    autopilot_widget:   { icon:'robot',          label:'Portfolio Autopilot',         description:'AI-drafted prioritised actions across your portfolio' },
    property_map:       { icon:'map',            label:'Property Map',                description:'Compact map showing all your properties' },
    portfolio_modeller: { icon:'trending-up',    label:'Portfolio What-If Modeller',  description:'Model rent changes, refinancing, and other scenarios' },
    company_documents:  { icon:'folder',         label:'Company Documents',           description:'Documents stored at company level (only shows when a company is selected)' },
  }
  const SECTION_DEFAULT_ORDER   = ['smart_alerts','autopilot_widget','tenant_inbox','portfolio_insights','kpi_grid','by_company','property_map','portfolio_modeller','company_documents']
  const SECTION_DEFAULT_ENABLED = { kpi_grid:true, by_company:true, smart_alerts:true, autopilot_widget:true, tenant_inbox:true, portfolio_insights:true, property_map:true, portfolio_modeller:false, company_documents:true }

  const WIDGET_META = {
    portfolio_value:    { icon:'home', label:'Portfolio Value',         description:'Total property value and unrealised gains' },
    monthly_rent:       { icon:'pound', label:'Monthly Rental Income',   description:'Rent per month, occupancy, annualised' },
    arrears:            { icon:'alert-triangle', label:'Total Arrears',           description:'Overdue rent and vacant properties' },
    refurb:             { icon:'hammer', label:'In Refurbishment',        description:'Properties under renovation' },
    mortgages:          { icon:'landmark', label:'Mortgages Outstanding',   description:'Debt, equity and repayment costs' },
    cashflow_forecast:  { icon:'wallet', label:'Cash Committed', description:'Total cash out across deals + properties, with 90-day urgency split' },
    insurance_renewals: { icon:'shield-check', label:'Insurance Renewals',      description:'Policies expiring soon with annual premium totals' },
    property_count:     { icon:'home', label:'Property Count',          description:'Total properties with rented/vacant split' },
    occupancy_rate:     { icon:'pie-chart', label:'Occupancy Rate',          description:'Occupancy % and vacancy cost' },
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
  const [userNavPrefs, setUserNavPrefs] = useState(DEFAULT_NAV_KEYS)
  // Tenant-portal branding for the current subdomain (<sub>.ownproperly.com).
  // Looked up once on mount via a public RPC so a logged-OUT visitor sees the
  // company's branded login instead of the generic marketing site. null = no
  // subdomain / unknown company → fall back to marketing.
  const [portalBranding, setPortalBranding] = useState(null)
  useEffect(() => {
    const sub = getSubdomain()
    if (!sub) return
    let cancelled = false
    api.fetchCompanyBySubdomain(sub)
      .then(b => { if (!cancelled && b && b.tenant_portal_enabled !== false) setPortalBranding(b) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  // 'individual' | 'limited_company' | 'mixed' | null. Drives feature visibility —
  // limited_company users don't see MTD ITSA (they file Corp Tax, not Self Assessment).
  const [accountType, setAccountType] = useState(null)
  const [yieldBasis, setYieldBasis]      = useState('cost') // 'cost' = purchase+refurb, 'value' = current value
  // Invite emails link to /?invite=<token>. A logged-out visitor must land
  // straight in the signup modal (LoginPage reads the param itself and
  // redeems after auth), without this they just see the marketing page and
  // the invite goes nowhere.
  const [showLoginModal, setShowLoginModal] = useState(() => new URLSearchParams(window.location.search).has('invite'))
  const [loginMode, setLoginMode] = useState(() => new URLSearchParams(window.location.search).has('invite') ? 'signup' : 'login')
  const [trialWarning, setTrialWarning] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [announcements, setAnnouncements] = useState([])
  const [dismissedAnns, setDismissedAnns] = useState(() => { try { return JSON.parse(localStorage.getItem('dismissed_anns')||'[]') } catch(e) { return [] } })
  const { T, darkMode, setDarkMode, loadUserTheme } = useTheme()

  const CSS = `
  html,body,#root{width:100%;max-width:100%;overflow-x:hidden;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:${SANS};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
  h1,h2,h3,h4{font-family:${SANS};letter-spacing:-0.02em;}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
  input,select,textarea{font-family:${MONO};background:${T.surface};border:1px solid ${T.border};color:${T.text};border-radius:8px;padding:8px 12px;width:100%;font-size:13px;outline:none;transition:border-color 0.2s;}
  input:focus,select:focus,textarea:focus{border-color:${T.gold};}
  :focus-visible{outline:2px solid ${T.gold};outline-offset:2px;}
  select option{background:${T.surface};}
  label{font-family:${MONO};font-size:10px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:${T.muted};display:block;margin-bottom:5px;}
  .btn{font-family:${SANS};font-weight:600;border:none;cursor:pointer;border-radius:10px;padding:9px 18px;font-size:13px;transition:all 0.18s;letter-spacing:0;}
  .btn-gold{background:${T.gold};color:#1C2830;}.btn-gold:hover{background:${T.gold}dd;}
  .btn-ghost{background:transparent;color:${T.text};border:1px solid ${T.border};}.btn-ghost:hover{border-color:${T.gold};color:${T.gold};}
  .btn-danger{background:${T.red};color:#fff;border:1px solid ${T.red};}.btn-danger:hover{filter:brightness(0.92);}
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
    /* Defense-in-depth: stop any single child from forcing the page wider
       than the viewport. Long text wraps; oversized images/iframes scale
       down. Without this, a single forgotten flex child can blow the
       horizontal scroll on iPhone — see commit fixing the dashboard
       "Portfolio Overview" header. */
    main img, main iframe, main video, main canvas, main pre { max-width: 100% !important; }
    main p, main h1, main h2, main h3, main label { overflow-wrap: anywhere; word-break: break-word; }
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
  .skeleton{position:relative;overflow:hidden;background:${T.card};border-radius:8px;}
  .skeleton::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,${T.border}99,transparent);animation:shimmer 1.3s infinite;}
  @keyframes shimmer{100%{transform:translateX(100%)}}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px;backdrop-filter:blur(4px);}
  .modal{background:${T.surface};border:1px solid ${T.border};border-radius:18px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;}
  .tab{font-family:${SANS};font-weight:500;font-size:13px;background:none;border:none;color:${T.muted};cursor:pointer;padding:8px 14px;border-radius:8px;transition:all 0.18s;letter-spacing:0;}
  .tab.active{background:${T.border};color:${T.gold};}.tab:hover{color:${T.text};}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media(max-width:700px){.g2{grid-template-columns:1fr}}
`


  const isMobile = useIsMobile(769)
  const [showDrawer, setShowDrawer] = useState(false)
  // Desktop left-rail collapse (redesign app shell). Snap between 212/68px —
  // do NOT CSS-transition width (caused a stuck-transition bug per the handoff);
  // only the label opacity fades. Mobile keeps the bottom tab bar (rail hidden).
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem('ef_rail_collapsed') === 'true' } catch(e) { return false }
  })
  useEffect(() => { try { localStorage.setItem('ef_rail_collapsed', String(railCollapsed)) } catch(e) {} }, [railCollapsed])
  const railWidth = isMobile ? 0 : (railCollapsed ? 68 : 212)
  const [userAccess,  setUserAccess]  = useState([])  // company_ids this user can see

  useEffect(()=>{
    const handler = () => setShowTour(true)
    window.addEventListener('ownproperly:restart-tour', handler)
    return () => window.removeEventListener('ownproperly:restart-tour', handler)
  }, [])

  // Last place we synced to the URL — used to decide pushState vs
  // replaceState (see the sync effect below).
  const lastSyncedNav = useRef(null)

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
      // Hash segments come back percent-encoded from window.location.hash
      // (e.g. a legacy '#/detail/<id>/epc%20plan' bookmark), so decode each
      // part before matching. Legacy space-keyed tabs map onto their slugs.
      const parts = h.split('/').filter(Boolean).map(p => {
        try { return decodeURIComponent(p) } catch { return p }
      })
      const LEGACY_TABS = { 'epc plan': 'epc-plan', 'right to rent': 'right-to-rent', 'rent history': 'rent-history' }
      if (parts[0] === 'detail' && parts[1]) {
        const rawTab = parts[2] || 'overview'
        return { view: 'detail', selectedId: parts[1], detailTab: LEGACY_TABS[rawTab] || rawTab }
      }
      if (parts[0] === 'settings') {
        return { view: 'settings', settingsTab: parts[1] || null }
      }
      if (parts[0] === 'admin') {
        return { view: 'admin', adminTab: parts[1] || null }
      }
      if (parts[0] === 'import') return { view: 'import' }
      if (parts[0] === 'properties' && parts[1] === 'bulk') return { view: 'bulk-add' }
      // All portfolio sub-tabs are addressable: #/properties/<tab>
      const PORTFOLIO_TABS = ['properties','companies','compliance','map','contractors']
      if (parts[0] === 'properties') {
        return { view: 'properties', portfolioTab: PORTFOLIO_TABS.includes(parts[1]) ? parts[1] : 'properties' }
      }
      // Legacy top-level views, folded into Portfolio sub-tabs (they used
      // to exist twice at two different levels).
      if (parts[0] === 'companies')   return { view: 'properties', portfolioTab: 'companies' }
      if (parts[0] === 'contractors') return { view: 'properties', portfolioTab: 'contractors' }
      if (parts[0] === 'rent' && parts[1] === 'day') {
        return { view: 'daytracker' }
      }
      // /reports                — catalogue
      // /reports/<reportId>     — drilled into a specific report
      if (parts[0] === 'reports' && parts[1]) {
        return { view: 'reports', selectedReportId: parts[1] }
      }
      // Unknown hashes (e.g. a stray #pricing from a marketing/blog link
      // opened while signed in) must not become a view — an unmatched view
      // key renders an empty main area. Fall back to the dashboard.
      const KNOWN_VIEWS = ['dashboard','properties','rent','deals','insurance','reports','mtd','autopilot','renters-rights','settings','daytracker','feedback','detail','import']
      return { view: KNOWN_VIEWS.includes(parts[0]) ? parts[0] : 'dashboard' }
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
      // Always reflect the portfolio sub-tab when on the portfolio view —
      // popping back from #/properties/companies to #/properties must reset
      // the tab, not leave it stale.
      if (parsed.view === 'properties') setPortfolioTab(parsed.portfolioTab || 'properties')
      if (parsed.settingsTab) window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab: parsed.settingsTab } }))
    }
    window.addEventListener('popstate', handlePopState)
    // Programmatic `window.location.hash = …` navigations (notification
    // links, insight actions, the error boundary's "go home") fire
    // `hashchange`, NOT `popstate` — without this listener they change the
    // URL but never the screen, and the sync effect then rewrites the URL
    // back to the stale view.
    window.addEventListener('hashchange', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handlePopState)
    }
  }, [])

  // Sync to URL whenever navigation state changes
  useEffect(() => {
    if (!user) return
    // The admin overlay owns #/admin/<tab> (AdminDashboard pushes it) —
    // don't fight it by rewriting the hash back to the underlying view.
    if (showAdmin) return
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
    } else if (view === 'properties' && portfolioTab && portfolioTab !== 'properties') {
      target = `#/properties/${portfolioTab}`
    } else if (view === 'daytracker') {
      target = '#/rent/day'
    } else if (view === 'bulk-add') {
      target = '#/properties/bulk'
    } else if (view === 'reports' && selectedReportId) {
      // When drilled into a specific report, encode its id so browser
      // back returns to the catalogue (the bare /reports URL).
      target = `#/reports/${selectedReportId}`
    }
    // SettingsPage owns its sub-tab URL segment (#/settings/<tab>): it pushes
    // the hash itself on tab change, and — being lazy-loaded — reads its
    // INITIAL tab from the hash at mount. If the hash already carries a
    // settings sub-tab, leave it alone. Pushing the bare '#/settings' here
    // would race the Suspense fallback on a cold chunk load and clobber the
    // sub-tab (e.g. the upgrade CTA's '#/settings/billing') before
    // SettingsPage mounts, landing the user on the Account tab instead.
    if (view === 'settings' && /^#\/settings(\/|$)/.test(window.location.hash)) return
    // DealsPage owns its sub-view / deal-detail URL segments the same way
    // (#/deals/pipeline, #/deals/deal/<id>).
    if (view === 'deals' && /^#\/deals(\/|$)/.test(window.location.hash)) return
    if (window.location.hash !== target) {
      // Push a history entry only when the *place* changes (view, property,
      // report). Intra-page tab flips (detailTab, portfolioTab) REPLACE the
      // current entry — otherwise browsing a property's 9 tabs means
      // pressing Back 9 times to leave it.
      const prev = lastSyncedNav.current
      const placeChanged = !prev || prev.view !== view || prev.selectedId !== selectedId || prev.selectedReportId !== selectedReportId
      const historyState = { view, selectedId, detailTab, portfolioTab, selectedReportId }
      if (placeChanged) window.history.pushState(historyState, '', target)
      else window.history.replaceState(historyState, '', target)
    }
    lastSyncedNav.current = { view, selectedId, selectedReportId }
  // user.id only — see the note on the loadData useEffect below for why.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedId, detailTab, portfolioTab, selectedReportId, user?.id, showAdmin])

  // A deep link can name a detail tab this property/account doesn't have
  // (feature toggled off, non-HMO 'rooms', no 'epc-plan' flag). The strip
  // wouldn't show the tab, so the content pane rendered empty — clamp back
  // to Overview instead.
  useEffect(() => {
    if (view !== 'detail' || !selectedId) return
    const sel = properties.find(p => p.id === selectedId)
    if (!sel) return
    const cs = companySettings[sel.company_id] || {}
    const eligibility = {
      compliance: cs.feature_compliance, maintenance: cs.feature_maintenance,
      documents: cs.feature_documents, expenses: cs.feature_expenses,
      tenancy: cs.feature_tenancy, 'right-to-rent': cs.feature_tenancy,
      deposit: cs.feature_tenancy, notices: cs.feature_tenancy, 'rent-history': cs.feature_tenancy,
      rooms: sel.is_hmo || activeFlags.has('hmo_rooms'),
      'epc-plan': activeFlags.has('epc_planner'),
    }
    if (detailTab in eligibility && !eligibility[detailTab]) setDetailTab('overview')
  }, [view, selectedId, detailTab, properties, companySettings, activeFlags])

  // Per-view document titles so history entries, bookmarks and the browser
  // tab strip are tellable apart (index.html's marketing title otherwise
  // labels every page identically). Signed-in sessions only: hooks run
  // before the auth early-returns, so without the guard the logged-out
  // marketing page was titled "Dashboard · Properly" instead of the SEO
  // title. Restored on sign-out via the user-flip + cleanup.
  const titleName = view === 'detail' ? (properties.find(p => p.id === selectedId)?.name || null) : null
  useEffect(() => {
    const MARKETING_TITLE = 'Properly — Property Portfolio Management Software for UK Landlords'
    if (!user) { document.title = MARKETING_TITLE; return }
    const label = titleName || VIEW_LABELS[view] || null
    document.title = label ? `${label} · Properly` : MARKETING_TITLE
    return () => { document.title = MARKETING_TITLE }
  }, [view, titleName, user])

  useEffect(()=>{
    if (!user) return
    async function loadData() {
      setLoading(true)
      setLoadError(null)
      try {
        // Redeem any invite BEFORE fetching access rows, so the granted
        // companies appear in this very load (no reload needed). Two sources:
        //  - ?invite=<token> in the URL, when an already-logged-in user clicked
        //    an invite email link (logged-out users get the signup modal,
        //    which redeems via LoginPage instead).
        //  - pending_invite_token stashed at signup (email-confirmation flow).
        // Clear both regardless of outcome so we don't retry a bad token forever.
        try {
          const inviteParam = new URLSearchParams(window.location.search).get('invite')
          const pending = localStorage.getItem('pending_invite_token') || inviteParam
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
            if (inviteParam) window.history.replaceState({}, '', window.location.pathname)
          }
        } catch(e) { /* non-fatal */ }
        // One user_profiles read serves the developer flag AND nav/yield/
        // account prefs (previously three separate selects of the same row).
        const [cos, props, accessById, accessByEmail, prof] = await Promise.all([
          api.fetchCompanies(),
          api.fetchProperties(),
          api.fetchUserAccess(user.id),
          api.fetchUserAccessByEmail(user.email),
          supabase.from('user_profiles')
            .select('is_developer, platform_admin, nav_items, yield_basis, account_type')
            .eq('user_id', user.id).single()
            .then(r => r.data).catch(() => null),
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

        // Developer status comes from the profile row fetched above —
        // developers see everything (site owner / devs only). Accept either
        // is_developer (new) or platform_admin (legacy) for backwards compat.
        const isPlatformAdminFlag = prof?.is_developer === true || prof?.platform_admin === true
        setIsPlatformAdmin(isPlatformAdminFlag)
        // Nav / yield / account prefs from the same row.
        if (prof?.nav_items && prof.nav_items.length > 0) setUserNavPrefs(prof.nav_items)
        else setUserNavPrefs(DEFAULT_NAV_KEYS)
        if (prof?.yield_basis) setYieldBasis(prof.yield_basis)
        setAccountType(prof?.account_type || null)

        // Everything below is independent — one parallel batch instead of a
        // serial waterfall: permissions/flags/widgets, theme, announcements,
        // onboarding status, tenant detection and the user's own companies.
        const devActiveEarly = isPlatformAdminFlag && !devModeDisabled
        const [permBatch, , anns, onboarded, prefetchedTenantRows, myCompanies] = await Promise.all([
          Promise.all([
            api.fetchMyPermissionsMap(devActiveEarly),
            api.fetchMyActiveFlags().catch(()=>new Set()),
            api.fetchWidgetPrefs().catch(()=>null),
          ]).catch(e => { logError('loadData:permissions+flags', e); return null }),
          loadUserTheme(user.id, user.email).catch(()=>{}),
          api.fetchAnnouncements().catch(e => { logError('loadData:announcements', e); return [] }),
          api.fetchOnboardingStatus(user.id).catch(()=>true),
          api.checkIsTenant(user.id).catch(e => { logError('loadData:tenantDetection', e); return [] }),
          api.fetchMyCompanies().catch(()=>[]),
        ])
        if (permBatch) {
          const [permMap, flags, widgets] = permBatch
          // Stamp an __owner map onto permissionsMap so canDo() can grant
          // implicit allow to the company owner without having to look up
          // ownership in every check site. (Owners typically don't have a
          // user_company_access row at all.)
          const ownerMap = {}
          for (const id of ownedIds) ownerMap[id] = true
          setPermissionsMap({ ...(permMap || {}), __owner: ownerMap })
          setActiveFlags(flags)
          setWidgetPrefs(widgets)
        }
        setAnnouncements(anns)
        if (!onboarded) setShowTour(true)
        // Load dashboard section preferences from localStorage (per-user keyed)
        try {
          const raw = localStorage.getItem(`ownproperly_section_prefs_${user.id}`)
          if (raw) setSectionPrefs(JSON.parse(raw))
        } catch(e) { /* non-fatal — fall back to defaults */ }

        // (Invite redemption ran at the top of loadData, before the access
        // fetches, so any newly granted companies are already in scope.)
        // (Theme, nav prefs, announcements and onboarding status are loaded
        // in the parallel batch above.)
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
        // ─── Suspended-company access control ────────────────────────────
        // If a company the user has access to (as collaborator) is
        // suspended (owner stopped paying, trial expired, no free-tier
        // grant), hide it from the collaborator's view. This is the
        // "if Justin stops paying, Alex loses access to ExH too" rule.
        //
        // Owners always see their own companies regardless of state —
        // they need to see them in order to pay (the gate shows pay
        // buttons). Platform admins / devs also bypass.
        //
        // We need subscriptions to make this decision. Fetch them
        // synchronously here so the filter is applied before the UI
        // sees `companies`. (The later best-effort fetch below stays
        // as a safety net for race-condition-free re-renders.)
        let initialSubs = []
        let settingsRows = null
        if (visibleCos.length > 0) {
          const coIds = visibleCos.map(c => c.id)
          // Subscriptions (needed for the suspension filter below) and
          // company settings (one .in() query instead of a request per
          // company) are independent — fetch together.
          ;[initialSubs, settingsRows] = await Promise.all([
            api.fetchSubscriptions(coIds).catch(() => []),
            supabase.from('company_settings').select('*').in('company_id', coIds)
              .then(r => r.data).catch(() => null),
          ])
        }
        // Track companies we hide due to suspension so we can show the
        // collaborator a clear banner ("your account owner hasn't paid")
        // instead of the onboarding wizard, which would be misleading.
        let suspendedCollabCos = []
        if (!devActive) {
          const subByCo = new Map(initialSubs.map(s => [s.company_id, s]))
          const isCompanyLive = (c) => {
            // Owner always sees the company (so they can pay if needed).
            if (c.owner_id === user.id) return true
            // Free tier — always live (admin granted).
            if (c.is_free_tier) return true
            const sub = subByCo.get(c.id)
            // Paid OR in stripe-side trial OR grace-period past_due → live.
            if (sub && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due')) return true
            // Otherwise live only while in-app trial hasn't expired yet.
            const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : 0
            return trialEnd > Date.now()
          }
          suspendedCollabCos = visibleCos.filter(c => c.owner_id !== user.id && !isCompanyLive(c))
          visibleCos = visibleCos.filter(isCompanyLive)
          // Enrich suspended companies with the account owner's email so
          // the banner can show who to contact. Best-effort — if RLS
          // blocks the user_profiles read, the banner falls back to a
          // generic "your account owner" label.
          if (suspendedCollabCos.length > 0) {
            try {
              const ownerIds = [...new Set(suspendedCollabCos.map(c => c.owner_id).filter(Boolean))]
              const { data: profiles } = await supabase
                .from('user_profiles').select('user_id, email').in('user_id', ownerIds)
              const emailById = {}
              for (const p of (profiles || [])) emailById[p.user_id] = p.email
              suspendedCollabCos = suspendedCollabCos.map(c => ({ ...c, owner_email: emailById[c.owner_id] || null }))
            } catch (e) { /* fall back to generic label */ }
          }
          // Also drop any properties whose company we just hid — so the
          // dashboard / reports / etc. don't surface data the user can
          // no longer access.
          const liveIds = new Set(visibleCos.map(c => c.id))
          visibleProps = visibleProps.filter(p => liveIds.has(p.company_id))
        }
        setCompanies(visibleCos)
        setCompanySubs(initialSubs)
        setProperties(visibleProps)
        setSuspendedAccess(suspendedCollabCos)
        if(visibleCos.length>0) setActiveCoTab(visibleCos[0].id)
        // Onboarding fires ONLY for genuinely new users (no companies anywhere).
        // Collaborators whose only access just got suspended see the
        // SuspendedAccessBanner instead — much clearer than asking them
        // to create a company they don't want.
        if (visibleCos.length === 0 && suspendedCollabCos.length === 0) {
          setShowOnboarding(true)
        }
        try { api.sendOnboardingEmail(user.email, '', 'welcome').catch(()=>{}) } catch(e) {}
        // Drop trial-expiring notifications into the bell (deduped daily
        // per company via localStorage). Fire-and-forget; failure is fine.
        api.maybeWarnTrialsExpiring(visibleCos).catch(() => {})
        // Same for compliance — fetch all compliance items for this user
        // and surface expired / soon-to-expire ones in the bell. This was
        // the biggest gap in the notification surface: zero rows despite
        // 90 occupied properties having no compliance tracking. Now any
        // compliance row whose expiry is within 60 days fires one notif
        // per item per day until renewed.
        api.fetchAllComplianceItems(user.id)
          .then(items => api.maybeWarnComplianceExpiring(items))
          .catch(() => {})
        // Mortgage product-end warnings: fires at 90 / 60 / 30 days
        // before each property's fixed/tracker rate expires. Same
        // dedup pattern as compliance. Lendlord-style "remortgage now"
        // nudge — biggest revenue lever once paired with a broker
        // referral partnership (£200-500/deal). Future work: add a
        // "Compare rates" CTA on the notification.
        api.maybeWarnMortgageExpiring(visibleProps).catch(() => {})
        // (Subscriptions already loaded above as part of the suspended-
        // company access filter. No need to re-fetch here.)
        // Check for tenant invite link param. Registration is bound to a
        // landlord-issued single-use token (redeemed via SECURITY DEFINER
        // RPC); legacy raw `?tenant_property=<uuid>` links are no longer
        // honoured — the DB blocks the old direct insert.
        const urlParams = new URLSearchParams(window.location.search)
        const tenantInviteToken = urlParams.get('tenant_invite')
        let tenantRows = prefetchedTenantRows
        if (tenantInviteToken) {
          try {
            await api.registerTenantProfile(user.id, null, tenantInviteToken)
            window.history.replaceState({}, '', window.location.pathname)
            // Re-check: the redemption may have just created this user's
            // first tenant_profiles row.
            tenantRows = await api.checkIsTenant(user.id)
          } catch(e) { logError('loadData:registerTenantProfile', e) }
        } else if (urlParams.get('tenant_property')) {
          window.history.replaceState({}, '', window.location.pathname)
        }
        // Plaid Link runs in-page (no redirect handoff) — the OAuth
        // exchange happens inside BankConnectionsModal via onSuccess.
        // We still clean up any legacy `?bank_callback=1` URL params
        // from the old TrueLayer redirect flow so bookmarks don't break.
        if (urlParams.get('bank_callback') === '1') {
          window.history.replaceState({}, '', window.location.pathname)
        }
        // Check if this user is a tenant (not a landlord) — rows prefetched
        // in the parallel batch above (re-fetched after invite redemption).
        // Skip tenant portal if user has their own companies or is platform admin.
        const isLandlord = myCompanies.length > 0 || devActive
        if (tenantRows.length > 0 && !isLandlord) { setIsTenant(true); return }
        // Auto-generate future rent months silently in background
        api.ensureFutureRentMonths(visibleProps, 6).then(count=>{
          if(count>0){
            api.fetchProperties().then(refreshed=>{
              const vis = devActive ? refreshed : refreshed.filter(p=>accessibleCompanyIds.has(p.company_id))
              setProperties(vis)
            })
          }
        }).catch(()=>{})
        // Company settings — fetched in bulk alongside subscriptions above.
        const settingsMap = {}
        const settingsById = new Map((settingsRows || []).map(s => [s.company_id, s]))
        visibleCos.forEach(c => {
          settingsMap[c.id] = settingsById.get(c.id) || {
            feature_compliance:true, feature_tenancy:true,
            feature_maintenance:true, feature_documents:true,
            feature_expenses:true, feature_reports:true
          }
        })
        setCompanySettings(settingsMap)
        // Tenancy rows for HealthBadge's tenancy-end deduction — best-effort,
        // non-blocking (an empty map just means no deduction is applied).
        api.fetchAllTenancies(user.id).then(rows => {
          const byProp = {}
          for (const t of (rows || [])) if (t.property_id) byProp[t.property_id] = t
          setTenanciesByProp(byProp)
        }).catch(() => {})
      } catch(e) {
        // Data load failed — DO NOT fall back to showing everything, and do
        // NOT let the dashboard render the new-account welcome zero-state
        // for a paying customer with a transient network error. The render
        // path shows a dedicated error screen with a Retry button.
        logError('loadData', e)
        setLoadError(e?.message || 'Something went wrong loading your portfolio')
        setCompanies([])
        setProperties([])
        setIsAdmin(false)
      } finally {
        setLoading(false)
      }
    }
    loadData()
    // Use user.id (stable across token refreshes), not the user object
    // (which gets a new reference on every supabase TOKEN_REFRESHED event
    // that fires on tab focus). Without this, the whole loadData runs
    // every time the user switches browser tabs back to OwnProperly,
    // re-mounting all child pages and losing any in-memory tab state
    // (e.g. which Settings tab the user was on).
    // loadNonce re-runs the load when the user hits Retry on the error screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.id, loadNonce])

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
    } catch(e) {
      // Refresh failed — keep the data we already have on screen, but don't
      // swallow it silently: log it and tell the user.
      logError('refreshData', e)
      showToast('Refresh failed — showing last loaded data', 'error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAccess, isPlatformAdmin, user?.id])

  const filtered = useMemo(()=>{
    const f = properties.filter(p=>{
      if(!showArchived && p.archived_at) return false
      if(coFilter!=='all'&&p.company_id!==coFilter) return false
      if(statusFilter!=='all'&&p.status!==statusFilter) return false
      if(searchQ&&!(p.name||'').toLowerCase().includes(searchQ.toLowerCase())&&!(p.address||'').toLowerCase().includes(searchQ.toLowerCase())) return false
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
        // Custom: drag positions first; rows never dragged (NULL sort_order)
        // tie at 0, so fall back to natural name order instead of DB order.
        case 'custom':       return ((a.sort_order||0)-(b.sort_order||0)) || natSort(a.name||a.address||'', b.name||b.address||'')
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


  // Success/info toasts auto-dismiss; ERROR toasts stay until dismissed —
  // a 3.5s window is not enough to read a failure, and the toast is the
  // only feedback channel most forms have.
  const toastTimer = useRef(null)
  const showToast = useCallback((msg,type='success')=>{
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null }
    setToast({msg,type})
    if (type !== 'error') toastTimer.current = setTimeout(()=>setToast(null),3500)
  },[])

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
  // Top-level navigation tabs — the registry lives in lib/nav.js (shared with
  // the Settings → Navigation toggles so the two can never disagree again).
  // Feedback used to live here as a required tab, but it's not a daily-use
  // page — moved to the "⋯ More" menu / drawer instead.
  // MTD ITSA only applies to individuals/sole-traders. Limited-company landlords
  // file Corporation Tax, not Self Assessment — hide the page from their nav so
  // their UI isn't cluttered with an irrelevant feature.
  const navItems = ALL_NAV
    .filter(n => n.flag ? activeFlags.has(n.flag) : (n.required || userNavPrefs.includes(n.key)))
    .filter(n => n.key !== 'mtd' || accountType !== 'limited_company')

  const paletteCommands = useMemo(() => {
    const cmds = []
    // Navigation — generated from the effective nav (registry + user prefs +
    // flags + account-type gating), so the palette can never offer a page
    // the user can't have (e.g. MTD Tax for limited companies) and never
    // misses one they can (Autopilot, Renters Rights, Insurance…).
    for (const n of navItems) {
      cmds.push({
        id: `nav:${n.key}`, icon: n.icon, label: `Go to ${n.label}`,
        group: 'navigate', keywords: n.label,
        action: () => { setView(n.key); setSelectedId(null) },
      })
    }
    cmds.push(
      { id:'nav:portfolio-companies', icon:'grid', label:'Go to Companies', group:'navigate', keywords:'companies portfolio',
        action: () => { setSelectedId(null); setPortfolioTab('companies'); setView('properties') } },
      { id:'nav:portfolio-compliance', icon:'shield-check', label:'Go to Compliance', group:'navigate', keywords:'certificates gas eicr epc',
        action: () => { setSelectedId(null); setPortfolioTab('compliance'); setView('properties') } },
      { id:'nav:portfolio-contractors', icon:'wrench', label:'Go to Contractors', group:'navigate', keywords:'trades contractors',
        action: () => { setSelectedId(null); setPortfolioTab('contractors'); setView('properties') } },
      { id:'nav:daytracker', icon:'calendar', label:'Go to Day Tracker', group:'navigate', keywords:'rent day tracker',
        action: () => { setSelectedId(null); setView('daytracker') } },
      { id:'nav:feedback', icon:'message', label:'Send Feedback', group:'navigate', keywords:'feedback bug feature',
        action: () => { setView('feedback'); setSelectedId(null) } },
    )
    // Settings sub-tabs — "Settings → Billing" etc., from the shared registry.
    for (const group of Object.values(SETTINGS_TABS)) {
      for (const t of group) {
        cmds.push({
          id: `settings:${t.key}`, icon: 'settings', label: `Settings → ${t.label}`,
          group: 'navigate', keywords: `settings ${t.label}`,
          action: () => openSettingsTab(t.key),
        })
      }
    }
    // Individual reports — "Report: Annual P&L" etc.
    for (const r of REPORT_CATALOGUE) {
      cmds.push({
        id: `report:${r.id}`, icon: r.icon, label: `Report: ${r.name}`,
        group: 'navigate', keywords: `report ${r.desc}`,
        action: () => { setSelectedId(null); setSelectedReportId(r.id); setView('reports') },
      })
    }
    // Open property by name/address
    for (const p of properties) {
      cmds.push({
        id: `prop:${p.id}`, icon: 'home', label: p.name || p.address || 'Untitled property',
        keywords: `${p.address || ''} ${p.company?.name || ''} ${p.company?.abbr || ''}`.trim(),
        group: 'open',
        hint: p.company?.abbr,
        action: () => { setSelectedId(p.id); setDetailTab('overview'); setView('detail') },
      })
    }
    // Open company by name
    for (const c of companies) {
      cmds.push({
        id: `co:${c.id}`, icon: 'grid', label: c.name,
        keywords: c.abbr,
        group: 'open',
        hint: 'Company',
        action: () => { setActiveCoTab(c.id); setView('properties'); setPortfolioTab('companies') },
      })
    }
    // Quick actions (matches the "+ New" menu)
    cmds.push(
      { id:'act:add-prop',   icon:'home', label:'Add Property',         group:'create', action:()=>{ setEditProp(null); setShowAddProp(true) } },
      { id:'act:add-bulk',   icon:'building', label:'Add Block of Flats',   group:'create', action:()=>openWorkflow('bulk-add') },
      { id:'act:add-co',     icon:'grid', label:'Add Company',          group:'create', action:()=>setShowAddCo(true) },
      { id:'act:import',     icon:'file-text', label:'Import Statement',     group:'create', action:()=>openWorkflow('import') },
      { id:'act:scan-receipt', icon:'receipt', label:'Scan Receipt',       group:'create', keywords:'expense camera ocr', action:()=>setShowReceiptScan(true) },
      { id:'act:dark',       icon:'moon', label: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        group:'action', keywords: 'theme toggle', action:()=>setDarkMode(!darkMode) },
      { id:'act:signout',    icon:'log-out', label:'Sign Out',              group:'action', action:()=>supabase.auth.signOut() },
    )
    return cmds
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, companies, darkMode, navItems])

  // Record where the user came from so the property page's Back returns
  // there (Portfolio sub-tab, Rent Tracker, Dashboard…) instead of always
  // dumping them on the Properties tab.
  const detailOrigin = useRef(null)
  // Full-page workflows (statement import, bulk add) record where the user
  // came from so closing them returns there.
  const workflowOrigin = useRef('dashboard')

  // Early returns AFTER all hooks — nothing below this line may call a hook.
  // (A hook after these returns crashes with React #300 the moment a gate
  // flips, e.g. a fresh signup being routed into the onboarding wizard.)
  // Privacy & Terms render at /privacy and /terms even when unauthenticated.
  // HMRC requires the URLs to be publicly reachable for production approval.
  // These checks sit BEFORE the auth gate.
  if (showPrivacy) return <PrivacyPolicy onBack={() => {
    setShowPrivacy(false)
    if (window.location.pathname.startsWith('/privacy')) {
      window.history.replaceState({}, '', '/')
    }
  }}/>
  if (showTerms) return <TermsOfService onBack={() => {
    setShowTerms(false)
    if (window.location.pathname.startsWith('/terms')) {
      window.history.replaceState({}, '', '/')
    }
  }}/>
  if (showSecurity) return <SecurityPage onBack={() => {
    setShowSecurity(false)
    if (window.location.pathname.startsWith('/security')) {
      window.history.replaceState({}, '', '/')
    }
  }}/>

  if (authLoading) return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style><div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>
  // On a company tenant subdomain, a logged-out visitor gets the company's
  // branded tenant login, never the OwnProperly marketing site.
  if (!session && portalBranding) return (
    <LoginPage branding={portalBranding} />
  )
  if (!session) return (
    <>
      <Suspense fallback={<PageLoadingSpinner T={T}/>}>
        <MarketingSite
          onSignIn={()=>{ setLoginMode('login'); setShowLoginModal(true) }}
          onSignUp={()=>{ setLoginMode('signup'); setShowLoginModal(true) }}
          onPrivacy={()=>setShowPrivacy(true)}
        />
      </Suspense>
      {showLoginModal && (
        <div onClick={e=>e.target===e.currentTarget&&setShowLoginModal(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16,backdropFilter:'blur(4px)'}}>
          <LoginPage key={`login-${loginMode}`} initialMode={loginMode} onClose={()=>setShowLoginModal(false)}/>
        </div>
      )}
    </>
  )
  if (isTenant) return (
    <Suspense fallback={<PageLoadingSpinner T={T}/>}>
      <TenantPortal user={user}
        onSignOut={()=>supabase.auth.signOut()}
        onSwitchToLandlord={()=>setIsTenant(false)}
      />
    </Suspense>
  )

  // ── TRIAL EXPIRED HARD GATE ────────────────────────────────────────
  // Platform admins (Justin) bypass entirely so we never lock ourselves
  // out. Tenant-only users are already handled above. For everyone else,
  // if ANY of their accessible companies is past its trial and not on a
  // paying plan or free tier, show a full-screen blocker requiring
  // Stripe Checkout per overdue company before the app loads.
  if (!isPlatformAdmin && !impersonatingUser) {
    // Pass user.id so the gate only considers OWNED companies — we never
    // gate a user on someone else's billing state (they can't pay for it
    // anyway, and gating would just lock them out of their other paid
    // companies). Collaborator companies that are expired drop out of
    // the user's view naturally, owner gets nudged via their own gate.
    const overdue = getOverdueCompanies({ companies, subs: companySubs, userId: user?.id })
    if (overdue.length > 0) {
      return <TrialExpiredGate
        companies={overdue}
        subs={companySubs}
        properties={properties}
        user={user}
        onSignOut={()=>supabase.auth.signOut()}
      />
    }
  }

  // Collaborator whose only access just got suspended (account owner
  // stopped paying or trial expired with no Stripe sub). Show a clear
  // banner instead of dropping them on the onboarding wizard, which
  // would invite them to create a company they don't actually want.
  if (companies.length === 0 && suspendedAccess.length > 0 && !isPlatformAdmin) {
    return <SuspendedAccessBanner
      suspended={suspendedAccess}
      user={user}
      T={T}
      onSignOut={()=>supabase.auth.signOut()}
    />
  }

  if (showOnboarding) return <Suspense fallback={<PageLoadingSpinner T={T}/>}><OnboardingWizard user={user} onComplete={()=>{ setShowOnboarding(false); refreshData() }}/></Suspense>


  const selected = properties.find(p=>p.id===selectedId)

  function openDetail(p, tab='overview'){
    detailOrigin.current = { view, portfolioTab }
    setSelectedId(p.id);setDetailTab(tab);setView('detail')
  }
  function closeDetail(){
    const origin = detailOrigin.current
    detailOrigin.current = null
    setSelectedId(null)
    if (origin && origin.view !== 'detail') {
      if (origin.view === 'properties' && origin.portfolioTab) setPortfolioTab(origin.portfolioTab)
      setView(origin.view)
    } else {
      setView('properties')
    }
  }
  function openWorkflow(key){
    workflowOrigin.current = (view === 'import' || view === 'bulk-add') ? 'dashboard' : view
    setSelectedId(null)
    setView(key)
  }
  function closeWorkflow(){
    setView(workflowOrigin.current || 'dashboard')
  }
  // Settings sub-tabs are owned by SettingsPage (it reads its initial tab
  // from the hash at mount and listens for this event when already open).
  function openSettingsTab(tab){
    window.history.pushState({ view: 'settings', settingsTab: tab }, '', `#/settings/${tab}`)
    setView('settings')
    window.dispatchEvent(new CustomEvent('ownproperly:set-settings-tab', { detail: { tab } }))
  }

  async function handleSaveProp(formData){
    try{
      // Strip the compliance payload from the property write — it gets
      // persisted separately into compliance_items below.
      const { _compliance = [], ...propData } = formData
      let propId
      if(editProp?.id){
        const updated=await api.updateProperty(editProp.id, propData)
        setProperties(prev=>prev.map(p=>p.id===editProp.id?{...p,...updated}:p))
        propId = editProp.id
        showToast('Property updated')
      }else{
        const created=await api.createProperty({...propData,user_id:user.id})
        setProperties(prev=>[...prev,created])
        propId = created.id
        // If this property was created by converting a completed deal,
        // retire that deal now — it's become a portfolio property, so it
        // shouldn't linger on the Deals page. Soft-delete sends it to Trash
        // (restorable for 30 days), matching the manual delete users were
        // doing by hand. Best-effort: the property is already saved, so a
        // failed deal-delete shouldn't block the success path.
        if (convertSourceDealId) {
          try {
            await api.deleteDeal(convertSourceDealId, user.id)
            setConvertRefreshKey(k => k + 1) // tell DealsPage to refresh its list
            showToast('Property added — deal moved to Trash')
          } catch (e) {
            console.error('failed to retire converted deal', e)
            showToast('Property added — but the deal could not be removed, delete it manually', 'error')
          }
          setConvertSourceDealId(null)
        } else {
          showToast('Property added')
        }
      }

      // Persist compliance items. Best-effort: if it fails, the property
      // is already saved — we just lose the compliance dates and the
      // user can re-enter them from the Compliance tab.
      if (propId && Array.isArray(_compliance) && _compliance.length > 0) {
        try {
          // Load existing items so we update-not-duplicate when the user
          // edits a property and changes dates. Match on cert_type.
          const existing = await api.fetchCompliance(propId).catch(() => [])
          const byType = new Map(existing.map(e => [e.cert_type, e]))
          for (const item of _compliance) {
            const match = byType.get(item.cert_type)
            if (match) {
              // In-place update via Supabase client — no dedicated update
              // helper exists yet so use the raw client.
              await supabase.from('compliance_items')
                .update({
                  expiry_date: item.expiry_date || null,
                  issue_date:  item.issue_date  || null,
                  reminder_days: item.reminder_days,
                  cert_name: item.cert_name,
                })
                .eq('id', match.id)
            } else {
              await api.createCompliance(propId, item)
            }
          }
        } catch (e) {
          console.error('compliance save failed', e)
          // Don't surface — property save succeeded which is the
          // critical path. User can fix from Compliance tab.
        }
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
      } catch(e) { logError('handleSaveCo:saveCompanySubdomain', e) }
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
      // updateRentSegment stamps period_start/period_end onto legacy
      // whole-month rows on touch — merge the returned row into local state
      // so period-filtered readers (day tracker, MTD) see the stamped dates
      // without a refetch.
      const updated = await api.updateRentSegment(payment.id, { status: newStatus })
      setProperties(prev=>prev.map(p=>{
        if(p.id!==payment.property_id) return p
        return {...p, rent_payments: p.rent_payments.map(rp=>
          rp.id===payment.id ? {...rp, ...(updated||{}), status:newStatus} : rp
        )}
      }))
      setEditingPayment(null)
      showToast(`${payment.month_label} marked as ${newStatus}`)
    }catch(e){showToast(e.message,'error')}
  }

  function CompaniesPanel({ companies, setCompanies, user, showToast, companySettings, setCompanySettings, T }) {
    const mono = MONO

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
                    Rename
                  </button>
                  {(c.owner_id === user?.id || devModeActive) && (
                    <button onClick={()=>setDeleteCoTarget(c)}
                      style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:`1px solid ${T.red}33`,background:'transparent',color:T.red,cursor:'pointer'}}>
                      Delete
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
              {groupPropertiesByBuilding(cProps).map(group => (
                <div key={group.tail || group.items[0].id}>
                  {group.isBuilding && (
                    <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6,marginBottom:6,paddingLeft:8}}>
                      <span style={{fontSize:13}} aria-hidden="true">🏘</span>
                      <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{group.tail}</span>
                      <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>· {group.items.length} units</span>
                    </div>
                  )}
                  <div style={{display:'grid',gap:10,marginLeft:group.isBuilding?14:0,borderLeft:group.isBuilding?`2px solid ${T.gold}33`:'none',paddingLeft:group.isBuilding?10:0}}>
                    {group.items.map(p => {
                      const canFin = canDo(permissionsMap, p.company_id, 'view_financial') || devModeActive
                      const displayName = group.isBuilding ? (String(p.name||'').split(',')[0].trim() || p.name) : p.name
                      return (
                      <div key={p.id} className="card pcard" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}} onClick={()=>openDetail(p)}>
                        <div style={{flex:1,minWidth:150}}>
                          <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{displayName}</div>
                          <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{p.prop_type} · {p.address}</div>
                        </div>
                        {p.arrears>0&&<div style={{fontFamily:MONO,fontSize:11,color:T.red}}>⚠ {fmt(p.arrears)}</div>}
                        {canFin && <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                            <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:T.gold}}>{calcGrossYield(p, yieldBasis).toFixed(1)}%</div>
                            <div style={{fontFamily:MONO,fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'0.05em'}}>{yieldBasis==='value'?'on value':'on cost'}</div>
                          </div>}
                        {canFin && <div style={{fontFamily:MONO,fontSize:12,color:T.muted}}>{fmt(p.rent_pcm)+'/mo'}</div>}
                        <Badge status={p.status}/>
                      </div>
                    )})}
                  </div>
                </div>
              ))}
              {cProps.length===0&&<div style={{fontFamily:MONO,color:T.muted,fontSize:12,padding:'32px',textAlign:'center'}}>No properties for this company yet.{(canDo(permissionsMap, activeCoTab, 'edit_properties') || devModeActive) && <><br/><button className="btn btn-gold" style={{fontSize:11,marginTop:12}} onClick={()=>{setEditProp({company_id:activeCoTab});setShowAddProp(true)}}>+ Add Property</button></>}</div>}
            </div>
          </div>
        })}


      </div>
    )
  }

  return (
    <div style={{fontFamily:SANS,minHeight:'100vh',width:'100%',maxWidth:'100vw',overflowX:'hidden',background:T.bg,color:T.text,transition:'background 0.3s, color 0.3s',paddingLeft:railWidth}}>
      <style>{CSS}</style>
      {/* ── LEFT RAIL (desktop) ── redesign app shell. Fixed in the gutter the
          outer paddingLeft reserves. Mobile keeps the bottom tab bar instead. */}
      {!isMobile && (
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
                : <div key={`hdr-${n.group}`} style={{fontFamily:MONO,fontSize:9,fontWeight:700,color:T.faint,textTransform:'uppercase',letterSpacing:'0.12em',padding:'12px 11px 4px'}}>{n.group}</div>)
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
                  <span style={{display:'flex',flexShrink:0,color:active?T.gold:'inherit'}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={20}/>:n.icon}</span>
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
      )}
      {/* ── IMPERSONATION BANNER ── */}
      {impersonatingUser && (
        <div style={{background:'#8B1F1F',color:'white',padding:'10px 16px',textAlign:'center',fontFamily:MONO,fontSize:12,fontWeight:600,position:'sticky',top:0,zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',gap:16,flexWrap:'wrap'}}>
          <span>🎭 <strong>Impersonating {impersonatingUser.name || impersonatingUser.email}</strong> — viewing their data (read-only for safety)</span>
          <button onClick={()=>{
            sessionStorage.removeItem('ownproperly_impersonate')
            setImpersonatingUser(null)
            window.location.reload()
          }} style={{background:'white',color:'#8B1F1F',border:'none',padding:'5px 14px',borderRadius:5,fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer'}}>
            Stop impersonating
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
          fontFamily:MONO,
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
              <span>DEVELOPER MODE — you see all user data across the platform</span>
              <button onClick={()=>{ setDevModeDisabled(true); window.location.reload() }}
                style={{background:'#C8A84B',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:9,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                VIEW AS REGULAR USER
              </button>
            </>
          ) : (
            <>
              <span>REGULAR USER VIEW — permission gates active (data-level access unchanged)</span>
              <button onClick={()=>{ setDevModeDisabled(false); window.location.reload() }}
                style={{background:'#9ecb9e',color:'#1A2530',border:'none',padding:'3px 10px',borderRadius:4,fontFamily:'inherit',fontSize:9,fontWeight:700,cursor:'pointer',letterSpacing:'0.05em'}}>
                ENABLE DEVELOPER MODE
              </button>
            </>
          )}
        </div>
      )}
      {/* ── HEADER ── */}
      {/* Skip link: focus <main> directly instead of navigating — setting
          location.hash to #main-content would be parsed by the hash router
          as an unknown view and blank the screen. */}
      <a href='#main-content' onClick={e=>{e.preventDefault(); const m=document.getElementById('main-content'); if(m){m.focus(); m.scrollIntoView()}}} style={{position:'absolute',left:'-9999px',top:'auto',width:1,height:1,overflow:'hidden'}} onFocus={e=>{e.target.style.left='16px';e.target.style.width='auto';e.target.style.height='auto'}} onBlur={e=>{e.target.style.left='-9999px';e.target.style.width='1px';e.target.style.height='1px'}}>Skip to main content</a>
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

          {/* Desktop nav now lives in the left rail; spacer pushes actions right */}
          {!isMobile&&<div style={{flex:1}}/>}

          {/* Mobile: current page title */}
          {isMobile&&<div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>
            {(()=>{const ni=navItems.find(n=>n.key===view); return ni&&ICON_NAMES.includes(ni.icon)?<Icon name={ni.icon} size={15} color={T.muted}/>:ni?.icon})()} <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{view==='detail'&&selected?selected.name:(navItems.find(n=>n.key===view)?.label||VIEW_LABELS[view]||'Dashboard')}</span>
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
                        {icon:'home',label:'Add Property',    action:()=>{setEditProp(null);setShowAddProp(true)}},
                        {icon:'building',label:'Add Block of Flats', action:()=>openWorkflow('bulk-add')},
                        {icon:'grid',label:'Add Company',     action:()=>setShowAddCo(true)},
                        {icon:'file-text',label:'Import Statement',action:()=>openWorkflow('import')},
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
                    border:`1px solid ${tone}`, background:tone+'22', color:tone,
                    whiteSpace:'nowrap',
                  }}>
                  {isMobile ? `${soonest.days}d` : `Trial: ${soonest.days} day${soonest.days===1?'':'s'} left`}
                </button>
              )
            })()}
            <NotificationCentre/>
            {isPlatformAdmin&&<button className="btn btn-ghost" style={{fontSize:11,padding:'6px 12px',color:T.gold,borderColor:T.gold+'44'}} onClick={()=>setShowAdmin(true)}>Admin</button>}
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
                          {item.hint && <span style={{fontFamily:MONO,fontSize:10,color:T.muted,border:`1px solid ${T.border}`,borderRadius:4,padding:'1px 5px'}}>{item.hint}</span>}
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

      {/* ── MOBILE DRAWER ── */}
      {isMobile&&showDrawer&&(
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
                  <span style={{width:24,display:'flex',justifyContent:'center',color:active?T.gold:T.muted}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={19}/>:<span style={{fontSize:18}}>{n.icon}</span>}</span>
                  <span style={{fontSize:14,fontWeight:active?600:400,color:active?T.gold:T.text}}>{n.label}</span>
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
      )}

      {/* Platform announcement banner */}
      {announcements.filter(a=>!dismissedAnns.includes(a.id)).map(a=>{
        const colors={info:'#4B8FE0',warning:'#E0943A',success:'#2ECC8A'}
        const col=colors[a.type]||colors.info
        return (
          <div key={a.id} style={{background:col+'18',borderBottom:`1px solid ${col}33`,padding:'10px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
            <span style={{fontFamily:MONO,fontSize:12,color:col}}>
              {a.message}{a.link_url&&a.link_text&&isSafeUrl(a.link_url)&&<a href={a.link_url} target="_blank" rel="noreferrer" style={{color:col,marginLeft:12,fontWeight:700}}>{a.link_text} →</a>}
            </span>
            <button onClick={()=>{const n=[...dismissedAnns,a.id];setDismissedAnns(n);localStorage.setItem('dismissed_anns',JSON.stringify(n))}}
              style={{background:'none',border:'none',color:col,cursor:'pointer',fontFamily:MONO,fontSize:11,flexShrink:0}}>Dismiss ✕</button>
          </div>
        )
      })}
      <main id="main-content" tabIndex={-1} style={{maxWidth:1240,margin:'0 auto',padding:isMobile?'16px 12px 90px':'28px 24px',width:'100%',outline:'none'}}>
        {loading?(view==='dashboard'?<DashboardSkeleton/>:<Spinner/>):<Suspense fallback={<PageLoadingSpinner T={T}/>}>

          {view==='dashboard'&&<div className="fade">
            {/* Load failure — a transient Supabase/network error must never
                look like a wiped account. Show a clear error + Retry instead
                of the new-account welcome hero. */}
            {loadError && (
              <div className="card" role="alert" style={{padding:isMobile?'24px 18px':'40px 32px',marginBottom:20,textAlign:'center',background:T.card,border:`1px solid ${T.red}66`}}>
                <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="alert-triangle" size={isMobile?30:38} color={T.red}/></div>
                <h1 style={{fontSize:isMobile?20:24,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>We couldn't load your portfolio</h1>
                <p style={{fontFamily:MONO,fontSize:13,color:T.muted,marginBottom:20,lineHeight:1.6,maxWidth:520,margin:'0 auto 20px'}}>
                  Your data is safe — this is usually a temporary connection problem. ({loadError})
                </p>
                <button className="btn btn-gold" onClick={()=>{ setLoadError(null); setLoadNonce(n=>n+1) }}>Retry</button>
              </div>
            )}
            {/* First-run zero-state. Accounts with no properties land here —
                including the most common post-onboarding state (a company
                created by the wizard but no property yet, which previously
                skipped this hero and dumped the user on a wall of £0 KPIs).
                While this shows, the dashboard sections below are skipped
                entirely. */}
            {!loadError && activeProperties.length === 0 && (
              <div className="card" style={{padding:isMobile?'24px 18px':'40px 32px',marginBottom:20,textAlign:'center',background:T.card,border:`1px dashed ${T.gold}66`}}>
                <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="home" size={isMobile?30:38} color={T.gold}/></div>
                <h1 style={{fontSize:isMobile?20:24,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>Welcome to Properly</h1>
                <p style={{fontFamily:MONO,fontSize:13,color:T.muted,marginBottom:20,lineHeight:1.6,maxWidth:520,margin:'0 auto 20px'}}>
                  {companies.length === 0
                    ? "You're on a 14-day free trial. The fastest way to see what the app does is to add your first company and one property — takes about 2 minutes."
                    : 'Your company is set up — now add your first property to bring the dashboard to life. Takes about a minute.'}
                </p>
                <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
                  {companies.length === 0
                    ? <>
                        <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>1. Add a Company</button>
                        <button className="btn btn-ghost" onClick={()=>{setEditProp(null);setShowAddProp(true)}} disabled title="Add a company first">2. Add a Property</button>
                      </>
                    : <button className="btn btn-gold" onClick={()=>{setEditProp(null);setShowAddProp(true)}}>Add your first property</button>}
                </div>
              </div>
            )}
            <div style={{marginBottom:isMobile?14:20,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:16,marginBottom:isMobile?10:16}}>
                <div style={{flex:'1 1 auto',minWidth:0}}>
                  {(() => {
                    const fn = (user?.user_metadata?.first_name || (user?.user_metadata?.full_name||'').trim().split(' ')[0] || '').trim()
                    const hr = new Date().getHours()
                    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
                    return (
                      <h1 style={{fontSize:isMobile?22:30,fontWeight:700,letterSpacing:'-0.03em',marginBottom:isMobile?2:4}}>
                        {greet}{fn ? <>, {fn}</> : ''}
                      </h1>
                    )
                  })()}
                  {activeProperties.length > 0 && <p style={{fontFamily:MONO,color:T.muted,fontSize:isMobile?11:12,lineHeight:1.5,wordBreak:'break-word',overflowWrap:'anywhere'}}>
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
                  </p>}
                </div>
                {/* Portfolio health ring — average of per-property health
                    scores, consistent with the per-card HealthBadge. */}
                {dashProps.length > 0 && (() => {
                  const avg = dashProps.reduce((sum,p)=>sum+(api.calcPropertyHealthScore(p, p.compliance_items||[], tenanciesByProp[p.id]||p.tenancy||null, p.maintenance_jobs||[], p.rent_payments||[]).score||0),0)/dashProps.length
                  return <HealthRing score={avg}/>
                })()}
              </div>
              {/* Company filter pills */}
              {companies.length > 1 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
                  <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
                  <button
                    onClick={()=>setDashCoFilter([])}
                    style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                      border:`1px solid ${dashCoFilter.length===0?T.gold:T.border}`,
                      background:dashCoFilter.length===0?T.gold:'transparent',
                      color:dashCoFilter.length===0?'#1C2830':T.muted,fontWeight:dashCoFilter.length===0?700:400}}>
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
                        style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
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
              // First-run: the welcome hero above is the whole dashboard.
              // Rendering the sections under it would just be a wall of £0
              // KPIs and empty widgets.
              if (!loadError && activeProperties.length === 0) return null
              // ───────────────────────────────────────────────────────────────
              // Dashboard sections registry — each section is a labelled chunk
              // that the user can reorder and show/hide. Section content is
              // rendered by the function below. The KPI grid is one of these
              // sections too, with its own internal customisation preserved.
              // ───────────────────────────────────────────────────────────────

              const SECTION_DEFS = {
                kpi_grid: {
                  icon: 'pie-chart',
                  label: 'KPI cards',
                  description: 'Portfolio value, monthly rent, arrears, and other key metrics',
                  render: () => renderKpiGrid(),
                },
                by_company: {
                  icon: 'grid',
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
                autopilot_widget: {
                  icon: '🤖',
                  label: 'Portfolio Autopilot',
                  description: 'AI-drafted prioritised actions across your portfolio',
                  render: () => {
                    if (!activeFlags.has('portfolio_autopilot')) return null
                    const scopedId = dashCoFilter.length === 1 ? dashCoFilter[0] : null
                    return (
                      <div style={{ marginTop: 28 }}>
                        <AutopilotWidget companyId={scopedId} companies={companies} onOpenFull={() => { window.location.hash = '#/autopilot' }}/>
                      </div>
                    )
                  },
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
                  description: 'Observations and opportunities generated by Claude (refreshable every 30 min) — Investor tier',
                  // Investor-tier feature. Gates via canUseInvestorFeatures
                  // helper — platform admins + free-tier companies pass; otherwise
                  // need an active 'investor' subscription. Falls back to an
                  // upgrade prompt for starter-tier users.
                  render: () => {
                    const hasInvestor = canUseInvestorFeatures({
                      subs: companySubs, companies, isPlatformAdmin,
                    })
                    if (!hasInvestor) {
                      return (
                        <div style={{ marginTop: 28, marginBottom: 20, background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 14, padding: '20px 22px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 16 }}>✨</span>
                            <h2 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0 }}>AI Portfolio Insights</h2>
                            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.gold + '22', color: T.gold }}>INVESTOR</span>
                          </div>
                          <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.7, marginBottom: 12 }}>
                            Get Claude-generated weekly observations about under-rented units, expiring certs, high LTVs and refinance opportunities. Available on the £5/property Investor tier.
                          </p>
                          <button className="btn btn-gold" style={{ fontSize: 12 }}
                            onClick={() => {
                              // 'billing' is a Settings sub-tab, not a top-level
                              // view. Set the hash BEFORE switching views —
                              // SettingsPage reads its initial tab from the URL
                              // at mount, whereas the tab-change event would
                              // fire before its listener exists. The event is
                              // still dispatched for an already-mounted page.
                              window.history.pushState({ view: 'settings', settingsTab: 'billing' }, '', '#/settings/billing')
                              setView('settings')
                              window.dispatchEvent(new CustomEvent(
                                'ownproperly:set-settings-tab',
                                { detail: { tab: 'billing' } }
                              ))
                            }}>
                            Upgrade to Investor →
                          </button>
                        </div>
                      )
                    }
                    const scopedId = dashCoFilter.length === 1 ? dashCoFilter[0] : null
                    const scopedName = scopedId ? companies.find(c => c.id === scopedId)?.name : null
                    return <PortfolioInsightsWidget companyId={scopedId} companyName={scopedName}/>
                  },
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
                          <p style={{fontFamily:MONO,fontSize:11,color:T.muted,marginBottom:14}}>
                            Documents stored at company level — for items that apply across all properties (e.g. company insurance, bank letters)
                          </p>
                          <CompanyDocumentsTab companyId={activeCoTab} showToast={showToast} isAdmin={isAdmin} user={user}/>
                        </div>
                      : null
                  ),
                },
              }

              // Default order + enabled are defined ONCE at the top of this
              // component (SECTION_DEFAULT_ORDER, SECTION_DEFAULT_ENABLED).
              // Previously redeclared here, which caused the customise modal
              // to silently miss new sections (e.g. portfolio_insights).
              // Resolve current section prefs, filling in any missing keys from defaults.
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
                  portfolio_value: { icon:'home', label:'Portfolio Value', render: () => (
                    <StatCard icon="home" label="Portfolio Value" value={fmt(stats.totalEstVal)} sub={`Invested ${fmt(stats.totalInvested)}`} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
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
                  monthly_rent: { icon:'pound', label:'Monthly Rental Income', render: () => (
                    <StatCard icon="pound" label="Monthly Rental Income" value={fmt(stats.monthlyRent)} sub={fmt(stats.monthlyRent*12)+'/yr'} accent={T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                      breakdown={[
                        ...companyStats.map(c=>({label:c.name, value:fmt(c.monthlyRent), color:c.color})),
                        {label:'Annual total', value:fmt(stats.monthlyRent*12), color:T.green},
                        {label:'Rented units', value:`${stats.rented} of ${stats.total}`},
                        {label:'Occupancy rate', value:`${Math.round((stats.rented/Math.max(stats.total,1))*100)}%`, color:T.green},
                      ]}
                    />
                  )},
                  arrears: { icon:'alert-triangle', label:'Total Arrears', render: () => (
                    <StatCard icon="alert-triangle" label="Total Arrears" value={fmt(stats.totalArrears)} sub={`${stats.vacant} vacant`} accent={stats.totalArrears>0?T.red:T.green} onNavigate={()=>setView('rent')} navLabel="Rent"
                      breakdown={[
                        ...dashProps.filter(p=>(p.arrears||0)>0).map(p=>({label:p.name, value:fmt(p.arrears), color:T.red})),
                        ...(dashProps.filter(p=>(p.arrears||0)>0).length===0?[{label:'No arrears - all clear!', value:'✓', color:T.green}]:[]),
                        {label:'Vacant units', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                      ]}
                    />
                  )},
                  refurb: { icon:'hammer', label:'In Refurbishment', render: () => (
                    <StatCard icon="hammer" label="In Refurbishment" value={stats.inRefurb} sub={`of ${stats.total} total`} accent={T.blue} onNavigate={()=>{setStatusFilter('refurb');setPortfolioTab('properties');setView('properties')}} navLabel="View"
                      breakdown={[
                        ...dashProps.filter(p=>p.refurb_status==='in-progress').map(p=>({label:p.name, value:p.company?.abbr||'', color:T.blue})),
                        ...(stats.inRefurb===0?[{label:'No active refurbs', value:'✓', color:T.green}]:[]),
                        {label:'Planned refurbs', value:dashProps.filter(p=>p.refurb_status==='planned').length},
                        {label:'Completed refurbs', value:dashProps.filter(p=>p.refurb_status==='complete').length, color:T.green},
                      ]}
                    />
                  )},
                  mortgages: { icon:'landmark', label:'Mortgages Outstanding', render: () => (
                    <StatCard icon="landmark" label="Mortgages Outstanding" value={fmt(stats.totalMortgage)} sub={`${stats.mortgaged} mortgaged properties`} accent="#9B59B6" onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
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
                  cashflow_forecast: { icon:'wallet', label:'Cash Committed', render: () => {
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
                      <StatCard icon="wallet" label="Cash Committed" value={fmt(cashAgg.totalCashOut)} sub={sub} accent={accent} onNavigate={()=>setView('deals')} navLabel="Deals"
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
                  insurance_renewals: { icon:'shield-check', label:'Insurance Renewals', render: () => {
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
                      <StatCard icon="shield-check" label="Insurance Renewals" value={fmt(totalAnnual)} sub={sub} accent={accent} onNavigate={()=>setView('insurance')} navLabel="Insurance"
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
                  property_count: { icon:'home', label:'Property Count', render: () => (
                    <StatCard icon="home" label="Property Count" value={stats.total} sub={`${stats.rented} rented · ${stats.vacant} vacant`} accent={T.gold} onNavigate={()=>{setPortfolioTab('properties');setView('properties')}} navLabel="Portfolio"
                      breakdown={[
                        {label:'Total properties', value:stats.total},
                        {label:'Rented', value:stats.rented, color:T.green},
                        {label:'Vacant', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                        {label:'In refurbishment', value:stats.inRefurb, color:T.blue},
                        ...companyStats.map(c=>({label:c.name, value:c.count, color:c.color})),
                      ]}
                    />
                  )},
                  occupancy_rate: { icon:'pie-chart', label:'Occupancy Rate', render: () => {
                    const rate = stats.total > 0 ? Math.round((stats.rented/stats.total)*100) : 0
                    return (
                      <StatCard icon="pie-chart" label="Occupancy Rate" value={rate+'%'} sub={`${stats.rented} of ${stats.total} rented`} accent={rate>=90?T.green:rate>=75?T.amber:T.red} onNavigate={()=>{setStatusFilter('vacant');setPortfolioTab('properties');setView('properties')}} navLabel="Vacant"
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
                          <div style={{fontFamily:MONO,color:T.muted,fontSize:12,marginBottom:16}}>No companies yet. Add your first one to get started.</div>
                          <button className="btn btn-gold" onClick={()=>setShowAddCo(true)}>+ Add Company</button>
                        </div>
                      :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:14,marginBottom:28}}>
                          {companyStats.map(c=>(
                            <div key={c.id} className="card" style={{padding:'20px 22px',borderLeft:`3px solid ${c.color}`}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                                <div style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:c.color,background:c.color+'22',padding:'3px 10px',borderRadius:4}}>{c.abbr}</div>
                                <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                              </div>
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                                {[{l:'Properties',v:c.count},{l:'Rented',v:`${c.rented}/${c.count}`},{l:'Monthly Income',v:fmt(c.monthlyRent)},{l:'Arrears',v:fmt(c.arrears),red:c.arrears>0}].map((item,i)=>(
                                  <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                                    <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:3}}>{item.l}</div>
                                    <div style={{fontFamily:MONO,fontSize:15,fontWeight:700,color:item.red?T.red:T.gold}}>{item.v}</div>
                                  </div>
                                ))}
                              </div>
                              <button className="btn btn-ghost" style={{width:'100%',marginTop:12,fontSize:11}} onClick={()=>{setCoFilter(c.id);setStatusFilter('all');setPortfolioTab('properties');setView('properties')}}>View Properties -&gt;</button>
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
                    <div style={{flex:'1 1 auto',minWidth:0,fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                      Dashboard · {visibleSections.length} sections shown
                    </div>
                    <button onClick={()=>{ setCustomizeDashTab('sections'); setShowCustomizeDash(true) }}
                      style={{fontFamily:MONO,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>
                      Customize
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
              canUseInvestor={canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin })}
              onDealsChange={setDashboardDeals}
              convertRefreshKey={convertRefreshKey}
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
                  // UI hint — lets PropertyModal start with the mortgage block
                  // hidden for cash deals. Stripped before save (no column).
                  is_cash:     isCash,
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
                // Remember which deal this came from. Once the property is
                // saved we soft-delete this deal so it leaves the Deals page.
                setConvertSourceDealId(deal.id)
                setShowAddProp(true)
                showToast('Deal data pre-filled — review and save')
              }}/>
          </div>}

          {view==='properties'&&<div className="fade">
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:16}}>
              <div style={{flex:'1 1 auto',minWidth:0}}>
                <h1 style={{fontSize:isMobile?20:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Portfolio</h1>
                <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{filtered.length} of {properties.length} properties shown</div>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {[['properties','building','Properties'],['companies','grid','Companies'],['compliance','shield-check','Compliance'],['map','map','Map'],['contractors','wrench','Contractors']].map(([k,ic,l])=>(
                  <button key={k} onClick={()=>setPortfolioTab(k)}
                    style={{display:'inline-flex',alignItems:'center',gap:6,fontFamily:MONO,fontSize:11,padding:'6px 14px',borderRadius:8,cursor:'pointer',
                      border:`1px solid ${portfolioTab===k?T.gold:T.border}`,
                      background:portfolioTab===k?T.gold:'transparent',
                      color:portfolioTab===k?'#1C2830':T.muted,fontWeight:portfolioTab===k?700:400}}>
                    <Icon name={ic} size={14}/>{l}
                  </button>
                ))}
              </div>
            </div>
            {portfolioTab==='companies'&&<CompaniesPanel companies={companies} setCompanies={setCompanies} user={user} showToast={showToast} companySettings={companySettings} setCompanySettings={setCompanySettings} T={T}/>}
            {portfolioTab==='compliance'&&<ComplianceMatrix properties={properties} companies={companies} openDetail={(p)=>openDetail(p,'compliance')}/>}
            {portfolioTab==='contractors'&&<ContractorsPage user={user} companies={companies} showToast={showToast}/>}
            {portfolioTab==='map'&&<>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:18,alignItems:'center'}}>
                <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
                {[{id:'all',abbr:'All',color:T.gold},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.gold):T.muted,transition:'all 0.18s'}}>{c.abbr}</button>
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
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search name or address…" style={{flex:'1 1 200px',minWidth:0,maxWidth:'100%',width:'auto',padding:'7px 12px',fontSize:12}}/>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[{id:'all',abbr:'All',color:T.gold},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.gold):T.muted,transition:'all 0.18s'}}>{c.abbr}</button>
                ))}
                <div style={{width:1,background:T.border,margin:'0 2px'}}/>
                {['all', ...PROPERTY_STATUSES].map(f=>(
                  <button key={f} onClick={()=>setStatusFilter(f)} style={{fontFamily:MONO,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold:'transparent',color:statusFilter===f?'#1C2830':T.muted,transition:'all 0.18s'}}>{f==='all'?'All Status':(PROPERTY_STATUS_LABELS[f] || STATUS_CFG[f]?.label || f)}</button>
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
              <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',flexShrink:0}}>Sort by:</span>
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
                  style={{fontFamily:MONO,fontSize:isMobile?9:10,padding:isMobile?'3px 8px':'4px 12px',borderRadius:20,cursor:'pointer',
                    border:`1px solid ${sortBy===opt.v?T.gold:T.border}`,
                    background:sortBy===opt.v?T.gold:'transparent',
                    color:sortBy===opt.v?'#1C2830':T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
                  {opt.l}
                </button>
              ))}
              {/* List / Grid layout toggle (grid is the redesign card view) */}
              <div style={{display:'flex',gap:2,marginLeft:'auto',background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:2}}>
                {[['list','list','List'],['grid','grid-2','Grid']].map(([k,ic,lbl])=>(
                  <button key={k} onClick={()=>setPropLayout(k)} title={`${lbl} view`} aria-pressed={propLayout===k}
                    style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:7,cursor:'pointer',border:'none',
                      background:propLayout===k?T.gold:'transparent',color:propLayout===k?'#1C2830':T.muted,
                      fontFamily:MONO,fontSize:10,fontWeight:propLayout===k?700:400}}>
                    <Icon name={ic} size={14}/>{!isMobile&&lbl}
                  </button>
                ))}
              </div>
            </div>
            {propLayout==='grid'
              ? <PropertyGrid filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} yieldBasis={yieldBasis}/>
              : <DraggablePropertyList filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} setProperties={setProperties} properties={properties} sortBy={sortBy} yieldBasis={yieldBasis}/>}
            </div>}
          </div>}

          {/* Standalone Companies view removed — Companies now lives solely
              as a Portfolio sub-tab (#/properties/companies); legacy #/companies
              deep links are mapped across in parseHash. */}
          {view==='rent'&&<RentTrackerOverview companies={companies} properties={activeProperties} fmt={fmt} openDetail={openDetail} onDayTracker={()=>setView('daytracker')} yieldBasis={yieldBasis} onRefresh={refreshData}/>}
          {view==='daytracker'&&<DayTrackerPage companies={companies} properties={activeProperties} setProperties={setProperties} showToast={showToast} onBack={()=>setView('rent')}/>}
          {view==='settings'&&<SettingsPage companies={companies} setCompanies={setCompanies} companySettings={companySettings} setCompanySettings={setCompanySettings} user={user} showToast={showToast} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} darkMode={darkMode} setDarkMode={setDarkMode} userNavPrefs={userNavPrefs} setUserNavPrefs={setUserNavPrefs} yieldBasis={yieldBasis} setYieldBasis={setYieldBasis} accountType={accountType} setAccountType={setAccountType} properties={activeProperties} activeFlags={activeFlags} companySubs={companySubs} activeCompanyId={activeCoTab||null}/>}
          {view==='reports'&&<div className="fade"><ReportsPage properties={properties} companies={companies} companySettings={companySettings} user={user} activeFlags={activeFlags} selectedReportId={selectedReportId} onSelectReport={setSelectedReportId}/></div>}
          {view==='mtd'&&<div className="fade"><MtdItsaPage properties={activeProperties} accountType={accountType}/></div>}
          {view==='insurance'&&<div className="fade"><InsurancePage user={user} companies={companies} properties={activeProperties} showToast={showToast}/></div>}
          {view==='feedback'&&<div className="fade"><FeedbackPage user={user} showToast={showToast}/></div>}
          {view==='import'&&<StatementImporter asPage properties={activeProperties} companies={companies} showToast={showToast} onClose={()=>{closeWorkflow(); refreshData()}}/>}
          {view==='bulk-add'&&<BulkAddPropertyModal asPage
            companies={companies}
            onClose={closeWorkflow}
            onSaved={(created)=>{
              setProperties(prev => [...prev, ...created])
              setPortfolioTab('properties')
              setView('properties')
            }}
            showToast={showToast}
          />}
          {view==='autopilot'&&activeFlags.has('portfolio_autopilot')&&<div className="fade"><AutopilotPage companyId={activeCoTab||null} companies={companies}/></div>}
          {view==='renters-rights'&&activeFlags.has('renters_rights')&&<div className="fade"><RentersRightsCopilot companyId={activeCoTab||null}/></div>}
          {/* A bookmark/shared link can name a flag-gated view the account
              doesn't have — say so instead of rendering an empty pane. */}
          {((view==='autopilot'&&!activeFlags.has('portfolio_autopilot'))||(view==='renters-rights'&&!activeFlags.has('renters_rights')))&&(
            <div className="card fade" style={{padding:'40px 32px',textAlign:'center'}}>
              <div style={{display:'flex',justifyContent:'center',marginBottom:10}} aria-hidden="true"><Icon name="lock" size={32} color={T.muted}/></div>
              <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8}}>This feature isn't enabled for your account</h1>
              <p style={{fontFamily:MONO,fontSize:12,color:T.muted,marginBottom:20,maxWidth:440,margin:'0 auto 20px',lineHeight:1.6}}>
                {view==='autopilot'?'Portfolio Autopilot':'The Renters Rights copilot'} is rolling out gradually. If you'd like early access, send us a message from the Feedback page.
              </p>
              <button className="btn btn-gold" onClick={()=>setView('dashboard')}>Back to Dashboard</button>
            </div>
          )}

          {view==='detail'&&!selected&&<div className="fade" style={{padding:40,textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔒</div>
            <h2 style={{fontSize:20,color:T.text,marginBottom:8}}>Property not found</h2>
            <p style={{fontFamily:MONO,fontSize:12,color:T.muted,marginBottom:20}}>
              This property doesn't exist or you don't have access to it.
            </p>
            <button className="btn btn-gold" onClick={closeDetail}>&lt;- Back to Properties</button>
          </div>}

          {view==='detail'&&selected&&<div className="fade">
            <button className="btn btn-ghost" style={{marginBottom:20,fontSize:11}} onClick={closeDetail}>&lt;- Back</button>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 280px',gap:18,alignItems:'start'}}>
              <div style={{minWidth:0}}>
                <div className="card" style={{padding:isMobile?'18px 16px':'24px 28px',marginBottom:16}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:16}}>
                    <div style={{flex:'1 1 auto',minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}><CompanyPill company={selected.company}/><Badge status={selected.status}/></div>
                      <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',marginBottom:3}}>{selected.name}</h1>
                      <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{selected.address}</div>
                      <div style={{fontFamily:MONO,fontSize:11,color:T.faint}}>{selected.prop_type}</div>
                      {selected.managed_by&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,padding:'2px 10px',borderRadius:20,background:'#1A1D27',border:'1px solid #2E3044',fontFamily:MONO,fontSize:10,color:'#8B8FA8'}}>🏢 {selected.managed_by}</div>}
                      {selected.archived_at&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,marginLeft:6,padding:'2px 10px',borderRadius:20,background:T.bg,border:`1px solid ${T.border}`,fontFamily:MONO,fontSize:10,color:T.muted}}>Archived {new Date(selected.archived_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>}
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
                              { label: 'Delete property', icon: 'trash',
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
                  if(selected.is_hmo || activeFlags.has('hmo_rooms')) tabs.push('rooms')
                  if(activeFlags.has('epc_planner')) tabs.push('epc-plan')
                  // Tab keys are URL slugs (they form the #/detail/<id>/<tab>
                  // segment — keys with spaces came back percent-encoded on
                  // refresh and matched nothing, rendering a blank pane).
                  // Multi-word keys need explicit display labels.
                  const TAB_LABELS = { 'epc-plan': 'EPC Plan' }
                  // Treat tenancy sub-tab URLs as if "tenancy" is the active top-level tab
                  const TENANCY_SUB = ['right-to-rent','deposit','notices','rent-history']
                  const activeTop = TENANCY_SUB.includes(detailTab) ? 'tenancy' : detailTab
                  return (
                    <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
                      {tabs.map(t=>(
                        <button key={t} className={`tab ${activeTop===t?'active':''}`} onClick={()=>setDetailTab(t)} style={{textTransform:TAB_LABELS[t]?'none':'capitalize'}}>{TAB_LABELS[t]||t}</button>
                      ))}
                    </div>
                  )
                })()}
                {detailTab==='overview'&&<OverviewTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditProperty={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}

                {/* Rent-at-a-glance — most landlords arriving from Rent
                    Tracker care about rent more than property metadata.
                    Show this year's payment dots + YTD summary + a
                    "Open full rent tracker" CTA. Stays on Overview so
                    they don't need to switch tabs.

                    Renders only when there's payment data; for brand-new
                    properties we skip it so the Overview isn't padded
                    with empty cards. */}
                {detailTab==='overview' && (() => {
                  const payments = selected.rent_payments || []
                  if (payments.length === 0) return null
                  // Current year when it has data, else the most recent
                  // year that does (shared defaultRentYear helper).
                  const focusYear = defaultRentYear(payments)
                  // Month-collapsed stats — same maths as the Rent Tracker
                  // page so the two screens agree for the same year.
                  const { paid, missed, late, income: collected } = getMonthlyRentStats(payments, focusYear, selected.rent_pcm)
                  const arrears = selected.arrears || 0

                  return (
                    <div className="card" style={{padding:'16px 20px',marginTop:14,borderLeft:`3px solid ${T.green}`}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                            Rent · {focusYear}
                          </div>
                          {arrears > 0 && (
                            <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.red+'22',color:T.red}}>
                              {fmt(arrears)} in arrears
                            </span>
                          )}
                        </div>
                        <button className="btn btn-ghost" style={{fontSize:10}} onClick={()=>setDetailTab('rent')}>
                          Full history →
                        </button>
                      </div>

                      {/* Year of dots */}
                      <RentDots payments={payments} filterYear={focusYear} stlIds={stlPaymentIds(selected)}
                        onUpdate={m=>setEditingPayment({payment:m,propId:selected.id})}
                        onDayTracker={()=>setView('daytracker')}/>

                      {/* YTD summary — compact 4-stat grid */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:14}}>
                        {[
                          {l:'Months paid',    v:paid,             c:T.green,  sub:fmt(collected)},
                          {l:'Months missed',  v:missed,           c:missed>0?T.red:T.muted,    sub:missed>0?fmt(missed*(selected.rent_pcm||0)):''},
                          {l:'Months late',    v:late,             c:late>0?T.amber:T.muted},
                          {l:'Monthly rent',   v:fmt(selected.rent_pcm), c:T.gold},
                        ].map((item,i)=>(
                          <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                            <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{item.l}</div>
                            <div style={{fontFamily:MONO,fontSize:16,fontWeight:700,color:item.c}}>{item.v}</div>
                            {item.sub&&<div style={{fontFamily:MONO,fontSize:9,color:T.faint,marginTop:2}}>{item.sub}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

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
                          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Insurance</div>
                          <div style={{fontFamily:MONO,fontSize:12,color:T.muted}}>No policies cover this property yet.</div>
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
                        <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                          Insurance · {myPolicies.length} {myPolicies.length===1?'policy':'policies'}
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
                                <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                                  {pol.policy_name}
                                  {isCompanyWide && <span style={{fontSize:9,color:T.muted,marginLeft:6,fontWeight:400}}>· company-wide</span>}
                                </div>
                                <div style={{fontFamily:MONO,fontSize:10,color:T.muted}}>{pol.provider || '—'} · expires {pol.expiry_date}</div>
                              </div>
                              <div style={{textAlign:'right',fontFamily:MONO,fontSize:11,fontWeight:700,color:color}}>{status}</div>
                              <div style={{textAlign:'right',fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{fmt(pol.premium)}/yr</div>
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
                        <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
                        <div style={{fontFamily:MONO,fontSize:18,fontWeight:700,color:item.gold?T.gold:item.green?T.green:T.text}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  {selected.notes&&<div className="card" style={{padding:'16px 20px'}}>
                    <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Notes</div>
                    <div style={{fontFamily:MONO,fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
                  </div>}
                </div>}
                {detailTab==='refurb'&&<RefurbTab prop={selected} onAddPhase={handleAddPhase} onAddCost={handleAddCost} onUpdatePhase={handleUpdatePhase} onDeletePhase={handleDeletePhase} onUpdateCost={handleUpdateCost} onDeleteCost={handleDeleteCost} onUpdateField={handleUpdatePropField} isAdmin={isAdmin} user={user}/>}
                {detailTab==='rent'&&<RentTab selected={selected} fmt={fmt} setEditingPayment={setEditingPayment} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties} onDayTracker={()=>setView('daytracker')}/>}
                {detailTab==='financials'&&<FinancialsTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={p=>calcGrossYield(p,yieldBasis)} calcMonthlyProfit={calcMonthlyProfit} isAdmin={isAdmin} user={user} showToast={showToast} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive} canEditFinancial={canDo(permissionsMap, selected.company_id, 'edit_financial') || devModeActive}/>}
                {false&&<div style={{display:'grid',gap:12}}>
                  {[{title:'Purchase & Costs',items:[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Deposit',v:fmt(selected.deposit)},{l:'Mortgage Amount',v:fmt(selected.mortgage_amount)},{l:'Stamp Duty',v:fmt(selected.stamp_duty)},{l:'Legal Fees',v:fmt(selected.legal_fees)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)}]},{title:'Mortgage',items:[{l:'Rate',v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'-'},{l:'Term',v:selected.mortgage_term?selected.mortgage_term+' years':'-'},{l:'Monthly (Repay)',v:fmt(calcMonthlyMortgage(selected))},{l:'Monthly (IO)',v:selected.mortgage_amount&&selected.mortgage_rate?fmt(selected.mortgage_amount*selected.mortgage_rate/12):'-'}]},{title:'Returns',items:[{l:'Monthly Rent',v:fmt(selected.rent_pcm),gold:true},{l:'Annual Rent',v:fmt((selected.rent_pcm||0)*12),gold:true},{l:'Gross Yield',v:calcGrossYield(selected, yieldBasis).toFixed(2)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0},{l:'Annual Profit',v:fmt(calcMonthlyProfit(selected)*12),green:calcMonthlyProfit(selected)>0}]}].map((section,si)=>(
                    <div key={si} className="card" style={{padding:'18px 22px'}}>
                      <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>{section.title}</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                        {section.items.map((item,i)=>(
                          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8}}>
                            <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                            <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:item.gold?T.gold:item.green?T.green:T.text}}>{item.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>}
                {/* NOTE: no 'contractors' detail tab — it was renderable here
                    but never present in the tab strip, so it was reachable
                    only by hand-typed URL with nothing highlighted. Property-
                    scoped contractor history lives in Maintenance. */}
                {(detailTab==='overview'||detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&<TenancyRenewalAlert propertyId={selected.id} rentPcm={selected.rent_pcm} userId={user?.id} showToast={showToast} T={T}/>}
                {detailTab==='compliance'&&<ComplianceTab propertyId={selected.id} showToast={showToast} isAdmin={isAdmin} user={user} category="compliance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_compliance') || devModeActive}/>}
                {(detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&(()=>{
                  // The four legacy values map to themselves as sub-tabs; "tenancy" => "details".
                  const subTab = detailTab==='tenancy' ? 'details' : detailTab
                  const SUBS = [
                    ['details',       'Details'],
                    ['right-to-rent', 'Right to Rent'],
                    ['deposit',       'Deposit'],
                    ['notices',       'Notices'],
                    ['rent-history',  'Rent History'],
                  ]
                  return (
                    <div>
                      <div style={{display:'flex',gap:2,marginBottom:14,flexWrap:'wrap',borderBottom:`1px solid ${T.border}`,paddingBottom:0,alignItems:'center'}}>
                        {SUBS.map(([k,label])=>(
                          <button key={k}
                            onClick={()=>setDetailTab(k==='details' ? 'tenancy' : k)}
                            style={{
                              fontFamily:MONO,fontSize:11,padding:'8px 14px',
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
                            fontFamily:MONO,fontSize:11,fontWeight:700,
                            padding:'5px 12px',borderRadius:6,
                            border:`1px solid ${T.gold}66`,background:T.gold+'14',color:T.gold,
                            cursor:'pointer',display:'flex',alignItems:'center',gap:6,
                          }}>
                          Tenant Referencing
                          <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',padding:'1px 5px',borderRadius:3,background:T.gold+'33',color:T.gold}}>EARLY</span>
                        </button>
                      </div>
                      {subTab==='details'      &&<TenancyTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="tenancy" canEdit={canDo(permissionsMap, selected.company_id, 'edit_tenancies') || devModeActive} canViewPersonal={canDo(permissionsMap, selected.company_id, 'view_tenant_personal') || devModeActive}/>}
                      {subTab==='right-to-rent'&&<RightToRentTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                      {subTab==='deposit'      &&<DepositProtectionTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T}/>}
                      {subTab==='notices'      &&<NoticeTrackerTab propertyId={selected.id} userId={user?.id} showToast={showToast} T={T} property={selected}/>}
                      {subTab==='rent-history' &&<RentHistoryTab propertyId={selected.id} userId={user?.id} currentRent={selected.rent_pcm} showToast={showToast} T={T}/>}
                    </div>
                  )
                })()}
                {detailTab==='maintenance'&&<MaintenanceTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="maintenance" canEdit={canDo(permissionsMap, selected.company_id, 'edit_maintenance') || devModeActive} activeFlags={activeFlags}/>}
                {detailTab==='expenses'&&<ExpensesTab propertyId={selected.id} showToast={showToast} fmt={fmt} rentPcm={selected.rent_pcm||0} isAdmin={isAdmin} user={user} category="expenses" canEdit={canDo(permissionsMap, selected.company_id, 'edit_expenses') || devModeActive} canViewFinancial={canDo(permissionsMap, selected.company_id, 'view_financial') || devModeActive}/>}
                {detailTab==='documents'&&<DocumentsTab propertyId={selected.id} propertyName={selected.name} showToast={showToast} isAdmin={isAdmin} user={user}/>}
                {detailTab==='rooms'&&(selected.is_hmo||activeFlags.has('hmo_rooms'))&&<HmoRoomsPanel propertyId={selected.id} canEdit={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
                {detailTab==='epc-plan'&&activeFlags.has('epc_planner')&&<EpcPlanner property={selected} T={T} canWrite={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
                {activeFlags.has('rent_collection')&&(detailTab==='rent'||detailTab==='rent-history')&&<RentCollectionPanel property={selected} companyId={selected.company_id} tenantUserId={null}/>}
                {detailTab==='documents'&&activeFlags.has('esign')&&<ESignPanel propertyId={selected.id} companyId={selected.company_id} documents={[]} T={T}/>}
                {(detailTab==='tenancy'||['right-to-rent','deposit','notices','rent-history'].includes(detailTab))&&activeFlags.has('referencing')&&<ReferencingPanel propertyId={selected.id} canEdit={canDo(permissionsMap, selected.company_id, 'edit_properties') || devModeActive}/>}
              </div>
              <div style={{display:'grid',gap:12}}>
                <div className="card" style={{padding:'18px 20px'}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Quick Stats</div>
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
                      <span style={{fontFamily:MONO,fontSize:11,color:T.muted}}>{item.l}</span>
                      <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.gold,display:'inline-flex',alignItems:'center',gap:2}}>
                        {item.v}
                        {item.explain && <CalcExplain {...item.explain}/>}
                      </span>
                    </div>
                  ))}
                </div>
                {(selected.arrears||0)>0&&<div className="card" style={{padding:'16px 18px',borderLeft:`3px solid ${T.red}`}}>
                  <div style={{fontFamily:MONO,fontSize:10,color:T.red,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Rent Arrears</div>
                  <div style={{fontFamily:MONO,fontSize:22,fontWeight:700,color:T.red,marginBottom:4}}>{fmt(selected.arrears)}</div>
                  {selected.notes&&<div style={{fontFamily:MONO,fontSize:11,color:T.muted,lineHeight:1.6}}>{selected.notes}</div>}
                </div>}
              </div>
            </div>
          </div>}
        </Suspense>}
      </main>

      <CommandPalette open={showPalette} commands={paletteCommands} onClose={()=>setShowPalette(false)}/>
      {showReferencing && selected && <TenantReferenceModal property={selected} onClose={()=>setShowReferencing(false)}/>}
      {showAddProp&&<PropertyModal prop={editProp} companies={companies} onClose={()=>{setShowAddProp(false);setEditProp(null);setConvertSourceDealId(null)}} onSave={handleSaveProp}/>}
      {showBuildingMortgage && <BuildingMortgageModal
        properties={activeCoTab ? activeProperties.filter(p => p.company_id === activeCoTab) : activeProperties}
        setProperties={setProperties}
        onClose={()=>setShowBuildingMortgage(false)}
      />}
      {showReceiptScan && <Suspense fallback={null}><ReceiptScanModal
        properties={activeProperties}
        onClose={()=>setShowReceiptScan(false)}
        onSaved={()=>{ /* expense saved — no refetch needed at App level */ }}
      /></Suspense>}
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
          // Don't pretend it's saved if the API call failed — the user
          // would see "Dashboard saved" and then their changes vanish on
          // next refresh with no clue why.
          try {
            await api.saveWidgetPrefs(newPrefs)
            showToast('Dashboard saved')
          } catch (e) {
            logError('saveWidgetPrefs', e)
            showToast('Dashboard not saved — ' + (e.message || 'try again'), 'error')
          }
        }}
        onClose={() => setShowCustomizeDash(false)}
        T={T}
      />}
      {renameCoTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:600,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:420,padding:'32px 28px',border:`1px solid ${T.border}`}}>
            <div style={{fontSize:32,marginBottom:12,textAlign:'center'}}>✏️</div>
            <h2 style={{fontSize:18,fontWeight:700,textAlign:'center',marginBottom:6}}>Rename company</h2>
            <p style={{fontFamily:MONO,fontSize:12,color:T.muted,textAlign:'center',marginBottom:24}}>Currently: <strong style={{color:T.text}}>{renameCoTarget.name}</strong></p>
            <div style={{display:'grid',gap:14,marginBottom:20}}>
              <div>
                <label style={{fontFamily:MONO,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>New company name</label>
                <input value={renameCo.name} onChange={e=>setRenameCo(p=>({...p,name:e.target.value}))} autoFocus
                  style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontFamily:MONO,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Abbreviation (up to 5 chars)</label>
                <input value={renameCo.abbr} onChange={e=>setRenameCo(p=>({...p,abbr:e.target.value.toUpperCase().slice(0,5)}))} placeholder="e.g. ACME"
                  style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontFamily:MONO,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your password to confirm</label>
                <input type="password" value={renameCoPassword} onChange={e=>{setRenameCoPassword(e.target.value);setRenameCoError('')}}
                  placeholder="Enter your password"
                  style={{width:'100%',fontFamily:MONO,fontSize:13,background:T.bg,border:`1.5px solid ${renameCoError?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
                {renameCoError&&<div style={{fontFamily:MONO,fontSize:11,color:T.red,marginTop:6}}>{renameCoError}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setRenameCoTarget(null)}
                style={{flex:1,fontFamily:MONO,fontSize:12,padding:'11px',borderRadius:10,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
                Cancel
              </button>
              <button onClick={handleRenameCompany} disabled={renameCoSaving}
                style={{flex:2,fontFamily:MONO,fontSize:12,fontWeight:700,padding:'11px',borderRadius:10,border:'none',background:renameCoSaving?T.border:T.gold,color:'#1A2530',cursor:'pointer'}}>
                {renameCoSaving?'Saving…':'Save new name'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editingPayment&&<PaymentModal payment={editingPayment.payment} onClose={()=>setEditingPayment(null)} onSave={handleUpdatePayment}/>}
      {/* Access modal now lives inside Settings page */}
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

      {/* Toast: role=alert + aria-live=assertive for errors (so screen readers
          interrupt and announce), role=status + aria-live=polite for success
          notices (so they're announced without interrupting the user). */}
      {toast&&(()=>{
        // Theme-aware surface (the old hardcoded dark panels failed AA in
        // light mode, the shipped default) + clear of the mobile bottom bar
        // and iPhone safe area. Errors persist (no auto-dismiss), so always
        // offer an explicit close.
        const tint = toast.type==='error'?T.red:T.green
        return <div
          role={toast.type==='error'?'alert':'status'}
          aria-live={toast.type==='error'?'assertive':'polite'}
          aria-atomic="true"
          style={{position:'fixed',bottom:isMobile?'calc(env(safe-area-inset-bottom) + 76px)':24,right:isMobile?12:24,left:isMobile?12:'auto',zIndex:999,background:T.card,border:`1px solid ${tint}`,borderLeft:`3px solid ${tint}`,color:T.text,fontFamily:MONO,fontSize:13,fontWeight:500,padding:'12px 16px',borderRadius:10,animation:'fadeIn 0.2s ease',boxShadow:'0 6px 24px rgba(0,0,0,0.18)',display:'flex',alignItems:'center',gap:12,maxWidth:isMobile?'none':420}}>
          <span style={{flex:1}}>{toast.msg}</span>
          <button onClick={()=>setToast(null)} aria-label="Dismiss notification"
            style={{background:'none',border:'none',cursor:'pointer',color:T.muted,padding:'4px 6px',margin:'-4px -6px',fontSize:14,lineHeight:1,flexShrink:0}}>✕</button>
        </div>
      })()}

      {/* Mobile bottom nav - consistent icons, + More opens drawer */}
      <nav className="mobile-nav" aria-label="Primary" style={{display:'flex',justifyContent:'space-around',alignItems:'center'}}>
        {/* Mobile bottom-nav: 6 slots — Dashboard, the user's 3 highest-
            priority items (mobileRank from lib/nav.js, not registry
            declaration order), Settings, and More (opens the drawer with
            everything else). */}
        {(() => {
          const dash = navItems.find(n => n.key === 'dashboard')
          const settingsItem = navItems.find(n => n.key === 'settings')
          const middle = navItems
            .filter(n => n.key !== 'dashboard' && n.key !== 'settings')
            .sort((a, b) => (a.mobileRank ?? 99) - (b.mobileRank ?? 99))
            .slice(0, 3)
          return [dash, ...middle, settingsItem].filter(Boolean)
        })().map(n=>{
          const key = n.key
          const active = view===key||(view==='detail'&&key==='properties')
          return (
            <button key={key} aria-current={active?'page':undefined} onClick={()=>{setView(key);setSelectedId(null)}}
              style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
                alignItems:'center',gap:2,padding:'4px 8px',flex:1,
                color:active?T.gold:T.muted,fontFamily:MONO}}>
              <span style={{display:'flex'}}>{ICON_NAMES.includes(n.icon)?<Icon name={n.icon} size={20}/>:<span style={{fontSize:20}}>{n.icon}</span>}</span>
              <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.04em'}}>{n.short}</span>
            </button>
          )
        })}
        <button onClick={()=>setShowDrawer(true)}
          style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',
            alignItems:'center',gap:2,padding:'4px 8px',flex:1,
            color:T.muted,fontFamily:MONO}}>
          <span style={{fontSize:20}}>☰</span>
          <span style={{fontSize:9,textTransform:'uppercase',letterSpacing:'0.04em'}}>More</span>
        </button>
      </nav>

      {/* ── ADMIN DASHBOARD OVERLAY ── */}
      {showAdmin && isPlatformAdmin && (
        <Suspense fallback={<PageLoadingSpinner T={T}/>}>
          <AdminDashboard onClose={()=>setShowAdmin(false)} user={user}/>
        </Suspense>
      )}

      {/* ── ONBOARDING TOUR ── */}
      {showTour && (
        <Suspense fallback={null}>
          <OnboardingTour user={user} onComplete={()=>setShowTour(false)}/>
        </Suspense>
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

  const iconBtn = {fontFamily:MONO,fontSize:11,padding:'4px 8px',background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,cursor:'pointer',color:T.muted}

  return <div>
    <div className="card" style={{padding:'14px 18px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
      <div>
        <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Refurb Status</div>
        <div style={{fontFamily:MONO,fontSize:14,fontWeight:700,color:REFURB_CFG[prop.refurb_status]?.color||'#C8A84B'}}>{REFURB_CFG[prop.refurb_status]?.label||prop.refurb_status}</div>
      </div>
      <div style={{display:'flex',gap:20}}>
        <div style={{textAlign:'right'}}><div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>Total Cost</div><div style={{fontFamily:MONO,fontSize:16,fontWeight:700,color:T.amber}}>{fmt(totalCost)}</div></div>
        <div style={{textAlign:'right'}}><div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>Paid Out</div><div style={{fontFamily:MONO,fontSize:16,fontWeight:700,color:T.green}}>{fmt(paidCost)}</div></div>
      </div>
      <select value={prop.refurb_status} onChange={e=>onUpdateField(prop.id,'refurb_status',e.target.value)} style={{width:'auto',fontSize:11,padding:'6px 10px'}}>
        <option value="planned">Planned</option><option value="in-progress">In Progress</option><option value="complete">Complete</option>
      </select>
    </div>
    <div style={{marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Phases</div>
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
      {phases.length===0&&!showPF&&<div style={{fontFamily:MONO,fontSize:11,color:T.faint,padding:'12px 0'}}>No phases yet.</div>}
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
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{ph.name}</div>{(ph.start_date||ph.end_date)&&<div style={{fontFamily:MONO,fontSize:10,color:T.muted}}>{ph.start_date||'?'} -&gt; {ph.end_date||'ongoing'}</div>}</div>
            <button onClick={()=>onUpdatePhase(prop.id, ph.id, {done:!ph.done})} title={ph.done?'Mark in progress':'Mark complete'}
              style={{...iconBtn,color:ph.done?'#2ECC8A':'#E0943A',borderColor:(ph.done?'#2ECC8A':'#E0943A')+'44'}}>
              {ph.done?'Done':'In Progress'}
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
        <div style={{fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Trade Costs</div>
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
      {costs.length===0&&!showCF&&<div style={{fontFamily:MONO,fontSize:11,color:T.faint,padding:'12px 0'}}>No costs logged yet.</div>}
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
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{item.trade}</div>{item.notes&&<div style={{fontFamily:MONO,fontSize:10,color:T.muted}}>{item.notes}</div>}{item.date&&<div style={{fontFamily:MONO,fontSize:10,color:T.faint}}>{item.date}</div>}</div>
            <div style={{fontFamily:MONO,fontSize:14,fontWeight:700,color:item.paid?'#2ECC8A':'#E0943A'}}>{fmt(item.cost)}</div>
            <button onClick={()=>onUpdateCost(prop.id, item.id, {paid:!item.paid})} title={item.paid?'Mark unpaid':'Mark paid'}
              style={{...iconBtn,color:item.paid?'#2ECC8A':'#E0943A',borderColor:(item.paid?'#2ECC8A':'#E0943A')+'44'}}>
              {item.paid?'Paid':'Unpaid'}
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
// ─── COMPLIANCE MATRIX ───────────────────────────────────────────────────────
// Portfolio-wide certificate matrix (redesign): RAG summary tiles + a
// needs-attention list + a properties × cert-type grid. Reads each property's
// compliance_items (same data as the per-property Compliance tab).
const CERT_COLS = [['gas','Gas'],['eicr','EICR'],['epc','EPC'],['hmo','HMO'],['fire','Fire'],['pat','PAT']]
// Matrix cell status — delegates to the shared classifier in complianceStatus.js
// so the matrix and per-property surfaces can't diverge.
const complianceCell = (p, key) => certTypeStatus(p, key)
function ComplianceMatrix({ properties, companies, openDetail }) {
  const { T } = useTheme()
  const active = (properties || []).filter(p => p.status !== 'sold' && !p.archived_at)
  let expired = 0, expiring = 0, valid = 0
  active.forEach(p => CERT_COLS.forEach(([k]) => { const c = complianceCell(p, k); if (c.state === 'expired') expired++; else if (c.state === 'expiring') expiring++; else if (c.state === 'valid') valid++ }))
  const attention = active.map(p => ({ p, issues: CERT_COLS.map(([k, lbl]) => ({ lbl, ...complianceCell(p, k) })).filter(c => c.state === 'expired' || c.state === 'expiring') }))
    .filter(x => x.issues.length)
    .sort((a, b) => Math.min(...a.issues.map(i => i.days)) - Math.min(...b.issues.map(i => i.days)))
  const tiles = [{ l: 'Expired', v: expired, c: T.red }, { l: 'Expiring soon', v: expiring, c: T.amber }, { l: 'Valid', v: valid, c: T.green }]
  const cellPill = (c) => {
    if (c.state === 'missing') return <span style={{ color: T.faint, fontFamily: MONO, fontSize: 12 }}>—</span>
    const map = { expired: [T.red, 'Expired'], expiring: [T.amber, `${c.days}d`], valid: [T.green, 'Valid'] }
    const [col, txt] = map[c.state]
    return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '3px 8px', borderRadius: 999, background: col + '1A', color: col, fontFamily: MONO, fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>{txt}</span>
  }
  const GRID = 'minmax(150px,1.4fr) repeat(6, minmax(58px,1fr))'
  if (!active.length) return <div style={{ fontFamily: MONO, color: T.muted, fontSize: 12, padding: 32, textAlign: 'center' }}>No properties to track compliance for yet.</div>
  const ordered = [...companies, { id: null }].flatMap(co => active.filter(p => p.company_id === co.id).map(p => ({ ...p, _co: co })))
  return (
    <div className="fade">
      {/* RAG summary tiles */}
      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        {tiles.map(t => (
          <div key={t.l} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{t.l}</div>
            <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 500, color: t.c }}>{t.v}</div>
          </div>
        ))}
      </div>
      {/* Needs attention */}
      {attention.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 10 }}>Needs attention</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {attention.slice(0, 8).map(({ p, issues }) => (
              <div key={p.id} className="card pcard" onClick={() => openDetail(p)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{p.name}</span>
                <CompanyPill company={p.company} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  {issues.map(i => (
                    <span key={i.lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: (i.state === 'expired' ? T.red : T.amber) + '1A', color: i.state === 'expired' ? T.red : T.amber, fontFamily: MONO, fontSize: 9, fontWeight: 700 }}>
                      {i.lbl} {i.state === 'expired' ? 'expired' : `${i.days}d`}
                    </span>
                  ))}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: T.gold, whiteSpace: 'nowrap' }}>Review →</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Certificate matrix */}
      <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 14, background: T.card }}>
        <div style={{ minWidth: 640 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, background: T.card }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Property</div>
            {CERT_COLS.map(([k, l]) => <div key={k} style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>{l}</div>)}
          </div>
          {ordered.map((p, i) => {
            const prev = i > 0 ? ordered[i - 1] : null
            const showCo = !prev || prev.company_id !== p.company_id
            return (
              <div key={p.id}>
                {showCo && p._co?.id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ width: 3, height: 14, borderRadius: 2, background: p._co.color || T.gold }} />
                    <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: p._co.color || T.gold }}>{p._co.abbr}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{p._co.name}</span>
                  </div>
                )}
                <div onClick={() => openDetail(p)} className="pcard" style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '9px 14px', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}>
                  <div style={{ minWidth: 0, paddingRight: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontFamily: MONO, fontSize: 9, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.prop_type}</div>
                  </div>
                  {CERT_COLS.map(([k]) => <div key={k} style={{ textAlign: 'center' }}>{cellPill(complianceCell(p, k))}</div>)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── PROPERTY CARD GRID ──────────────────────────────────────────────────────
// Redesign card grid (design/redesign-2026). An optional browse layout alongside
// the dense list — a light card with a company-accent left edge + accent-tinted
// type-icon tile, then name / company+status pills / rent · yield · compliance.

// Derive a hairline icon + bedroom count from the free-text prop_type
// ("1-Bed Flat", "House", "HMO Room", "Studio", …). `beds` is null when the
// type doesn't state one (e.g. plain "House"); `studio` flags studios.
function propTypeMeta(propType) {
  const t = String(propType || '').toLowerCase()
  const bedM = t.match(/(\d+)\s*-?\s*bed/)
  const beds = bedM ? parseInt(bedM[1], 10) : null
  const studio = /studio|bedsit/.test(t)
  let icon = 'home'
  if (/hmo|room/.test(t)) icon = 'bed'
  else if (/flat|apartment|maisonette|studio|bedsit/.test(t)) icon = 'building'
  else if (/commercial|office|shop|retail|unit/.test(t)) icon = 'landmark'
  // house / bungalow / detached / terraced / semi / (unknown) → home
  return { icon, beds, studio }
}

function PropertyGrid({ filtered, fmt, openDetail, calcGrossYield, yieldBasis }) {
  const { T } = useTheme()
  if (!filtered.length) return <div style={{fontFamily:MONO,color:T.muted,fontSize:12,padding:32,textAlign:'center'}}>No properties match your filters.</div>
  // Compliance footer chip — one consistent pill shape for every state.
  const compliancePill = (cfg) => cfg
    ? <span title={cfg.label} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'4px 9px',borderRadius:999,background:cfg.bg,color:cfg.color,fontFamily:MONO,fontSize:9,fontWeight:700,whiteSpace:'nowrap'}}><Icon name={cfg.iconName} size={11}/>{cfg.label}</span>
    : <span title="Compliance valid" style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 9px',borderRadius:999,background:T.green+'1A',color:T.green,fontFamily:MONO,fontSize:9,fontWeight:700,whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:'50%',background:T.green}}/>Valid</span>
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14}}>
      {filtered.map(p=>{
        const co = p.company
        const accent = co?.color || T.gold
        const tm = propTypeMeta(p.prop_type)
        const cfg = complianceBadge(complianceStatusFor(p), T)
        const gy = calcGrossYield(p, yieldBasis)
        return (
          <div key={p.id} className="card pcard" onClick={()=>openDetail(p)}
            style={{cursor:'pointer',display:'flex',flexDirection:'column',gap:9,padding:'14px 15px',borderLeft:`3px solid ${accent}`}}>
            {/* Top: accent-tinted type-icon tile + name / pills / address */}
            <div style={{display:'flex',alignItems:'flex-start',gap:11,minWidth:0}}>
              <div title={p.prop_type || 'Property'} style={{position:'relative',width:38,height:38,borderRadius:10,background:accent+'1A',border:`1px solid ${accent}33`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <Icon name={tm.icon} size={19} color={accent}/>
                {(tm.beds != null || tm.studio) && (
                  <span style={{position:'absolute',bottom:-5,right:-5,minWidth:16,height:16,padding:'0 3px',borderRadius:8,background:accent,color:'#fff',fontFamily:MONO,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',border:`1.5px solid ${T.surface}`}}>
                    {tm.studio ? 'S' : tm.beds}
                  </span>
                )}
              </div>
              <div style={{flex:1,minWidth:0}}>
                {/* Name gets the full width (wraps to 2 lines); pills sit below */}
                <div style={{fontSize:14,fontWeight:700,color:T.text,lineHeight:1.3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{p.name}</div>
                <div style={{fontFamily:MONO,fontSize:10,color:T.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:3}}>{p.prop_type}{p.address?` · ${p.address}`:''}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:8}}>
                  <CompanyPill company={co}/>
                  <Badge status={p.status}/>
                </div>
              </div>
            </div>
            {/* Footer: rent / yield / compliance */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
              <div>
                <div style={{fontFamily:MONO,fontSize:8,color:T.faint,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:1}}>Rent</div>
                <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:T.text}}>{fmt(p.rent_pcm)}<span style={{fontSize:9,color:T.muted,fontWeight:400}}>/mo</span></div>
              </div>
              <div>
                <div style={{fontFamily:MONO,fontSize:8,color:T.faint,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:1}}>Yield</div>
                <div style={{fontFamily:MONO,fontSize:13,fontWeight:700,color:T.gold}}>{gy.toFixed(1)}%</div>
              </div>
              {compliancePill(cfg)}
            </div>
          </div>
        )
      })}
    </div>
  )
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
      const tail = buildingTailFromName(p.name)
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
      tail: buildingTailFromName(p.name) || null,
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
        const tail = !isCustomSort ? buildingTailFromName(p.name) : null
        const buildingSize = tail ? (buildingCounts.get(tail) || 0) : 0
        const inBuilding = buildingSize > 1
        const prevTail = prev ? buildingTailFromName(prev.name) : null
        const showBuildingHeader = inBuilding && tail !== prevTail
        // Inside a multi-unit building, drop the redundant suffix from the
        // displayed name (so "Room 1, Watts Moses House" → "Room 1").
        const displayName = inBuilding ? (String(p.name||'').split(',')[0].trim() || p.name) : p.name

        return (
        <div key={p.id}>
          {showCompanyHeader&&co&&(
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:idx>0?16:0,marginBottom:8}}>
              <div style={{width:3,height:18,background:co.color||T.gold,borderRadius:2,flexShrink:0}}/>
              <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:co.color||T.gold}}>{co.abbr}</span>
              <span style={{fontSize:13,fontWeight:600,color:T.text}}>{co.name}</span>
              <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>
                {renderItems.filter(x=>x.company_id===co.id).length} properties
              </span>
            </div>
          )}
          {showBuildingHeader&&(
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:showCompanyHeader?6:10,marginBottom:6,paddingLeft:8}}>
              <Icon name="building" size={14} color={T.muted}/>
              <span style={{fontFamily:MONO,fontSize:11,fontWeight:700,color:T.text}}>{tail}</span>
              <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>· {buildingSize} units</span>
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
              <div style={{fontFamily:MONO,fontSize:11,color:T.muted}}>
                {p.prop_type} · {p.address}
                {p.managed_by&&<span style={{marginLeft:8,color:T.faint,display:'inline-flex',alignItems:'center',gap:4,verticalAlign:'middle'}}><Icon name="building" size={11}/> {p.managed_by}</span>}
              </div>
            </div>
            {/* Stats */}
            <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap',cursor:'pointer'}} onClick={()=>openDetail(p)}>
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
                <div style={{fontFamily:MONO,fontSize:14,fontWeight:700,color:T.gold}}>{calcGrossYield(p, yieldBasis).toFixed(1)}% yield</div>
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

// ─── RENT TRACKER OVERVIEW PAGE ──────────────────────────────────────────────
function RentTrackerOverview({companies, properties, fmt, openDetail, onDayTracker, yieldBasis, onRefresh}) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const [showRentReview, setShowRentReview] = useState(false)
  const [showBankConnect, setShowBankConnect] = useState(false)
  const [showBankInbox, setShowBankInbox] = useState(false)
  // Empty array = "all companies visible". Toggle pills below the header
  // to focus on a subset; identical UX to the dashboard's dashCoFilter.
  const [coFilter, setCoFilter] = useState([])

  // Global year filter - applies to all properties
  const allPayments = properties.flatMap(p=>p.rent_payments||[])
  const allYears = [...new Set(allPayments.map(p=>p.year))].sort()
  const [globalYear, setGlobalYear] = useState(() => defaultRentYear(allPayments))
  const [expandedCompanies, setExpandedCompanies] = useState({})

  function toggleCompany(id) {
    setExpandedCompanies(prev=>({...prev,[id]:!prev[id]}))
  }

  // Per-property year stats — shared month-collapsing helper
  const getStats = getMonthlyRentStats

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
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:isMobile?8:12,marginBottom:isMobile?14:24}}>
        <div>
          <h1 style={{fontSize:isMobile?20:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:isMobile?6:8}}>Rent Tracker</h1>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {[{c:T.green,l:'Paid'},{c:STL_COLOR,l:'STL'},{c:T.red,l:'Missed'},{c:T.amber,l:'Late'},{c:T.blue,l:'Refurb'},{c:T.faint,l:'Void'}].map(x=>(
              <span key={x.l} style={{display:'flex',alignItems:'center',gap:4,fontFamily:MONO,fontSize:11,color:T.muted}}>
                <span style={{width:10,height:10,borderRadius:2,background:x.c,display:'inline-block'}}/>{x.l}
              </span>
            ))}
          </div>
        </div>
        {/* Right side: year filter + day tracker button */}
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontFamily:MONO,fontSize:10,color:T.muted,marginRight:4}}>FILTER YEAR:</span>
            {[null,...allYears].map(yr=>(
              <button key={yr||'all'} onClick={()=>setGlobalYear(yr)}
                style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${globalYear===yr?T.gold:T.border}`,
                  background:globalYear===yr?T.gold:'transparent',
                  color:globalYear===yr?'#1C2830':T.muted,transition:'all 0.18s'}}>
                {yr||'All'}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowRentReview(true)}
            title="Plan rent review"
            style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.green}`,background:T.green+'22',color:T.green,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:6}}>
            <Icon name="trending-up" size={13}/> {isMobile ? 'Review' : 'Plan rent review'}
          </button>
          <button onClick={()=>setShowBankConnect(true)}
            title="Connect bank (early access)"
            style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.blue}`,background:T.blue+'22',color:T.blue,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:6}}>
            <Icon name="landmark" size={13}/> {isMobile ? 'Bank' : 'Connect bank'}
            <span style={{fontSize:8,fontWeight:700,letterSpacing:'0.08em',padding:'1px 5px',borderRadius:3,background:T.blue+'33',color:T.blue}}>SOON</span>
          </button>
          {/* Bank Inbox hidden while Open Banking integration is paused —
              we don't yet have an approved AISP partner (GoCardless paused
              signups, TrueLayer declined). Component + edge function code
              are preserved; flip this back on once a provider is sorted.
              The Connect button stays visible because its modal gracefully
              shows a "register interest" form when no creds are set, which
              is useful for gauging demand for the feature. */}
          {false && (
            <button onClick={()=>setShowBankInbox(true)}
              title="Review bank transactions & match to rent"
              style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${T.purple || '#9B7CC8'}`,background:(T.purple || '#9B7CC8')+'22',color:T.purple || '#9B7CC8',whiteSpace:'nowrap'}}>
              📥 {isMobile ? 'Inbox' : 'Bank inbox'}
            </button>
          )}
          <button onClick={onDayTracker}
            title="Day-by-day view"
            style={{fontFamily:MONO,fontSize:11,fontWeight:700,padding:'6px 14px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.gold,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:6}}>
            <Icon name="calendar" size={13}/> {isMobile ? 'Day' : 'Day view'}
          </button>
        </div>
      </div>

      {showBankConnect && <BankConnectionsModal onClose={()=>setShowBankConnect(false)}/>}
      {showBankInbox && <BankInboxModal onClose={()=>{setShowBankInbox(false); onRefresh?.()}} properties={properties} onMatched={onRefresh}/>}

      {/* Portfolio rent summary tiles (respects the company filter + year) */}
      {(() => {
        const visCos = coFilter.length === 0 ? companies : companies.filter(c => coFilter.includes(c.id))
        const visProps = visCos.flatMap(c => properties.filter(p => p.company_id===c.id && (p.rent_payments?.length>0 || isPropertyEarningRent(p.status))))
        if (!visProps.length) return null
        const agg = visProps.reduce((a,p)=>{ const s=getStats(p.rent_payments||[], globalYear, p.rent_pcm); a.paid+=s.paid; a.paidToDate+=s.paidToDate; a.missed+=s.missed; a.late+=s.late; a.voidM+=s.voidM; a.income+=s.income; return a }, {paid:0,paidToDate:0,missed:0,late:0,voidM:0,income:0})
        // Collection rate counts VOID months against the portfolio: of every
        // month that has happened so far (paid / missed / late / void), how
        // many actually paid. Future months are excluded on both sides —
        // pre-created future voids aren't losses yet, and prepaid future STL
        // bookings aren't collections yet. Refurb months are deliberately
        // out (not lettable).
        const tracked = agg.paidToDate + agg.missed + agg.late + agg.voidM
        const rate = tracked ? Math.round((agg.paidToDate / tracked) * 100) : null
        const tiles = [
          { label: globalYear ? `Collected · ${globalYear}` : 'Collected · all years', value: fmt(agg.income), accent: T.green },
          { label: 'Collection rate', value: rate === null ? '—' : `${rate}%`, accent: rate === null ? T.muted : rate>=95?T.green:rate>=85?T.amber:T.red },
          { label: 'Months paid', value: agg.paid, accent: T.text },
          { label: 'Missed / late / void', value: `${agg.missed} / ${agg.late} / ${agg.voidM}`, accent: (agg.missed>0)?T.red:(agg.late>0)?T.amber:T.muted },
        ]
        return (
          <div className="summary-cards" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:isMobile?14:20}}>
            {tiles.map(t=>(
              <div key={t.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'16px 18px'}}>
                <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{t.label}</div>
                <div style={{fontFamily:MONO,fontSize:20,fontWeight:500,color:t.accent,letterSpacing:'-0.01em'}}>{t.value}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Company filter pills (only render if there's more than one
          company to choose from — saves vertical space for solo landlords) */}
      {companies.length > 1 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:18}}>
          <span style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:4}}>Filter:</span>
          <button onClick={()=>setCoFilter([])}
            style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
              border:`1px solid ${coFilter.length===0?T.gold:T.border}`,
              background:coFilter.length===0?T.gold:'transparent',
              color:coFilter.length===0?'#1C2830':T.muted,fontWeight:coFilter.length===0?700:400}}>
            All companies
          </button>
          {companies.map(c => {
            const sel = coFilter.includes(c.id)
            return (
              <button key={c.id}
                onClick={()=>setCoFilter(prev => {
                  if (prev.length === 0) return [c.id]  // was 'all' → focus this one
                  if (prev.includes(c.id)) {
                    const next = prev.filter(id => id !== c.id)
                    return next  // deselecting → may end up at [] = all
                  }
                  const next = [...prev, c.id]
                  return next.length === companies.length ? [] : next  // all selected → snap back to 'all'
                })}
                style={{fontFamily:MONO,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                  border:`1px solid ${sel?(c.color||T.gold):T.border}`,
                  background:sel?(c.color||T.gold)+'22':'transparent',
                  color:sel?(c.color||T.gold):T.muted}}>
                {sel?'✓ ':''}{c.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Companies — filtered by the pill row above */}
      {(coFilter.length === 0 ? companies : companies.filter(c => coFilter.includes(c.id))).map(c=>{
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
                  <span style={{fontFamily:MONO,fontSize:10,color:T.muted}}>{cps.length} properties</span>
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
                  <span key={x.l} style={{fontFamily:MONO,fontSize:11,color:x.c,fontWeight:600}}>
                    {x.v} {x.l}
                  </span>
                ))}
                <span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.gold}}>{fmt(totals.income)}</span>
                <span style={{fontFamily:MONO,fontSize:12,color:T.muted}}>{isOpen?'▲':'▼'}</span>
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

                // Natural-sort items inside each multi-unit building so
                // "Flat 1, 2, 3, 10" reads correctly instead of the
                // lexical "1, 10, 2, 3". Single-property groups are
                // untouched (the parent properties list already controls
                // their order via sort_order / name).
                for (const g of groups) {
                  if (g.items.length > 1) {
                    g.items.sort((a, b) => naturalCompare(a.name, b.name))
                  }
                }

                // Flat index for row striping across the whole company
                let rowIdx = 0
                const totalRows = cps.length

                return groups.map((group) => {
                  const isBuilding = group.items.length > 1
                  // Sum building-level totals for the header: nominal rent roll
                  // plus actual collected revenue for the selected year — the
                  // "whole block" line for multi-unit buildings (HMOs, STL
                  // blocks like Piers View).
                  const bgRent = group.items.reduce((s,p) => s + (Number(p.rent_pcm)||0), 0)
                  const bgStats = group.items.reduce((acc, p) => {
                    const s = getStats(p.rent_payments||[], globalYear, p.rent_pcm)
                    acc.income += s.income; acc.paid += s.paid; acc.missed += s.missed; acc.late += s.late
                    return acc
                  }, { income:0, paid:0, missed:0, late:0 })
                  return (
                    <div key={group.key}>
                      {isBuilding && (
                        <div style={{
                          padding: '10px 18px', background: T.bg,
                          borderBottom: `1px solid ${T.border}`,
                          display: 'flex', alignItems: 'center', gap: 10,
                          flexWrap: 'wrap',
                          fontFamily: MONO,
                        }}>
                          <span style={{ fontSize: 14 }} aria-hidden="true">🏘</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
                            {group.name}
                          </span>
                          <span style={{ fontSize: 10, color: T.muted }}>
                            · {group.items.length} units · {fmt(bgRent)}/mo
                          </span>
                          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                            {bgStats.missed > 0 && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: T.red }}>{bgStats.missed} missed</span>
                            )}
                            {bgStats.late > 0 && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: T.amber }}>{bgStats.late} late</span>
                            )}
                            <span style={{ fontSize: 10, color: T.muted }}>
                              {globalYear ? `${globalYear} revenue` : 'all-years revenue'}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: T.gold }}>
                              {fmt(bgStats.income)}
                            </span>
                          </span>
                        </div>
                      )}
                      {group.items.map((p) => {
                        const pi = rowIdx++
                        const s = getStats(p.rent_payments||[], globalYear, p.rent_pcm)
                        return (
                          <div key={p.id}
                            style={{padding:`14px 18px 14px ${isBuilding ? (isMobile ? 22 : 30) : 18}px`,borderBottom:pi<totalRows-1?`1px solid ${T.border}`:'none',
                              background:pi%2===0?T.card:T.surface,cursor:'pointer',transition:'background 0.15s',
                              borderLeft: isBuilding ? `2px solid ${T.gold}33` : 'none',
                              marginLeft: isBuilding ? (isMobile ? 10 : 14) : 0,
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
                                  {(p.arrears||0)>0&&<span style={{fontFamily:MONO,fontSize:10,color:T.red,fontWeight:700}}>⚠ {fmt(p.arrears)}</span>}
                                </div>
                                <div style={{fontFamily:MONO,fontSize:10,color:T.muted,marginBottom:6}}>
                                  {`${fmt(p.rent_pcm)}/mo`} · Due {p.rent_due_day||'-'}
                                </div>
                                <RentDots payments={p.rent_payments||[]} stlIds={stlPaymentIds(p)} filterYear={globalYear} onDayTracker={onDayTracker}/>
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
                                    <span key={x.l} style={{fontFamily:MONO,fontSize:10,color:x.v>0?x.c:T.faint}}>
                                      {x.v} {x.l}
                                    </span>
                                  ))}
                                </div>
                                <div style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:T.gold}}>
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
        <div style={{fontFamily:MONO,color:T.muted,fontSize:12,textAlign:'center',padding:40}}>
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
  const [filterYear, setFilterYear] = useState(() => defaultRentYear(payments))

  // Stats for selected year — month-collapsed via the shared helper so
  // multi-segment months (changeovers, partial payments) count once and
  // income reflects the amounts actually logged.
  const { paid, missed, late, refurb, voidM, income: totalIncome } = getMonthlyRentStats(payments, filterYear, selected.rent_pcm)
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
            <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:MONO,fontSize:18,fontWeight:700,color:item.accent||T.text}}>{item.v}</div>
          </div>
        ))}
      </div>

      {/* Payment history with year filter */}
      {payments.length>0&&<div className="card" style={{padding:'16px 20px',marginBottom:14}}>
        {/* Year filter buttons */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
            Payment History <span style={{fontSize:9}}>(click dot to update)</span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setFilterYear(null)}
              style={{fontFamily:MONO,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${filterYear===null?T.gold:T.border}`,
                background:filterYear===null?T.gold:'transparent',
                color:filterYear===null?'#1C2830':T.muted}}>All</button>
            {years.map(yr=>(
              <button key={yr} onClick={()=>setFilterYear(yr)}
                style={{fontFamily:MONO,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${filterYear===yr?T.gold:T.border}`,
                  background:filterYear===yr?T.gold:'transparent',
                  color:filterYear===yr?'#1C2830':T.muted}}>{yr}</button>
            ))}
          </div>
        </div>

        {/* Dots */}
        <RentDots payments={payments} stlIds={stlPaymentIds(selected)} onUpdate={m=>setEditingPayment({payment:m,propId:selected.id})} filterYear={filterYear} onDayTracker={onDayTracker}/>

        {/* Legend */}
        <div style={{display:'flex',gap:12,marginTop:10,flexWrap:'wrap'}}>
          {[{c:T.green,l:'Paid'},{c:STL_COLOR,l:'STL'},{c:T.red,l:'Missed'},{c:T.amber,l:'Late'},{c:T.blue,l:'Refurb'},{c:T.faint,l:'Void'}].map(x=>(
            <span key={x.l} style={{display:'flex',alignItems:'center',gap:4,fontFamily:MONO,fontSize:10,color:T.muted}}>
              <span style={{width:8,height:8,borderRadius:2,background:x.c,display:'inline-block'}}/>{x.l}
            </span>
          ))}
        </div>

        {/* Year summary */}
        <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>
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
                <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{item.l}</div>
                <div style={{fontFamily:MONO,fontSize:item.big?15:17,fontWeight:700,color:item.c}}>{item.v}</div>
                {item.sub&&<div style={{fontFamily:MONO,fontSize:9,color:T.faint,marginTop:2}}>{item.sub}</div>}
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
