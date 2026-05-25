import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { supabase } from '../lib/supabase'
import { isPropertyEarningRent, isPropertyOccupied } from '../lib/propertyStatus'
import { loadCdnScript } from '../lib/loadCdnScript'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'


const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / (1000*60*60*24))
}

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date() - new Date(dateStr)) / (1000*60*60*24))
}

// ── SMART ALERTS DASHBOARD PANEL ─────────────────────────────────────────────
export function SmartAlerts({properties, companies, fmt, openDetail}) {
  const { T } = useTheme()
  const [compliance, setCompliance] = useState([])
  const [tenancies, setTenancies] = useState([])
  const [maintenance, setMaintenance] = useState([])

  useEffect(()=>{
    // Load compliance items expiring soon
    supabase.from('compliance_items').select('*, property:properties(id,name,company_id)')
      .order('expiry_date').then(({data})=>setCompliance(data||[]))
      .catch(()=>{})

    // Load tenancies ending soon
    supabase.from('tenancy_details').select('*, property:properties(id,name,company_id)')
      .not('tenancy_end','is',null).order('tenancy_end').then(({data})=>setTenancies(data||[]))
      .catch(()=>{})

    // Load open maintenance jobs
    supabase.from('maintenance_jobs').select('*, property:properties(id,name,company_id)')
      .neq('status','complete').order('created_at').then(({data})=>setMaintenance(data||[]))
      .catch(()=>{})
  },[])

  const alerts = []

  // Arrears alerts
  properties.filter(p=>(p.arrears||0)>0).forEach(p=>{
    alerts.push({
      type:'arrears', priority:1, icon:'💸', color:T.red,
      title:`${p.name}`, detail:`Arrears: ${fmt(p.arrears)}`,
      property:p, badge:'ARREARS'
    })
  })

  // Vacant properties
  properties.filter(p=>p.status==='vacant').forEach(p=>{
    const days = daysSince(p.updated_at)
    const lost = Math.floor((days||0)/30) * (p.rent_pcm||0)
    alerts.push({
      type:'vacant', priority:2, icon:'🏚', color:T.amber,
      title:`${p.name}`, detail:`Vacant${days?` · ${days}d`:''}${lost>0?` · ${fmt(lost)} lost`:''}`,
      property:p, badge:'VACANT'
    })
  })

  // Compliance expiring within 60 days
  compliance.filter(c=>{
    const d = daysUntil(c.expiry_date)
    return d !== null && d <= 60
  }).forEach(c=>{
    const days = daysUntil(c.expiry_date)
    const prop = properties.find(p=>p.id===c.property?.id)
    alerts.push({
      type:'compliance', priority: days < 0 ? 0 : days <= 30 ? 1 : 2,
      icon:'📋', color: days < 0 ? T.red : days <= 30 ? T.red : T.amber,
      title:`${c.cert_name}`, detail:`${c.property?.name} · ${days<0?`Expired ${Math.abs(days)}d ago`:`Expires in ${days}d`}`,
      property:prop, badge: days<0?'EXPIRED':'EXPIRING'
    })
  })

  // Tenancies ending within 60 days
  tenancies.filter(t=>{
    const d = daysUntil(t.tenancy_end)
    return d !== null && d <= 60
  }).forEach(t=>{
    const days = daysUntil(t.tenancy_end)
    const prop = properties.find(p=>p.id===t.property?.id)
    alerts.push({
      type:'tenancy', priority: days < 0 ? 0 : 2,
      icon:'🤝', color: days < 0 ? T.red : T.amber,
      title:`${t.property?.name}`, detail:`Tenancy ${days<0?`expired ${Math.abs(days)}d ago`:`ends in ${days}d`}`,
      property:prop, badge:'TENANCY'
    })
  })

  // Mortgage rate alerts removed — rates are agreed

  // Open maintenance > 30 days
  maintenance.filter(m=>{
    const days = daysSince(m.date_raised || m.created_at)
    return (days||0) > 30 && m.priority === 'urgent'
  }).forEach(m=>{
    const prop = properties.find(p=>p.id===m.property?.id)
    const days = daysSince(m.date_raised || m.created_at)
    alerts.push({
      type:'maintenance', priority:2, icon:'🔧', color:T.amber,
      title:`${m.title}`, detail:`${m.property?.name} · Urgent job open ${days}d`,
      property:prop, badge:'URGENT'
    })
  })

  // Sort by priority
  alerts.sort((a,b)=>a.priority-b.priority)

  const badgeColor = (badge) => {
    if (badge==='ARREARS'||badge==='EXPIRED') return T.red
    if (badge==='VACANT'||badge==='EXPIRING'||badge==='TENANCY'||badge==='URGENT') return T.amber
    if (badge==='MORTGAGE') return T.purple
    return T.muted
  }

  return (
    <div style={{marginBottom:28}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em'}}>
          Needs Attention
          {alerts.length>0&&<span style={{marginLeft:8,background:T.red,color:'white',borderRadius:20,fontSize:11,fontFamily:"'DM Mono',monospace",padding:'2px 8px',fontWeight:700}}>{alerts.length}</span>}
        </h2>
      </div>
      <div style={{display:'grid',gap:8,maxHeight:520,overflowY:'auto',paddingRight:4}}>
        {alerts.map((alert,i)=>(
          <div key={i} className="card pcard" style={{padding:'12px 18px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',borderLeft:`3px solid ${alert.color}`}}
            onClick={()=>alert.property&&openDetail(alert.property)}>
            <span style={{fontSize:16,flexShrink:0}}>{alert.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{alert.title}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{alert.detail}</div>
            </div>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,color:badgeColor(alert.badge),background:badgeColor(alert.badge)+'22',padding:'2px 6px',borderRadius:20,flexShrink:0}}>{alert.badge}</span>
          </div>
        ))}
        {alerts.length===0&&(
          <div style={{fontFamily:"'DM Mono',monospace",color:T.green,fontSize:12,textAlign:'center',padding:32,background:T.card,borderRadius:12}}>
            ✓ All properties healthy — no alerts
          </div>
        )}
      </div>
    </div>
  )
}

