import { useState, useEffect, useRef } from 'react'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { SignedPhoto } from '../lib/SignedPhoto'

const mono = "'DM Mono',monospace"
const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

// Tenant portal colour tokens. The previous hard-coded values were:
//   '#999' on white     → 2.85:1  (fails WCAG AA 4.5:1)
//   '#bbb' on white     → 1.85:1  (fails — barely visible)
//   '#ccc' on white     → 1.61:1  (fails badly)
// These are public-facing for tenants (highest legal risk surface).
// Replaced with higher-contrast neutrals tuned against #FFFFFF:
//   MUTED  #595E7A → 5.6:1 (AA pass)
//   FAINT  #6A6764 → 5.0:1 (AA pass)
//   GHOST  #8A8784 → 3.7:1 (AA Large only — only use for >= 18pt or
//                            decoration like calendar dot empty cells)
const TENANT_MUTED = '#595E7A'
const TENANT_FAINT = '#6A6764'
const TENANT_GHOST = '#8A8784'

// Build a bank-reference string from the tenant's property. Guards against
// edge cases that previously produced 'RENT-' (empty address + empty name)
// or '-FOO' (no prefix). Tenants pay with this exact reference, so an
// empty or malformed value means the landlord can't auto-match.
function buildBankReference(bankDetails, property) {
  const prefix = (bankDetails?.bank_reference_prefix || 'RENT').trim() || 'RENT'
  const source = String(property?.address || property?.name || '').trim()
  const word = source.split(/\s+/).filter(Boolean)[0]
  const suffix = word ? word.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : 'UNIT'
  return `${prefix}-${suffix}`
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const STATUS_COLORS = {
  paid:    { bg:'#2ECC8A22', color:'#2ECC8A', label:'Paid' },
  overdue: { bg:'#E0555522', color:'#E05555', label:'Overdue' },
  pending: { bg:'#C8A84B22', color:'#C8A84B', label:'Pending' },
  void:    { bg:'#88888822', color:'#888',    label:'Void' },
}
// When a month holds several rent segments, the worst one wins the square.
const STATUS_PRIORITY = { overdue: 4, pending: 3, paid: 2, void: 1 }

// rent_payments rows key months on integer year/month columns (a month can
// hold several dated segments). Sum the rows' amounts for a status, falling
// back to one month's rent per distinct month only when no row carries an
// amount — never per segment, which would overcount split months.
function sumForStatus(payments, status, rentPcm) {
  const rows = (payments || []).filter(p => p.status === status)
  const amount = rows.reduce((s, p) => s + (p.amount || 0), 0)
  if (amount > 0) return amount
  const months = new Set(rows.map(p => `${p.year}-${p.month}`)).size
  return months * (rentPcm || 0)
}
const JOB_STATUS = {
  open:          { bg:'#E0943A22', color:'#E0943A', label:'Open' },
  'in-progress': { bg:'#4B8FE022', color:'#4B8FE0', label:'In progress' },
  complete:      { bg:'#2ECC8A22', color:'#2ECC8A', label:'Complete' },
}

// Detect subdomain from hostname
function getSubdomain() {
  const host = window.location.hostname
  const parts = host.split('.')
  if (parts.length >= 3 && parts[0] !== 'www') return parts[0]
  return null
}

export default function TenantPortal({ user, onSignOut, onSwitchToLandlord }) {
  const [tab, setTab]         = useState('home')
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [bankDetails, setBankDetails] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const [features, setFeatures] = useState({})
  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      // Load tenant's property profile. Bank details and feature flags ride
      // along in the same curated RPC payload — tenants have no direct read
      // access to company_settings.
      const data = await api.fetchTenantProperty(user.id)
      setProfile(data)

      const co = data?.property?.company
      setCompany(co)
      setBankDetails(data?.bank_details || {})
      setFeatures(data?.features || {})
    } catch(e) {
      setError('Unable to load your tenancy. Please contact your landlord.')
    }
    setLoading(false)
  }

  if (loading) return (
    <div style={{minHeight:'100vh',background:'#F4F3EF',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:12,color:TENANT_MUTED}}>
      Loading your portal…
    </div>
  )

  if (error || !profile) return (
    <div style={{minHeight:'100vh',background:'#F4F3EF',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{background:'white',borderRadius:16,padding:'40px 32px',maxWidth:400,textAlign:'center',boxShadow:'0 4px 24px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:40,marginBottom:16}}>🏠</div>
        <h2 style={{fontSize:18,fontWeight:700,color:'#2D3C4A',marginBottom:8}}>Not set up yet</h2>
        <p style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,lineHeight:1.8,marginBottom:24}}>
          {error||"Your landlord hasn't linked your account to a property yet."}
        </p>
        <button onClick={onSignOut} style={{fontFamily:mono,fontSize:12,padding:'10px 20px',borderRadius:8,border:'1px solid #ddd',background:'transparent',color:'#666',cursor:'pointer'}}>Sign out</button>
      </div>
    </div>
  )

  const property = profile.property
  const effectiveMode = property?.contact_mode_override || company?.contact_mode || 'landlord'
  const contactInfo = effectiveMode === 'agent'
    ? { name: company?.agent_name, phone: company?.agent_phone, email: company?.agent_email, label: 'Managing agent' }
    : null

  // Branding from company
  const brandColor = company?.color || '#C8A84B'
  const logoUrl    = bankDetails?.logo_url || null
  const companyName = company?.name || 'My Home'

  const tabStyle = k => ({
    fontFamily:mono, fontSize:11, padding:'10px 0', cursor:'pointer',
    border:'none', background:'transparent',
    color: tab===k ? brandColor : '#8A95A0',
    fontWeight: tab===k ? 700 : 400,
    borderBottom: `2px solid ${tab===k ? brandColor : 'transparent'}`,
    transition:'all 0.15s', whiteSpace:'nowrap',
  })

  const canMessage  = features.feature_tenant_messaging !== false
  const canRepairs  = features.feature_tenant_repairs   !== false
  const canDocs     = features.feature_tenant_documents !== false

  const TABS = [
    ['home',    '🏠 Home'],
    ['rent',    '💷 Rent'],
    ...(canRepairs  ? [['maintenance','🔧 Repairs']]   : []),
    ...(canDocs     ? [['documents', '📄 Documents']]  : []),
    ...(canMessage  ? [['messages',  '✉ Messages']]    : []),
    ['profile', '👤 Profile'],
  ]

  return (
    <div style={{minHeight:'100vh',background:'#F4F3EF',fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>

      {/* Header — company branded */}
      <div style={{background:'#2D3C4A',padding:'0 24px',position:'sticky',top:0,zIndex:100}}>
        <div style={{maxWidth:860,margin:'0 auto'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',height:60}}>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              {logoUrl
                ? <img src={logoUrl} alt={companyName} style={{height:36,width:'auto',objectFit:'contain'}}/>
                : (<>
                    <div style={{width:36,height:36,borderRadius:8,background:brandColor+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:14,fontWeight:700,color:brandColor}}>
                      {company?.abbr||companyName[0]}
                    </div>
                    <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:brandColor}}>{companyName}</span>
                  </>)
              }
              <div style={{width:1,height:20,background:'#ffffff22'}}/>
              <span style={{fontFamily:mono,fontSize:10,color:'#7A8899',letterSpacing:'0.1em',textTransform:'uppercase'}}>Tenant Portal</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <span style={{fontFamily:mono,fontSize:11,color:'#7A8899',display:'none'}}>{user.email}</span>
              {onSwitchToLandlord && (
              <button onClick={onSwitchToLandlord} style={{fontFamily:mono,fontSize:11,background:'none',border:'1px solid #ffffff22',color:'#C8A84B',borderRadius:6,padding:'5px 12px',cursor:'pointer'}}>
                ← Landlord view
              </button>
            )}
          <button onClick={onSignOut} style={{fontFamily:mono,fontSize:11,background:'none',border:'1px solid #ffffff22',color:'#7A8899',borderRadius:6,padding:'5px 12px',cursor:'pointer'}}>Sign out</button>
            </div>
          </div>

          {/* Nav tabs */}
          <nav style={{display:'flex',gap:20,overflowX:'auto',paddingBottom:0}}>
            {TABS.map(([k,l])=>(<button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{l}</button>))}
          </nav>
        </div>
      </div>

      {/* Sub-header: property address */}
      <div style={{background:'#364B5F',padding:'10px 24px'}}>
        <div style={{maxWidth:860,margin:'0 auto',fontFamily:mono,fontSize:11,color:'#8A9BAB'}}>
          {property?.address||property?.name||'Your property'}
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:860,margin:'0 auto',padding:'28px 24px'}}>
        {tab==='home'        && <TenantHome property={property} company={company} user={user} contactInfo={contactInfo} brandColor={brandColor} bankDetails={bankDetails}/>}
        {tab==='rent'        && <TenantRent property={property} user={user} bankDetails={bankDetails} brandColor={brandColor}/>}
        {tab==='maintenance' && <TenantMaintenance property={property} user={user} brandColor={brandColor}/>}
        {tab==='documents'   && <TenantDocuments property={property} user={user} brandColor={brandColor}/>}
        {tab==='messages'    && <TenantMessages property={property} user={user} contactInfo={contactInfo} brandColor={brandColor}/>}
        {tab==='profile'     && <TenantProfile property={property} user={user} company={company}/>}
      </div>
    </div>
  )
}

