import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { Icon } from '../lib/icons'
import * as api from '../lib/api'
import { isPropertyEarningRent, isPropertyOccupied } from '../lib/propertyStatus'
import { loadCdnScript } from '../lib/loadCdnScript'
import { showAppToast } from '../lib/toast'
import { BarChart, RankedBar, AreaChart, DonutChart } from '../lib/charts.jsx'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'

// Compact currency formatter for chart Y-axes — "£12k" reads better than
// "£12,000" at small sizes.
function fmtCompact(n) {
  if (n == null || n === 0) return '£0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e6) return `${sign}£${(abs/1e6).toFixed(1)}m`
  if (abs >= 1e3) return `${sign}£${Math.round(abs/1e3)}k`
  return `${sign}£${Math.round(abs)}`
}

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
const fmtPct = (n,d=1) => (n||0).toFixed(d)+'%'
const mono = "'DM Mono',monospace"
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Natural sort: company name first, then property name with numeric ordering (Flat 1, Flat 2, Flat 10)
function sortByCompanyName(props) {
  const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  return [...props].sort((a, b) => {
    const coA = a.company?.name || ''; const coB = b.company?.name || ''
    if (coA !== coB) return nat(coA, coB)
    return nat(a.name || '', b.name || '')
  })
}

// Tax year: 6 Apr → 5 Apr. Calendar: Jan → Dec
function getYearRange(year, type) {
  if (type === 'tax') return { start: new Date(`${year}-04-06`), end: new Date(`${year+1}-04-05`), label: `${year}/${String(year+1).slice(2)} Tax Year` }
  return { start: new Date(`${year}-01-01`), end: new Date(`${year}-12-31`), label: `${year} Calendar Year` }
}
function inRange(dateStr, range) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d >= range.start && d <= range.end
}
// Monthly-grid reports cap out here so a very wide (or not-yet-set) custom
// range can't render hundreds of columns.
const MAX_GRID_MONTHS = 36
// Ordered {m,y} month buckets a monthly report should show. Tax year runs
// Apr→Mar, calendar Jan→Dec, and custom spans every calendar month the range
// touches (start→end inclusive) so a custom window of any length lines up.
function periodMonths(year, yearType, range) {
  if (yearType === 'tax') return [3,4,5,6,7,8,9,10,11,0,1,2].map(m=>({m,y:m>=3?year:year+1}))
  if (yearType === 'calendar') return [0,1,2,3,4,5,6,7,8,9,10,11].map(m=>({m,y:year}))
  const out = []
  const d   = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
  const end = new Date(range.end.getFullYear(),   range.end.getMonth(),   1)
  // +1 past the cap so callers can detect "too wide" and show a notice.
  while (d <= end && out.length <= MAX_GRID_MONTHS) { out.push({ m:d.getMonth(), y:d.getFullYear() }); d.setMonth(d.getMonth()+1) }
  return out.length ? out : [{ m: range.start.getMonth(), y: range.start.getFullYear() }]
}
// Month column label: include a 2-digit year for custom ranges (which can
// cross year boundaries); tax/calendar keep the bare month name as before.
function monthLabel(m, y, yearType) {
  return yearType === 'custom' ? `${MONTHS[m]} ${String(y).slice(2)}` : MONTHS[m]
}
// Effective date of a rent payment row: prefer the dated period, fall back
// to the year/month columns (legacy rows have no period_start).
function rentPaymentDate(r) {
  if (r.period_start) return r.period_start
  if (r.year && r.month) return `${r.year}-${String(r.month).padStart(2,'0')}-01`
  return null
}
function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / (1000*60*60*24))
}

// Curated to 16 reports — May 2026. Removed 4 redundancies whose data
// is now folded into the surviving reports:
//   - "expiring_certs" → top section of Compliance
//   - "best_worst"     → Yield Comparison already ranks (and best_worst
//                        crashed at runtime on row colour logic)
//   - "open_jobs"      → top section of Maintenance Cost Report
//   - "portfolio_growth" → Equity Report covers same numbers more clearly
const REPORT_CATALOGUE = [
  { id:'pnl',          cat:'tax',         icon:'pie-chart', name:'Annual P&L',                  desc:'Collected rent vs expenses, net profit per property — HMRC-ready' },
  { id:'income_sched', cat:'tax',         icon:'calendar', name:'Rental income schedule',       desc:'Month-by-month rent received — ideal for SA105' },
  { id:'expense_breakdown', cat:'tax',    icon:'receipt', name:'Expense breakdown',            desc:'All expenses by category, ready for your accountant' },
  { id:'mortgage_interest', cat:'tax',    icon:'landmark', name:'Mortgage interest summary',    desc:'Total interest paid per property — Section 24 tax credit' },
  { id:'capital_gains', cat:'tax',        icon:'trending-up', name:'Capital gains summary',        desc:'Purchase cost vs current value, unrealised gain per property' },
  { id:'yield_compare', cat:'performance',icon:'target', name:'Yield comparison',             desc:'Gross and net yield ranked across all properties' },
  { id:'occupancy',     cat:'performance',icon:'home', name:'Occupancy rate',               desc:'Portfolio occupancy %, vacant days, void cost by property' },
  { id:'rent_collect',  cat:'performance',icon:'pound', name:'Rent collection rate',         desc:'% collected on time, late and missed payments by property' },
  { id:'cashflow',      cat:'finance',    icon:'wallet', name:'Monthly cash flow',            desc:'Real monthly rent in, all costs out, net cash month-by-month' },
  { id:'equity',        cat:'finance',    icon:'building', name:'Equity report',                desc:'Property values, debt, equity, LTV and unrealised gain per property' },
  { id:'mortgage_port', cat:'finance',    icon:'file-text', name:'Mortgage portfolio',           desc:'All mortgages, rates, terms, monthly payments and LTV ratios' },
  { id:'arrears',       cat:'finance',    icon:'alert-triangle', name:'Arrears report',               desc:'Outstanding rent by property, amount and days overdue' },
  { id:'compliance',    cat:'compliance', icon:'shield-check', name:'Compliance status',            desc:'All certificates — expired, expiring soon, valid (RAG)' },
  { id:'tenancy_sched', cat:'compliance', icon:'clipboard-check', name:'Tenancy schedule',             desc:'All tenancies, start/end dates, notice periods, renewals' },
  { id:'maintenance_report',cat:'maintenance',icon:'wrench',name:'Maintenance overview',      desc:'Open jobs, total spend by property and trade' },
  { id:'contractor_spend',cat:'maintenance',icon:'users',name:'Contractor spend',            desc:'Total paid to each contractor, job counts, average cost' },
]

const CAT_LABELS = { tax:'Tax & Accounting', performance:'Portfolio Performance', finance:'Cash Flow & Finance', compliance:'Compliance & Legal', maintenance:'Maintenance & Costs' }
const CAT_COLORS = { tax:'#4B8FE0', performance:'#2ECC8A', finance:'#C8A84B', compliance:'#9B59B6', maintenance:'#E0943A' }