// ── REPORTS PAGE ─────────────────────────────────────────────────────────────
export function ReportsPage({properties, companies, fmt, onImport, companySettings}) {
  const { T } = useTheme()
  const [selectedCompany, setSelectedCompany] = useState('all')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [expenses, setExpenses] = useState([])
  const [loadingExp, setLoadingExp] = useState(true)

  useEffect(()=>{
    supabase.from('property_expenses').select('*, property:properties(name,company_id)')
      .then(({data})=>{ setExpenses(data||[]); setLoadingExp(false) })
      .catch(()=>setLoadingExp(false))
  },[])

  const years = [2024, 2025, 2026, 2027]

  const filteredProps = selectedCompany==='all'
    ? properties
    : properties.filter(p=>p.company_id===selectedCompany)

  const filteredExp = expenses.filter(e=>{
    const yr = new Date(e.date).getFullYear()
    const inYear = yr === selectedYear
    const inCo = selectedCompany==='all' || e.property?.company_id===selectedCompany
    return inYear && inCo
  })

  // P&L calculations
  const annualRent = filteredProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0)*12,0)
  const totalExpenses = filteredExp.reduce((s,e)=>s+(e.amount||0),0)
  const netProfit = annualRent - totalExpenses
  const totalMortgage = filteredProps.reduce((s,p)=>s+(p.mortgage_amount||0),0)
  const totalEquity = filteredProps.reduce((s,p)=>s+(p.est_value||0)-(p.mortgage_amount||0),0)
  // Only include properties that have a real est_value in the average.
  // The previous `v = est_value || 1` fallback was a divide-by-1 disaster
  // for any property with missing valuation — it produced yields like
  // "1,440,000%" (rent × 12 / 1) which then dragged the portfolio average
  // up to nonsense. Exclude rather than mask.
  const yieldable = filteredProps.filter(p => Number(p.est_value) > 0 && Number(p.rent_pcm) > 0)
  const avgYield = yieldable.length > 0
    ? yieldable.reduce((s,p)=>s+((p.rent_pcm*12)/p.est_value)*100, 0) / yieldable.length
    : 0

  // Per-property P&L
  const propPnL = filteredProps.map(p=>{
    const rent = isPropertyEarningRent(p.status) ? (p.rent_pcm||0)*12 : 0
    const exp = filteredExp.filter(e=>e.property_id===p.id).reduce((s,e)=>s+(e.amount||0),0)
    const net = rent - exp
    const yield_ = p.est_value ? ((p.rent_pcm||0)*12/(p.est_value))*100 : 0
    return {...p, annualRent:rent, expenses:exp, netProfit:net, yield:yield_}
  }).sort((a,b)=>b.netProfit-a.netProfit)

  // Expense breakdown by category
  const expByCategory = filteredExp.reduce((acc,e)=>{
    acc[e.category] = (acc[e.category]||0) + e.amount
    return acc
  },{})

  function exportCSV() {
    const rows = [
      ['Property','Company','Status','Annual Rent','Expenses','Net Profit','Gross Yield','Est Value','Mortgage'],
      ...propPnL.map(p=>[
        p.name, p.company?.name||'', p.status,
        p.annualRent, p.expenses, p.netProfit,
        p.yield.toFixed(2)+'%', p.est_value||0, p.mortgage_amount||0
      ])
    ]
    const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], {type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href=url; a.download=`ownproperly-report-${selectedYear}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPDF() {
    await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
    const { jsPDF } = window.jspdf
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210, H = 297
    const gold = [200, 168, 75]
    const dark = [11, 13, 20]
    const surface = [23, 27, 40]
    const muted = [107, 113, 145]
    const green = [46, 204, 138]
    const red = [224, 85, 85]
    const white = [228, 224, 216]

    // ── COVER / HEADER ────────────────────────────────────────
    // Dark header band
    doc.setFillColor(...dark)
    doc.rect(0, 0, W, 42, 'F')

    // Gold accent bar
    doc.setFillColor(...gold)
    doc.rect(0, 0, 4, 42, 'F')

    // Logo text
    doc.setTextColor(...gold)
    doc.setFontSize(20)
    doc.setFont('helvetica','bold')
    doc.text('Own Properly', 14, 16)

    doc.setTextColor(...muted)
    doc.setFontSize(7)
    doc.setFont('helvetica','normal')
    doc.text('PROPERTY MANAGEMENT', 14, 21)

    // Report title
    doc.setTextColor(...white)
    doc.setFontSize(13)
    doc.setFont('helvetica','bold')
    const coName = selectedCompany==='all' ? 'All Companies'
      : companies.find(c=>c.id===selectedCompany)?.name || ''
    doc.text(`Portfolio Report — ${selectedYear}`, 14, 32)
    doc.setFontSize(9)
    doc.setFont('helvetica','normal')
    doc.setTextColor(...muted)
    doc.text(`${coName} · Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`, 14, 38)

    let y = 52

    // ── SUMMARY KPI CARDS ─────────────────────────────────────
    const kpis = [
      {label:'Annual Rent Income', value:fmt(annualRent), color:green},
      {label:'Total Expenses',     value:fmt(totalExpenses), color:red},
      {label:'Net Profit (Est.)',  value:fmt(netProfit), color: netProfit>=0 ? green : red},
      {label:'Portfolio Value',    value:fmt(filteredProps.reduce((s,p)=>s+(p.est_value||0),0)), color:gold},
      {label:'Mortgage Debt',      value:fmt(totalMortgage), color:[155,89,182]},
      {label:'Avg Gross Yield',    value:avgYield.toFixed(2)+'%', color:[75,143,224]},
    ]

    const cardW = (W - 28 - 10) / 3
    kpis.forEach((kpi, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = 14 + col * (cardW + 5)
      const cy = y + row * 22

      // Card background
      doc.setFillColor(...surface)
      doc.roundedRect(x, cy, cardW, 18, 2, 2, 'F')

      // Gold left border
      doc.setFillColor(...kpi.color)
      doc.rect(x, cy, 2, 18, 'F')

      // Label
      doc.setTextColor(...muted)
      doc.setFontSize(6.5)
      doc.setFont('helvetica','normal')
      doc.text(kpi.label.toUpperCase(), x + 5, cy + 6)

      // Value
      doc.setTextColor(...kpi.color)
      doc.setFontSize(11)
      doc.setFont('helvetica','bold')
      doc.text(kpi.value, x + 5, cy + 14)
    })

    y += 50

    // ── DIVIDER ───────────────────────────────────────────────
    doc.setDrawColor(...gold)
    doc.setLineWidth(0.3)
    doc.line(14, y, W - 14, y)
    y += 6

    // ── PROPERTY P&L TABLE ────────────────────────────────────
    doc.setTextColor(...gold)
    doc.setFontSize(10)
    doc.setFont('helvetica','bold')
    doc.text('Property P&L Analysis', 14, y)
    y += 6

    // Table header
    const cols = [
      {label:'Property',    x:14,  w:68, align:'left'},
      {label:'Status',      x:82,  w:22, align:'left'},
      {label:'Annual Rent', x:104, w:28, align:'right'},
      {label:'Expenses',    x:132, w:24, align:'right'},
      {label:'Net Profit',  x:156, w:26, align:'right'},
      {label:'Yield',       x:182, w:14, align:'right'},
    ]

    // Header row background
    doc.setFillColor(...surface)
    doc.rect(14, y, W - 28, 7, 'F')

    doc.setTextColor(...muted)
    doc.setFontSize(6.5)
    doc.setFont('helvetica','bold')
    cols.forEach(col => {
      const tx = col.align==='right' ? col.x + col.w - 1 : col.x + 2
      doc.text(col.label.toUpperCase(), tx, y + 4.5, {align: col.align==='right'?'right':'left'})
    })
    y += 7

    // Data rows
    doc.setFont('helvetica','normal')
    propPnL.forEach((p, i) => {
      if (y > H - 25) {
        doc.addPage()
        // Repeat header on new page
        doc.setFillColor(...dark)
        doc.rect(0, 0, W, 12, 'F')
        doc.setFillColor(...gold)
        doc.rect(0, 0, 4, 12, 'F')
        doc.setTextColor(...gold)
        doc.setFontSize(8)
        doc.setFont('helvetica','bold')
        doc.text('Own Properly — Property P&L (continued)', 14, 8)
        y = 20
        // Re-draw column headers
        doc.setFillColor(...surface)
        doc.rect(14, y, W - 28, 7, 'F')
        doc.setTextColor(...muted)
        doc.setFontSize(6.5)
        cols.forEach(col => {
          const tx = col.align==='right' ? col.x + col.w - 1 : col.x + 2
          doc.text(col.label.toUpperCase(), tx, y + 4.5, {align: col.align==='right'?'right':'left'})
        })
        y += 7
        doc.setFont('helvetica','normal')
      }

      // Alternating row
      if (i % 2 === 0) {
        doc.setFillColor(18, 21, 31)
        doc.rect(14, y, W - 28, 6.5, 'F')
      }

      const rowColor = i % 2 === 0 ? [40,44,60] : surface

      doc.setFontSize(7.5)
      doc.setTextColor(...white)

      // Property name (truncate)
      const maxNameW = 65
      let name = p.name
      doc.setFont('helvetica','bold')
      while (doc.getTextWidth(name) > maxNameW && name.length > 8) name = name.slice(0,-1)
      if (name !== p.name) name += '…'
      doc.text(name, 16, y + 4.5)

      doc.setFont('helvetica','normal')
      doc.setTextColor(...muted)
      doc.text(p.status||'', 84, y + 4.5)

      // Financials
      doc.setTextColor(...(p.annualRent>0 ? green : muted))
      doc.text(p.annualRent>0 ? fmt(p.annualRent) : '—', 130, y + 4.5, {align:'right'})

      doc.setTextColor(...(p.expenses>0 ? red : muted))
      doc.text(p.expenses>0 ? fmt(p.expenses) : '—', 154, y + 4.5, {align:'right'})

      const netCol = p.netProfit >= 0 ? green : red
      doc.setTextColor(...(p.annualRent>0 ? netCol : muted))
      doc.text(p.annualRent>0 ? fmt(p.netProfit) : '—', 180, y + 4.5, {align:'right'})

      doc.setTextColor(...gold)
      doc.text(p.yield>0 ? p.yield.toFixed(1)+'%' : '—', 195, y + 4.5, {align:'right'})

      y += 6.5
    })

    y += 4

    // ── EXPENSE BREAKDOWN ─────────────────────────────────────
    if (Object.keys(expByCategory).length > 0) {
      if (y > H - 60) { doc.addPage(); y = 20 }

      doc.setDrawColor(...gold)
      doc.line(14, y, W - 14, y)
      y += 6

      doc.setTextColor(...gold)
      doc.setFontSize(10)
      doc.setFont('helvetica','bold')
      doc.text('Expense Breakdown', 14, y)
      y += 7

      const sortedExp = Object.entries(expByCategory).sort((a,b)=>b[1]-a[1])
      sortedExp.forEach(([cat, amt]) => {
        const CATEGORY_LABELS = {
          insurance:'Insurance', agent_fees:'Agent / Management Fees', repairs:'Repairs & Maintenance',
          ground_rent:'Ground Rent', service_charge:'Service Charge', utilities:'Utilities',
          mortgage:'Mortgage Payment', legal:'Legal Fees', accountancy:'Accountancy', other:'Other'
        }
        const barW = totalExpenses > 0 ? ((amt / totalExpenses) * 100) : 0
        const barPx = (barW / 100) * 120

        doc.setFontSize(8)
        doc.setFont('helvetica','normal')
        doc.setTextColor(...white)
        doc.text(CATEGORY_LABELS[cat]||cat, 14, y + 3.5)

        // Bar background
        doc.setFillColor(...surface)
        doc.roundedRect(80, y, 120, 5, 1, 1, 'F')

        // Bar fill
        doc.setFillColor(...red)
        if (barPx > 0) doc.roundedRect(80, y, barPx, 5, 1, 1, 'F')

        // Amount
        doc.setTextColor(...red)
        doc.setFont('helvetica','bold')
        doc.text(fmt(amt), W - 14, y + 3.5, {align:'right'})

        y += 8
      })

      // Total
      doc.setFillColor(...surface)
      doc.rect(14, y, W-28, 8, 'F')
      doc.setFontSize(9)
      doc.setFont('helvetica','bold')
      doc.setTextColor(...white)
      doc.text('Total Expenses', 16, y+5.5)
      doc.setTextColor(...red)
      doc.text(fmt(totalExpenses), W-14, y+5.5, {align:'right'})
      y += 12
    }

    // ── FOOTER ────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFillColor(...dark)
      doc.rect(0, H-10, W, 10, 'F')
      doc.setFillColor(...gold)
      doc.rect(0, H-10, W, 0.5, 'F')
      doc.setTextColor(...muted)
      doc.setFontSize(7)
      doc.setFont('helvetica','normal')
      doc.text('Own Properly Property Management — Confidential', 14, H-4)
      doc.text(`Page ${i} of ${pageCount}`, W-14, H-4, {align:'right'})
    }

    doc.save(`ownproperly-report-${selectedYear}.pdf`)
  }

  const CATEGORY_LABELS = {
    insurance:'Insurance', agent_fees:'Agent Fees', repairs:'Repairs',
    ground_rent:'Ground Rent', service_charge:'Service Charge',
    utilities:'Utilities', mortgage:'Mortgage', legal:'Legal', accountancy:'Accountancy', other:'Other'
  }

  return (
    <div className="fade">
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:24}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Reports & Analytics</h1>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12}}>Portfolio performance and P&L analysis</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <select value={selectedCompany} onChange={e=>setSelectedCompany(e.target.value)} style={{fontSize:11}}>
            <option value="all">All Companies</option>
            {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={selectedYear} onChange={e=>setSelectedYear(+e.target.value)} style={{fontSize:11}}>
            {years.map(y=><option key={y}>{y}</option>)}
          </select>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-gold" style={{fontSize:11,background:'#1A1525',color:'#C8A84B',border:'1px solid #C8A84B'}} onClick={exportPDF}>⬇ PDF Report</button>
          {onImport&&(()=>{
            // Show import button if ANY selected company has feature_statements enabled
            const hasFeature = selectedCompany==='all'
              ? companies.some(c=>(companySettings[c.id]||{}).feature_statements)
              : (companySettings[selectedCompany]||{}).feature_statements
            return hasFeature ? (
              <button className="btn btn-gold" style={{fontSize:11,background:'#0D2B1F',color:'#2ECC8A',border:'1px solid #2ECC8A'}} onClick={onImport}>📄 Import Statement</button>
            ) : null
          })()}
        </div>
      </div>

      {/* Summary cards */}
      <div className="kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:20}}>
        {[
          {l:'Annual Rent Income',   v:fmt(annualRent),    c:T.green,  sub:`${filteredProps.filter(p=>isPropertyEarningRent(p.status)).length} rented properties`},
          {l:'Total Expenses',       v:fmt(totalExpenses), c:T.red,    sub:`${selectedYear} recorded expenses`},
          {l:'Net Profit (Est.)',    v:fmt(netProfit),     c:netProfit>=0?T.green:T.red, sub:'Before tax'},
          {l:'Portfolio Value',      v:fmt(filteredProps.reduce((s,p)=>s+(p.est_value||0),0)), c:T.gold, sub:`${filteredProps.length} properties`},
          {l:'Mortgage Debt',        v:fmt(totalMortgage), c:T.purple, sub:`Equity ${fmt(totalEquity)}`},
          {l:'Average Gross Yield',  v:avgYield.toFixed(2)+'%', c:T.blue, sub:'By estimated value'},
        ].map((item,i)=>(
          <div key={i} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,fontWeight:700,color:item.c,marginBottom:2}}>{item.v}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint}}>{item.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:16,marginBottom:20}}>
        {/* Per property P&L table */}
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Property P&L — {selectedYear}</div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontFamily:"'DM Mono',monospace",fontSize:11}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${T.border}`}}>
                  {['Property','Rent','Expenses','Net','Yield'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:h==='Property'?'left':'right',color:T.muted,fontWeight:400,fontSize:10}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {propPnL.map((p,i)=>(
                  <tr key={p.id} style={{borderBottom:`1px solid ${T.border}22`,background:i%2===0?'transparent':T.bg}}>
                    <td style={{padding:'8px 8px',color:T.text,fontSize:11,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</td>
                    <td style={{padding:'8px 8px',textAlign:'right',color:T.green}}>{p.annualRent>0?fmt(p.annualRent):'—'}</td>
                    <td style={{padding:'8px 8px',textAlign:'right',color:p.expenses>0?T.red:T.faint}}>{p.expenses>0?fmt(p.expenses):'—'}</td>
                    <td style={{padding:'8px 8px',textAlign:'right',fontWeight:700,color:p.netProfit>=0?T.green:T.red}}>{p.annualRent>0?fmt(p.netProfit):'—'}</td>
                    <td style={{padding:'8px 8px',textAlign:'right',color:T.gold}}>{p.yield>0?p.yield.toFixed(1)+'%':'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expense breakdown */}
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Expenses by Category</div>
          {Object.keys(expByCategory).length===0
            ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint}}>No expenses recorded for {selectedYear}</div>
            : Object.entries(expByCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>(
              <div key={cat} style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.text}}>{CATEGORY_LABELS[cat]||cat}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:T.red}}>{fmt(amt)}</span>
                </div>
                <div style={{height:4,background:T.bg,borderRadius:2}}>
                  <div style={{height:4,background:T.red,borderRadius:2,width:`${Math.min(100,(amt/totalExpenses)*100)}%`,opacity:0.7}}/>
                </div>
              </div>
            ))
          }
          {totalExpenses>0&&<div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between'}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Total</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:T.red}}>{fmt(totalExpenses)}</span>
          </div>}
        </div>
      </div>

      {/* Yield chart - simple bar chart per company */}
      <div className="card" style={{padding:'18px 20px',marginBottom:20}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Income vs Expenses by Company</div>
        <div style={{display:'grid',gap:12}}>
          {companies.filter(c=>selectedCompany==='all'||c.id===selectedCompany).map(c=>{
            const cProps = properties.filter(p=>p.company_id===c.id)
            const cRent = cProps.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0)*12,0)
            const cExp = filteredExp.filter(e=>e.property?.company_id===c.id).reduce((s,e)=>s+(e.amount||0),0)
            const maxVal = Math.max(cRent, cExp, 1)
            if (cRent===0 && cExp===0) return null
            return (
              <div key={c.id}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:600,color:c.color}}>{c.abbr} {c.name}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:cRent-cExp>=0?T.green:T.red,fontWeight:700}}>Net {fmt(cRent-cExp)}</span>
                </div>
                <div style={{display:'grid',gap:4}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,width:50,flexShrink:0}}>INCOME</span>
                    <div style={{flex:1,height:12,background:T.bg,borderRadius:3}}>
                      <div style={{height:12,background:T.green,borderRadius:3,width:`${(cRent/maxVal)*100}%`,transition:'width 0.5s'}}/>
                    </div>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.green,width:70,textAlign:'right'}}>{fmt(cRent)}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,width:50,flexShrink:0}}>EXPENSES</span>
                    <div style={{flex:1,height:12,background:T.bg,borderRadius:3}}>
                      <div style={{height:12,background:T.red,borderRadius:3,width:`${(cExp/maxVal)*100}%`,opacity:0.7,transition:'width 0.5s'}}/>
                    </div>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.red,width:70,textAlign:'right'}}>{cExp>0?fmt(cExp):'—'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── CONTRACTORS PAGE ──────────────────────────────────────────────────────────
export function ContractorsPage({companies, showToast}) {
  const { T } = useTheme()
  const [contractors, setContractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const blank = {name:'',trade:'',phone:'',email:'',company_ids:[],notes:'',preferred:false}
  const [form, setForm] = useState(blank)
  const s = (k,v) => setForm(f=>({...f,[k]:v}))
  function toggleCompany(id) {
    setForm(f=>({...f, company_ids: f.company_ids.includes(id)
      ? f.company_ids.filter(x=>x!==id)
      : [...f.company_ids, id]
    }))
  }

  const TRADES = ['Plumber','Electrician','Handyman','Carpenter','Plasterer','Painter & Decorator',
    'Roofer','Locksmith','Gas Engineer','Landscaper','Cleaner','Letting Agent','Solicitor','Other']

  useEffect(()=>{ loadContractors() },[])

  async function loadContractors() {
    setLoading(true)
    try {
      const {data} = await supabase.from('contractors').select('*').order('name')
      setContractors(data||[])
    } catch(e) { }
    setLoading(false)
  }

  async function handleSave() {
    if (!form.name||!form.trade) return
    try {
      const {data:{user}} = await supabase.auth.getUser()
      const saveData = {...form, company_id: form.company_ids[0]||null, company_ids_json: JSON.stringify(form.company_ids), user_id:user.id}
      const {data,error} = await supabase.from('contractors')
        .insert(saveData).select().single()
      if (error) throw error
      setContractors(prev=>[...prev,data].sort((a,b)=>a.name.localeCompare(b.name)))
      setForm(blank); setShowForm(false)
      showToast('Contractor added')
    } catch(e) { showToast(e.message,'error') }
  }

  async function handleDelete(id) {
    try {
      await supabase.from('contractors').delete().eq('id',id)
      setContractors(prev=>prev.filter(c=>c.id!==id))
      showToast('Removed')
    } catch(e) { showToast(e.message,'error') }
  }

  const byTrade = contractors.reduce((acc,c)=>{
    const t = c.trade||'Other'
    if (!acc[t]) acc[t]=[]
    acc[t].push(c)
    return acc
  },{})

  return (
    <div className="fade">
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:24}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Contractor Directory</h1>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12}}>{contractors.length} contacts across {Object.keys(byTrade).length} trades</p>
        </div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowForm(v=>!v)}>+ Add Contractor</button>
      </div>

      {showForm&&<div className="card" style={{padding:'18px 20px',marginBottom:20}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Name *</label><input value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Bob Smith"/></div>
          <div><label>Trade *</label><select value={form.trade} onChange={e=>s('trade',e.target.value)}><option value="">Select trade…</option>{TRADES.map(t=><option key={t}>{t}</option>)}</select></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Phone</label><input value={form.phone} onChange={e=>s('phone',e.target.value)} placeholder="07xxx xxxxxx"/></div>
          <div><label>Email</label><input value={form.email} onChange={e=>s('email',e.target.value)} placeholder="contractor@email.com"/></div>
        </div>
        <div style={{marginBottom:12}}>
          <label>Linked Companies</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:6}}>
            {companies.map(co=>{
              const selected = form.company_ids.includes(co.id)
              return (
                <button key={co.id} type="button" onClick={()=>toggleCompany(co.id)}
                  style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                    border:`1px solid ${selected?co.color:T.border}`,
                    background:selected?co.color+'22':'transparent',
                    color:selected?co.color:T.muted,transition:'all 0.18s'}}>
                  {selected?'✓ ':''}{co.abbr} {co.name}
                </button>
              )
            })}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <input type="checkbox" checked={form.preferred} onChange={e=>s('preferred',e.target.checked)} style={{width:'auto'}}/>
          <label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>⭐ Preferred contractor</label>
        </div>
        <div style={{marginBottom:12}}><label>Notes</label><input value={form.notes} onChange={e=>s('notes',e.target.value)} placeholder="e.g. Available weekends, good rate for block work"/></div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleSave}>Save Contractor</button>
          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setShowForm(false);setForm(blank)}}>Cancel</button>
        </div>
      </div>}

      {loading
        ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading…</div>
        : contractors.length===0
          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.faint,textAlign:'center',padding:40,background:T.card,borderRadius:12}}>No contractors added yet. Add your plumber, electrician and other regular trades here.</div>
          : Object.entries(byTrade).sort().map(([trade,list])=>(
            <div key={trade} style={{marginBottom:20}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>{trade}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10}}>
                {list.map(c=>(
                  <div key={c.id} className="card" style={{padding:'14px 16px',borderLeft:c.preferred?`3px solid ${T.gold}`:`3px solid ${T.border}`}}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:6}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,marginBottom:1}}>
                          {c.preferred&&<span style={{marginRight:4}}>⭐</span>}{c.name}
                        </div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{c.trade}</div>
                      </div>
                      <button onClick={()=>handleDelete(c.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer',flexShrink:0}}>Remove</button>
                    </div>
                    {c.phone&&<a href={`tel:${c.phone}`} style={{display:'block',fontFamily:"'DM Mono',monospace",fontSize:12,color:T.blue,marginBottom:2,textDecoration:'none'}}>📞 {c.phone}</a>}
                    {c.email&&<a href={`mailto:${c.email}`} style={{display:'block',fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginBottom:4,textDecoration:'none'}}>✉ {c.email}</a>}
                    {c.notes&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint,marginTop:4,lineHeight:1.6}}>{c.notes}</div>}
                    {(()=>{
                      const ids = c.company_ids_json ? JSON.parse(c.company_ids_json) : (c.company_id ? [c.company_id] : [])
                      return ids.length>0&&(
                        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                          {ids.map(id=>{
                            const co = companies.find(x=>x.id===id)
                            return co ? <span key={id} style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:co.color,background:co.color+'22',padding:'2px 6px',borderRadius:4,border:`1px solid ${co.color}44`}}>{co.abbr}</span> : null
                          })}
                        </div>
                      )
                    })()}
                  </div>
                ))}
              </div>
            </div>
          ))
      }
    </div>
  )
}