// ── SHARED HELPERS ────────────────────────────────────────────────────────────
function Card({ children, style={} }) {
  return <div style={{background:'white',borderRadius:14,padding:'20px 22px',...style}}>{children}</div>
}
function SectionLabel({ children }) {
  return <div style={{fontFamily:mono,fontSize:9,color:TENANT_MUTED,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:12}}>{children}</div>
}
function StatusPill({ status, cfg }) {
  const sc = cfg[status] || { bg:'#eee', color:TENANT_MUTED, label: status }
  return <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,background:sc.bg,color:sc.color}}>{sc.label}</span>
}

// ── HOME TAB ──────────────────────────────────────────────────────────────────
function TenantHome({ property, company, user, contactInfo, brandColor, bankDetails }) {
  const [tenancy, setTenancy]   = useState(null)
  const [openJobs, setOpenJobs] = useState(0)
  const [arrears, setArrears]   = useState(0)

  useEffect(() => {
    api.fetchTenancyDetails(property.id).then(setTenancy).catch(()=>{})
    api.fetchTenantMaintenance(property.id, user.id).then(jobs => {
      setOpenJobs(jobs.filter(j=>j.status==='open'||j.status==='in-progress').length)
    }).catch(()=>{})
    // Calculate arrears from rent_payments
    api.fetchTenantPaymentTracker(property.id).then(payments => {
      setArrears(sumForStatus(payments, 'overdue', property?.rent_pcm))
    }).catch(()=>{})
  }, [property.id])

  const endDays = tenancy?.tenancy_end ? Math.ceil((new Date(tenancy.tenancy_end)-new Date())/(1000*60*60*24)) : null

  return (
    <div>
      <h1 style={{fontSize:24,fontWeight:700,color:'#2D3C4A',marginBottom:4,letterSpacing:'-0.02em'}}>Welcome home</h1>
      <p style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,marginBottom:24}}>{property?.address||property?.name}</p>

      {/* Alert banners */}
      {arrears > 0 && (
        <div style={{background:'#E0555518',border:'1px solid #E0555544',borderRadius:12,padding:'12px 16px',marginBottom:12,fontFamily:mono,fontSize:12,color:'#E05555'}}>
          ⚠ You have outstanding arrears of <strong>{fmt(arrears)}</strong> — please make payment as soon as possible.
        </div>
      )}
      {openJobs > 0 && (
        <div style={{background:brandColor+'18',border:`1px solid ${brandColor}44`,borderRadius:12,padding:'12px 16px',marginBottom:12,fontFamily:mono,fontSize:12,color:brandColor}}>
          🔧 You have {openJobs} repair request{openJobs!==1?'s':''} in progress.
        </div>
      )}
      {endDays!=null && endDays<=90 && endDays>0 && (
        <div style={{background:'#E0943A18',border:'1px solid #E0943A44',borderRadius:12,padding:'12px 16px',marginBottom:12,fontFamily:mono,fontSize:12,color:'#E0943A'}}>
          📅 Your tenancy expires in {endDays} days. Please contact your landlord about renewal.
        </div>
      )}

      {/* Key stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
        <Card style={{borderLeft:`3px solid ${brandColor}`}}>
          <SectionLabel>Monthly rent</SectionLabel>
          <div style={{fontSize:28,fontWeight:700,color:'#2D3C4A'}}>{fmt(property?.rent_pcm)}</div>
          <div style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED,marginTop:4}}>per calendar month</div>
        </Card>
        <Card style={{borderLeft:`3px solid ${arrears>0?'#E05555':'#2ECC8A'}`}}>
          <SectionLabel>Current balance</SectionLabel>
          <div style={{fontSize:28,fontWeight:700,color:arrears>0?'#E05555':'#2ECC8A'}}>{arrears>0?`-${fmt(arrears)}`:'All clear'}</div>
          <div style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED,marginTop:4}}>{arrears>0?'Arrears outstanding':'No arrears'}</div>
        </Card>
      </div>

      {/* Tenancy summary */}
      {tenancy && (
        <Card style={{marginBottom:16}}>
          <SectionLabel>Your tenancy</SectionLabel>
          {[
            ['Tenant name',   tenancy.tenant_names||'—'],
            ['Start date',    tenancy.tenancy_start?new Date(tenancy.tenancy_start).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'—'],
            ['End date',      tenancy.tenancy_end?new Date(tenancy.tenancy_end).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'Rolling'],
            ['Notice period', tenancy.notice_period||'—'],
            ['Deposit held',  tenancy.deposit_amount?fmt(tenancy.deposit_amount):'—'],
            ['Deposit scheme',tenancy.deposit_scheme||'—'],
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f4f4f4'}}>
              <span style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED}}>{l}</span>
              <span style={{fontFamily:mono,fontSize:11,color:'#2D3C4A',fontWeight:600}}>{v}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Bank payment details */}
      {(bankDetails?.bank_account_no || bankDetails?.bank_sort_code) && (
        <Card style={{marginBottom:16,borderLeft:'3px solid #4B8FE0'}}>
          <SectionLabel>Pay your rent by bank transfer</SectionLabel>
          {[
            ['Bank name',      bankDetails.bank_name||'—'],
            ['Sort code',      bankDetails.bank_sort_code||'—'],
            ['Account number', bankDetails.bank_account_no||'—'],
            ['Reference',      buildBankReference(bankDetails, property)],
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f4f4f4'}}>
              <span style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED}}>{l}</span>
              <span style={{fontFamily:mono,fontSize:12,color:'#2D3C4A',fontWeight:700}}>{v}</span>
            </div>
          ))}
          <div style={{fontFamily:mono,fontSize:10,color:TENANT_MUTED,marginTop:10,lineHeight:1.6}}>
            Please always use your reference when making payment so we can allocate it correctly.
          </div>
        </Card>
      )}

      {/* Contact */}
      <Card>
        <SectionLabel>{contactInfo ? `Contact — ${contactInfo.label}` : 'Need help?'}</SectionLabel>
        {contactInfo ? (
          <>
            <div style={{fontSize:15,fontWeight:700,color:'#2D3C4A',marginBottom:10}}>{contactInfo.name||'—'}</div>
            {contactInfo.phone&&<div style={{fontFamily:mono,fontSize:12,color:'#666',marginBottom:6}}>📞 <a href={`tel:${contactInfo.phone}`} style={{color:'#4B8FE0',textDecoration:'none'}}>{contactInfo.phone}</a></div>}
            {contactInfo.email&&<div style={{fontFamily:mono,fontSize:12,color:'#666'}}>✉ <a href={`mailto:${contactInfo.email}`} style={{color:'#4B8FE0',textDecoration:'none'}}>{contactInfo.email}</a></div>}
          </>
        ) : (
          <div style={{fontFamily:mono,fontSize:12,color:'#666',lineHeight:1.7}}>Use the Messages tab to contact your landlord, or the Repairs tab to report a maintenance issue.</div>
        )}
      </Card>
    </div>
  )
}