export default function ReportsPage({ properties, companies, companySettings, user, selectedReportId, onSelectReport }) {
  const { T } = useTheme()
  // Local view state: 'catalogue' shows the grid of reports, 'report'
  // shows a specific report's content. Driven by the selectedReportId
  // prop (which is URL-synced) when provided — falls back to local state
  // so older callers / tests still work.
  const [localActiveReport, setLocalActiveReport] = useState(null)
  // Resolve the "active" report from the controlled prop if present.
  // The catalogue is shown whenever selectedReportId is null/undefined.
  const activeReport = selectedReportId
    ? (REPORT_CATALOGUE.find(r => r.id === selectedReportId) || null)
    : localActiveReport
  const view = activeReport ? 'report' : 'catalogue'
  const [catFilter, setCatFilter] = useState('all')
  const [selectedCompany, setSelectedCompany] = useState('all')
  const [yearType, setYearType] = useState('tax')
  const [year, setYear]         = useState(new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1)
  // Custom reporting period (ISO yyyy-mm-dd). Only used when yearType==='custom'.
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd]     = useState('')

  // All data
  const [compliance, setCompliance]   = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [tenancies, setTenancies]     = useState([])
  const [rentPayments, setRentPayments] = useState([])
  const [expenses, setExpenses]       = useState([])
  const [loading, setLoading]         = useState(false)
  const [dataLoaded, setDataLoaded]   = useState(false)
  const [loadErrors, setLoadErrors]   = useState([])

  // Load all data once on mount
  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    // Each dataset is fetched independently so one failure doesn't blank
    // every report — failures are surfaced instead of swallowed.
    const sources = [
      { label: 'compliance',    fetch: () => api.fetchAllComplianceItems(user.id), set: setCompliance },
      { label: 'maintenance',   fetch: () => api.fetchAllMaintenanceJobs(user.id), set: setMaintenance },
      { label: 'tenancies',     fetch: () => api.fetchAllTenancies(user.id),       set: setTenancies },
      { label: 'rent payments', fetch: () => api.fetchAllRentPayments(user.id),    set: setRentPayments },
      { label: 'expenses',      fetch: () => api.fetchAllExpenses(user.id),        set: setExpenses },
    ]
    const results = await Promise.allSettled(sources.map(s => s.fetch()))
    const failed = []
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') sources[i].set(res.value || [])
      else { console.error(`Reports: failed to load ${sources[i].label}`, res.reason); failed.push(sources[i].label) }
    })
    setLoadErrors(failed)
    setDataLoaded(true)
    setLoading(false)
  }

  // Internal yearType is 'tax' | 'calendar' | 'custom'. The settings table
  // stores the longer vocabulary ('tax_year' | 'calendar_year' | 'custom'),
  // and some legacy rows hold the short form — normalise both on the way in.
  function normType(t) {
    if (t === 'tax_year' || t === 'tax') return 'tax'
    if (t === 'calendar_year' || t === 'calendar') return 'calendar'
    if (t === 'custom') return 'custom'
    return 'tax'
  }
  const STORE_TYPE = { tax: 'tax_year', calendar: 'calendar_year', custom: 'custom' }

  // Load the saved reporting period from company settings when company changes.
  useEffect(() => {
    if (selectedCompany !== 'all') {
      const cs = companySettings?.[selectedCompany]
      if (cs?.year_type) {
        setYearType(normType(cs.year_type))
        setCustomStart(cs.custom_period_start || '')
        setCustomEnd(cs.custom_period_end || '')
      }
    }
  }, [selectedCompany, companySettings])

  // Persist the current selection back to the company (no-op for "all").
  async function persistPeriod(internalType, start, end) {
    if (selectedCompany === 'all') return
    if (internalType === 'custom') {
      const base = companySettings?.[selectedCompany] || {}
      await api.upsertCompanySettings(selectedCompany, {
        ...base, year_type: 'custom',
        custom_period_start: start || null,
        custom_period_end: end || null,
      }).catch(()=>{})
    } else {
      await api.saveCompanyYearType(selectedCompany, STORE_TYPE[internalType]).catch(()=>{})
    }
  }

  function saveYearType(type) {
    setYearType(type)
    persistPeriod(type, customStart, customEnd)
  }

  function saveCustomDates(start, end) {
    setCustomStart(start); setCustomEnd(end); setYearType('custom')
    persistPeriod('custom', start, end)
  }

  const range = useMemo(() => {
    if (yearType === 'custom') {
      // Missing bounds open out to a wide window so a half-set range still
      // renders rather than blanking every report.
      const s = customStart || '2000-01-01'
      const e = customEnd   || '2100-12-31'
      const fmtD = iso => new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      return { start: new Date(s), end: new Date(e), label: `${fmtD(s)} — ${fmtD(e)}` }
    }
    return getYearRange(year, yearType)
  }, [year, yearType, customStart, customEnd])

  // Filtered by company
  const filtProps = useMemo(() => sortByCompanyName(selectedCompany === 'all' ? properties : properties.filter(p => p.company_id === selectedCompany)), [properties, selectedCompany])
  const filtExp   = useMemo(() => expenses.filter(e => (selectedCompany==='all'||e.property?.company_id===selectedCompany) && inRange(e.date, range)), [expenses, selectedCompany, range])
  const filtRent  = useMemo(() => rentPayments.filter(r => (selectedCompany==='all'||r.property?.company_id===selectedCompany) && inRange(rentPaymentDate(r), range)), [rentPayments, selectedCompany, range])
  const filtComp  = useMemo(() => compliance.filter(c => selectedCompany==='all'||c.property?.company_id===selectedCompany), [compliance, selectedCompany])
  const filtMaint = useMemo(() => maintenance.filter(m => selectedCompany==='all'||m.property?.company_id===selectedCompany), [maintenance, selectedCompany])
  const filtTen   = useMemo(() => tenancies.filter(t => selectedCompany==='all'||t.property?.company_id===selectedCompany), [tenancies, selectedCompany])

  // Open a specific report. If a parent supplied onSelectReport (the URL
  // sync) we delegate so the URL stays in sync and browser back works.
  // Otherwise fall back to local state.
  function openReport(report) {
    if (onSelectReport) onSelectReport(report.id)
    else setLocalActiveReport(report)
  }
  function backToCatalogue() {
    if (onSelectReport) onSelectReport(null)
    else setLocalActiveReport(null)
  }

  const co = companies.find(c => c.id === selectedCompany)
  const cs = companySettings?.[selectedCompany] || {}

  // Shown in both views when one or more datasets failed to load, so a
  // partial failure never masquerades as "no data".
  const errorBanner = loadErrors.length > 0 && (
    <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',background:T.red+'18',border:`1px solid ${T.red}44`,borderRadius:10,padding:'10px 16px',marginBottom:16}}>
      <span style={{fontFamily:mono,fontSize:11,color:T.red,flex:1}}>Couldn't load: {loadErrors.join(', ')} — figures shown may be incomplete.</span>
      <button onClick={loadAll} disabled={loading}
        style={{fontFamily:mono,fontSize:11,fontWeight:700,padding:'5px 14px',borderRadius:8,border:`1px solid ${T.red}`,background:'transparent',color:T.red,cursor:loading?'wait':'pointer'}}>
        {loading ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )

  // ── CATALOGUE VIEW ──────────────────────────────────────────────────────────
  if (view === 'catalogue') {
    const cats = catFilter === 'all' ? Object.keys(CAT_LABELS) : [catFilter]
    return (
      <div className="fade">
        {errorBanner}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:24}}>
          <div>
            <h1 style={{fontSize:28,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Reports & Analytics</h1>
            <p style={{fontFamily:mono,color:T.muted,fontSize:12}}>{REPORT_CATALOGUE.length} reports available · click any report to open full screen</p>
          </div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
            {companies.length > 1 && (
              <select value={selectedCompany} onChange={e=>setSelectedCompany(e.target.value)}
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 12px'}}>
                <option value="all">All companies</option>
                {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <select value={year} onChange={e=>setYear(Number(e.target.value))}
              title="Tax year applied to the Year-End Pack"
              style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 12px'}}>
              {[2022,2023,2024,2025,2026,2027].map(y=><option key={y} value={y}>{getYearRange(y,yearType).label}</option>)}
            </select>
            <YearEndPackButton
              filtProps={filtProps} filtExp={filtExp} filtRent={filtRent}
              filtComp={filtComp} filtMaint={filtMaint} filtTen={filtTen}
              range={range} year={year} yearType={yearType} co={co} cs={cs}
              T={T}/>
          </div>
        </div>

        {/* Category filter pills */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:24}}>
          <button onClick={()=>setCatFilter('all')} style={{fontFamily:mono,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',border:`1px solid ${catFilter==='all'?T.gold:T.border}`,background:catFilter==='all'?T.gold+'22':'transparent',color:catFilter==='all'?T.gold:T.muted}}>All reports</button>
          {Object.entries(CAT_LABELS).map(([k,l])=>(
            <button key={k} onClick={()=>setCatFilter(k)} style={{fontFamily:mono,fontSize:11,padding:'5px 14px',borderRadius:20,cursor:'pointer',border:`1px solid ${catFilter===k?CAT_COLORS[k]:T.border}`,background:catFilter===k?CAT_COLORS[k]+'22':'transparent',color:catFilter===k?CAT_COLORS[k]:T.muted}}>{l}</button>
          ))}
        </div>

        {cats.map(cat => (
          <div key={cat} style={{marginBottom:28}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
              <div style={{width:3,height:20,borderRadius:2,background:CAT_COLORS[cat]}}/>
              <h2 style={{fontSize:16,fontWeight:700,color:T.text,margin:0}}>{CAT_LABELS[cat]}</h2>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
              {REPORT_CATALOGUE.filter(r=>r.cat===cat).map(report=>(
                <div key={report.id}
                  onClick={()=>openReport(report)}
                  style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'18px 20px',cursor:'pointer',transition:'all 0.18s',borderLeft:`3px solid ${CAT_COLORS[cat]}`}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <span style={{width:38,height:38,borderRadius:9,background:CAT_COLORS[cat]+'18',display:'flex',alignItems:'center',justifyContent:'center'}}><Icon name={report.icon} size={19} color={CAT_COLORS[cat]}/></span>
                    <span style={{fontFamily:mono,fontSize:9,color:CAT_COLORS[cat],background:CAT_COLORS[cat]+'18',padding:'2px 8px',borderRadius:10,textTransform:'uppercase',letterSpacing:'0.08em'}}>{CAT_LABELS[cat].split(' ')[0]}</span>
                  </div>
                  <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:5}}>{report.name}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.6}}>{report.desc}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:CAT_COLORS[cat],marginTop:12}}>View report →</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── REPORT FULL SCREEN ──────────────────────────────────────────────────────
  const years = [2022,2023,2024,2025,2026,2027]
  const accent = activeReport ? CAT_COLORS[activeReport.cat] : T.gold

  return (
    <div className="fade">
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <button onClick={backToCatalogue} style={{fontFamily:mono,fontSize:11,background:'none',border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>← All Reports</button>
        <div style={{flex:1}}>
          <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.02em',margin:0,display:'flex',alignItems:'center',gap:10}}>{activeReport&&<Icon name={activeReport.icon} size={22} color={accent}/>} {activeReport?.name}</h1>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {companies.length > 1 && (
            <select value={selectedCompany} onChange={e=>setSelectedCompany(e.target.value)}
              style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 12px'}}>
              <option value="all">All companies</option>
              {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {/* Year type toggle */}
          <div style={{display:'flex',background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden'}}>
            {[['tax','Tax year'],['calendar','Calendar'],['custom','Custom']].map(([k,l])=>(
              <button key={k} onClick={()=>saveYearType(k)} style={{fontFamily:mono,fontSize:11,padding:'7px 14px',border:'none',cursor:'pointer',background:yearType===k?accent+'22':'transparent',color:yearType===k?accent:T.muted,fontWeight:yearType===k?700:400}}>{l}</button>
            ))}
          </div>
          {yearType==='custom' ? (
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <input type="date" value={customStart} max={customEnd||undefined}
                onChange={e=>{
                  const s=e.target.value
                  if(customEnd && s && s>customEnd) return
                  saveCustomDates(s, customEnd)
                }}
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'6px 10px'}}/>
              <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>—</span>
              <input type="date" value={customEnd} min={customStart||undefined}
                onChange={e=>{
                  const en=e.target.value
                  if(customStart && en && en<customStart) return
                  saveCustomDates(customStart, en)
                }}
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'6px 10px'}}/>
            </div>
          ) : (
            <select value={year} onChange={e=>setYear(Number(e.target.value))}
              style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 12px'}}>
              {years.map(y=><option key={y} value={y}>{getYearRange(y,yearType).label}</option>)}
            </select>
          )}
          <ExportButtons reportId={activeReport?.id} filtProps={filtProps} filtExp={filtExp} filtRent={filtRent} filtComp={filtComp} filtMaint={filtMaint} filtTen={filtTen} range={range} companies={companies} co={co} cs={cs} T={T} accent={accent} reportName={activeReport?.name}/>
        </div>
      </div>

      {/* Range label */}
      <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20}}>
        {range.label} · {filtProps.length} {filtProps.length===1?'property':'properties'}{selectedCompany!=='all'?` · ${co?.name}`:''}
        {selectedCompany!=='all' && (
          <button onClick={()=>saveYearType(yearType)} style={{fontFamily:mono,fontSize:10,color:accent,background:'none',border:`1px solid ${accent}44`,borderRadius:4,padding:'1px 8px',marginLeft:10,cursor:'pointer'}}>Save year type for {co?.name}</button>
        )}
      </div>

      {errorBanner}
      {loading && <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:40,textAlign:'center'}}>Loading report data…</div>}
      {!loading && <ReportBody id={activeReport?.id} filtProps={filtProps} filtExp={filtExp} filtRent={filtRent} filtComp={filtComp} filtMaint={filtMaint} filtTen={filtTen} range={range} year={year} yearType={yearType} T={T} accent={accent} fmt={fmt} fmtPct={fmtPct}/>}
    </div>
  )
}

// ── REPORT BODY ROUTER ────────────────────────────────────────────────────────
function ReportBody({ id, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range, year, yearType, T, accent, fmt, fmtPct }) {
  const props = { filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range, year, yearType, T, accent, fmt, fmtPct }
  const map = {
    pnl: <ReportPnL {...props}/>,
    income_sched: <ReportIncomeSchedule {...props}/>,
    expense_breakdown: <ReportExpenseBreakdown {...props}/>,
    mortgage_interest: <ReportMortgageInterest {...props}/>,
    capital_gains: <ReportCapitalGains {...props}/>,
    yield_compare: <ReportYieldComparison {...props}/>,
    occupancy: <ReportOccupancy {...props}/>,
    rent_collect: <ReportRentCollection {...props}/>,
    cashflow: <ReportCashFlow {...props}/>,
    equity: <ReportEquity {...props}/>,
    mortgage_port: <ReportMortgagePortfolio {...props}/>,
    arrears: <ReportArrears {...props}/>,
    compliance: <ReportCompliance {...props}/>,
    tenancy_sched: <ReportTenancySchedule {...props}/>,
    maintenance_report: <ReportMaintenance {...props}/>,
    contractor_spend: <ReportContractorSpend {...props}/>,
  }
  return map[id] || <div style={{fontFamily:mono,fontSize:12,color:'#999',padding:40,textAlign:'center'}}>Report not found</div>
}

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────
function StatCards({ items, T }) {
  return (
    <div style={{display:'grid',gridTemplateColumns:`repeat(${Math.min(items.length,4)},1fr)`,gap:12,marginBottom:24}}>
      {items.map((item,i)=>(
        <div key={i} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:12,padding:'16px 18px'}}>
          <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{item.label}</div>
          <div style={{fontSize:22,fontWeight:700,color:item.color||T.gold,letterSpacing:'-0.02em'}}>{item.value}</div>
          {item.sub && <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:3}}>{item.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function ReportTable({ headers, rows, T, accent }) {
  if (!rows.length) return <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:32,textAlign:'center',background:T.card,border:`1px solid ${T.border}`,borderRadius:12}}>No data for this period</div>
  return (
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:headers.map(h=>h.width||'1fr').join(' '),gap:16,background:T.bg,borderBottom:`1px solid ${T.border}`,padding:'10px 20px'}}>
        {headers.map((h,i)=><div key={i} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',textAlign:h.right?'right':'left'}}>{h.label}</div>)}
      </div>
      {rows.map((row,ri)=>(
        <div key={ri} style={{display:'grid',gridTemplateColumns:headers.map(h=>h.width||'1fr').join(' '),gap:16,padding:'11px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
          {row.map((cell,ci)=>(
            <div key={ci} style={{fontFamily:mono,fontSize:12,color:typeof cell==='object'?cell.color||T.text:T.text,textAlign:headers[ci]?.right?'right':'left',fontWeight:typeof cell==='object'&&cell.bold?700:400}}>
              {typeof cell==='object'?cell.v:cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ title, T }) {
  return <h2 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:14,marginTop:24}}>{title}</h2>
}

// Card wrapper for in-app charts — keeps visual rhythm with StatCards
// and ReportTable.
function ChartCard({ title, T, children, padding = '16px 18px 20px' }) {
  return (
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding,marginBottom:18}}>
      {title && (
        <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

// ── EXPORT BUTTONS ────────────────────────────────────────────────────────────
// Neutralise CSV formula injection: a cell starting with = + - @ or a tab
// executes as a formula in Excel/Sheets. Prefix a quote unless the value is
// a plain number (negative amounts must stay numeric).
function csvSafe(v) {
  const s = String(v == null ? '' : v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) return "'" + s
  return s
}

function ExportButtons({ reportId, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range, companies, co, cs, T, accent, reportName }) {
  const [exporting, setExporting] = useState(false)
  function exportCSV() {
    const rows = buildCSVRows(reportId, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range)
    if (!rows) return
    const csv = rows.map(r=>r.map(v=>`"${csvSafe(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`${reportId}-${range.label}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  async function exportPDF() {
    setExporting(true)
    try {
      const data = buildReportData(reportId, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range)
      await renderReportPDF({
        ...data,
        reportName: reportName || data.title,
        company: co?.name || 'All companies',
        period: range.label,
        // Use the company's brand colour if set; otherwise fall back to the
        // report category's accent (gold for tax, green for performance,
        // etc) — matches the in-app catalogue card colour.
        companyColor: co?.color,
        categoryAccent: accent,
        logoUrl: cs?.logo_url,
      })
    } catch(e) { console.error('PDF export failed', e); showAppToast('PDF export failed — ' + (e?.message || 'unknown'), 'error') }
    setExporting(false)
  }
  return (
    <div style={{display:'flex',gap:8}}>
      <button onClick={exportPDF} disabled={exporting}
        style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.gold,cursor:exporting?'wait':'pointer',fontWeight:700}}>
        {exporting?'Generating...':'↓ PDF'}
      </button>
      <button onClick={exportCSV} style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>↓ CSV</button>
    </div>
  )
}

// ── YEAR-END TAX PACK ─────────────────────────────────────────────────────────
// One button → one PDF containing the 5 HMRC-relevant reports as
// sections, each on its own page run. Lands at the top of the
// catalogue so accountants don't have to download 5 separate files.
const TAX_PACK_REPORTS = ['pnl','income_sched','expense_breakdown','mortgage_interest','capital_gains','tenancy_sched']

function YearEndPackButton({ filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range, year, yearType, co, cs, T }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      await renderYearEndPackPDF({
        reports: TAX_PACK_REPORTS.map(id => ({
          id,
          name: REPORT_CATALOGUE.find(r => r.id === id)?.name || id,
          data: buildReportData(id, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range),
        })),
        company: co?.name || 'All companies',
        companyColor: co?.color,
        logoUrl: cs?.logo_url,
        period: range.label,
      })
    } catch (e) {
      console.error('Year-End Pack export failed', e)
      showAppToast('Could not generate the pack — ' + (e?.message || 'unknown error'), 'error')
    }
    setBusy(false)
  }
  return (
    <button onClick={run} disabled={busy}
      title="Bundle the 5 HMRC tax reports into one PDF"
      style={{
        fontFamily:mono, fontSize:11, padding:'8px 14px', borderRadius:8,
        border:`1px solid ${T.gold}`, background:T.gold,
        color:'#0B0D14', cursor:busy?'wait':'pointer', fontWeight:700,
        whiteSpace:'nowrap',
      }}>
      {busy ? 'Generating pack…' : 'Year-End Tax Pack'}
    </button>
  )
}

// ── BUILD REPORT DATA ─────────────────────────────────────────────────────────
function buildReportData(id, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range) {
  switch(id) {
    case 'pnl': {
      const hasPaid = filtRent.some(r => r.status === 'paid')
      const rows = filtProps.map(p => {
        const rent = hasPaid
          ? filtRent.filter(r => r.property_id === p.id && r.status === 'paid').reduce((s,r) => s + (r.amount || 0), 0)
          : (isPropertyEarningRent(p.status) ? (p.rent_pcm||0)*12 : 0)
        const exp = filtExp.filter(e=>e.property_id===p.id).reduce((s,e)=>s+(e.amount||0),0)
        return { name:p.name, rent, exp, net:rent-exp, yield:p.est_value?((p.rent_pcm||0)*12/p.est_value*100):0 }
      }).sort((a,b)=>b.net-a.net)
      const tR=rows.reduce((s,r)=>s+r.rent,0), tE=rows.reduce((s,r)=>s+r.exp,0)
      return { title:'Annual P&L', kpis:[['Total income',fmt(tR)],['Total expenses',fmt(tE)],['Net profit',fmt(tR-tE)],['Net margin',tR>0?fmtPct((tR-tE)/tR*100):'—']], headers:['Property','Annual Rent','Expenses','Net Profit','Gross Yield'], rows:rows.map(r=>[r.name,fmt(r.rent),fmt(r.exp),fmt(r.net),r.yield>0?fmtPct(r.yield):'—']), totals:['Total',fmt(tR),fmt(tE),fmt(tR-tE),''] }
    }
    case 'income_sched': {
      const pRows = filtProps.map(p=>({name:p.name,rent:(p.rent_pcm||0)*12}))
      const total = pRows.reduce((s,r)=>s+r.rent,0)
      return { title:'Rental Income Schedule', kpis:[['Total income',fmt(total)],['Monthly average',fmt(Math.round(total/12))],['Properties',filtProps.length.toString()]], headers:['Property','Monthly Rent','Annual Rent'], rows:pRows.map(r=>[r.name,fmt(r.rent/12),fmt(r.rent)]), totals:['Total',fmt(total/12),fmt(total)] }
    }
    case 'expense_breakdown': {
      const byCat = filtExp.reduce((a,e)=>{a[e.category||'Other']=(a[e.category||'Other']||0)+(e.amount||0);return a},{})
      const cats = Object.entries(byCat).sort((a,b)=>b[1]-a[1])
      const total = cats.reduce((s,[,v])=>s+v,0)
      return { title:'Expense Breakdown', kpis:[['Total expenses',fmt(total)],['Largest category',cats[0]?cats[0][0]:'—'],['Items',filtExp.length.toString()]], headers:['Category','Amount','% of Total','Items'], rows:cats.map(([cat,amt])=>[cat,fmt(amt),fmtPct(amt/total*100),filtExp.filter(e=>(e.category||'Other')===cat).length.toString()]), totals:['Total',fmt(total),'100%',filtExp.length.toString()] }
    }
    case 'mortgage_interest': {
      // For interest-only mortgages: annual_interest = balance × rate.
      // For repayment mortgages we approximate year-one interest at the
      // same level (true value declines as principal is paid down — the
      // first-year approximation is what most accountants want for
      // Section 24 planning; recommend re-running annually).
      // mortgage_rate is stored as a DECIMAL (e.g. 0.05 for 5%) per
      // PropertyModal which divides user input by 100 before saving.
      // Do NOT divide by 100 again here.
      const rows = filtProps.filter(p=>p.mortgage_amount&&p.mortgage_rate).map(p => {
        const annual = p.mortgage_amount * p.mortgage_rate
        const kind = p.mortgage_type === 'interest_only' ? 'interest-only' : 'repayment'
        return { name:p.name, loan:p.mortgage_amount, rate:p.mortgage_rate, kind, annual, credit:annual*0.2 }
      })
      const tI=rows.reduce((s,r)=>s+r.annual,0), tC=rows.reduce((s,r)=>s+r.credit,0)
      return { title:'Mortgage Interest Summary', note:'Section 24: mortgage interest receives a 20% tax credit, not a deduction. Repayment figures are year-one approximations.', kpis:[['Total interest',fmt(tI)],['20% tax credit',fmt(tC)],['Mortgaged properties',rows.length.toString()]], headers:['Property','Loan Amount','Rate','Type','Annual Interest','20% Credit'], rows:rows.map(r=>[r.name,fmt(r.loan),fmtPct(r.rate*100),r.kind,fmt(r.annual),fmt(r.credit)]), totals:['Total','','','',fmt(tI),fmt(tC)] }
    }
    case 'capital_gains': {
      const rows = filtProps.map(p=>{const c=(p.purchase_price||0)+(p.refurb_cost||0)+(p.stamp_duty||0)+(p.legal_fees||0);return{name:p.name,cost:c,val:p.est_value||0,gain:(p.est_value||0)-c}}).sort((a,b)=>b.gain-a.gain)
      const tC=rows.reduce((s,r)=>s+r.cost,0),tV=rows.reduce((s,r)=>s+r.val,0)
      return { title:'Capital Gains Summary', note:'Unrealised gains based on estimated values. Consult your accountant for CGT planning.', kpis:[['Cost base',fmt(tC)],['Portfolio value',fmt(tV)],['Unrealised gain',fmt(tV-tC)]], headers:['Property','Cost Base','Est. Value','Gain','Gain %'], rows:rows.map(r=>[r.name,fmt(r.cost),fmt(r.val),fmt(r.gain),r.cost>0?fmtPct(r.gain/r.cost*100):'—']), totals:['Total',fmt(tC),fmt(tV),fmt(tV-tC),''] }
    }
    case 'yield_compare': {
      const rows = filtProps.map(p=>{const gy=p.est_value&&p.rent_pcm?((p.rent_pcm*12)/p.est_value)*100:0;return{name:p.name,rent:p.rent_pcm||0,val:p.est_value||0,gy}}).sort((a,b)=>b.gy-a.gy)
      const avg = rows.length?rows.reduce((s,r)=>s+r.gy,0)/rows.length:0
      return { title:'Yield Comparison', kpis:[['Average gross yield',fmtPct(avg)],['Best performer',rows[0]?.name||'—'],['Highest yield',rows[0]?fmtPct(rows[0].gy):'—']], headers:['#','Property','Monthly Rent','Est. Value','Gross Yield'], rows:rows.map((r,i)=>[(i+1).toString(),r.name,fmt(r.rent),fmt(r.val),r.gy>0?fmtPct(r.gy):'—']) }
    }
    case 'occupancy': {
      const rented=filtProps.filter(p=>isPropertyEarningRent(p.status)).length,vacant=filtProps.filter(p=>p.status==='vacant').length,rate=filtProps.length>0?(rented/filtProps.length)*100:0
      return { title:'Occupancy Rate Report', kpis:[['Occupancy rate',fmtPct(rate)],['Rented',rented.toString()],['Vacant',vacant.toString()]], headers:['Property','Status','Monthly Rent','Occupied'], rows:filtProps.map(p=>[p.name,p.status||'—',fmt(p.rent_pcm),isPropertyEarningRent(p.status)?'Yes':'No']) }
    }
    case 'rent_collect': {
      const expected=filtProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0)*12,0)
      const collected=filtRent.filter(r=>r.status==='paid').reduce((s,r)=>s+(r.amount||0),0)
      const lateCol=filtRent.filter(r=>r.status==='late'||r.status==='partial').reduce((s,r)=>s+(r.amount||0),0)
      const missed=filtRent.filter(r=>r.status==='overdue'||r.status==='missed').length
      const rate=expected>0?((collected+lateCol)/expected)*100:100
      const rows=filtProps.filter(p=>isPropertyEarningRent(p.status)).map(p=>{
        const own=filtRent.filter(r=>r.property_id===p.id)
        return { name:p.name, expected:(p.rent_pcm||0)*12,
          paid:own.filter(r=>r.status==='paid').reduce((s,r)=>s+(r.amount||0),0),
          late:own.filter(r=>r.status==='late').length,
          missed:own.filter(r=>r.status==='overdue'||r.status==='missed').length }
      })
      return { title:'Rent Collection Rate', kpis:[['Collection rate',fmtPct(rate)],['Expected',fmt(expected)],['Collected on time',fmt(collected)],['Missed payments',missed.toString()]],
        headers:['Property','Expected','Collected','Late','Missed'],
        rows:rows.map(r=>[r.name,fmt(r.expected),fmt(r.paid),r.late.toString(),r.missed.toString()]),
        totals:['Total',fmt(expected),fmt(collected),'',missed.toString()] }
    }
    case 'cashflow': {
      // Use real per-month data — same logic as the in-app component.
      const hasPaid = filtRent.some(r => r.status === 'paid')
      const monthRent = MONTHS.map((_, m) =>
        hasPaid
          ? filtRent.filter(r => r.status === 'paid' && r.month === (m + 1))
            .reduce((s,r) => s + (r.amount || 0), 0)
          : filtProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0)
      )
      const monthExp = MONTHS.map((_, m) =>
        filtExp.filter(e => e.date && new Date(e.date).getMonth() === m).reduce((s,e)=>s+(e.amount||0),0)
      )
      const tR = monthRent.reduce((s,v)=>s+v,0), tE = monthExp.reduce((s,v)=>s+v,0)
      return { title:'Monthly Cash Flow', kpis:[['Total income',fmt(tR)],['Total outgoings',fmt(tE)],['Net cash flow',fmt(tR-tE)]], headers:['Month','Rent Income','Expenses','Net Cash Flow'], rows:MONTHS.map((m,i)=>[m,fmt(monthRent[i]),fmt(monthExp[i]),fmt(monthRent[i]-monthExp[i])]), totals:['Total',fmt(tR),fmt(tE),fmt(tR-tE)] }
    }
    case 'equity': {
      const rows=filtProps.map(p=>({name:p.name,val:p.est_value||0,debt:p.mortgage_amount||0,eq:(p.est_value||0)-(p.mortgage_amount||0),ltv:p.est_value?((p.mortgage_amount||0)/p.est_value)*100:0})).sort((a,b)=>b.eq-a.eq)
      const t=rows.reduce((s,r)=>({v:s.v+r.val,d:s.d+r.debt,e:s.e+r.eq}),{v:0,d:0,e:0})
      return { title:'Equity Report', kpis:[['Portfolio value',fmt(t.v)],['Total debt',fmt(t.d)],['Total equity',fmt(t.e)],['Portfolio LTV',t.v>0?fmtPct(t.d/t.v*100):'—']], headers:['Property','Est. Value','Mortgage','Equity','LTV'], rows:rows.map(r=>[r.name,fmt(r.val),fmt(r.debt),fmt(r.eq),r.ltv>0?fmtPct(r.ltv):'—']), totals:['Total',fmt(t.v),fmt(t.d),fmt(t.e),''] }
    }
    case 'mortgage_port': {
      // mortgage_rate stored as decimal (0.05). monthly = P × r/12 × (1+r/12)^n / ((1+r/12)^n - 1)
      const rows=filtProps.filter(p=>p.mortgage_amount>0).map(p=>{
        const r12 = (p.mortgage_rate||0)/12
        const n = (p.mortgage_term||25)*12
        const m = p.mortgage_rate&&p.mortgage_amount
          ? Math.round(p.mortgage_amount * r12 * Math.pow(1+r12,n) / (Math.pow(1+r12,n) - 1))
          : 0
        return {name:p.name,loan:p.mortgage_amount,rate:p.mortgage_rate,term:p.mortgage_term,monthly:m,ltv:p.est_value?((p.mortgage_amount||0)/p.est_value)*100:0}
      })
      return { title:'Mortgage Portfolio Summary', kpis:[['Total debt',fmt(rows.reduce((s,r)=>s+r.loan,0))],['Monthly repayments',fmt(rows.reduce((s,r)=>s+r.monthly,0))],['Mortgaged properties',rows.length.toString()]], headers:['Property','Loan Amount','Rate','Term','Monthly','LTV'], rows:rows.map(r=>[r.name,fmt(r.loan),fmtPct((r.rate||0)*100),r.term?r.term+'y':'—',fmt(r.monthly),r.ltv>0?fmtPct(r.ltv):'—']) }
    }
    case 'arrears': {
      const rows=filtProps.filter(p=>(p.arrears||0)>0).map(p=>({name:p.name,arrears:p.arrears||0,rent:p.rent_pcm||0})).sort((a,b)=>b.arrears-a.arrears)
      const total=rows.reduce((s,r)=>s+r.arrears,0)
      return { title:'Arrears Report', kpis:[['Properties in arrears',rows.length.toString()],['Total arrears',fmt(total)],['Clear properties',(filtProps.length-rows.length).toString()]], headers:['Property','Arrears Amount','Monthly Rent','Status'], rows:rows.length?rows.map(r=>[r.name,fmt(r.arrears),fmt(r.rent),'Overdue']):[['No arrears','','','All clear']] }
    }
    case 'compliance': {
      const rows=filtComp.map(c=>{const d=daysUntil(c.expiry_date);return{prop:c.property?.name||'—',type:c.item_type||c.type||'—',expiry:c.expiry_date||'—',days:d,status:!c.expiry_date?'No date':d<0?'EXPIRED':d<=60?'Expiring':'Valid'}}).sort((a,b)=>(a.days||999)-(b.days||999))
      const expired=rows.filter(r=>r.status==='EXPIRED').length,expiring=rows.filter(r=>r.status==='Expiring').length
      return { title:'Compliance Status', kpis:[['Expired',expired.toString()],['Expiring <60 days',expiring.toString()],['Valid',rows.filter(r=>r.status==='Valid').length.toString()],['Total',rows.length.toString()]], headers:['Property','Certificate','Expiry Date','Days','Status'], rows:rows.map(r=>[r.prop,r.type,r.expiry,r.days!=null?r.days.toString():'—',r.status]) }
    }
    case 'tenancy_sched': {
      const rows=filtTen.map(t=>({prop:t.property?.name||'—',tenant:t.tenant_name||'—',start:t.start_date||'—',end:t.end_date||'Rolling',rent:t.property?.rent_pcm||0,days:t.end_date?daysUntil(t.end_date):null})).sort((a,b)=>(a.days||9999)-(b.days||9999))
      return { title:'Tenancy Schedule', kpis:[['Active tenancies',filtTen.length.toString()],['Expiring <90 days',rows.filter(r=>r.days!=null&&r.days<=90&&r.days>=0).length.toString()]], headers:['Property','Tenant','Start','End','Rent','Days to End'], rows:rows.map(r=>[r.prop,r.tenant,r.start,r.end,fmt(r.rent),r.days!=null?r.days.toString():'—']) }
    }
    case 'maintenance_report': {
      const byProp=filtMaint.reduce((a,m)=>{const k=m.property?.name||'Unknown';if(!a[k])a[k]={name:k,total:0,jobs:0};a[k].total+=(m.cost||0);a[k].jobs++;return a},{})
      const rows=Object.values(byProp).sort((a,b)=>b.total-a.total)
      const total=rows.reduce((s,r)=>s+r.total,0)
      return { title:'Maintenance Cost Report', kpis:[['Total spend',fmt(total)],['Jobs',filtMaint.length.toString()],['Avg cost',filtMaint.length?fmt(Math.round(total/filtMaint.length)):'—']], headers:['Property','Total Spend','Jobs','Avg per Job'], rows:rows.map(r=>[r.name,fmt(r.total),r.jobs.toString(),fmt(Math.round(r.total/r.jobs))]) }
    }
    case 'contractor_spend': {
      const byC=filtMaint.filter(m=>m.contractor&&m.cost>0).reduce((a,m)=>{if(!a[m.contractor])a[m.contractor]={name:m.contractor,total:0,jobs:0};a[m.contractor].total+=(m.cost||0);a[m.contractor].jobs++;return a},{})
      const rows=Object.values(byC).sort((a,b)=>b.total-a.total)
      const total=rows.reduce((s,r)=>s+r.total,0)
      return { title:'Contractor Spend Report', kpis:[['Total spend',fmt(total)],['Contractors',rows.length.toString()],['Top contractor',rows[0]?.name||'—']], headers:['Contractor','Total Paid','Jobs','Avg per Job'], rows:rows.length?rows.map(r=>[r.name,fmt(r.total),r.jobs.toString(),fmt(Math.round(r.total/r.jobs))]):[['None','No contractor costs recorded','','']] }
    }
    default: return { title:id, kpis:[], headers:['Report'], rows:[[id]] }
  }
}

// ── RENDER PDF ─────────────────────────────────────────────────────────────────
async function renderReportPDF({ title, kpis, headers, rows, totals, note, reportName, company, period, companyColor, categoryAccent, logoUrl }) {
  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const { jsPDF } = window.jspdf
  const isLandscape = headers.length > 5
  const doc = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const W = isLandscape ? 297 : 210
  const H = isLandscape ? 210 : 297
  const margin = 14
  const cW = W - margin * 2

  // Dashboard colour palette
  const cream    = [244, 243, 239]
  const cardBg   = [255, 255, 255]
  const border   = [226, 223, 216]
  const gold     = [200, 168, 75]
  const dark     = [26, 37, 48]
  const slate    = [45, 60, 74]
  const muted    = [107, 118, 145]
  const faint    = [160, 165, 178]
  const green    = [46, 204, 138]
  const red      = [224, 85, 85]
  const amber    = [224, 148, 58]
  // Accent priority: company brand colour > category accent > gold default.
  // Category accent comes from CAT_COLORS via ExportButtons so PDFs match
  // the in-app catalogue card colour for that report.
  const hexToRgb = h => (h || '').match(/[0-9a-f]{2}/gi)?.map(x => parseInt(x, 16))
  const accent   = hexToRgb(companyColor) || hexToRgb(categoryAccent) || gold

  // Load images
  async function loadImg(url) {
    try {
      const r = await fetch(url); const b = await r.blob()
      return await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b) })
    } catch(e) { return null }
  }
  let coLogo = logoUrl ? await loadImg(logoUrl) : null
  let opLogo = null
  try { opLogo = await loadImg('/logo.svg') } catch(e) {}

  // Helper: draw rounded rect card
  function card(x, y, w, h) {
    doc.setFillColor(...cardBg); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F')
    doc.setDrawColor(...border); doc.setLineWidth(0.3); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'S')
  }

  function addPage() { doc.addPage(); doc.setFillColor(...cream); doc.rect(0, 0, W, H, 'F'); return 14 }

  // ── PAGE BACKGROUND ──────────────────────────────────────────────────────
  doc.setFillColor(...cream); doc.rect(0, 0, W, H, 'F')

  // Top accent stripe — catches the eye, branded to category/company.
  doc.setFillColor(...accent); doc.rect(0, 0, W, 3, 'F')

  // ── HEADER CARD ──────────────────────────────────────────────────────────
  card(margin, 8, cW, 30)
  // Company logo
  let tx = margin + 8
  if (coLogo) {
    try { doc.addImage(coLogo, 'PNG', margin + 5, 12, 22, 11); tx = margin + 32 } catch(e) {}
  }
  // Company name + report title
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark)
  doc.text(company || 'Portfolio Report', tx, 19)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted)
  doc.text(reportName || title, tx, 26)
  // Right side: period + date
  doc.setFontSize(8); doc.setTextColor(...faint); doc.setFont('helvetica', 'normal')
  doc.text(period, W - margin - 6, 18, { align: 'right' })
  doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), W - margin - 6, 24, { align: 'right' })
  // Accent bar at bottom of header card
  doc.setFillColor(...accent); doc.rect(margin, 36.5, cW, 1, 'F')

  let y = 44

  // ── NOTE ─────────────────────────────────────────────────────────────────
  if (note) {
    card(margin, y, cW, 10)
    doc.setFillColor(...accent); doc.rect(margin, y, 1.5, 10, 'F')
    doc.setFontSize(7.5); doc.setTextColor(...slate); doc.setFont('helvetica', 'italic')
    doc.text(note.length > 130 ? note.slice(0, 127) + '...' : note, margin + 6, y + 6.5)
    y += 15
  }

  // ── KPI CARDS ────────────────────────────────────────────────────────────
  if (kpis.length > 0) {
    const perRow = Math.min(kpis.length, 4)
    const gap = 5
    const cardRows = Math.ceil(kpis.length / perRow)
    for (let row = 0; row < cardRows; row++) {
      const rk = kpis.slice(row * perRow, (row + 1) * perRow)
      const kw = (cW - (rk.length - 1) * gap) / rk.length
      rk.forEach(([label, value], i) => {
        const x = margin + i * (kw + gap)
        card(x, y, kw, 18)
        doc.setFillColor(...accent); doc.rect(x, y + 3, 1.2, 12, 'F')
        doc.setFontSize(6.5); doc.setTextColor(...muted); doc.setFont('helvetica', 'normal')
        doc.text(String(label).toUpperCase(), x + 5, y + 6.5)
        doc.setFontSize(13); doc.setTextColor(...dark); doc.setFont('helvetica', 'bold')
        // Wrap long KPI values (property names etc) instead of truncating.
        const lines = doc.splitTextToSize(String(value || '—'), kw - 7).slice(0, 2)
        doc.text(lines, x + 5, y + 14)
      })
      y += 24
    }
    y += 2
  }

  // ── TABLE CARD ───────────────────────────────────────────────────────────
  const colCount = headers.length
  const firstW = Math.min(cW * 0.3, 65)
  const otherW = (cW - firstW) / Math.max(colCount - 1, 1)
  function colX(ci) { return ci === 0 ? margin : margin + firstW + (ci - 1) * otherW }
  function colWid(ci) { return ci === 0 ? firstW : otherW }

  // Table header
  card(margin, y, cW, 8)
  doc.setFontSize(7); doc.setTextColor(...muted); doc.setFont('helvetica', 'bold')
  headers.forEach((h, ci) => {
    if (ci === 0) doc.text(String(h).toUpperCase(), colX(ci) + 4, y + 5.5)
    else doc.text(String(h).toUpperCase(), colX(ci) + colWid(ci) - 4, y + 5.5, { align: 'right' })
  })
  y += 9

  // Table rows. Wrap long cells (typically property addresses) to up to 2
  // lines rather than truncating with "..." — looks far more professional
  // on Greenwich Park, Coatham House, 12 Branstone Park type names.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  rows.forEach((row, ri) => {
    // Measure each cell's wrapped height; row height = max line count × 4.
    const wraps = row.map((cell, ci) => {
      const val = String(cell != null ? cell : '')
      const w = colWid(ci) - 8
      // jsPDF.splitTextToSize returns an array of lines that fit within `w`
      return doc.splitTextToSize(val, w).slice(0, 2)
    })
    const lineCount = Math.max(1, ...wraps.map(w => w.length))
    const rowH = Math.max(6.5, lineCount * 4.5)

    if (y + rowH > H - 26) { addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark); y = addPage() }

    if (ri % 2 === 0) { doc.setFillColor(...cardBg); doc.rect(margin, y - 1.5, cW, rowH, 'F') }
    doc.setDrawColor(...border); doc.setLineWidth(0.15)
    doc.line(margin + 2, y + rowH - 1.5, margin + cW - 2, y + rowH - 1.5)

    row.forEach((cell, ci) => {
      const val = String(cell != null ? cell : '')
      // Colour logic matching dashboard
      if (ci > 0) {
        if (val.startsWith('-') || val.includes('EXPIRED') || val.includes('Overdue') || val.includes('overdue')) doc.setTextColor(...red)
        else if (val === 'Valid' || val === 'Yes' || val === 'Rented' || val === 'All clear') doc.setTextColor(...green)
        else if (val.includes('Expiring')) doc.setTextColor(...amber)
        else doc.setTextColor(...slate)
      } else { doc.setTextColor(...dark) }

      doc.setFont('helvetica', ci === 0 ? 'bold' : 'normal')
      const lines = wraps[ci]
      if (ci === 0) doc.text(lines, colX(ci) + 4, y + 3.5)
      else doc.text(lines, colX(ci) + colWid(ci) - 4, y + 3.5, { align: 'right' })
    })
    y += rowH
  })

  // Totals row
  if (totals && totals.length > 0) {
    if (y > H - 26) { addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark); y = addPage() }
    y += 1
    // Gold top line + card background
    doc.setFillColor(...accent); doc.rect(margin, y - 2, cW, 0.8, 'F')
    card(margin, y - 0.5, cW, 8)
    doc.setFontSize(8.5); doc.setTextColor(...dark); doc.setFont('helvetica', 'bold')
    totals.forEach((val, ci) => {
      if (!val) return
      if (ci === 0) doc.text(String(val), colX(ci) + 4, y + 4.5)
      else doc.text(String(val), colX(ci) + colWid(ci) - 4, y + 4.5, { align: 'right' })
    })
  }

  // Footer on all pages
  const pc = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pc; p++) { doc.setPage(p); addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark) }

  doc.save(`${(reportName || title).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`)
}

function addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark) {
  const fy = H - 18
  const cW = W - margin * 2
  // Card-style footer
  doc.setFillColor(...cream); doc.rect(0, fy - 2, W, 20, 'F')
  doc.setDrawColor(...border); doc.setLineWidth(0.3); doc.line(margin, fy, W - margin, fy)
  doc.setFillColor(...accent); doc.rect(margin, fy, cW, 0.6, 'F')

  // OwnProperly logo
  if (opLogo) {
    try { doc.addImage(opLogo, 'SVG', margin, fy + 3, 16, 8) } catch(e) {}
  }
  const lx = opLogo ? margin + 19 : margin
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark)
  doc.text('OwnProperly', lx, fy + 7)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...muted)
  doc.text('Property Portfolio Management', lx, fy + 11)
  doc.setFontSize(6); doc.setTextColor(...faint)
  doc.text('ownproperly.com', lx, fy + 14.5)

  // Page number
  const pc = doc.internal.getNumberOfPages()
  const cp = doc.getCurrentPageInfo().pageNumber
  doc.setFontSize(7); doc.setTextColor(...muted); doc.setFont('helvetica', 'normal')
  doc.text(`Page ${cp} of ${pc}`, W - margin, fy + 8, { align: 'right' })
}

// ── YEAR-END TAX PACK PDF ─────────────────────────────────────────────────────
// Single document with: cover page · table of contents · one section per
// report (with header, KPI grid, table, optional totals row, optional
// note). Reuses the same colour palette and helpers as renderReportPDF
// for visual consistency. Pages flow automatically when a section runs
// long — no truncation.
async function renderYearEndPackPDF({ reports, company, companyColor, logoUrl, period }) {
  await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, margin = 14, cW = W - margin * 2

  // Shared palette (matches the dashboard's print colours).
  const cream = [244, 243, 239], cardBg = [255, 255, 255], border = [226, 223, 216]
  const gold = [200, 168, 75], dark = [26, 37, 48], slate = [45, 60, 74]
  const muted = [107, 118, 145], faint = [160, 165, 178]
  const green = [46, 204, 138], red = [224, 85, 85], amber = [224, 148, 58]
  const accent = companyColor
    ? (companyColor.match(/[0-9a-f]{2}/gi)?.map(h => parseInt(h, 16)) || gold)
    : gold

  // Logo loaders (same as the single-report renderer).
  async function loadImg(url) {
    try {
      const r = await fetch(url); const b = await r.blob()
      return await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b) })
    } catch { return null }
  }
  const coLogo = logoUrl ? await loadImg(logoUrl) : null
  let opLogo = null; try { opLogo = await loadImg('/logo.svg') } catch {}

  function card(x, y, w, h) {
    doc.setFillColor(...cardBg); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F')
    doc.setDrawColor(...border); doc.setLineWidth(0.3); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'S')
  }
  function fillPage() { doc.setFillColor(...cream); doc.rect(0, 0, W, H, 'F') }
  function newPage() { doc.addPage(); fillPage(); return 14 }

  // ── COVER PAGE ───────────────────────────────────────────────────────
  fillPage()
  // Big gold band at top
  doc.setFillColor(...accent); doc.rect(0, 0, W, 4, 'F')
  if (coLogo) { try { doc.addImage(coLogo, 'PNG', margin, 22, 40, 20) } catch {} }
  doc.setFontSize(32); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark)
  doc.text('Year-End Tax Pack', margin, 70)
  doc.setFontSize(13); doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted)
  doc.text(company, margin, 80)
  doc.setFontSize(11); doc.text(period, margin, 88)
  // Accent line
  doc.setFillColor(...accent); doc.rect(margin, 95, 50, 0.8, 'F')

  // What's included
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...slate)
  doc.text('CONTENTS', margin, 110)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  reports.forEach((r, i) => {
    doc.setTextColor(...muted)
    doc.text(`${i + 1}.`, margin, 120 + i * 8)
    doc.setTextColor(...dark)
    doc.text(r.name, margin + 8, 120 + i * 8)
    doc.setTextColor(...faint)
    doc.text(String(r.data?.rows?.length || 0) + ' rows', W - margin, 120 + i * 8, { align: 'right' })
  })

  // Footer note
  doc.setFontSize(8); doc.setTextColor(...faint); doc.setFont('helvetica', 'italic')
  doc.text(
    'Pass this pack to your accountant for self-assessment (SA105). Generated on ' +
      new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '.',
    margin, H - 30, { maxWidth: cW }
  )
  // OwnProperly footer credit (smaller than per-page footer)
  if (opLogo) { try { doc.addImage(opLogo, 'SVG', margin, H - 18, 14, 7) } catch {} }
  doc.setFontSize(7); doc.setTextColor(...muted); doc.setFont('helvetica', 'bold')
  doc.text('Generated by OwnProperly', margin + (opLogo ? 18 : 0), H - 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...faint)
  doc.text('ownproperly.com · UK Landlord Portfolio Management', margin + (opLogo ? 18 : 0), H - 9.5)

  // ── REPORT SECTIONS ──────────────────────────────────────────────────
  for (const rep of reports) {
    const d = rep.data
    if (!d) continue
    let y = newPage()

    // Section header card
    card(margin, 8, cW, 22)
    doc.setFillColor(...accent); doc.rect(margin, 8, 1.5, 22, 'F')
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark)
    doc.text(rep.name, margin + 6, 18)
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted)
    doc.text(`${company} · ${period}`, margin + 6, 25)
    doc.setFontSize(7); doc.setTextColor(...faint)
    doc.text(new Date().toLocaleDateString('en-GB'), W - margin - 6, 18, { align: 'right' })
    y = 36

    // Optional note ribbon
    if (d.note) {
      card(margin, y, cW, 10)
      doc.setFillColor(...accent); doc.rect(margin, y, 1.5, 10, 'F')
      doc.setFontSize(7.5); doc.setTextColor(...slate); doc.setFont('helvetica', 'italic')
      doc.text(d.note.length > 130 ? d.note.slice(0, 127) + '...' : d.note, margin + 6, y + 6.5)
      y += 14
    }

    // KPIs
    if (d.kpis?.length) {
      const perRow = Math.min(d.kpis.length, 4)
      const gap = 5
      const cardRows = Math.ceil(d.kpis.length / perRow)
      for (let row = 0; row < cardRows; row++) {
        const rk = d.kpis.slice(row * perRow, (row + 1) * perRow)
        const kw = (cW - (rk.length - 1) * gap) / rk.length
        rk.forEach(([label, value], i) => {
          const x = margin + i * (kw + gap)
          card(x, y, kw, 18)
          doc.setFillColor(...accent); doc.rect(x, y + 3, 1.2, 12, 'F')
          doc.setFontSize(6.5); doc.setTextColor(...muted); doc.setFont('helvetica', 'normal')
          doc.text(String(label).toUpperCase(), x + 5, y + 6.5)
          doc.setFontSize(13); doc.setTextColor(...dark); doc.setFont('helvetica', 'bold')
          // Don't truncate — wrap to two lines if needed.
          const lines = doc.splitTextToSize(String(value || '—'), kw - 7)
          doc.text(lines.slice(0, 2), x + 5, y + 14)
        })
        y += 24
      }
      y += 2
    }

    // Table — same layout as single-report PDF but wrap (don't truncate)
    if (d.headers?.length && d.rows?.length) {
      const colCount = d.headers.length
      const firstW = Math.min(cW * 0.34, 70)
      const otherW = (cW - firstW) / Math.max(colCount - 1, 1)
      const colX = ci => ci === 0 ? margin : margin + firstW + (ci - 1) * otherW
      const colWid = ci => ci === 0 ? firstW : otherW

      // Header row
      card(margin, y, cW, 8)
      doc.setFontSize(7); doc.setTextColor(...muted); doc.setFont('helvetica', 'bold')
      d.headers.forEach((h, ci) => {
        if (ci === 0) doc.text(String(h).toUpperCase(), colX(ci) + 4, y + 5.5)
        else doc.text(String(h).toUpperCase(), colX(ci) + colWid(ci) - 4, y + 5.5, { align: 'right' })
      })
      y += 9

      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      for (const row of d.rows) {
        // Measure: how tall will this row be (allows wrapping for long property names)
        const lineHeights = row.map((cell, ci) => {
          const val = String(cell != null ? cell : '')
          const w = colWid(ci) - 8
          const lines = doc.splitTextToSize(val, w)
          return Math.max(1, Math.min(lines.length, 2))
        })
        const rowH = Math.max(6.5, Math.max(...lineHeights) * 4.5)

        if (y + rowH > H - 26) { addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark); y = newPage() }

        // Subtle alternating background
        if ((d.rows.indexOf(row)) % 2 === 0) {
          doc.setFillColor(...cardBg); doc.rect(margin, y - 1.5, cW, rowH, 'F')
        }
        doc.setDrawColor(...border); doc.setLineWidth(0.15)
        doc.line(margin + 2, y + rowH - 1.5, margin + cW - 2, y + rowH - 1.5)

        row.forEach((cell, ci) => {
          const val = String(cell != null ? cell : '')
          // Colour by intent (same as renderReportPDF)
          if (ci > 0) {
            if (val.startsWith('-') || val.includes('EXPIRED') || val.includes('Overdue') || val.includes('overdue')) doc.setTextColor(...red)
            else if (val === 'Valid' || val === 'Yes' || val === 'Rented' || val === 'All clear') doc.setTextColor(...green)
            else if (val.includes('Expiring')) doc.setTextColor(...amber)
            else doc.setTextColor(...slate)
          } else { doc.setTextColor(...dark) }
          doc.setFont('helvetica', ci === 0 ? 'bold' : 'normal')
          const w = colWid(ci) - 8
          const lines = doc.splitTextToSize(val, w).slice(0, 2)
          if (ci === 0) doc.text(lines, colX(ci) + 4, y + 3.5)
          else doc.text(lines, colX(ci) + colWid(ci) - 4, y + 3.5, { align: 'right' })
        })
        y += rowH
      }

      // Totals row
      if (d.totals?.length) {
        if (y > H - 26) { addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark); y = newPage() }
        y += 1
        doc.setFillColor(...accent); doc.rect(margin, y - 2, cW, 0.8, 'F')
        card(margin, y - 0.5, cW, 8)
        doc.setFontSize(8.5); doc.setTextColor(...dark); doc.setFont('helvetica', 'bold')
        d.totals.forEach((val, ci) => {
          if (!val) return
          if (ci === 0) doc.text(String(val), colX(ci) + 4, y + 4.5)
          else doc.text(String(val), colX(ci) + colWid(ci) - 4, y + 4.5, { align: 'right' })
        })
      }
    } else {
      doc.setFontSize(10); doc.setTextColor(...muted); doc.setFont('helvetica', 'italic')
      doc.text('No data for this period.', margin, y + 8)
    }
  }

  // Footer on every page (cover excluded — has its own)
  const pc = doc.internal.getNumberOfPages()
  for (let p = 2; p <= pc; p++) { doc.setPage(p); addFooter(doc, W, H, margin, opLogo, cream, border, accent, muted, faint, dark) }

  doc.save(`year-end-tax-pack-${company.replace(/[^a-zA-Z0-9]/g,'-').toLowerCase()}-${period.replace(/[^a-zA-Z0-9]/g,'-')}.pdf`)
}

