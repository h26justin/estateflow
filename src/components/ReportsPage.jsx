import { useState, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
const fmtPct = n => ((n||0)).toFixed(1)+'%'
const mono = "'DM Mono',monospace"

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// UK tax year: 6 Apr to 5 Apr
function getTaxYearRange(year) {
  return {
    from: new Date(`${year}-04-06`),
    to:   new Date(`${year+1}-04-05`),
    label: `${year}/${String(year+1).slice(2)} UK Tax Year (6 Apr ${year} – 5 Apr ${year+1})`
  }
}
function getCalendarYearRange(year) {
  return {
    from: new Date(`${year}-01-01`),
    to:   new Date(`${year}-12-31`),
    label: `${year} Calendar Year`
  }
}

// ── REPORT CATALOGUE ──────────────────────────────────────────────────────────
const REPORTS = [
  // Tax & Accounting
  { id:'pnl',          cat:'tax',         icon:'📊', title:'Annual P&L',               desc:'Income vs expenses per property. Net profit, gross income and total costs for the year.' },
  { id:'income_sched', cat:'tax',         icon:'📅', title:'Rental income schedule',   desc:'Month-by-month rent received per property. Ideal for SA105 self-assessment forms.' },
  { id:'expense_break',cat:'tax',         icon:'🧾', title:'Expense breakdown',         desc:'All expenses grouped by category — repairs, agent fees, insurance, utilities.' },
  { id:'mortgage_int', cat:'tax',         icon:'🏦', title:'Mortgage interest summary', desc:'Total interest paid per property. Section 24 finance cost for tax relief calculations.' },
  { id:'capital_gains',cat:'tax',         icon:'📈', title:'Capital gains summary',     desc:'Purchase cost vs current value, unrealised gain and equity per property.' },
  // Portfolio Performance
  { id:'yield',        cat:'performance', icon:'💰', title:'Yield comparison',          desc:'Gross and net yield ranked across all properties. Spot your best and worst performers.' },
  { id:'cashflow',     cat:'performance', icon:'💷', title:'Monthly cash flow',         desc:'Rent in vs all costs out, month by month. See your net cash position clearly.' },
  { id:'occupancy',    cat:'performance', icon:'🏠', title:'Occupancy rate',            desc:'Occupancy percentage, void periods and the cost of empty properties.' },
  { id:'rent_coll',    cat:'performance', icon:'✅', title:'Rent collection rate',      desc:'Payment rates by property. Flags late payers and shows arrears trends.' },
  { id:'performers',   cat:'performance', icon:'🏆', title:'Best & worst performers',   desc:'Properties ranked by profit, yield and return on investment.' },
  // Finance
  { id:'equity',       cat:'finance',     icon:'🏛', title:'Equity report',             desc:'Portfolio value, outstanding mortgage debt, equity and LTV ratio per property.' },
  { id:'mortgage_port',cat:'finance',     icon:'📋', title:'Mortgage portfolio',        desc:'All mortgages with rates, terms, monthly payments and upcoming expiry dates.' },
  { id:'arrears',      cat:'finance',     icon:'⚠️', title:'Arrears report',            desc:'Outstanding rent by property and tenant. Days overdue and total owed.' },
  // Compliance & Legal
  { id:'compliance',   cat:'compliance',  icon:'📋', title:'Compliance status',         desc:'All certificates across every property with RAG status — valid, expiring or expired.' },
  { id:'expiring',     cat:'compliance',  icon:'⏰', title:'Expiring certificates',     desc:'Certificates expiring within 90 days sorted by urgency.' },
  { id:'tenancy_sched',cat:'compliance',  icon:'📄', title:'Tenancy schedule',          desc:'All tenancies with start/end dates, notice periods and upcoming renewals.' },
  // Maintenance
  { id:'maint_cost',   cat:'maintenance', icon:'🔧', title:'Maintenance costs',         desc:'Spend by property, trade type and contractor over a selected period.' },
  { id:'open_jobs',    cat:'maintenance', icon:'🛠', title:'Open jobs',                 desc:'All outstanding maintenance jobs by priority and age.' },
  { id:'refurb',       cat:'maintenance', icon:'🏗', title:'Refurb cost tracker',       desc:'Budgeted vs actual spend per refurbishment project.' },
  { id:'contractor',   cat:'maintenance', icon:'👷', title:'Contractor spend',          desc:'Total paid to each contractor, job counts and average cost per job.' },
]

const CATS = [
  { id:'all',         label:'All reports' },
  { id:'tax',         label:'Tax & accounting' },
  { id:'performance', label:'Portfolio performance' },
  { id:'finance',     label:'Finance' },
  { id:'compliance',  label:'Compliance & legal' },
  { id:'maintenance', label:'Maintenance' },
]

const CAT_COLORS = {
  tax:'#4B8FE0', performance:'#2ECC8A', finance:'#9B59B6',
  compliance:'#E0943A', maintenance:'#E05555',
}

export default function ReportsPage({ properties, companies, companySettings, user }) {
  const { T } = useTheme()
  const [cat, setCat]       = useState('all')
  const [openReport, setOpenReport] = useState(null)

  const visible = cat === 'all' ? REPORTS : REPORTS.filter(r => r.cat === cat)

  return (
    <div className="fade">
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:28,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Reports & Analytics</h1>
        <p style={{fontFamily:mono,color:T.muted,fontSize:12}}>
          {REPORTS.length} reports · click any report to open it full screen with filters and export options
        </p>
      </div>

      {/* Category filter */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:28}}>
        {CATS.map(c=>(
          <button key={c.id} onClick={()=>setCat(c.id)}
            style={{fontFamily:mono,fontSize:11,padding:'6px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.15s',
              border:`1px solid ${cat===c.id?(CAT_COLORS[c.id]||T.gold):T.border}`,
              background:cat===c.id?(CAT_COLORS[c.id]||T.gold)+'22':'transparent',
              color:cat===c.id?(CAT_COLORS[c.id]||T.gold):T.muted,
              fontWeight:cat===c.id?700:400}}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Report cards grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
        {visible.map(r=>{
          const cc = CAT_COLORS[r.cat]
          return (
            <div key={r.id} className="card" onClick={()=>setOpenReport(r)}
              style={{padding:'22px 24px',cursor:'pointer',transition:'border-color 0.18s,transform 0.18s',borderLeft:`3px solid ${cc}`}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=cc;e.currentTarget.style.transform='translateY(-2px)'}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=cc;e.currentTarget.style.transform='none'}}>
              <div style={{fontSize:26,marginBottom:12}}>{r.icon}</div>
              <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:6}}>{r.title}</div>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.7,marginBottom:14}}>{r.desc}</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:cc+'22',color:cc,textTransform:'uppercase',letterSpacing:'0.08em'}}>
                  {CATS.find(c=>c.id===r.cat)?.label}
                </span>
                <span style={{fontFamily:mono,fontSize:11,color:cc,fontWeight:700}}>Open →</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Full-screen report viewer */}
      {openReport && (
        <ReportViewer
          report={openReport}
          properties={properties}
          companies={companies}
          companySettings={companySettings}
          user={user}
          T={T}
          onClose={()=>setOpenReport(null)}
        />
      )}
    </div>
  )
}