// ── RENT TAB ──────────────────────────────────────────────────────────────────
function TenantRent({ property, user, bankDetails, brandColor }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(()=>{
    api.fetchTenantPaymentTracker(property.id).then(d=>{setPayments(d);setLoading(false)}).catch(()=>setLoading(false))
  },[property.id])

  const totalPaid    = sumForStatus(payments, 'paid', property?.rent_pcm)
  const totalArrears = sumForStatus(payments, 'overdue', property?.rent_pcm)

  // Build monthly tracker — last 12 months. rent_payments months are integer
  // year/month columns; a month can hold several dated segments, so take the
  // worst status and sum the segment amounts.
  const now = new Date()
  const monthTracker = Array.from({length:12},(_,i)=>{
    const d = new Date(now.getFullYear(), now.getMonth()-11+i, 1)
    const y = d.getFullYear(), mo = d.getMonth()+1
    const matches = payments.filter(p => Number(p.year) === y && Number(p.month) === mo)
    let status = null
    for (const p of matches) {
      if (status === null || (STATUS_PRIORITY[p.status]||0) > (STATUS_PRIORITY[status]||0)) status = p.status
    }
    const summed = matches.reduce((s,p)=>s+(p.amount||0),0)
    const isFuture = d > now
    return { label: MONTHS[d.getMonth()], year: y, status: isFuture ? 'future' : status || 'unknown', amount: summed || property?.rent_pcm || 0, isFuture }
  })

  const statusConfig = {
    paid:    { bg:'#2ECC8A22', color:'#2ECC8A', label:'✓' },
    overdue: { bg:'#E0555522', color:'#E05555', label:'!' },
    pending: { bg:'#C8A84B22', color:'#C8A84B', label:'~' },
    future:  { bg:'#f4f4f4',   color:TENANT_GHOST,    label:'' },
    unknown: { bg:'#f4f4f4',   color:TENANT_FAINT,    label:'?' },
  }

  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:700,color:'#2D3C4A',marginBottom:20}}>Rent & payments</h2>

      {/* Arrears alert */}
      {totalArrears > 0 && (
        <div style={{background:'#E0555518',border:'1px solid #E0555544',borderRadius:12,padding:'14px 18px',marginBottom:20}}>
          <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:'#E05555',marginBottom:4}}>Outstanding arrears: {fmt(totalArrears)}</div>
          <div style={{fontFamily:mono,fontSize:11,color:'#E05555',lineHeight:1.6}}>Please make payment as soon as possible. See bank details below.</div>
        </div>
      )}

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:24}}>
        {[
          {label:'Monthly rent',    value:fmt(property?.rent_pcm), color:'#2D3C4A'},
          {label:'Total paid',      value:fmt(totalPaid),          color:'#2ECC8A'},
          {label:'Arrears',         value:totalArrears>0?fmt(totalArrears):'None', color:totalArrears>0?'#E05555':'#2ECC8A'},
        ].map(k=>(
          <Card key={k.label}>
            <SectionLabel>{k.label}</SectionLabel>
            <div style={{fontSize:20,fontWeight:700,color:k.color}}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* Monthly tracker */}
      <Card style={{marginBottom:20}}>
        <SectionLabel>Payment tracker — last 12 months</SectionLabel>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:8}}>
          {monthTracker.map((m,i)=>{
            const sc = statusConfig[m.status]||statusConfig.unknown
            return (
              <div key={i} style={{textAlign:'center'}}>
                <div style={{fontFamily:mono,fontSize:10,color:TENANT_FAINT,marginBottom:6}}>{m.label}</div>
                <div style={{width:'100%',aspectRatio:'1',borderRadius:8,background:sc.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:16,color:sc.color,fontWeight:700,border:`1px solid ${sc.color}33`}}>
                  {sc.label}
                </div>
                {!m.isFuture&&m.status!=='unknown'&&<div style={{fontFamily:mono,fontSize:9,color:TENANT_FAINT,marginTop:4}}>{fmt(m.amount)}</div>}
              </div>
            )
          })}
        </div>
        <div style={{display:'flex',gap:16,marginTop:16,flexWrap:'wrap'}}>
          {[['paid','✓','#2ECC8A'],['overdue','!','#E05555'],['pending','~','#C8A84B'],['unknown','?','#bbb']].map(([k,s,c])=>(
            <div key={k} style={{display:'flex',alignItems:'center',gap:6,fontFamily:mono,fontSize:10,color:TENANT_MUTED}}>
              <div style={{width:18,height:18,borderRadius:4,background:statusConfig[k]?.bg,display:'flex',alignItems:'center',justifyContent:'center',color:c,fontWeight:700,fontSize:11}}>{s}</div>
              {k.charAt(0).toUpperCase()+k.slice(1)}
            </div>
          ))}
        </div>
      </Card>

      {/* Bank transfer details */}
      {(bankDetails?.bank_account_no||bankDetails?.bank_sort_code) && (
        <Card style={{marginBottom:20,borderLeft:'3px solid #4B8FE0'}}>
          <SectionLabel>Pay by bank transfer</SectionLabel>
          <div style={{display:'grid',gap:0}}>
            {[
              ['Bank',           bankDetails.bank_name||'—'],
              ['Sort code',      bankDetails.bank_sort_code||'—'],
              ['Account number', bankDetails.bank_account_no||'—'],
              ['Reference',      buildBankReference(bankDetails, property)],
              ['Amount',         fmt(property?.rent_pcm)],
            ].map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid #f4f4f4'}}>
                <span style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED}}>{l}</span>
                <span style={{fontFamily:mono,fontSize:12,color:'#2D3C4A',fontWeight:700}}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{fontFamily:mono,fontSize:10,color:TENANT_MUTED,marginTop:10,padding:'10px 12px',background:'#f8f8f8',borderRadius:8}}>
            ⚠ Always use your reference exactly as shown so we can match your payment.
          </div>
        </Card>
      )}

      {/* Full payment history */}
      <Card>
        <SectionLabel>Full payment history</SectionLabel>
        {loading ? <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,padding:24,textAlign:'center'}}>Loading…</div>
        : payments.length===0 ? <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,textAlign:'center',padding:24}}>No payment records yet.</div>
        : <div>
            <div style={{display:'grid',gridTemplateColumns:'110px 1fr 110px 90px',gap:8,padding:'8px 0',borderBottom:'1px solid #f0f0f0'}}>
              {['Date','Period','Amount','Status'].map(h=><div key={h} style={{fontFamily:mono,fontSize:9,color:TENANT_FAINT,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>)}
            </div>
            {payments.map(p=>{
              const sc = STATUS_COLORS[p.status]||STATUS_COLORS.pending
              return (
                <div key={p.id} style={{display:'grid',gridTemplateColumns:'110px 1fr 110px 90px',gap:8,padding:'10px 0',borderBottom:'1px solid #f8f8f8',alignItems:'center'}}>
                  <div style={{fontFamily:mono,fontSize:11,color:'#888'}}>{p.period_start?new Date(p.period_start).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:'#2D3C4A'}}>{p.month_label||(p.year&&p.month?`${MONTHS[Number(p.month)-1]} ${p.year}`:'—')}</div>
                  <div style={{fontFamily:mono,fontSize:12,fontWeight:700,color:'#2D3C4A'}}>{fmt(p.amount||property?.rent_pcm)}</div>
                  <div><span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,background:sc.bg,color:sc.color}}>{sc.label}</span></div>
                </div>
              )
            })}
          </div>
        }
      </Card>
    </div>
  )
}