function buildCSVRows(id, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range) {
  // Default: drive CSV off the same buildReportData() shape used for PDF
  // — headers row + each data row + an optional totals row. Strips
  // currency formatting so the CSV opens cleanly in Excel/Sheets.
  // Report-specific overrides below add columns useful for accountants
  // that aren't in the on-screen table.
  const stripCurrency = (s) => typeof s === 'string' ? s.replace(/[£,]/g, '').trim() : s

  switch(id) {
    case 'pnl': {
      const hasPaid = filtRent.some(r => r.status === 'paid')
      return [
        ['Property','Status','Annual rent (collected)','Expenses','Net profit','Gross yield','Est. value','Mortgage'],
        ...filtProps.map(p => {
          const rent = hasPaid
            ? filtRent.filter(r=>r.property_id===p.id&&r.status==='paid').reduce((s,r)=>s+(r.amount||0),0)
            : (isPropertyEarningRent(p.status) ? (p.rent_pcm||0)*12 : 0)
          const exp = filtExp.filter(e=>e.property_id===p.id).reduce((s,e)=>s+(e.amount||0),0)
          return [p.name, p.status||'', rent, exp, rent-exp,
            p.est_value?((p.rent_pcm||0)*12/p.est_value*100).toFixed(2)+'%':'',
            p.est_value||0, p.mortgage_amount||0]
        })
      ]
    }
    case 'income_sched': {
      // Per-property per-month rent — 12 columns.
      const months = MONTHS
      const hasPaid = filtRent.some(r=>r.status==='paid')
      return [
        ['Property', ...months, 'Total'],
        ...filtProps.map(p => {
          const monthRent = months.map((_, m) => {
            if (!hasPaid) return p.rent_pcm || 0
            return filtRent.filter(r => r.property_id === p.id && r.status === 'paid'
              && r.month === (m+1)
            ).reduce((s,r) => s + (r.amount||0), 0)
          })
          const tot = monthRent.reduce((s,v)=>s+v,0)
          return [p.name, ...monthRent, tot]
        }),
      ]
    }
    case 'compliance': return [
      ['Property','Certificate type','Expiry date','Status','Days until expiry','Issuer'],
      ...filtComp.map(c => {
        const d = daysUntil(c.expiry_date)
        const status = !c.expiry_date ? 'No date' : d<0 ? 'EXPIRED' : d<60 ? 'Expiring soon' : 'Valid'
        return [c.property?.name||'', c.item_type||c.type||'', c.expiry_date||'', status, d ?? '', c.issuer||'']
      })
    ]
    case 'tenancy_sched': return [
      ['Property','Tenant','Start date','End date','Monthly rent','Annual rent','Notice period','Days to end'],
      ...filtTen.map(t => [
        t.property?.name||'', t.tenant_name||'', t.start_date||'', t.end_date||'Rolling',
        t.property?.rent_pcm||0, (t.property?.rent_pcm||0)*12,
        t.notice_period||'', t.end_date ? daysUntil(t.end_date) : ''
      ])
    ]
    case 'mortgage_port': return [
      ['Property','Lender','Loan amount','Rate %','Type','Term (years)','Monthly payment','Expiry','LTV %'],
      ...filtProps.filter(p=>p.mortgage_amount>0).map(p => {
        // mortgage_rate stored as decimal (0.05) → monthly rate = rate/12.
        const r = (p.mortgage_rate||0)/12
        const n = (p.mortgage_term||25)*12
        const monthly = p.mortgage_type === 'interest_only'
          ? p.mortgage_amount * r
          : (r > 0 ? p.mortgage_amount*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1) : 0)
        return [
          p.name, p.lender||'', p.mortgage_amount||0,
          p.mortgage_rate ? +(p.mortgage_rate*100).toFixed(3) : '',
          p.mortgage_type === 'interest_only' ? 'Interest-only' : 'Repayment',
          p.mortgage_term||'', Math.round(monthly), p.mortgage_expiry||'',
          p.est_value ? ((p.mortgage_amount||0)/p.est_value*100).toFixed(1) : ''
        ]
      })
    ]
    default: {
      // Generic path — use buildReportData's headers+rows shape, strip
      // currency formatting on data cells (objects use .v, strings stay).
      const data = buildReportData(id, filtProps, filtExp, filtRent, filtComp, filtMaint, filtTen, range)
      if (!data || !data.headers) return [['Report', id], ['Period', range.label]]
      const out = [data.headers]
      for (const row of (data.rows || [])) {
        out.push(row.map(cell => stripCurrency(typeof cell === 'object' && cell !== null ? cell.v : cell)))
      }
      if (data.totals) out.push(data.totals.map(stripCurrency))
      return out
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function ReportPnL({ filtProps, filtRent, filtExp, range, T, accent, fmt, fmtPct }) {
  // Use actually-collected rent (status='paid') for the period — that's
  // what HMRC cares about on SA105. Fall back to the expected rent only
  // when no payment records exist at all (new portfolio, first month).
  const hasAnyPaymentData = filtRent.some(r => r.status === 'paid')
  const rows = filtProps.map(p => {
    const rent = hasAnyPaymentData
      ? filtRent.filter(r => r.property_id === p.id && r.status === 'paid')
          .reduce((s,r) => s + (r.amount || 0), 0)
      : (isPropertyEarningRent(p.status) ? (p.rent_pcm||0)*12 : 0)
    const exp = filtExp.filter(e=>e.property_id===p.id).reduce((s,e)=>s+(e.amount||0),0)
    const net = rent - exp
    const yield_ = p.est_value ? ((p.rent_pcm||0)*12/p.est_value)*100 : 0
    return { p, rent, exp, net, yield: yield_ }
  }).sort((a,b)=>b.net-a.net)
  const totalRent = rows.reduce((s,r)=>s+r.rent,0)
  const totalExp = rows.reduce((s,r)=>s+r.exp,0)
  const totalNet = totalRent - totalExp
  return (
    <>
      <StatCards T={T} items={[
        {label:'Total rental income',value:fmt(totalRent),color:T.green},
        {label:'Total expenses',value:fmt(totalExp),color:T.red},
        {label:'Net profit',value:fmt(totalNet),color:totalNet>=0?T.green:T.red},
        {label:'Net margin',value:totalRent>0?fmtPct((totalNet/totalRent)*100):'—',color:accent},
      ]}/>

      {rows.length > 0 && (
        <ChartCard title="Net profit by property" T={T}>
          <BarChart T={T} accent={accent} fmt={fmtCompact}
            data={rows.map(r => ({
              label: r.p.name,
              value: r.net,
              color: r.net >= 0 ? T.green : T.red,
            }))}/>
        </ChartCard>
      )}

      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Annual rent',right:true,width:'120px'},{label:'Expenses',right:true,width:'120px'},{label:'Net profit',right:true,width:'120px'},{label:'Gross yield',right:true,width:'100px'}]}
        rows={rows.map(r=>[
          r.p.name,
          {v:fmt(r.rent),color:T.green,right:true},
          {v:fmt(r.exp),color:T.red,right:true},
          {v:fmt(r.net),color:r.net>=0?T.green:T.red,bold:true,right:true},
          {v:r.yield>0?fmtPct(r.yield):'—',color:r.yield>=6?T.green:r.yield>=4?T.amber:T.red,right:true},
        ])}
      />
      <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px 120px 100px',gap:0,padding:'12px 20px',background:T.bg,borderRadius:'0 0 14px 14px',border:`1px solid ${T.border}`,borderTop:'none',marginTop:-1}}>
        <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.text}}>Total</div>
        <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.green,textAlign:'right'}}>{fmt(totalRent)}</div>
        <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.red,textAlign:'right'}}>{fmt(totalExp)}</div>
        <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:totalNet>=0?T.green:T.red,textAlign:'right'}}>{fmt(totalNet)}</div>
        <div/>
      </div>
    </>
  )
}