// ── PORTFOLIO GROWTH CHART ────────────────────────────────────────────────────
export function PortfolioChart({properties, companies}) {
  const { T } = useTheme()
  const years = [2020,2021,2022,2023,2024,2025,2026]

  // Cumulative properties and value by year (using purchase_date if available, else estimate)
  const yearData = years.map(yr=>{
    const propsToDate = properties // All properties (we don't have exact purchase dates)
    const rent = properties.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0)
    return {year:yr, properties:properties.length, monthlyRent:rent, value:properties.reduce((s,p)=>s+(p.est_value||0),0)}
  })

  const maxRent = Math.max(...yearData.map(d=>d.monthlyRent),1)
  const maxVal = Math.max(...yearData.map(d=>d.value),1)

  return (
    <div className="card" style={{padding:'18px 20px',marginBottom:20}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Portfolio at a Glance</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
        {[
          {l:'Total Properties', v:properties.length, c:T.gold},
          {l:'Monthly Rent Roll', v:`£${(properties.filter(p=>isPropertyEarningRent(p.status)).reduce((s,p)=>s+(p.rent_pcm||0),0)).toLocaleString()}`, c:T.green},
          {l:'Est. Portfolio Value', v:`£${(properties.reduce((s,p)=>s+(p.est_value||0),0)/1000000).toFixed(1)}m`, c:T.gold},
        ].map((item,i)=>(
          <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{item.l}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:24,fontWeight:700,color:item.c}}>{item.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RENT REVIEW MODAL ────────────────────────────────────────────────────────
export function RentReviewModal({ properties, companies, fmt, yieldBasis, onClose }) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"

  // Only include rented properties with a rent figure
  const eligible = properties.filter(p => (p.rent_pcm || 0) > 0)

  const [globalPct, setGlobalPct]       = useState(0)
  const [scope, setScope]               = useState('all') // 'all' | 'rented' | companyId
  const [overrides, setOverrides]       = useState({})    // { [propId]: pct }
  const [showOverrides, setShowOverrides] = useState(false)
  const [exporting, setExporting]       = useState(false)

  const presets = [
    { label: '−5%',        value: -5   },
    { label: '0%',         value: 0    },
    { label: 'CPIH 2.8%',  value: 2.8  },
    { label: 'CPI 3.1%',   value: 3.1  },
    { label: '5%',         value: 5    },
    { label: '10%',        value: 10   },
  ]

  // Filter by scope
  const inScope = eligible.filter(p => {
    if (scope === 'all')    return true
    if (scope === 'rented') return isPropertyEarningRent(p.status)
    return p.company_id === scope
  })

  // Tenancy status classifier
  function tenancyBadge(p) {
    // notice_given is still rented (tenant paying) but with an imminent
    // end date — so it gets the same date-based classification as a
    // regular rented property. let_agreed / vacant / etc are "vacant"
    // from a tenancy-expiry perspective.
    if (!isPropertyOccupied(p.status)) return { label: 'Vacant',        color: T.green, dot: '🟢' }
    if (!p.tenancy_end)                return { label: 'No end date',   color: T.muted, dot: '⚪' }
    const today = new Date()
    const end = new Date(p.tenancy_end)
    // The property modal accepts free-text dates ("31st March 2026") which
    // Date() can't parse → Invalid Date → previously rendered as
    // "Fixed to Invalid Date". Fall back to showing the raw input so the
    // user at least sees what they typed.
    if (isNaN(end.getTime())) return { label: `Fixed to ${p.tenancy_end}`, color: T.muted, dot: '⚪' }
    const diffDays = Math.round((end - today) / (1000 * 60 * 60 * 24))
    if (diffDays < 0)   return { label: 'Expired',                              color: T.green, dot: '🟢' }
    if (diffDays <= 90) return { label: `Ends in ${diffDays}d`,                 color: T.amber, dot: '🟡' }
    return { label: `Fixed to ${end.toLocaleDateString('en-GB',{month:'short',year:'numeric'})}`, color: T.red, dot: '🔴' }
  }

  // Per-property computed row
  const rows = inScope.map(p => {
    const pct     = overrides[p.id] !== undefined ? overrides[p.id] : globalPct
    const current = p.rent_pcm || 0
    const next    = current * (1 + pct / 100)
    const delta   = next - current
    const co      = companies.find(c => c.id === p.company_id)
    const basis   = yieldBasis === 'value'
      ? (p.current_value || p.est_value || p.purchase_price || 0)
      : (p.purchase_price || 0) + (p.refurb_cost || 0)
    const currentYield = basis > 0 ? (current * 12 / basis) * 100 : 0
    const newYield     = basis > 0 ? (next    * 12 / basis) * 100 : 0
    return { p, co, pct, current, next, delta, badge: tenancyBadge(p), currentYield, newYield }
  })

  const totals = rows.reduce((a, r) => ({
    current: a.current + r.current,
    next:    a.next    + r.next,
  }), { current: 0, next: 0 })
  const monthlyDelta = totals.next - totals.current
  const annualDelta  = monthlyDelta * 12

  // Portfolio yield (weighted by basis)
  const totalBasis = inScope.reduce((s, p) => {
    if (yieldBasis === 'value') return s + (p.current_value || p.est_value || p.purchase_price || 0)
    return s + (p.purchase_price || 0) + (p.refurb_cost || 0)
  }, 0)
  const currentYield = totalBasis > 0 ? (totals.current * 12 / totalBasis) * 100 : 0
  const newYield     = totalBasis > 0 ? (totals.next    * 12 / totalBasis) * 100 : 0

  function setOverride(id, pct) {
    setOverrides(prev => ({ ...prev, [id]: pct }))
  }
  function clearOverride(id) {
    setOverrides(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  async function exportPDF() {
    setExporting(true)
    await loadCdnScript(JSPDF_CDN_URL, 'jspdf')
    const { jsPDF } = window.jspdf
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210
    const gold = [200,168,75], dark = [11,13,20], muted = [107,113,145], white = [228,224,216], green = [46,204,138], red = [224,85,85]

    // Header
    doc.setFillColor(...dark); doc.rect(0, 0, W, 42, 'F')
    doc.setFillColor(...gold); doc.rect(0, 0, 4, 42, 'F')
    doc.setTextColor(...gold); doc.setFontSize(20); doc.setFont('helvetica','bold')
    doc.text('Own Properly', 14, 16)
    doc.setTextColor(...muted); doc.setFontSize(7); doc.setFont('helvetica','normal')
    doc.text('PROPERTY MANAGEMENT', 14, 21)
    doc.setTextColor(...white); doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text('Rent Review Scenario', 14, 32)
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...muted)
    const scopeLabel = scope === 'all' ? 'All properties' : scope === 'rented' ? 'Rented only' : (companies.find(c => c.id === scope)?.name || 'Selected')
    doc.text(`${scopeLabel} · Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`, 14, 38)

    let y = 54

    // Summary
    doc.setFontSize(9); doc.setTextColor(...muted); doc.setFont('helvetica','normal')
    doc.text('GLOBAL RENT INCREASE', 14, y); y += 6
    doc.setFontSize(18); doc.setTextColor(...gold); doc.setFont('helvetica','bold')
    doc.text(`${globalPct > 0 ? '+' : ''}${globalPct.toFixed(1)}%`, 14, y); y += 10

    const cards = [
      { l: 'Current monthly',  v: fmt(totals.current), c: white },
      { l: 'New monthly',      v: fmt(totals.next),    c: gold  },
      { l: 'Monthly delta',    v: (monthlyDelta >= 0 ? '+' : '') + fmt(monthlyDelta), c: monthlyDelta >= 0 ? green : red },
      { l: 'Annual delta',     v: (annualDelta  >= 0 ? '+' : '') + fmt(annualDelta),  c: annualDelta  >= 0 ? green : red },
      { l: 'Current yield',    v: currentYield.toFixed(2) + '%', c: white },
      { l: 'New yield',        v: newYield.toFixed(2) + '%',     c: gold  },
    ]
    const cw = (W - 28 - 10) / 3
    cards.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3)
      const cx = 14 + col * (cw + 5), cy = y + row * 20
      doc.setDrawColor(60,60,70); doc.roundedRect(cx, cy, cw, 18, 2, 2)
      doc.setFontSize(7); doc.setTextColor(...muted); doc.setFont('helvetica','normal')
      doc.text(k.l.toUpperCase(), cx + 3, cy + 5)
      doc.setFontSize(11); doc.setTextColor(...k.c); doc.setFont('helvetica','bold')
      doc.text(k.v, cx + 3, cy + 13)
    })
    y += 46

    // Table
    doc.setFontSize(9); doc.setTextColor(...muted); doc.setFont('helvetica','normal')
    doc.text('PER-PROPERTY BREAKDOWN', 14, y); y += 6
    doc.setFillColor(240,240,245); doc.rect(14, y - 4, W - 28, 8, 'F')
    doc.setFontSize(8); doc.setTextColor(...dark); doc.setFont('helvetica','bold')
    doc.text('Property', 16, y + 1)
    doc.text('Current', 100, y + 1, { align: 'right' })
    doc.text('New',     130, y + 1, { align: 'right' })
    doc.text('Δ/mo',    160, y + 1, { align: 'right' })
    doc.text('Tenancy', 194, y + 1, { align: 'right' })
    y += 7

    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...dark)
    rows.forEach(r => {
      if (y > 280) { doc.addPage(); y = 20 }
      const name = r.p.name.length > 44 ? r.p.name.slice(0,41) + '…' : r.p.name
      doc.text(name, 16, y)
      doc.text(fmt(r.current), 100, y, { align: 'right' })
      doc.text(fmt(r.next),    130, y, { align: 'right' })
      const deltaStr = (r.delta >= 0 ? '+' : '') + fmt(r.delta)
      if (r.delta >= 0) doc.setTextColor(...green); else doc.setTextColor(...red)
      doc.text(deltaStr, 160, y, { align: 'right' })
      doc.setTextColor(...dark)
      doc.text(r.badge.label.length > 18 ? r.badge.label.slice(0,17)+'…' : r.badge.label, 194, y, { align: 'right' })
      y += 5.5
    })

    doc.save(`rent-review-${new Date().toISOString().slice(0,10)}.pdf`)
    setExporting(false)
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'flex-start', justifyContent:'center', zIndex:500, padding:'40px 16px', overflowY:'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:18, width:'100%', maxWidth:1100, padding:'28px 32px' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:24, flexWrap:'wrap', gap:12 }}>
          <div>
            <h2 style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.02em', marginBottom:4 }}>📈 Rent Review Planner</h2>
            <div style={{ fontFamily:mono, fontSize:11, color:T.muted, lineHeight:1.6 }}>
              Model the impact of rent increases across your portfolio. {rows.length} properties in scope.
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={exportPDF} disabled={exporting || rows.length === 0}
              style={{ fontFamily:mono, fontSize:11, padding:'8px 16px', borderRadius:8, cursor:exporting?'wait':'pointer', border:`1px solid ${T.gold}`, background:T.gold+'22', color:T.gold, fontWeight:700 }}>
              {exporting ? 'Generating…' : '📄 Export PDF'}
            </button>
            <button onClick={onClose}
              style={{ fontFamily:mono, fontSize:11, padding:'8px 16px', borderRadius:8, cursor:'pointer', border:`1px solid ${T.border}`, background:'transparent', color:T.muted }}>
              ✕ Close
            </button>
          </div>
        </div>

        {/* Summary bar */}
        <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:12, padding:'18px 22px', marginBottom:20 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:16 }}>
            <div>
              <div style={{ fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Current monthly</div>
              <div style={{ fontSize:20, fontWeight:700, color:T.text }}>{fmt(totals.current)}</div>
            </div>
            <div>
              <div style={{ fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>New monthly</div>
              <div style={{ fontSize:20, fontWeight:700, color:T.gold }}>{fmt(totals.next)}</div>
            </div>
            <div>
              <div style={{ fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Monthly Δ</div>
              <div style={{ fontSize:20, fontWeight:700, color: monthlyDelta >= 0 ? T.green : T.red }}>
                {monthlyDelta >= 0 ? '+' : ''}{fmt(monthlyDelta)}
              </div>
            </div>
            <div>
              <div style={{ fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Annual Δ</div>
              <div style={{ fontSize:20, fontWeight:700, color: annualDelta >= 0 ? T.green : T.red }}>
                {annualDelta >= 0 ? '+' : ''}{fmt(annualDelta)}
              </div>
            </div>
            <div>
              <div style={{ fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Yield {yieldBasis === 'value' ? '(on value)' : '(on cost)'}</div>
              <div style={{ fontSize:14, fontWeight:700, color:T.text }}>
                {currentYield.toFixed(2)}% <span style={{ color:T.muted }}>→</span> <span style={{ color:T.gold }}>{newYield.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Slider + presets */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:'18px 22px', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
            <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em' }}>Global rent change</div>
            <div style={{ fontFamily:mono, fontSize:22, fontWeight:700, color: globalPct === 0 ? T.muted : globalPct > 0 ? T.green : T.red }}>
              {globalPct > 0 ? '+' : ''}{globalPct.toFixed(1)}%
            </div>
          </div>
          <input type="range" min={-10} max={10} step={0.1} value={globalPct}
            onChange={e => setGlobalPct(parseFloat(e.target.value))}
            style={{ width:'100%', accentColor:T.gold, marginBottom:12 }}/>
          <div style={{ display:'flex', justifyContent:'space-between', fontFamily:mono, fontSize:9, color:T.muted, marginBottom:14 }}>
            <span>−10%</span><span>0%</span><span>+10%</span>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {presets.map(p => (
              <button key={p.value} onClick={() => setGlobalPct(p.value)}
                style={{ fontFamily:mono, fontSize:11, padding:'6px 14px', borderRadius:20, cursor:'pointer',
                  border:`1px solid ${Math.abs(globalPct - p.value) < 0.05 ? T.gold : T.border}`,
                  background: Math.abs(globalPct - p.value) < 0.05 ? T.gold+'22' : 'transparent',
                  color: Math.abs(globalPct - p.value) < 0.05 ? T.gold : T.muted,
                  fontWeight: Math.abs(globalPct - p.value) < 0.05 ? 700 : 400 }}>
                {p.label}
              </button>
            ))}
            {Object.keys(overrides).length > 0 && (
              <button onClick={() => setOverrides({})}
                style={{ fontFamily:mono, fontSize:11, padding:'6px 14px', borderRadius:20, cursor:'pointer',
                  border:`1px solid ${T.red}44`, background:T.red+'11', color:T.red, marginLeft:'auto' }}>
                Clear {Object.keys(overrides).length} override{Object.keys(overrides).length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

        {/* Scope filter */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
          <span style={{ fontFamily:mono, fontSize:10, color:T.muted, marginRight:4 }}>SCOPE:</span>
          {[{ k:'all', l:'All' }, { k:'rented', l:'Rented only' }, ...companies.map(c => ({ k:c.id, l:c.abbr || c.name }))].map(opt => (
            <button key={opt.k} onClick={() => setScope(opt.k)}
              style={{ fontFamily:mono, fontSize:11, padding:'5px 12px', borderRadius:20, cursor:'pointer',
                border:`1px solid ${scope === opt.k ? T.gold : T.border}`,
                background: scope === opt.k ? T.gold+'22' : 'transparent',
                color: scope === opt.k ? T.gold : T.muted, fontWeight: scope === opt.k ? 700 : 400 }}>
              {opt.l}
            </button>
          ))}
          <button onClick={() => setShowOverrides(s => !s)}
            style={{ fontFamily:mono, fontSize:11, padding:'5px 12px', borderRadius:20, cursor:'pointer', marginLeft:'auto',
              border:`1px solid ${showOverrides ? T.gold : T.border}`,
              background: showOverrides ? T.gold+'22' : 'transparent',
              color: showOverrides ? T.gold : T.muted }}>
            {showOverrides ? '− Hide overrides' : '+ Show overrides'}
          </button>
        </div>

        {/* Per-property table */}
        {rows.length === 0 ? (
          <div style={{ fontFamily:mono, fontSize:12, color:T.muted, textAlign:'center', padding:40 }}>
            No properties with rent in this scope.
          </div>
        ) : (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns: showOverrides ? '1fr 70px 90px 90px 90px 110px 180px' : '1fr 70px 90px 90px 90px 140px',
              gap:10, padding:'12px 18px', background:T.bg, fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700 }}>
              <div>Property</div>
              <div>Co.</div>
              <div style={{ textAlign:'right' }}>Current</div>
              <div style={{ textAlign:'right' }}>New</div>
              <div style={{ textAlign:'right' }}>Δ/mo</div>
              <div style={{ textAlign:'right' }}>Tenancy</div>
              {showOverrides && <div style={{ textAlign:'right' }}>Override</div>}
            </div>
            {rows.map(r => (
              <div key={r.p.id} style={{ display:'grid', gridTemplateColumns: showOverrides ? '1fr 70px 90px 90px 90px 110px 180px' : '1fr 70px 90px 90px 90px 140px',
                gap:10, padding:'12px 18px', borderTop:`1px solid ${T.border}`, alignItems:'center' }}>
                <div style={{ fontFamily:mono, fontSize:12, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {r.p.name}
                  {overrides[r.p.id] !== undefined && (
                    <span style={{ marginLeft:8, fontSize:9, color:T.gold, fontWeight:700 }}>·OVERRIDE</span>
                  )}
                </div>
                <div>
                  <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, color:r.co?.color || T.muted, background:(r.co?.color || T.border) + '22', padding:'2px 7px', borderRadius:4 }}>
                    {r.co?.abbr || '—'}
                  </span>
                </div>
                <div style={{ fontFamily:mono, fontSize:12, color:T.text, textAlign:'right' }}>{fmt(r.current)}</div>
                <div style={{ fontFamily:mono, fontSize:12, fontWeight:700, color:T.gold, textAlign:'right' }}>{fmt(r.next)}</div>
                <div style={{ fontFamily:mono, fontSize:12, fontWeight:700, color: r.delta >= 0 ? T.green : T.red, textAlign:'right' }}>
                  {r.delta >= 0 ? '+' : ''}{fmt(r.delta)}
                </div>
                <div style={{ textAlign:'right' }}>
                  <span style={{ fontFamily:mono, fontSize:10, color:r.badge.color, background:r.badge.color + '22', padding:'2px 8px', borderRadius:4, whiteSpace:'nowrap' }}>
                    {r.badge.label}
                  </span>
                </div>
                {showOverrides && (
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <input type="range" min={-10} max={10} step={0.1}
                      value={overrides[r.p.id] !== undefined ? overrides[r.p.id] : globalPct}
                      onChange={e => setOverride(r.p.id, parseFloat(e.target.value))}
                      style={{ flex:1, accentColor:T.gold }}/>
                    <span style={{ fontFamily:mono, fontSize:10, color: r.pct === 0 ? T.muted : r.pct > 0 ? T.green : T.red, width:40, textAlign:'right', fontWeight:700 }}>
                      {r.pct > 0 ? '+' : ''}{r.pct.toFixed(1)}%
                    </span>
                    {overrides[r.p.id] !== undefined && (
                      <button onClick={() => clearOverride(r.p.id)}
                        style={{ fontFamily:mono, fontSize:10, padding:'2px 6px', cursor:'pointer', border:'none', background:'transparent', color:T.muted }}
                        title="Reset to global">✕</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontFamily:mono, fontSize:10, color:T.faint, marginTop:16, lineHeight:1.6 }}>
          Yield calculated {yieldBasis === 'value' ? 'on current property value' : 'on purchase + refurb cost'}.
          Tenancy badges based on tenancy end dates: 🟢 expired or vacant · 🟡 ends within 90 days · 🔴 fixed term &gt; 90 days remaining.
          This tool is for scenario modelling — actual rent increases must follow legal notice requirements (Section 13 etc.).
        </div>
      </div>
    </div>
  )
}