// ── MAINTENANCE TAB ───────────────────────────────────────────────────────────
function TenantMaintenance({ property, user, brandColor }) {
  const [jobs, setJobs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [title, setTitle]         = useState('')
  const [desc, setDesc]           = useState('')
  const [priority, setPriority]   = useState('normal')
  const [photos, setPhotos]       = useState([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Revoke any blob: URLs we created for preview so we don't leak memory
  // when the tenant submits / cancels the form. We also revoke them on
  // unmount in case the tenant navigates away mid-flow.
  useEffect(() => {
    return () => {
      for (const p of photos) {
        if (p?.url?.startsWith('blob:')) {
          try { URL.revokeObjectURL(p.url) } catch (_) {}
        }
      }
    }
  }, [photos])
  const [success, setSuccess]     = useState(false)

  useEffect(()=>{
    api.fetchTenantMaintenance(property.id, user.id).then(d=>{setJobs(d);setLoading(false)}).catch(()=>setLoading(false))
  },[property.id])

  async function handlePhotoUpload(e) {
    const files = Array.from(e.target.files||[])
    if (!files.length) return
    setUploading(true)
    const uploaded = []
    for (const file of files.slice(0,5)) {
      try {
        const ext = file.name.split('.').pop()
        // Tenant uploads now live under their auth user-id folder so storage
        // RLS can scope writes to the uploader. The bucket is private — we
        // store the path durably and fetch a signed URL on display.
        const tenantUid = user?.id || 'anon'
        const path = `${tenantUid}/tenant-uploads/${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('property-documents').upload(path, file, {upsert:true})
        if (!error) {
          // Use a local object URL for the immediate preview — works without
          // a server round-trip and doesn't rely on bucket public access.
          // The durable `path` is what gets persisted on the maintenance job.
          const previewUrl = URL.createObjectURL(file)
          uploaded.push({ url: previewUrl, path, name: file.name })
        }
      } catch(e) {}
    }
    setPhotos(prev=>[...prev,...uploaded])
    setUploading(false)
  }

  const [submitErr, setSubmitErr] = useState('')
  async function submit() {
    if (!title.trim()) return
    setSubmitting(true)
    setSubmitErr('')
    try {
      const job = await api.submitMaintenanceRequest(property.id, user.id, title, desc, priority)
      if (photos.length > 0) await api.attachPhotosToJob(job.id, photos)
      setJobs(prev=>[{...job, photos},...prev])
      setTitle(''); setDesc(''); setPriority('normal'); setPhotos([])
      setShowForm(false); setSuccess(true)
      setTimeout(()=>setSuccess(false),4000)
    } catch(e) {
      // Don't silently swallow. A tenant who thinks they've reported a
      // broken boiler and never gets a response will assume the landlord
      // is ignoring them. Surface the error inline so they can retry.
      console.error('Maintenance request submit failed', e)
      setSubmitErr(e?.message || 'Could not send your request. Please check your connection and try again.')
    }
    setSubmitting(false)
  }

  const inp = {fontFamily:mono,fontSize:12,background:'#f8f8f8',border:'1px solid #e8e8e8',color:'#2D3C4A',borderRadius:8,padding:'9px 12px',width:'100%',outline:'none'}

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={{fontSize:20,fontWeight:700,color:'#2D3C4A',margin:0}}>Repairs & maintenance</h2>
        <button onClick={()=>setShowForm(true)} style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'9px 18px',borderRadius:8,border:'none',background:brandColor,color:'white',cursor:'pointer'}}>
          + Report repair
        </button>
      </div>

      {success && (
        <div style={{background:'#2ECC8A18',border:'1px solid #2ECC8A44',borderRadius:10,padding:'12px 16px',marginBottom:16,fontFamily:mono,fontSize:12,color:'#2ECC8A'}}>
          ✓ Repair request submitted — your landlord has been notified.
        </div>
      )}

      {showForm && (
        <Card style={{marginBottom:20,border:`1px solid ${brandColor}44`}}>
          <div style={{fontFamily:mono,fontSize:10,color:brandColor,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Report a repair</div>

          <div style={{marginBottom:12}}>
            <label style={{fontFamily:mono,fontSize:10,color:TENANT_MUTED,display:'block',marginBottom:6}}>What needs fixing? *</label>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Boiler not working, Leak under sink" style={inp}/>
          </div>

          <div style={{marginBottom:12}}>
            <label style={{fontFamily:mono,fontSize:10,color:TENANT_MUTED,display:'block',marginBottom:6}}>Details (optional)</label>
            <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3} placeholder="Describe the issue, when it started, how bad it is…" style={{...inp,resize:'vertical'}}/>
          </div>

          <div style={{marginBottom:14}}>
            <label style={{fontFamily:mono,fontSize:10,color:TENANT_MUTED,display:'block',marginBottom:8}}>How urgent is this?</label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {[['normal','Normal','#4B8FE0'],['high','High priority','#E0943A'],['urgent','Urgent — safety risk','#E05555']].map(([k,l,c])=>(
                <button key={k} onClick={()=>setPriority(k)} style={{fontFamily:mono,fontSize:11,padding:'6px 14px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${priority===k?c:'#e0e0e0'}`,
                  background:priority===k?c+'22':'transparent',color:priority===k?c:'#999'}}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Photo upload */}
          <div style={{marginBottom:16}}>
            <label style={{fontFamily:mono,fontSize:10,color:TENANT_MUTED,display:'block',marginBottom:8}}>Add photos (optional, up to 5)</label>
            <label style={{display:'inline-block',cursor:'pointer'}}>
              <span style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,border:'1px solid #e0e0e0',background:'#f8f8f8',color:'#666'}}>
                {uploading?'Uploading…':'📷 Add photos'}
              </span>
              <input type="file" accept="image/*" multiple style={{display:'none'}} onChange={handlePhotoUpload} disabled={uploading||photos.length>=5}/>
            </label>
            {photos.length>0 && (
              <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
                {photos.map((p,i)=>(
                  <div key={i} style={{position:'relative'}}>
                    <img src={p.url} alt="" style={{width:70,height:70,objectFit:'cover',borderRadius:8,border:'1px solid #e0e0e0'}}/>
                    <button onClick={()=>setPhotos(prev=>prev.filter((_,j)=>j!==i))}
                      style={{position:'absolute',top:-6,right:-6,width:18,height:18,borderRadius:9,background:'#E05555',border:'none',color:'white',fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1}}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{display:'flex',gap:10}}>
            <button onClick={submit} disabled={submitting||!title.trim()} style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px 22px',borderRadius:8,border:'none',background:submitting||!title.trim()?'#ccc':brandColor,color:'white',cursor:'pointer'}}>
              {submitting?'Submitting…':'Submit request'}
            </button>
            <button onClick={()=>{setShowForm(false);setPhotos([]);setSubmitErr('')}} style={{fontFamily:mono,fontSize:12,padding:'10px 16px',borderRadius:8,border:'1px solid #e0e0e0',background:'transparent',color:TENANT_MUTED,cursor:'pointer'}}>
              Cancel
            </button>
          </div>
          {submitErr && (
            <div role="alert" aria-live="assertive"
              style={{marginTop:12,fontFamily:mono,fontSize:12,color:'#DC2626',background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'10px 14px'}}>
              {submitErr}
            </div>
          )}
        </Card>
      )}

      {loading ? <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,textAlign:'center',padding:40}}>Loading…</div>
      : jobs.length===0 ? <Card style={{textAlign:'center',padding:40}}>
          <div style={{fontSize:32,marginBottom:12}}>🔧</div>
          <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED}}>No repair requests yet. Report any issues above.</div>
        </Card>
      : <div style={{display:'grid',gap:12}}>
          {jobs.map(job=>{
            const sc = JOB_STATUS[job.status]||JOB_STATUS.open
            const jobPhotos = Array.isArray(job.photos) ? job.photos : []
            return (
              <Card key={job.id}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,gap:10}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#2D3C4A',flex:1}}>{job.title||'Repair request'}</div>
                  <StatusPill status={job.status} cfg={JOB_STATUS}/>
                </div>
                {job.description && <div style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED,marginBottom:10,lineHeight:1.6}}>{job.description}</div>}
                {jobPhotos.length>0 && (
                  <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                    {jobPhotos.map((p,i)=>(
                      <SignedPhoto key={i} path={p.path} url={p.url}
                        style={{width:60,height:60,objectFit:'cover',borderRadius:6,border:'1px solid #e0e0e0'}}/>
                    ))}
                  </div>
                )}
                <div style={{display:'flex',gap:16,fontFamily:mono,fontSize:10,color:TENANT_FAINT,flexWrap:'wrap'}}>
                  <span>Reported {new Date(job.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                  {job.priority&&job.priority!=='normal'&&<span style={{color:job.priority==='urgent'?'#E05555':'#E0943A'}}>⚑ {job.priority}</span>}
                </div>
              </Card>
            )
          })}
        </div>
      }
    </div>
  )
}