// Shown by the month-by-month reports when a custom range spans more months
// than the grid can sensibly display (or both custom dates aren't set yet).
function GridTooWide({ T }) {
  return (
    <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:40,textAlign:'center',border:`1px dashed ${T.border}`,borderRadius:14,lineHeight:1.7}}>
      This month-by-month view supports up to {MAX_GRID_MONTHS} months.<br/>
      Set both custom dates and keep the range within {MAX_GRID_MONTHS/12} years to see it, or switch to a tax/calendar year.
    </div>
  )
}

function ReportIncomeSchedule({ filtProps, filtRent, range, year, yearType, T, accent, fmt }) {
  const months = periodMonths(year, yearType, range)
  if (months.length > MAX_GRID_MONTHS) return <GridTooWide T={T}/>
  const nMonths = months.length
  const cols = `160px repeat(${nMonths},1fr) 100px`
  const propRent = filtProps.map(p => {
    const monthData = months.map(({m,y}) => {
      const paid = filtRent.filter(r => r.property_id===p.id && r.month === (m+1) && r.year === y)
        .reduce((s,r)=>s+(r.amount||0),0)
      return paid || (p.rent_pcm||0)
    })
    return { p, monthData, total: monthData.reduce((s,v)=>s+v,0) }
  })
  const monthTotals = months.map((_,i) => propRent.reduce((s,r)=>s+r.monthData[i],0))
  const grandTotal = monthTotals.reduce((s,v)=>s+v,0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Total income for period',value:fmt(grandTotal),color:T.green},
        {label:'Monthly average',value:fmt(Math.round(grandTotal/nMonths)),color:accent},
        {label:'Properties tracked',value:filtProps.length,color:T.text},
      ]}/>
      <div style={{overflowX:'auto'}}>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden',minWidth:900}}>
          <div style={{display:'grid',gridTemplateColumns:cols,background:T.bg,borderBottom:`1px solid ${T.border}`,padding:'10px 16px'}}>
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Property</div>
            {months.map(({m,y},i)=><div key={i} style={{fontFamily:mono,fontSize:9,color:T.muted,textAlign:'center'}}>{monthLabel(m,y,yearType)}</div>)}
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',textAlign:'right'}}>Total</div>
          </div>
          {propRent.map(({p,monthData,total}) => (
            <div key={p.id} style={{display:'grid',gridTemplateColumns:cols,padding:'10px 16px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
              <div style={{fontFamily:mono,fontSize:11,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
              {monthData.map((v,i)=><div key={i} style={{fontFamily:mono,fontSize:11,color:T.green,textAlign:'center'}}>{v>0?fmt(v):'-'}</div>)}
              <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.green,textAlign:'right'}}>{fmt(total)}</div>
            </div>
          ))}
          <div style={{display:'grid',gridTemplateColumns:cols,padding:'10px 16px',background:T.bg}}>
            <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:T.text}}>Monthly total</div>
            {monthTotals.map((v,i)=><div key={i} style={{fontFamily:mono,fontSize:11,fontWeight:700,color:T.green,textAlign:'center'}}>{fmt(v)}</div>)}
            <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.green,textAlign:'right'}}>{fmt(grandTotal)}</div>
          </div>
        </div>
      </div>
    </>
  )
}