// ── REPORT VIEWER ─────────────────────────────────────────────────────────────
function ReportViewer({ report, properties, companies, companySettings, user, T, onClose }) {
  const currentYear = new Date().getFullYear()
  const defaultYearType = coFilter !== 'all'
    ? (companySettings[coFilter]?.year_type || 'tax_year')
    : 'tax_year'
  const [year, setYear]         = useState(currentYear - 1)
  const [yearType, setYearType] = useState(defaultYearType)
  const [coFilter, setCoFilter] = useState('all')
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState(null)

  const dateRange = useMemo(()=>
    yearType === 'tax_year' ? getTaxYearRange(year) : getCalendarYearRange(year)
  , [year, yearType])

  const filteredProps = useMemo(()=>
    coFilter === 'all' ? properties : properties.filter(p=>p.company_id===coFilter)
  , [properties, coFilter])

  const companyIds = useMemo(()=>
    coFilter === 'all' ? companies.map(c=>c.id) : [coFilter]
  , [companies, coFilter])

  useEffect(()=>{ loadData() }, [report.id, year, yearType, coFilter])

  async function loadData() {
    setLoading(true)
    try {
      const from = dateRange.from.toISOString().split('T')[0]
      const to   = dateRange.to.toISOString().split('T')[0]

      const [expenses, payments, compliance, tenancies, maintenance] = await Promise.all([
        supabase.from('property_expenses').select('*,property:properties(name,company_id)')
          .gte('date', from).lte('date', to).then(r=>r.data||[]),
        supabase.from('rent_payments').select('*,property:properties(id,name,rent_pcm,company_id,company:companies(name,abbr,color))')
          .then(r=>(r.data||[]).filter(p=>p.property&&companyIds.includes(p.property.company_id))),
        supabase.from('compliance_items').select('*,property:properties(id,name,company_id,company:companies(name,abbr,color))')
          .then(r=>(r.data||[]).filter(d=>d.property&&companyIds.includes(d.property.company_id))),
        supabase.from('tenancy_details').select('*,property:properties(id,name,rent_pcm,company_id,company:companies(name,abbr,color))')
          .then(r=>(r.data||[]).filter(d=>d.property&&companyIds.includes(d.property.company_id))),
        supabase.from('maintenance_jobs').select('*,property:properties(id,name,company_id,company:companies(name,abbr,color))')
          .then(r=>(r.data||[]).filter(d=>d.property&&companyIds.includes(d.property.company_id))),
      ])

      const filtExp = expenses.filter(e=>e.property&&companyIds.includes(e.property.company_id))
      setData({ expenses: filtExp, payments, compliance, tenancies, maintenance })
    } catch(e) {}
    setLoading(false)
  }

  function exportCSV(rows, filename) {
    const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv'})
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href=url; a.download=`${filename}-${year}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const years = Array.from({length:6},(_,i)=>currentYear-i)
  const cc    = CAT_COLORS[report.cat]

  return (
    <div style={{position:'fixed',inset:0,background:T.bg,zIndex:300,overflowY:'auto',display:'flex',flexDirection:'column'}}>
      {/* Header */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 24px',position:'sticky',top:0,zIndex:10}}>
        <div style={{maxWidth:1200,margin:'0 auto',display:'flex',alignItems:'center',gap:16,height:60,flexWrap:'wrap'}}>
          <button onClick={onClose} style={{fontFamily:mono,fontSize:11,background:'none',border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,padding:'6px 12px',cursor:'pointer',flexShrink:0}}>← Reports</button>
          <div style={{display:'flex',alignItems:'center',gap:10,flex:1}}>
            <span style={{fontSize:20}}>{report.icon}</span>
            <span style={{fontSize:17,fontWeight:700,color:T.text}}>{report.title}</span>
            <span style={{fontFamily:mono,fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:cc+'22',color:cc}}>{CATS.find(c=>c.id===report.cat)?.label}</span>
          </div>
          {/* Filters */}
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            {/* Year type toggle */}
            <div style={{display:'flex',background:T.bg,borderRadius:8,border:`1px solid ${T.border}`,overflow:'hidden'}}>
              {[['tax_year','Tax year'],['calendar','Calendar']].map(([k,l])=>(
                <button key={k} onClick={()=>setYearType(k)}
                  style={{fontFamily:mono,fontSize:10,padding:'5px 10px',border:'none',cursor:'pointer',
                    background:yearType===k?T.gold:'transparent',color:yearType===k?T.bg:T.muted,fontWeight:yearType===k?700:400}}>
                  {l}
                </button>
              ))}
            </div>
            <select value={year} onChange={e=>setYear(Number(e.target.value))}
              style={{fontFamily:mono,fontSize:11,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'5px 10px'}}>
              {years.map(y=><option key={y} value={y}>{yearType==='tax_year'?`${y}/${y+1}`:y}</option>)}
            </select>
            {companies.length > 1 && (
              <select value={coFilter} onChange={e=>{
                const v=e.target.value
                setCoFilter(v)
                if(v!=='all'&&companySettings[v]?.year_type) setYearType(companySettings[v].year_type)
              }}
                style={{fontFamily:mono,fontSize:11,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'5px 10px'}}>
                <option value="all">All companies</option>
                {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Report content */}
      <div style={{maxWidth:1200,margin:'0 auto',padding:'28px 24px',width:'100%',flex:1}}>
        <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20}}>
          {dateRange.label} · {filteredProps.length} properties
        </div>

        {loading ? (
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:80,fontFamily:mono,fontSize:12,color:T.muted}}>Loading report…</div>
        ) : (
          <ReportContent
            report={report} properties={filteredProps} companies={companies}
            companySettings={companySettings} data={data} dateRange={dateRange}
            year={year} yearType={yearType} T={T} fmt={fmt} fmtPct={fmtPct}
            onExportCSV={exportCSV}
          />
        )}
      </div>
    </div>
  )
}

// ── REPORT CONTENT ROUTER ─────────────────────────────────────────────────────
function ReportContent({ report, properties, companies, companySettings, data, dateRange, year, yearType, T, fmt, fmtPct, onExportCSV }) {
  const props = { properties, companies, companySettings, data, dateRange, year, T, fmt, fmtPct, onExportCSV }
  switch(report.id) {
    case 'pnl':          return <PnLReport {...props}/>
    case 'income_sched': return <IncomeScheduleReport {...props}/>
    case 'expense_break':return <ExpenseBreakdownReport {...props}/>
    case 'mortgage_int': return <MortgageInterestReport {...props}/>
    case 'capital_gains':return <CapitalGainsReport {...props}/>
    case 'yield':        return <YieldReport {...props}/>
    case 'cashflow':     return <CashFlowReport {...props}/>
    case 'occupancy':    return <OccupancyReport {...props}/>
    case 'rent_coll':    return <RentCollectionReport {...props}/>
    case 'performers':   return <PerformersReport {...props}/>
    case 'equity':       return <EquityReport {...props}/>
    case 'mortgage_port':return <MortgagePortfolioReport {...props}/>
    case 'arrears':      return <ArrearsReport {...props}/>
    case 'compliance':   return <ComplianceStatusReport {...props}/>
    case 'expiring':     return <ExpiringCertsReport {...props}/>
    case 'tenancy_sched':return <TenancyScheduleReport {...props}/>
    case 'maint_cost':   return <MaintenanceCostReport {...props}/>
    case 'open_jobs':    return <OpenJobsReport {...props}/>
    case 'refurb':       return <RefurbReport {...props}/>
    case 'contractor':   return <ContractorReport {...props}/>
    default: return <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,padding:40}}>Report coming soon.</div>
  }
}

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────
function Table({ headers, rows, T, onExport, filename }) {
  return (
    <div>
      {onExport && (
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12,gap:8}}>
          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>onExport([headers,...rows],filename||'report')}>⬇ Export CSV</button>
        </div>
      )}
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontFamily:"'DM Mono',monospace",fontSize:12}}>
          <thead>
            <tr style={{borderBottom:`2px solid ${T.border}`}}>
              {headers.map((h,i)=><th key={i} style={{padding:'10px 12px',textAlign:i===0?'left':'right',color:T.muted,fontSize:10,textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:700,whiteSpace:'nowrap'}}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row,ri)=>(
              <tr key={ri} style={{borderBottom:`1px solid ${T.border}`,background:ri%2===0?'transparent':T.bg+'44'}}>
                {row.map((cell,ci)=>(
                  <td key={ci} style={{padding:'10px 12px',textAlign:ci===0?'left':'right',color:typeof cell==='number'&&cell<0?T.red:T.text}}>
                    {typeof cell === 'number' ? fmt(cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KpiRow({ items, T }) {
  return (
    <div style={{display:'grid',gridTemplateColumns:`repeat(${items.length},1fr)`,gap:12,marginBottom:24}}>
      {items.map(item=>(
        <div key={item.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'18px 20px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{item.label}</div>
          <div style={{fontSize:22,fontWeight:700,color:item.color||T.gold,letterSpacing:'-0.02em'}}>{item.value}</div>
          {item.sub && <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginTop:4}}>{item.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function RAGBadge({ status, T }) {
  const cfg = status==='expired'?{bg:T.red+'22',color:T.red,label:'Expired'}
    :status==='expiring'?{bg:T.amber+'22',color:T.amber,label:'Expiring'}
    :{bg:T.green+'22',color:T.green,label:'Valid'}
  return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
}

function ragStatus(expiryDate) {
  if (!expiryDate) return 'expired'
  const days = Math.ceil((new Date(expiryDate)-new Date())/(1000*60*60*24))
  if (days < 0) return 'expired'
  if (days < 90) return 'expiring'
  return 'valid'
}

// ── INDIVIDUAL REPORTS ────────────────────────────────────────────────────────

function PnLReport({ properties, data, T, fmt, fmtPct, onExportCSV }) {
  const rows = properties.map(p=>{
    const rent = p.status==='rented'?(p.rent_pcm||0)*12:0
    const exp = (data.expenses||[]).filter(e=>e.property_id===p.id).reduce((s,e)=>s+(e.amount||0),0)
    const net = rent - exp
    return { p, rent, exp, net }
  }).sort((a,b)=>b.net-a.net)
  const totRent = rows.reduce((s,r)=>s+r.rent,0)
  const totExp  = rows.reduce((s,r)=>s+r.exp,0)
  const totNet  = totRent - totExp
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total rental income', value:fmt(totRent), color:T.green},
        {label:'Total expenses',      value:fmt(totExp),  color:T.red},
        {label:'Net profit',          value:fmt(totNet),  color:totNet>=0?T.green:T.red},
        {label:'Profit margin',       value:totRent>0?fmtPct((totNet/totRent)*100):'—', color:T.gold},
      ]}/>
      <Table T={T} headers={['Property','Company','Annual rent','Expenses','Net profit','Margin']}
        onExport={onExportCSV} filename="pnl"
        rows={rows.map(r=>[r.p.name,r.p.company?.name||'',r.rent,r.exp,r.net,r.rent>0?fmtPct((r.net/r.rent)*100)+'%':'—'])}/>
    </div>
  )
}

function IncomeScheduleReport({ properties, data, year, yearType, T, fmt, onExportCSV }) {
  const months = yearType==='tax_year'
    ? [3,4,5,6,7,8,9,10,11,0,1,2].map(m=>({m,y:m>=3?year:year+1}))
    : Array.from({length:12},(_,i)=>({m:i,y:year}))

  const rows = properties.map(p=>{
    const monthTotals = months.map(({m,y})=>{
      const payment = (data.payments||[]).find(pay=>pay.property_id===p.id&&pay.month===m+1&&pay.year===y)
      return payment?.status==='paid'?(p.rent_pcm||0):0
    })
    const total = monthTotals.reduce((s,v)=>s+v,0)
    return { p, monthTotals, total }
  })
  const monthlyTotals = months.map((_,i)=>rows.reduce((s,r)=>s+r.monthTotals[i],0))
  const grandTotal = rows.reduce((s,r)=>s+r.total,0)

  const csvRows = [
    ['Property','Company',...months.map(({m})=>MONTH_NAMES[m]),'Total'],
    ...rows.map(r=>[r.p.name,r.p.company?.name||'',...r.monthTotals,r.total]),
    ['TOTAL','',...monthlyTotals,grandTotal],
  ]
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total received', value:fmt(grandTotal), color:T.green},
        {label:'Properties',    value:properties.length},
        {label:'Avg per month', value:fmt(grandTotal/12), color:T.gold},
      ]}/>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>onExportCSV(csvRows,'income-schedule')}>⬇ Export CSV</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontFamily:"'DM Mono',monospace",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:`2px solid ${T.border}`}}>
              <th style={{padding:'8px 10px',textAlign:'left',color:T.muted,fontSize:9,textTransform:'uppercase'}}>Property</th>
              {months.map(({m},i)=><th key={i} style={{padding:'8px 6px',textAlign:'right',color:T.muted,fontSize:9,textTransform:'uppercase'}}>{MONTH_NAMES[m]}</th>)}
              <th style={{padding:'8px 10px',textAlign:'right',color:T.gold,fontSize:9,textTransform:'uppercase'}}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r,ri)=>(
              <tr key={r.p.id} style={{borderBottom:`1px solid ${T.border}`,background:ri%2===0?'transparent':T.bg+'44'}}>
                <td style={{padding:'8px 10px',color:T.text,whiteSpace:'nowrap'}}>{r.p.name}</td>
                {r.monthTotals.map((v,i)=><td key={i} style={{padding:'8px 6px',textAlign:'right',color:v>0?T.text:T.faint}}>{v>0?fmt(v):'—'}</td>)}
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:T.gold}}>{fmt(r.total)}</td>
              </tr>
            ))}
            <tr style={{borderTop:`2px solid ${T.border}`,background:T.bg}}>
              <td style={{padding:'8px 10px',fontWeight:700,color:T.text}}>TOTAL</td>
              {monthlyTotals.map((v,i)=><td key={i} style={{padding:'8px 6px',textAlign:'right',fontWeight:700,color:T.green}}>{fmt(v)}</td>)}
              <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:T.green}}>{fmt(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExpenseBreakdownReport({ properties, data, T, fmt, onExportCSV }) {
  const expenses = data.expenses||[]
  const byCategory = expenses.reduce((acc,e)=>{
    const cat = e.category||'Other'
    if(!acc[cat]) acc[cat]={cat,total:0,count:0,items:[]}
    acc[cat].total+=e.amount||0; acc[cat].count++; acc[cat].items.push(e)
    return acc
  },{})
  const cats = Object.values(byCategory).sort((a,b)=>b.total-a.total)
  const total = cats.reduce((s,c)=>s+c.total,0)
  const rows = cats.map(c=>[c.cat,c.count,c.total,total>0?((c.total/total)*100).toFixed(1)+'%':'—'])
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total expenses',   value:fmt(total),     color:T.red},
        {label:'Categories',       value:cats.length},
        {label:'Expense entries',  value:expenses.length},
        {label:'Avg per property', value:fmt(total/Math.max(properties.length,1)), color:T.amber},
      ]}/>
      <Table T={T} headers={['Category','Entries','Total','% of expenses']}
        onExport={onExportCSV} filename="expenses"
        rows={rows}/>
      <div style={{marginTop:24,background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Category breakdown</div>
        {cats.map(c=>{
          const pct = total>0?(c.total/total)*100:0
          return (
            <div key={c.cat} style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text}}>{c.cat}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:T.red}}>{fmt(c.total)}</span>
              </div>
              <div style={{height:6,background:T.border,borderRadius:3}}>
                <div style={{height:'100%',borderRadius:3,background:T.red,width:`${pct}%`,transition:'width 0.4s'}}/>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MortgageInterestReport({ properties, T, fmt, onExportCSV }) {
  function calcAnnualInterest(p) {
    if(!p.mortgage_amount||!p.mortgage_rate) return 0
    const r=p.mortgage_rate/12/100,n=(p.mortgage_term||25)*12
    const payment=p.mortgage_amount*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1)
    return Math.round(payment*12 - (p.mortgage_amount*(1-Math.pow(1+r,12))/(Math.pow(1+r,n)-1)))
  }
  const rows = properties.filter(p=>p.mortgage_amount).map(p=>({p,interest:calcAnnualInterest(p)})).sort((a,b)=>b.interest-a.interest)
  const totalInterest = rows.reduce((s,r)=>s+r.interest,0)
  const taxCredit = Math.round(totalInterest*0.20)
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total interest paid',    value:fmt(totalInterest), color:T.amber},
        {label:'Section 24 tax credit',  value:fmt(taxCredit),     color:T.green, sub:'20% of total interest'},
        {label:'Mortgaged properties',   value:rows.length},
      ]}/>
      <div style={{background:T.amber+'11',border:`1px solid ${T.amber}44`,borderRadius:10,padding:'12px 16px',marginBottom:16,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.amber,lineHeight:1.7}}>
        ⚠ Section 24: You cannot deduct mortgage interest as an expense. Instead you receive a 20% tax credit on the full interest amount shown above. Share this figure with your accountant.
      </div>
      <Table T={T} headers={['Property','Mortgage balance','Rate','Annual interest','20% credit']}
        onExport={onExportCSV} filename="mortgage-interest"
        rows={rows.map(r=>[r.p.name,r.p.mortgage_amount,fmtPct(r.p.mortgage_rate||0)+'%',r.interest,Math.round(r.interest*0.2)])}/>
    </div>
  )
}

function CapitalGainsReport({ properties, T, fmt, fmtPct, onExportCSV }) {
  const rows = properties.map(p=>{
    const cost = (p.purchase_price||0)+(p.refurb_cost||0)+(p.stamp_duty||0)+(p.legal_fees||0)
    const value = p.est_value||0
    const gain = value - cost
    const gainPct = cost>0?(gain/cost)*100:0
    return {p,cost,value,gain,gainPct}
  }).sort((a,b)=>b.gain-a.gain)
  const totCost  = rows.reduce((s,r)=>s+r.cost,0)
  const totValue = rows.reduce((s,r)=>s+r.value,0)
  const totGain  = totValue-totCost
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total invested',       value:fmt(totCost),  color:T.text},
        {label:'Portfolio value',      value:fmt(totValue), color:T.gold},
        {label:'Unrealised gain',      value:fmt(totGain),  color:totGain>=0?T.green:T.red},
        {label:'Portfolio growth',     value:totCost>0?fmtPct((totGain/totCost)*100):'—', color:T.gold},
      ]}/>
      <div style={{background:T.blue+'11',border:`1px solid ${T.blue}44`,borderRadius:10,padding:'12px 16px',marginBottom:16,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.blue,lineHeight:1.7}}>
        ℹ These are unrealised gains only — CGT is not due until the property is sold. Gains use estimated values which may differ from actual sale prices. Consult your accountant before any disposal.
      </div>
      <Table T={T} headers={['Property','Total cost','Est. value','Unrealised gain','Growth %']}
        onExport={onExportCSV} filename="capital-gains"
        rows={rows.map(r=>[r.p.name,r.cost,r.value,r.gain,fmtPct(r.gainPct)+'%'])}/>
    </div>
  )
}

function YieldReport({ properties, T, fmt, fmtPct, onExportCSV }) {
  const rows = properties.map(p=>{
    const gross = p.est_value>0?((p.rent_pcm||0)*12/p.est_value)*100:0
    const net   = p.purchase_price>0?((p.rent_pcm||0)*12/((p.purchase_price||0)+(p.refurb_cost||0)))*100:0
    return {p,gross,net}
  }).sort((a,b)=>b.gross-a.gross)
  const avgGross = rows.length>0?rows.reduce((s,r)=>s+r.gross,0)/rows.length:0
  const avgNet   = rows.length>0?rows.reduce((s,r)=>s+r.net,0)/rows.length:0
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Avg gross yield',  value:fmtPct(avgGross), color:T.green},
        {label:'Avg net yield',    value:fmtPct(avgNet),   color:T.gold},
        {label:'Best performer',   value:rows[0]?fmtPct(rows[0].gross):'-', color:T.green, sub:rows[0]?.p.name},
        {label:'Worst performer',  value:rows.length>0?fmtPct(rows[rows.length-1].gross):'-', color:T.red, sub:rows[rows.length-1]?.p.name},
      ]}/>
      <div style={{marginBottom:24,background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px'}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Gross yield by property</div>
        {rows.map(r=>(
          <div key={r.p.id} style={{marginBottom:10}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text}}>{r.p.name}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:r.gross>=6?T.green:r.gross>=4?T.amber:T.red}}>{fmtPct(r.gross)}</span>
            </div>
            <div style={{height:6,background:T.border,borderRadius:3}}>
              <div style={{height:'100%',borderRadius:3,background:r.gross>=6?T.green:r.gross>=4?T.amber:T.red,width:`${Math.min(r.gross/12*100,100)}%`}}/>
            </div>
          </div>
        ))}
      </div>
      <Table T={T} headers={['Property','Monthly rent','Gross yield','Net yield (on cost)']}
        onExport={onExportCSV} filename="yield"
        rows={rows.map(r=>[r.p.name,r.p.rent_pcm||0,fmtPct(r.gross)+'%',fmtPct(r.net)+'%'])}/>
    </div>
  )
}

function CashFlowReport({ properties, data, year, yearType, T, fmt, onExportCSV }) {
  const months = yearType==='tax_year'
    ? [3,4,5,6,7,8,9,10,11,0,1,2].map(m=>({m,y:m>=3?year:year+1}))
    : Array.from({length:12},(_,i)=>({m:i,y:year}))
  const monthData = months.map(({m,y})=>{
    const rent = (data.payments||[]).filter(p=>p.month===m+1&&p.year===y&&p.status==='paid').reduce((s,p)=>s+(p.property?.rent_pcm||0),0)
    const exp  = (data.expenses||[]).filter(e=>{const d=new Date(e.date);return d.getMonth()===m&&d.getFullYear()===y}).reduce((s,e)=>s+(e.amount||0),0)
    return {label:MONTH_NAMES[m],rent,exp,net:rent-exp}
  })
  const totRent=monthData.reduce((s,m)=>s+m.rent,0)
  const totExp =monthData.reduce((s,m)=>s+m.exp,0)
  const totNet =totRent-totExp
  const maxVal =Math.max(...monthData.map(m=>Math.abs(m.net)),1)
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total income',  value:fmt(totRent), color:T.green},
        {label:'Total costs',   value:fmt(totExp),  color:T.red},
        {label:'Net cash flow', value:fmt(totNet),  color:totNet>=0?T.green:T.red},
        {label:'Best month',    value:fmt(Math.max(...monthData.map(m=>m.net))), color:T.green},
      ]}/>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 22px',marginBottom:20}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Monthly net cash flow</div>
        <div style={{display:'flex',gap:4,alignItems:'flex-end',height:120}}>
          {monthData.map((m,i)=>{
            const h=Math.abs(m.net)/maxVal*100
            return (
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:m.net>=0?T.green:T.red}}>{m.net>=0?'':''}{fmt(Math.abs(m.net)).replace('£','')}</div>
                <div style={{width:'100%',height:`${Math.max(h,4)}%`,background:m.net>=0?T.green:T.red,borderRadius:'3px 3px 0 0',minHeight:4}}/>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>{m.label}</div>
              </div>
            )
          })}
        </div>
      </div>
      <Table T={T} headers={['Month','Rent in','Costs out','Net cash flow']}
        onExport={onExportCSV} filename="cashflow"
        rows={monthData.map(m=>[m.label,m.rent,m.exp,m.net])}/>
    </div>
  )
}

function OccupancyReport({ properties, T, fmt, fmtPct, onExportCSV }) {
  const rented  = properties.filter(p=>p.status==='rented').length
  const total   = properties.length
  const vacant  = properties.filter(p=>p.status==='vacant').length
  const occRate = total>0?(rented/total)*100:0
  const voidCost= properties.filter(p=>p.status==='vacant').reduce((s,p)=>s+(p.rent_pcm||0),0)
  const rows = properties.map(p=>([p.name,p.status==='rented'?'Rented':p.status==='vacant'?'Vacant':p.status,fmt(p.rent_pcm||0),p.status==='vacant'?fmt((p.rent_pcm||0)*12)+'/yr lost':'—']))
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Occupancy rate',  value:fmtPct(occRate),     color:occRate>=90?T.green:occRate>=75?T.amber:T.red},
        {label:'Rented',          value:rented},
        {label:'Vacant',          value:vacant,              color:vacant>0?T.red:T.green},
        {label:'Monthly void cost',value:fmt(voidCost),      color:voidCost>0?T.red:T.green},
      ]}/>
      <Table T={T} headers={['Property','Status','Monthly rent','Void impact']}
        onExport={onExportCSV} filename="occupancy" rows={rows}/>
    </div>
  )
}

function RentCollectionReport({ properties, data, T, fmt, fmtPct, onExportCSV }) {
  const rows = properties.filter(p=>p.status==='rented').map(p=>{
    const payments = (data.payments||[]).filter(pay=>pay.property_id===p.id)
    const paid   = payments.filter(pay=>pay.status==='paid').length
    const overdue= payments.filter(pay=>pay.status==='overdue').length
    const rate   = payments.length>0?(paid/payments.length)*100:0
    return {p,paid,overdue,total:payments.length,rate,arrears:p.arrears||0}
  }).sort((a,b)=>a.rate-b.rate)
  const avgRate = rows.length>0?rows.reduce((s,r)=>s+r.rate,0)/rows.length:0
  const totalArrears = rows.reduce((s,r)=>s+r.arrears,0)
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Avg collection rate', value:fmtPct(avgRate),    color:avgRate>=95?T.green:avgRate>=85?T.amber:T.red},
        {label:'Total arrears',       value:fmt(totalArrears),  color:totalArrears>0?T.red:T.green},
        {label:'Properties flagged',  value:rows.filter(r=>r.rate<90).length, color:T.red},
      ]}/>
      <Table T={T} headers={['Property','Paid','Overdue','Collection rate','Arrears']}
        onExport={onExportCSV} filename="rent-collection"
        rows={rows.map(r=>[r.p.name,r.paid,r.overdue,fmtPct(r.rate)+'%',r.arrears])}/>
    </div>
  )
}

function PerformersReport({ properties, data, T, fmt, fmtPct, onExportCSV }) {
  const rows = properties.map(p=>{
    const rent = p.status==='rented'?(p.rent_pcm||0)*12:0
    const exp  = (data.expenses||[]).filter(e=>e.property_id===p.id).reduce((s,e)=>s+(e.amount||0),0)
    const net  = rent - exp
    const cost = (p.purchase_price||0)+(p.refurb_cost||0)
    const roi  = cost>0?(net/cost)*100:0
    const gross= p.est_value>0?((p.rent_pcm||0)*12/p.est_value)*100:0
    return {p,rent,exp,net,roi,gross}
  }).sort((a,b)=>b.net-a.net)
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        <div style={{background:T.green+'11',border:`1px solid ${T.green}44`,borderRadius:12,padding:'16px 20px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.green,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Top 3 by profit</div>
          {rows.slice(0,3).map((r,i)=><div key={r.p.id} style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,marginBottom:4}}>{i+1}. {r.p.name} — <span style={{color:T.green,fontWeight:700}}>{fmt(r.net)}/yr</span></div>)}
        </div>
        <div style={{background:T.red+'11',border:`1px solid ${T.red}44`,borderRadius:12,padding:'16px 20px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.red,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Bottom 3 by profit</div>
          {rows.slice(-3).reverse().map((r,i)=><div key={r.p.id} style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,marginBottom:4}}>{i+1}. {r.p.name} — <span style={{color:T.red,fontWeight:700}}>{fmt(r.net)}/yr</span></div>)}
        </div>
      </div>
      <Table T={T} headers={['Rank','Property','Annual rent','Expenses','Net profit','ROI','Gross yield']}
        onExport={onExportCSV} filename="performers"
        rows={rows.map((r,i)=>[i+1,r.p.name,r.rent,r.exp,r.net,fmtPct(r.roi)+'%',fmtPct(r.gross)+'%'])}/>
    </div>
  )
}

function EquityReport({ properties, T, fmt, fmtPct, onExportCSV }) {
  const rows = properties.map(p=>{
    const value  = p.est_value||0
    const debt   = p.mortgage_amount||0
    const equity = value - debt
    const ltv    = value>0?(debt/value)*100:0
    return {p,value,debt,equity,ltv}
  }).sort((a,b)=>b.equity-a.equity)
  const totVal   = rows.reduce((s,r)=>s+r.value,0)
  const totDebt  = rows.reduce((s,r)=>s+r.debt,0)
  const totEq    = totVal-totDebt
  const portLtv  = totVal>0?(totDebt/totVal)*100:0
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Portfolio value',  value:fmt(totVal),  color:T.gold},
        {label:'Total debt',       value:fmt(totDebt), color:T.red},
        {label:'Total equity',     value:fmt(totEq),   color:T.green},
        {label:'Portfolio LTV',    value:fmtPct(portLtv), color:portLtv<60?T.green:portLtv<75?T.amber:T.red},
      ]}/>
      <Table T={T} headers={['Property','Est. value','Mortgage','Equity','LTV']}
        onExport={onExportCSV} filename="equity"
        rows={rows.map(r=>[r.p.name,r.value,r.debt,r.equity,fmtPct(r.ltv)+'%'])}/>
    </div>
  )
}

function MortgagePortfolioReport({ properties, T, fmt, fmtPct, onExportCSV }) {
  function calcMonthly(p) {
    if(!p.mortgage_amount||!p.mortgage_rate) return 0
    const r=p.mortgage_rate/12/100,n=(p.mortgage_term||25)*12
    return Math.round(p.mortgage_amount*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1))
  }
  const rows = properties.filter(p=>p.mortgage_amount).map(p=>({p,monthly:calcMonthly(p)})).sort((a,b)=>b.p.mortgage_amount-a.p.mortgage_amount)
  const totDebt = rows.reduce((s,r)=>s+r.p.mortgage_amount,0)
  const totMo   = rows.reduce((s,r)=>s+r.monthly,0)
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total debt',          value:fmt(totDebt), color:T.red},
        {label:'Monthly repayments',  value:fmt(totMo),   color:T.amber},
        {label:'Annual repayments',   value:fmt(totMo*12),color:T.amber},
        {label:'Mortgaged properties',value:rows.length},
      ]}/>
      <Table T={T} headers={['Property','Balance','Rate','Term','Monthly payment','Est. value']}
        onExport={onExportCSV} filename="mortgages"
        rows={rows.map(r=>[r.p.name,r.p.mortgage_amount,fmtPct(r.p.mortgage_rate||0)+'%',(r.p.mortgage_term||25)+' yrs',r.monthly,r.p.est_value||0])}/>
    </div>
  )
}

function ArrearsReport({ properties, data, T, fmt, onExportCSV }) {
  const rows = properties.filter(p=>(p.arrears||0)>0).map(p=>{
    const overdue = (data.payments||[]).filter(pay=>pay.property_id===p.id&&pay.status==='overdue')
    return {p,arrears:p.arrears||0,months:overdue.length}
  }).sort((a,b)=>b.arrears-a.arrears)
  const total = rows.reduce((s,r)=>s+r.arrears,0)
  if(rows.length===0) return <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:T.green,padding:40,textAlign:'center'}}>✓ No arrears — all rent is up to date</div>
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total arrears',        value:fmt(total),    color:T.red},
        {label:'Properties with arrears',value:rows.length, color:T.red},
      ]}/>
      <Table T={T} headers={['Property','Company','Arrears','Overdue months']}
        onExport={onExportCSV} filename="arrears"
        rows={rows.map(r=>[r.p.name,r.p.company?.name||'',r.arrears,r.months])}/>
    </div>
  )
}

function ComplianceStatusReport({ properties, data, T, onExportCSV }) {
  const items = (data.compliance||[])
  const expired  = items.filter(i=>ragStatus(i.expiry_date)==='expired').length
  const expiring = items.filter(i=>ragStatus(i.expiry_date)==='expiring').length
  const valid    = items.filter(i=>ragStatus(i.expiry_date)==='valid').length
  const rows = items.sort((a,b)=>new Date(a.expiry_date||0)-new Date(b.expiry_date||0))
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total certificates',value:items.length},
        {label:'Valid',             value:valid,    color:T.green},
        {label:'Expiring <90 days', value:expiring, color:T.amber},
        {label:'Expired',           value:expired,  color:T.red},
      ]}/>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>onExportCSV([['Property','Type','Expiry date','Status'],...rows.map(i=>[i.property?.name,i.cert_type,i.expiry_date,ragStatus(i.expiry_date)])],'compliance')}>⬇ Export CSV</button>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontFamily:"'DM Mono',monospace",fontSize:12}}>
          <thead><tr style={{borderBottom:`2px solid ${T.border}`}}>
            {['Property','Type','Expiry date','Status'].map((h,i)=><th key={i} style={{padding:'10px 12px',textAlign:'left',color:T.muted,fontSize:10,textTransform:'uppercase',letterSpacing:'0.08em'}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((item,i)=>{
              const s=ragStatus(item.expiry_date)
              return (
                <tr key={item.id} style={{borderBottom:`1px solid ${T.border}`,background:i%2===0?'transparent':T.bg+'44'}}>
                  <td style={{padding:'10px 12px',color:T.text}}>{item.property?.name||'—'}</td>
                  <td style={{padding:'10px 12px',color:T.text}}>{item.cert_type}</td>
                  <td style={{padding:'10px 12px',color:T.text}}>{item.expiry_date?new Date(item.expiry_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—'}</td>
                  <td style={{padding:'10px 12px'}}><RAGBadge status={s} T={T}/></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExpiringCertsReport({ data, T, onExportCSV }) {
  const items = (data.compliance||[])
    .filter(i=>['expiring','expired'].includes(ragStatus(i.expiry_date)))
    .sort((a,b)=>new Date(a.expiry_date||0)-new Date(b.expiry_date||0))
  if(items.length===0) return <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:T.green,padding:40,textAlign:'center'}}>✓ No certificates expiring within 90 days</div>
  return (
    <div>
      <KpiRow T={T} items={[{label:'Certificates needing attention',value:items.length,color:T.amber}]}/>
      <div style={{display:'grid',gap:10}}>
        {items.map(item=>{
          const days=Math.ceil((new Date(item.expiry_date)-new Date())/(1000*60*60*24))
          const s=ragStatus(item.expiry_date)
          return (
            <div key={item.id} style={{background:T.card,border:`1px solid ${s==='expired'?T.red:T.amber}44`,borderRadius:10,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:T.text,marginBottom:3}}>{item.property?.name} — {item.cert_type}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>
                  {item.expiry_date?new Date(item.expiry_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'No expiry date'}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:s==='expired'?T.red:T.amber}}>
                  {days<0?Math.abs(days)+' days overdue':days+' days left'}
                </span>
                <RAGBadge status={s} T={T}/>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TenancyScheduleReport({ data, T, fmt, onExportCSV }) {
  const items = (data.tenancies||[]).sort((a,b)=>new Date(a.tenancy_end||'9999')-new Date(b.tenancy_end||'9999'))
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total tenancies',value:items.length},
        {label:'Ending <3 months',value:items.filter(i=>{const d=Math.ceil((new Date(i.tenancy_end)-new Date())/(1000*60*60*24));return d>=0&&d<=90}).length,color:T.amber},
        {label:'Periodic (rolling)',value:items.filter(i=>!i.tenancy_end).length},
      ]}/>
      <Table T={T} headers={['Property','Tenant','Start date','End date','Monthly rent','Notice period']}
        onExport={onExportCSV} filename="tenancies"
        rows={items.map(i=>[i.property?.name||'—',i.tenant_name||'—',i.tenancy_start?new Date(i.tenancy_start).toLocaleDateString('en-GB'):'—',i.tenancy_end?new Date(i.tenancy_end).toLocaleDateString('en-GB'):'Rolling',i.property?.rent_pcm||0,i.notice_period||'—'])}/>
    </div>
  )
}

function MaintenanceCostReport({ data, T, fmt, onExportCSV }) {
  const jobs = (data.maintenance||[]).filter(j=>j.cost>0)
  const byTrade = jobs.reduce((acc,j)=>{
    const k=j.trade||'General';if(!acc[k])acc[k]=0;acc[k]+=j.cost||0;return acc
  },{})
  const total = jobs.reduce((s,j)=>s+(j.cost||0),0)
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total maintenance spend',value:fmt(total),color:T.amber},
        {label:'Jobs with costs',value:jobs.length},
        {label:'Avg cost per job',value:fmt(jobs.length>0?total/jobs.length:0)},
      ]}/>
      <Table T={T} headers={['Property','Description','Trade','Cost','Status']}
        onExport={onExportCSV} filename="maintenance-costs"
        rows={jobs.map(j=>[j.property?.name||'—',j.description||'—',j.trade||'—',j.cost||0,j.status||'—'])}/>
    </div>
  )
}

function OpenJobsReport({ data, T, onExportCSV }) {
  const PRIORITY_ORDER={urgent:0,high:1,medium:2,low:3}
  const open = (data.maintenance||[]).filter(j=>j.status!=='complete')
    .sort((a,b)=>(PRIORITY_ORDER[a.priority]??4)-(PRIORITY_ORDER[b.priority]??4))
  const COLORS={urgent:T.red,high:T.amber,medium:T.blue,low:T.muted}
  if(open.length===0) return <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:T.green,padding:40,textAlign:'center'}}>✓ No open maintenance jobs</div>
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Open jobs',  value:open.length},
        {label:'Urgent',     value:open.filter(j=>j.priority==='urgent').length, color:T.red},
        {label:'High',       value:open.filter(j=>j.priority==='high').length,   color:T.amber},
      ]}/>
      <div style={{display:'grid',gap:8}}>
        {open.map(j=>{
          const age=j.created_at?Math.ceil((new Date()-new Date(j.created_at))/(1000*60*60*24)):0
          const pColor=COLORS[j.priority]||T.muted
          return (
            <div key={j.id} style={{background:T.card,border:`1px solid ${T.border}`,borderLeft:`3px solid ${pColor}`,borderRadius:10,padding:'13px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:3}}>{j.description||'Untitled job'}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{j.property?.name} · {age} days old</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,background:pColor+'22',color:pColor,textTransform:'capitalize'}}>{j.priority||'low'}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'capitalize'}}>{j.status}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RefurbReport({ properties, T, fmt, fmtPct, onExportCSV }) {
  const refurbing = properties.filter(p=>p.refurb_cost>0)
  const total = refurbing.reduce((s,p)=>s+(p.refurb_cost||0),0)
  const gainFromRefurb = refurbing.reduce((s,p)=>s+(p.est_value||0)-(p.purchase_price||0)-(p.refurb_cost||0),0)
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total refurb spend', value:fmt(total),           color:T.amber},
        {label:'Properties refurbed',value:refurbing.length},
        {label:'Value added',        value:fmt(gainFromRefurb),  color:gainFromRefurb>0?T.green:T.red, sub:'Est. value − cost'},
      ]}/>
      <Table T={T} headers={['Property','Status','Refurb cost','Est. value','Value added']}
        onExport={onExportCSV} filename="refurb"
        rows={refurbing.map(p=>[p.name,p.refurb_status||'—',p.refurb_cost||0,p.est_value||0,(p.est_value||0)-(p.purchase_price||0)-(p.refurb_cost||0)])}/>
    </div>
  )
}

function ContractorReport({ data, T, fmt, onExportCSV }) {
  const jobs = data.maintenance||[]
  const byContractor = jobs.reduce((acc,j)=>{
    const k=j.contractor||'Unassigned'
    if(!acc[k])acc[k]={name:k,spend:0,jobs:0}
    acc[k].spend+=j.cost||0; acc[k].jobs++
    return acc
  },{})
  const rows = Object.values(byContractor).sort((a,b)=>b.spend-a.spend)
  const total = rows.reduce((s,r)=>s+r.spend,0)
  if(rows.length===0||rows.every(r=>r.name==='Unassigned'))
    return <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,color:T.muted,padding:40,textAlign:'center'}}>No contractor data recorded yet</div>
  return (
    <div>
      <KpiRow T={T} items={[
        {label:'Total contractor spend',value:fmt(total),    color:T.amber},
        {label:'Contractors used',      value:rows.filter(r=>r.name!=='Unassigned').length},
        {label:'Total jobs',            value:jobs.length},
      ]}/>
      <Table T={T} headers={['Contractor','Jobs','Total spend','Avg per job']}
        onExport={onExportCSV} filename="contractors"
        rows={rows.map(r=>[r.name,r.jobs,r.spend,r.jobs>0?Math.round(r.spend/r.jobs):0])}/>
    </div>
  )
}