// ── DOCUMENTS TAB ─────────────────────────────────────────────────────────────
function TenantDocuments({ property, user, brandColor }) {
  const [docs, setDocs]     = useState([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState(null)

  useEffect(()=>{
    api.fetchTenantDocuments(property.id).then(d=>{setDocs(d);setLoading(false)}).catch(()=>setLoading(false))
  },[property.id])

  // Bucket is private — fetch a short-lived signed URL on demand rather than
  // relying on a stored public URL.
  async function openDoc(doc) {
    setOpeningId(doc.id)
    try {
      const url = doc.file_path ? await api.getDocumentSignedUrl(doc.file_path) : (doc.file_url || doc.url)
      if (url) window.open(url, '_blank', 'noopener')
    } catch(e) {}
    setOpeningId(null)
  }

  const getIcon = name => ({ pdf:'📄', jpg:'🖼', jpeg:'🖼', png:'🖼', doc:'📝', docx:'📝' })[(name||'').split('.').pop()?.toLowerCase()] || '📎'

  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:700,color:'#2D3C4A',marginBottom:8}}>Documents</h2>
      <p style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED,marginBottom:20}}>Documents shared by your landlord — download anytime.</p>
      {loading ? <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,textAlign:'center',padding:40}}>Loading…</div>
      : docs.length===0 ? <Card style={{textAlign:'center',padding:40}}>
          <div style={{fontSize:32,marginBottom:12}}>📄</div>
          <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED}}>No documents shared yet. Your landlord can share certificates, agreements and more.</div>
        </Card>
      : <div style={{display:'grid',gap:10}}>
          {docs.map(doc=>(
            <Card key={doc.id} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 18px'}}>
              <span style={{fontSize:24,flexShrink:0}}>{getIcon(doc.name)}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:'#2D3C4A',marginBottom:3}}>{doc.name}</div>
                <div style={{fontFamily:mono,fontSize:10,color:TENANT_FAINT}}>
                  {doc.size?`${(doc.size/1024).toFixed(0)}KB · `:''}Added {new Date(doc.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                </div>
              </div>
              <button onClick={()=>openDoc(doc)} disabled={openingId===doc.id}
                style={{fontFamily:mono,fontSize:11,fontWeight:700,padding:'7px 16px',borderRadius:8,border:'none',background:brandColor+'22',color:brandColor,cursor:'pointer',flexShrink:0}}>
                {openingId===doc.id?'Opening…':'Download'}
              </button>
            </Card>
          ))}
        </div>
      }
    </div>
  )
}