function ReportExpenseBreakdown({ filtExp, T, accent, fmt }) {
  const byCat = filtExp.reduce((acc,e)=>{ acc[e.category||'Other']=(acc[e.category||'Other']||0)+(e.amount||0); return acc },{})
  const cats = Object.entries(byCat).sort((a,b)=>b[1]-a[1])
  const total = cats.reduce((s,[,v])=>s+v,0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Total expenses',value:fmt(total),color:T.red},
        {label:'Largest category',value:cats[0]?cats[0][0]:'—',color:accent},
        {label:'Expense items',value:filtExp.length,color:T.text},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Category'},{label:'Amount',right:true,width:'140px'},{label:'% of total',right:true,width:'120px'},{label:'Items',right:true,width:'80px'}]}
        rows={cats.map(([cat,amount])=>[
          cat,
          {v:fmt(amount),color:T.red,right:true},
          {v:fmtPct((amount/total)*100),right:true},
          {v:filtExp.filter(e=>(e.category||'Other')===cat).length,right:true},
        ])}
      />
    </>
  )
}

function ReportMortgageInterest({ filtProps, T, accent, fmt, fmtPct }) {
  // Year-one interest = balance × rate. For repayment mortgages this is
  // the high-water mark — true interest declines over the term as
  // principal is paid down. Accountants want this approximation for
  // Section 24 planning; tag the type so they can refine.
  // mortgage_rate is stored as decimal (0.05 for 5%) — see PropertyModal.
  const rows = filtProps.filter(p=>p.mortgage_amount&&p.mortgage_rate).map(p => {
    const annualInterest = (p.mortgage_amount||0) * (p.mortgage_rate||0)
    return {
      p,
      kind: p.mortgage_type === 'interest_only' ? 'Interest-only' : 'Repayment',
      annualInterest,
      taxCredit: annualInterest * 0.2,
    }
  })
  const totalInterest = rows.reduce((s,r)=>s+r.annualInterest,0)
  const totalCredit = rows.reduce((s,r)=>s+r.taxCredit,0)
  return (
    <>
      <div style={{background:T.amber+'18',border:`1px solid ${T.amber}44`,borderRadius:10,padding:'12px 16px',marginBottom:20,fontFamily:mono,fontSize:12,color:T.text,lineHeight:1.7}}>
        <strong style={{color:T.amber}}>Section 24 note:</strong> Since April 2020, mortgage interest can no longer be deducted as an expense. You receive a 20% tax credit on the finance cost instead. Repayment figures are year-one approximations — re-run annually for accuracy.
      </div>
      <StatCards T={T} items={[
        {label:'Total mortgage interest',value:fmt(totalInterest),color:T.amber},
        {label:'20% tax credit value',value:fmt(totalCredit),color:T.green},
        {label:'Properties with mortgages',value:rows.length,color:T.text},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Loan amount',right:true,width:'130px'},{label:'Rate',right:true,width:'80px'},{label:'Type',width:'120px'},{label:'Annual interest',right:true,width:'140px'},{label:'20% tax credit',right:true,width:'130px'}]}
        rows={rows.map(r=>[
          r.p.name,
          {v:fmt(r.p.mortgage_amount),right:true},
          {v:fmtPct((r.p.mortgage_rate||0)*100),right:true},
          {v:r.kind,color:r.kind==='Interest-only'?T.amber:T.muted},
          {v:fmt(r.annualInterest),color:T.amber,right:true},
          {v:fmt(r.taxCredit),color:T.green,right:true},
        ])}
      />
    </>
  )
}

function ReportCapitalGains({ filtProps, T, accent, fmt }) {
  const rows = filtProps.map(p => ({
    p,
    cost: (p.purchase_price||0)+(p.refurb_cost||0)+(p.stamp_duty||0)+(p.legal_fees||0),
    currentValue: p.est_value||0,
    gain: (p.est_value||0)-((p.purchase_price||0)+(p.refurb_cost||0)+(p.stamp_duty||0)+(p.legal_fees||0)),
  })).sort((a,b)=>b.gain-a.gain)
  const totalCost = rows.reduce((s,r)=>s+r.cost,0)
  const totalValue = rows.reduce((s,r)=>s+r.currentValue,0)
  const totalGain = totalValue - totalCost
  return (
    <>
      <div style={{background:T.blue+'18',border:`1px solid ${T.blue}44`,borderRadius:10,padding:'12px 16px',marginBottom:20,fontFamily:mono,fontSize:12,color:T.text}}>
        These are unrealised gains based on estimated values. Actual CGT is calculated at the point of sale. Consult your accountant for CGT planning.
      </div>
      <StatCards T={T} items={[
        {label:'Total cost base',value:fmt(totalCost),color:T.text},
        {label:'Estimated portfolio value',value:fmt(totalValue),color:accent},
        {label:'Unrealised gain',value:fmt(totalGain),color:totalGain>=0?T.green:T.red},
        {label:'Average gain',value:rows.length?fmtPct((totalGain/totalCost)*100):'—',color:T.green},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Cost base',right:true,width:'130px'},{label:'Est. value',right:true,width:'130px'},{label:'Unrealised gain',right:true,width:'140px'},{label:'Gain %',right:true,width:'90px'}]}
        rows={rows.map(r=>[
          r.p.name,
          {v:fmt(r.cost),right:true},
          {v:fmt(r.currentValue),right:true},
          {v:fmt(r.gain),color:r.gain>=0?T.green:T.red,bold:true,right:true},
          {v:r.cost>0?fmtPct((r.gain/r.cost)*100):'—',color:r.gain>=0?T.green:T.red,right:true},
        ])}
      />
    </>
  )
}

function ReportYieldComparison({ filtProps, filtExp, T, accent, fmt, fmtPct }) {
  const rows = filtProps.map(p => {
    const grossYield = p.est_value&&p.rent_pcm ? ((p.rent_pcm*12)/p.est_value)*100 : 0
    // Use real expenses for this property over the period — falls back
    // to a 20% rule of thumb when no expense rows exist.
    const realCosts = filtExp.filter(e => e.property_id === p.id).reduce((s,e) => s + (e.amount || 0), 0)
    const annualRent = (p.rent_pcm||0) * 12
    const costsForYield = realCosts > 0 ? realCosts : annualRent * 0.2
    const netYield = p.est_value ? ((annualRent - costsForYield) / p.est_value) * 100 : 0
    return { p, grossYield, netYield, costsActual: realCosts > 0 }
  }).sort((a,b)=>b.grossYield-a.grossYield)
  const avg = rows.length ? rows.reduce((s,r)=>s+r.grossYield,0)/rows.length : 0
  return (
    <>
      <StatCards T={T} items={[
        {label:'Average gross yield',value:fmtPct(avg),color:avg>=6?T.green:avg>=4?T.amber:T.red},
        {label:'Best performer',value:rows[0]?.p.name||'—',color:accent},
        {label:'Highest gross yield',value:rows[0]?fmtPct(rows[0].grossYield):'—',color:T.green},
      ]}/>

      {rows.length > 0 && (
        <ChartCard title="Gross yield — ranked" T={T}>
          <RankedBar T={T} accent={accent} fmt={v => `${v.toFixed(1)}%`}
            data={rows.map(r => ({
              label: r.p.name,
              value: r.grossYield,
              color: r.grossYield >= 6 ? T.green : r.grossYield >= 4 ? T.amber : T.red,
            }))}/>
        </ChartCard>
      )}

      <ReportTable T={T} accent={accent}
        headers={[{label:'#',width:'30px'},{label:'Property'},{label:'Monthly rent',right:true,width:'130px'},{label:'Est. value',right:true,width:'130px'},{label:'Gross yield',right:true,width:'110px'},{label:'Est. net yield',right:true,width:'120px'}]}
        rows={rows.map((r,i)=>[
          {v:`${i+1}`,color:T.muted},
          r.p.name,
          {v:fmt(r.p.rent_pcm),right:true},
          {v:fmt(r.p.est_value),right:true},
          {v:r.grossYield>0?fmtPct(r.grossYield):'—',color:r.grossYield>=6?T.green:r.grossYield>=4?T.amber:T.red,bold:true,right:true},
          {v:r.netYield>0?fmtPct(r.netYield):'—',color:T.muted,right:true},
        ])}
      />
    </>
  )
}

function ReportOccupancy({ filtProps, T, accent, fmt }) {
  const total = filtProps.length
  const rented = filtProps.filter(p=>isPropertyEarningRent(p.status)).length
  const vacant = filtProps.filter(p=>p.status==='vacant').length
  const rate = total>0?(rented/total)*100:0
  const voidCost = filtProps.filter(p=>p.status==='vacant').reduce((s,p)=>s+(p.rent_pcm||0),0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Occupancy rate',value:`${rate.toFixed(1)}%`,color:rate>=90?T.green:rate>=70?T.amber:T.red},
        {label:'Rented',value:rented,color:T.green},
        {label:'Vacant',value:vacant,color:T.red},
        {label:'Monthly void cost',value:fmt(voidCost),color:vacant>0?T.red:T.green},
      ]}/>

      {total > 0 && (
        <ChartCard title="Portfolio occupancy" T={T} padding="20px">
          <div style={{display:'flex',gap:24,alignItems:'center',flexWrap:'wrap',justifyContent:'center'}}>
            <DonutChart T={T} accent={accent}
              percent={rate}
              value={`${rate.toFixed(0)}%`}
              sublabel={`${rented} of ${total}`}
              label="OCCUPIED"
              color={rate >= 90 ? T.green : rate >= 70 ? T.amber : T.red}
              size={200}/>
            <div style={{display:'flex',flexDirection:'column',gap:12,fontFamily:mono,fontSize:12,minWidth:160}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:24}}>
                <span style={{color:T.muted}}>Rented</span>
                <span style={{color:T.green,fontWeight:700}}>{rented}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',gap:24}}>
                <span style={{color:T.muted}}>Vacant</span>
                <span style={{color:T.red,fontWeight:700}}>{vacant}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',gap:24}}>
                <span style={{color:T.muted}}>Other</span>
                <span style={{color:T.text,fontWeight:700}}>{total - rented - vacant}</span>
              </div>
              <div style={{height:1,background:T.border,margin:'4px 0'}}/>
              <div style={{display:'flex',justifyContent:'space-between',gap:24}}>
                <span style={{color:T.muted}}>Monthly void cost</span>
                <span style={{color:vacant > 0 ? T.red : T.green,fontWeight:700}}>{fmt(voidCost)}</span>
              </div>
            </div>
          </div>
        </ChartCard>
      )}

      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Status',width:'120px'},{label:'Monthly rent',right:true,width:'130px'},{label:'Occupied',width:'100px'}]}
        rows={filtProps.sort((a,b)=>a.status==='vacant'?-1:1).map(p=>[
          p.name,
          {v:p.status||'unknown',color:isPropertyEarningRent(p.status)?T.green:T.red},
          {v:fmt(p.rent_pcm),right:true},
          {v:isPropertyEarningRent(p.status)?'Yes':'No',color:isPropertyEarningRent(p.status)?T.green:T.red},
        ])}
      />
    </>
  )
}

function ReportRentCollection({ filtProps, filtRent, range, T, accent, fmt }) {
  // rent_payments.status values: paid | late | overdue | void | partial | refurb.
  // Legacy 'missed' rows (pre-2026-05-25) still treated as overdue. Treat
  // late + partial as "collected with delay".
  const expected = filtProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0)*12,0)
  const collected = filtRent.filter(r=>r.status==='paid').reduce((s,r)=>s+(r.amount||0),0)
  const lateCollected = filtRent.filter(r=>r.status==='late'||r.status==='partial').reduce((s,r)=>s+(r.amount||0),0)
  const missed = filtRent.filter(r=>r.status==='overdue'||r.status==='missed').length
  const rate = expected>0?((collected+lateCollected)/expected)*100:100

  // Per-property breakdown of what landed when.
  const byProp = filtProps.filter(p=>isPropertyEarningRent(p.status)).map(p => {
    const own = filtRent.filter(r => r.property_id === p.id)
    return {
      p,
      expected: (p.rent_pcm||0) * 12,
      paid: own.filter(r=>r.status==='paid').reduce((s,r)=>s+(r.amount||0),0),
      late: own.filter(r=>r.status==='late').length,
      missed: own.filter(r=>r.status==='overdue'||r.status==='missed').length,
    }
  }).sort((a,b) => (b.missed+b.late) - (a.missed+a.late))

  return (
    <>
      <StatCards T={T} items={[
        {label:'Collection rate',value:`${rate.toFixed(1)}%`,color:rate>=95?T.green:rate>=85?T.amber:T.red},
        {label:'Expected income',value:fmt(expected),color:T.text},
        {label:'Collected on time',value:fmt(collected),color:T.green},
        {label:'Missed payments',value:missed,color:missed>0?T.red:T.green},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Expected',right:true,width:'120px'},{label:'Collected',right:true,width:'120px'},{label:'Late',right:true,width:'70px'},{label:'Missed',right:true,width:'70px'}]}
        rows={byProp.map(r=>[
          r.p.name,
          {v:fmt(r.expected),right:true},
          {v:fmt(r.paid),color:T.green,right:true},
          {v:r.late||'—',color:r.late>0?T.amber:T.muted,right:true},
          {v:r.missed||'—',color:r.missed>0?T.red:T.muted,right:true,bold:r.missed>0},
        ])}
      />
      {filtRent.length===0&&<div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:'20px 0'}}>No payment records found. Mark rent as paid in the Rent Tracker to populate this report.</div>}
    </>
  )
}