// ── MESSAGES TAB ──────────────────────────────────────────────────────────────
function TenantMessages({ property, user, contactInfo, brandColor }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [newMsg, setNewMsg]     = useState('')
  const [sending, setSending]   = useState(false)
  const bottomRef = useRef(null)

  useEffect(()=>{
    api.fetchTenantMessages(property.id, user.id)
      .then(d=>{setMessages(d);setLoading(false)}).catch(()=>setLoading(false))
    api.markMessagesRead(property.id, user.id).catch(()=>{})
  },[property.id])

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}) },[messages])

  async function send() {
    if (!newMsg.trim()) return
    setSending(true)
    try {
      const msg = await api.sendTenantMessage(property.id, user.id, newMsg.trim(), 'tenant')
      setMessages(prev=>[...prev,msg]); setNewMsg('')
    } catch(e) {}
    setSending(false)
  }

  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:700,color:'#2D3C4A',marginBottom:4}}>Messages</h2>
      <p style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED,marginBottom:20}}>
        {contactInfo ? `Message your ${contactInfo.label}` : 'Message your landlord — they\'ll reply as soon as possible.'}
      </p>

      <Card>
        <div style={{height:450,overflowY:'auto',marginBottom:0,padding:'4px'}}>
          {loading && <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED,textAlign:'center',padding:40}}>Loading…</div>}
          {!loading && messages.length===0 && (
            <div style={{textAlign:'center',padding:48}}>
              <div style={{fontSize:32,marginBottom:12}}>✉</div>
              <div style={{fontFamily:mono,fontSize:12,color:TENANT_MUTED}}>No messages yet.<br/>Send a message below.</div>
            </div>
          )}
          {messages.map(m=>{
            const isMe = m.sender_type==='tenant'
            return (
              <div key={m.id} style={{display:'flex',justifyContent:isMe?'flex-end':'flex-start',marginBottom:14}}>
                <div style={{maxWidth:'72%'}}>
                  <div style={{fontFamily:mono,fontSize:9,color:TENANT_FAINT,marginBottom:4,textAlign:isMe?'right':'left'}}>
                    {isMe?'You':'Landlord'} · {new Date(m.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} {new Date(m.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
                  </div>
                  <div style={{background:isMe?brandColor+'22':'#f4f4f4',borderRadius:isMe?'14px 14px 4px 14px':'14px 14px 14px 4px',padding:'10px 14px',fontFamily:mono,fontSize:12,color:'#2D3C4A',lineHeight:1.7}}>
                    {m.message}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef}/>
        </div>
        <div style={{borderTop:'1px solid #f0f0f0',marginTop:8,paddingTop:12,display:'flex',gap:10}}>
          <input value={newMsg} onChange={e=>setNewMsg(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),send())}
            placeholder="Type a message…"
            style={{flex:1,fontFamily:mono,fontSize:12,background:'#f8f8f8',border:'1px solid #e8e8e8',color:'#2D3C4A',borderRadius:8,padding:'9px 14px',outline:'none'}}/>
          <button onClick={send} disabled={sending||!newMsg.trim()}
            style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'9px 20px',borderRadius:8,border:'none',
              background:sending||!newMsg.trim()?'#ccc':brandColor,color:'white',cursor:'pointer',flexShrink:0}}>
            {sending?'…':'Send'}
          </button>
        </div>
      </Card>
    </div>
  )
}

// ── PROFILE TAB ───────────────────────────────────────────────────────────────
function TenantProfile({ property, user, company }) {
  const [tenancy, setTenancy] = useState(null)
  useEffect(()=>{ api.fetchTenancyDetails(property.id).then(setTenancy).catch(()=>{}) },[property.id])

  return (
    <div>
      <h2 style={{fontSize:20,fontWeight:700,color:'#2D3C4A',marginBottom:20}}>Your profile</h2>
      <Card style={{marginBottom:16}}>
        <SectionLabel>Account</SectionLabel>
        {[['Email address',user.email],['Property',property?.address||property?.name||'—'],['Managed by',company?.name||'—']].map(([l,v])=>(
          <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f4f4f4'}}>
            <span style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED}}>{l}</span>
            <span style={{fontFamily:mono,fontSize:11,color:'#2D3C4A',fontWeight:600}}>{v}</span>
          </div>
        ))}
      </Card>
      {tenancy&&(
        <Card style={{marginBottom:16}}>
          <SectionLabel>Tenancy details</SectionLabel>
          {[
            ['Tenant name',    tenancy.tenant_names||'—'],
            ['Start date',     tenancy.tenancy_start?new Date(tenancy.tenancy_start).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'—'],
            ['End date',       tenancy.tenancy_end?new Date(tenancy.tenancy_end).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'Rolling'],
            ['Notice period',  tenancy.notice_period||'—'],
            ['Deposit amount', tenancy.deposit_amount?fmt(tenancy.deposit_amount):'—'],
            ['Deposit scheme', tenancy.deposit_scheme||'—'],
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f4f4f4'}}>
              <span style={{fontFamily:mono,fontSize:11,color:TENANT_MUTED}}>{l}</span>
              <span style={{fontFamily:mono,fontSize:11,color:'#2D3C4A',fontWeight:600}}>{v}</span>
            </div>
          ))}
        </Card>
      )}
      <div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:12,padding:'14px 16px'}}>
        <div style={{fontFamily:mono,fontSize:11,color:'#991B1B',lineHeight:1.7}}>
          To update your details or give notice to vacate, please contact your landlord via the Messages tab.
        </div>
      </div>
    </div>
  )
}