function ReportCashFlow({ filtProps, filtRent, filtExp, range, year, yearType, T, accent, fmt }) {
  const months = periodMonths(year, yearType, range)
  if (months.length > MAX_GRID_MONTHS) return <GridTooWide T={T}/>
  // Use real per-month data: collected rent from rent_payments, real
  // expense rows by date. Previously this just multiplied rent_pcm by
  // every month identically — showed the same figure for Jan as for
  // Dec, ignoring vacancies and seasonality.
  const hasPaid = filtRent.some(r => r.status === 'paid')
  const mData = months.map(({m,y}) => {
    const rent = hasPaid
      ? filtRent.filter(r => {
          if (r.status !== 'paid') return false
          // year/month columns are kept in sync with period_start by every
          // writer, so they're the reliable month bucket.
          return r.month === (m + 1) && r.year === y
        }).reduce((s,r) => s + (r.amount || 0), 0)
      // No payment records anywhere → assume expected rent (legacy display).
      : filtProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0)
    const exp = filtExp.filter(e => {
      if (!e.date) return false
      const d = new Date(e.date)
      return d.getMonth() === m && d.getFullYear() === y
    }).reduce((s,e)=>s+(e.amount||0),0)
    const net = rent - exp
    return { label: monthLabel(m, y, yearType), rent, exp, net, m, y }
  })
  const totalRent = mData.reduce((s,m)=>s+m.rent,0)
  const totalExp = mData.reduce((s,m)=>s+m.exp,0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Total income',value:fmt(totalRent),color:T.green},
        {label:'Total outgoings',value:fmt(totalExp),color:T.red},
        {label:'Net cash flow',value:fmt(totalRent-totalExp),color:(totalRent-totalExp)>=0?T.green:T.red},
      ]}/>

      <ChartCard title="Net cash flow by month" T={T}>
        <AreaChart T={T} accent={accent} fmt={fmtCompact}
          data={mData.map(m => ({ label: m.label, value: m.net }))}/>
      </ChartCard>

      <ReportTable T={T} accent={accent}
        headers={[{label:'Month',width:'80px'},{label:'Rent income',right:true,width:'140px'},{label:'Expenses',right:true,width:'140px'},{label:'Net cash flow',right:true,width:'140px'}]}
        rows={mData.map(m=>[
          {v:m.label,color:T.muted},
          {v:fmt(m.rent),color:T.green,right:true},
          {v:fmt(m.exp),color:T.red,right:true},
          {v:fmt(m.net),color:m.net>=0?T.green:T.red,bold:true,right:true},
        ])}
      />
    </>
  )
}

function ReportEquity({ filtProps, T, accent, fmt, fmtPct }) {
  const rows = filtProps.map(p => ({
    p,
    value: p.est_value||0,
    debt: p.mortgage_amount||0,
    equity: (p.est_value||0)-(p.mortgage_amount||0),
    ltv: p.est_value ? ((p.mortgage_amount||0)/(p.est_value||1))*100 : 0,
  })).sort((a,b)=>b.equity-a.equity)
  const totals = rows.reduce((s,r)=>({value:s.value+r.value,debt:s.debt+r.debt,equity:s.equity+r.equity}),{value:0,debt:0,equity:0})
  return (
    <>
      <StatCards T={T} items={[
        {label:'Portfolio value',value:fmt(totals.value),color:accent},
        {label:'Total debt',value:fmt(totals.debt),color:T.amber},
        {label:'Total equity',value:fmt(totals.equity),color:T.green},
        {label:'Portfolio LTV',value:totals.value>0?fmtPct((totals.debt/totals.value)*100):'—',color:totals.debt/totals.value<0.75?T.green:T.amber},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Est. value',right:true,width:'130px'},{label:'Mortgage',right:true,width:'130px'},{label:'Equity',right:true,width:'130px'},{label:'LTV',right:true,width:'90px'}]}
        rows={rows.map(r=>[
          r.p.name,
          {v:fmt(r.value),right:true},
          {v:fmt(r.debt),color:T.amber,right:true},
          {v:fmt(r.equity),color:r.equity>=0?T.green:T.red,bold:true,right:true},
          {v:r.ltv>0?fmtPct(r.ltv):'—',color:r.ltv<75?T.green:r.ltv<85?T.amber:T.red,right:true},
        ])}
      />
    </>
  )
}

function ReportMortgagePortfolio({ filtProps, T, accent, fmt, fmtPct }) {
  // mortgage_rate stored as decimal (0.05) — monthly rate = rate / 12.
  const rows = filtProps.filter(p=>p.mortgage_amount>0).map(p => {
    const r12 = (p.mortgage_rate||0)/12
    const n = (p.mortgage_term||25)*12
    const monthly = p.mortgage_rate&&p.mortgage_amount
      ? Math.round(p.mortgage_amount * r12 * Math.pow(1+r12,n) / (Math.pow(1+r12,n) - 1))
      : 0
    return {
      p,
      monthly,
      ltv: p.est_value ? ((p.mortgage_amount||0)/p.est_value)*100 : 0,
    }
  })
  const totalDebt = rows.reduce((s,r)=>s+r.p.mortgage_amount,0)
  const totalMonthly = rows.reduce((s,r)=>s+r.monthly,0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Total debt',value:fmt(totalDebt),color:T.amber},
        {label:'Monthly repayments',value:fmt(totalMonthly),color:T.text},
        {label:'Mortgaged properties',value:rows.length,color:T.text},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Loan amount',right:true,width:'130px'},{label:'Rate',right:true,width:'80px'},{label:'Term',right:true,width:'80px'},{label:'Monthly',right:true,width:'120px'},{label:'LTV',right:true,width:'90px'}]}
        rows={rows.map(r=>[
          r.p.name,
          {v:fmt(r.p.mortgage_amount),right:true},
          {v:fmtPct((r.p.mortgage_rate||0)*100),right:true},
          {v:r.p.mortgage_term?`${r.p.mortgage_term}y`:'—',right:true},
          {v:fmt(r.monthly),color:T.amber,right:true},
          {v:r.ltv>0?fmtPct(r.ltv):'—',color:r.ltv<75?T.green:r.ltv<85?T.amber:T.red,right:true},
        ])}
      />
    </>
  )
}

function ReportArrears({ filtProps, T, accent, fmt }) {
  const rows = filtProps.filter(p=>(p.arrears||0)>0).map(p=>({p,arrears:p.arrears||0})).sort((a,b)=>b.arrears-a.arrears)
  const total = rows.reduce((s,r)=>s+r.arrears,0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Properties with arrears',value:rows.length,color:rows.length>0?T.red:T.green},
        {label:'Total arrears',value:fmt(total),color:total>0?T.red:T.green},
        {label:'Clear properties',value:filtProps.length-rows.length,color:T.green},
      ]}/>
      {rows.length===0
        ? <div style={{background:T.green+'18',border:`1px solid ${T.green}44`,borderRadius:12,padding:'24px 20px',textAlign:'center',fontFamily:mono,fontSize:13,color:T.green}}>No arrears — all clear!</div>
        : <ReportTable T={T} accent={accent}
            headers={[{label:'Property'},{label:'Arrears amount',right:true,width:'160px'},{label:'Monthly rent',right:true,width:'140px'},{label:'Status',width:'120px'}]}
            rows={rows.map(r=>[
              r.p.name,
              {v:fmt(r.arrears),color:T.red,bold:true,right:true},
              {v:fmt(r.p.rent_pcm),right:true},
              {v:'Overdue',color:T.red},
            ])}
          />
      }
    </>
  )
}

function ReportCompliance({ filtComp, T, accent }) {
  const rows = filtComp.map(c => {
    const days = daysUntil(c.expiry_date)
    const status = !c.expiry_date ? 'no-date' : days < 0 ? 'expired' : days <= 60 ? 'expiring' : 'valid'
    return { c, days, status }
  }).sort((a,b) => {
    const order = { expired:-1, expiring:0, 'no-date':1, valid:2 }
    if ((order[a.status]||0) !== (order[b.status]||0)) return (order[a.status]||0)-(order[b.status]||0)
    return (a.days ?? 9999) - (b.days ?? 9999)
  })
  const expired = rows.filter(r=>r.status==='expired')
  const expiring = rows.filter(r=>r.status==='expiring')
  const valid = rows.filter(r=>r.status==='valid')
  const statusColor = { expired:T.red, expiring:T.amber, valid:T.green, 'no-date':T.muted }
  const statusLabel = { expired:'EXPIRED', expiring:'Expiring soon', valid:'Valid', 'no-date':'No date set' }
  return (
    <>
      <StatCards T={T} items={[
        {label:'Expired',value:expired.length,color:expired.length>0?T.red:T.green},
        {label:'Expiring within 60 days',value:expiring.length,color:expiring.length>0?T.amber:T.green},
        {label:'Valid',value:valid.length,color:T.green},
        {label:'Total certificates',value:rows.length,color:T.text},
      ]}/>

      {/* "Expiring certificates" — previously a standalone report, now a
          highlighted block at the top of this one. Covers everything
          within 90 days. Skipped when nothing's expiring. */}
      {(expired.length + expiring.length) > 0 && (
        <div style={{background:T.red+'11',border:`1px solid ${T.red}33`,borderRadius:12,padding:'16px 18px',marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <span style={{fontSize:14}}>⏰</span>
            <h3 style={{fontSize:13,fontWeight:700,color:T.text,margin:0}}>Action needed — {expired.length + expiring.length} certificates need attention</h3>
          </div>
          <div style={{display:'grid',gap:6}}>
            {[...expired, ...expiring].slice(0,8).map((r,i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,fontFamily:mono,fontSize:11}}>
                <span style={{color:T.text}}>{r.c.property?.name||'—'} · {r.c.item_type||r.c.type||'—'}</span>
                <span style={{color:r.status==='expired'?T.red:T.amber,fontWeight:700,whiteSpace:'nowrap'}}>
                  {r.status === 'expired' ? `${Math.abs(r.days)} days overdue` : `${r.days} days left`}
                </span>
              </div>
            ))}
            {(expired.length + expiring.length) > 8 && (
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:4}}>+ {expired.length + expiring.length - 8} more below</div>
            )}
          </div>
        </div>
      )}

      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Certificate type'},{label:'Expiry date',width:'120px'},{label:'Days',right:true,width:'80px'},{label:'Status',width:'130px'}]}
        rows={rows.map(r=>[
          r.c.property?.name||'—',
          r.c.item_type||r.c.type||'—',
          r.c.expiry_date||'—',
          {v:r.days!=null?r.days:'—',right:true,color:r.days<0?T.red:r.days<60?T.amber:T.green},
          {v:statusLabel[r.status],color:statusColor[r.status],bold:r.status==='expired'},
        ])}
      />
    </>
  )
}

function ReportTenancySchedule({ filtTen, T, accent, fmt }) {
  const today = new Date()
  const rows = filtTen.map(t => {
    const endDays = t.end_date ? daysUntil(t.end_date) : null
    return { t, endDays }
  }).sort((a,b)=>(a.endDays||9999)-(b.endDays||9999))
  return (
    <>
      <StatCards T={T} items={[
        {label:'Active tenancies',value:filtTen.filter(t=>t.status==='active'||!t.status).length,color:T.green},
        {label:'Expiring within 90 days',value:rows.filter(r=>r.endDays!=null&&r.endDays<=90&&r.endDays>=0).length,color:T.amber},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Tenant'},{label:'Start date',width:'110px'},{label:'End date',width:'110px'},{label:'Rent',right:true,width:'110px'},{label:'Days to end',right:true,width:'110px'}]}
        rows={rows.map(r=>[
          r.t.property?.name||'—',
          r.t.tenant_name||'—',
          r.t.start_date||'—',
          r.t.end_date||'Rolling',
          {v:fmt(r.t.property?.rent_pcm),right:true},
          {v:r.endDays!=null?r.endDays:'—',color:r.endDays!=null&&r.endDays<=90?T.amber:T.green,right:true},
        ])}
      />
    </>
  )
}

function ReportMaintenance({ filtMaint, T, accent, fmt }) {
  const withCost = filtMaint.filter(m=>m.cost>0)
  const total = withCost.reduce((s,m)=>s+(m.cost||0),0)
  const byProp = filtMaint.reduce((acc,m)=>{
    const k = m.property?.name||'Unknown'
    acc[k]=(acc[k]||0)+(m.cost||0); return acc
  },{})

  // Open / in-progress jobs — previously a separate report, now folded
  // here. Sorted by priority urgency.
  const open = filtMaint.filter(m => m.status === 'open' || m.status === 'in-progress')
  const priorityOrder = { urgent:0, high:1, normal:2 }
  const openSorted = [...open].sort((a,b) => (priorityOrder[a.priority]||2) - (priorityOrder[b.priority]||2))
  const urgent = open.filter(m => m.priority === 'urgent').length

  return (
    <>
      <StatCards T={T} items={[
        {label:'Total maintenance spend',value:fmt(total),color:T.amber},
        {label:'Jobs with costs',value:withCost.length,color:T.text},
        {label:'Average job cost',value:withCost.length?fmt(Math.round(total/withCost.length)):'—',color:T.text},
        {label:'Open jobs',value:open.length,color:open.length>0?T.amber:T.green},
      ]}/>

      {open.length > 0 && (
        <>
          <SectionTitle title={`Open jobs (${open.length})${urgent>0?` · ${urgent} urgent`:''}`} T={T}/>
          <ReportTable T={T} accent={accent}
            headers={[{label:'Property'},{label:'Issue'},{label:'Priority',width:'90px'},{label:'Status',width:'110px'},{label:'Reported',width:'110px'}]}
            rows={openSorted.map(m=>[
              m.property?.name || '—',
              m.title || m.description || '—',
              {v: m.priority || 'normal', color: m.priority === 'urgent' ? T.red : m.priority === 'high' ? T.amber : T.muted, bold: m.priority === 'urgent'},
              {v: m.status || 'open', color: m.status === 'in-progress' ? T.blue : T.amber},
              {v: m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—', color: T.muted},
            ])}
          />
        </>
      )}

      <SectionTitle title="Spend by property" T={T}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Property'},{label:'Total spend',right:true,width:'150px'},{label:'Jobs',right:true,width:'80px'}]}
        rows={Object.entries(byProp).sort((a,b)=>b[1]-a[1]).map(([name,amt])=>[
          name,
          {v:fmt(amt),color:T.amber,bold:true,right:true},
          {v:filtMaint.filter(m=>m.property?.name===name).length,right:true},
        ])}
      />
    </>
  )
}

function ReportContractorSpend({ filtMaint, T, accent, fmt }) {
  const byContractor = filtMaint.filter(m=>m.contractor&&m.cost>0).reduce((acc,m)=>{
    const k=m.contractor; if(!acc[k]) acc[k]={name:k,jobs:0,total:0}
    acc[k].jobs++; acc[k].total+=(m.cost||0); return acc
  },{})
  const rows = Object.values(byContractor).sort((a,b)=>b.total-a.total)
  const total = rows.reduce((s,r)=>s+r.total,0)
  return (
    <>
      <StatCards T={T} items={[
        {label:'Total contractor spend',value:fmt(total),color:T.amber},
        {label:'Contractors used',value:rows.length,color:T.text},
        {label:'Top contractor',value:rows[0]?.name||'—',color:accent},
      ]}/>
      <ReportTable T={T} accent={accent}
        headers={[{label:'Contractor'},{label:'Total paid',right:true,width:'150px'},{label:'Jobs',right:true,width:'80px'},{label:'Avg per job',right:true,width:'120px'}]}
        rows={rows.map(r=>[
          r.name,
          {v:fmt(r.total),color:T.amber,bold:true,right:true},
          {v:r.jobs,right:true},
          {v:fmt(Math.round(r.total/r.jobs)),right:true},
        ])}
      />
      {rows.length===0&&<div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:'20px 0'}}>No contractor costs recorded. Add costs and contractor names in the Maintenance tab.</div>}
    </>
  )
}
