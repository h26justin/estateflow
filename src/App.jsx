
import { useState, useEffect, useMemo } from 'react'
import { ComplianceTab, TenancyTab, MaintenanceTab, ExpensesTab, SettingsPage, NotesTimeline, OverviewTab, FinancialsTab } from './components/FeatureComponents'
import { SmartAlerts, ReportsPage, ContractorsPage } from './components/DashboardComponents'
import { StatementImporter } from './components/StatementImporter'
import { supabase } from './lib/supabase'
import { useAuth } from './lib/AuthContext'
import * as api from './lib/api'
import LoginPage from './components/LoginPage'

const T = {
  bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
  text:'#E4E0D8', muted:'#6B7191', faint:'#3A3F58',
  gold:'#C8A84B', green:'#2ECC8A', red:'#E05555', blue:'#4B8FE0', amber:'#E0943A',
}

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

function calcMonthlyMortgage(p) {
  if (!p.mortgage_rate || !p.mortgage_amount) return 0
  const r = p.mortgage_rate/12, n=(p.mortgage_term||25)*12
  return p.mortgage_amount * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1)
}
function calcGrossYield(p) {
  const base=(p.purchase_price||0)+(p.refurb_cost||0)
  return base&&p.rent_pcm?((p.rent_pcm*12)/base)*100:0
}
function calcMonthlyProfit(p) {
  return (p.rent_pcm||0)-calcMonthlyMortgage(p)-(p.insurance||0)/12
}

const STATUS_CFG = {
  rented:   {label:'Rented',    bg:'#0D2B1F',fg:'#2ECC8A',dot:'#2ECC8A'},
  vacant:   {label:'Vacant',    bg:'#2B1010',fg:'#E05555',dot:'#E05555'},
  purchased:{label:'Purchased', bg:'#2B200A',fg:'#E0943A',dot:'#E0943A'},
  refurb:   {label:'Refurbing', bg:'#0A1A2B',fg:'#4B8FE0',dot:'#4B8FE0'},
}
const REFURB_CFG = {
  complete:     {label:'Complete',    color:'#2ECC8A'},
  'in-progress':{label:'In Progress', color:'#E0943A'},
  planned:      {label:'Planned',     color:'#4B8FE0'},
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#0B0D14}::-webkit-scrollbar-thumb{background:#1E2335;border-radius:3px}
  input,select,textarea{font-family:'DM Mono',monospace;background:#12151F;border:1px solid #1E2335;color:#E4E0D8;border-radius:8px;padding:8px 12px;width:100%;font-size:13px;outline:none;transition:border-color 0.2s;}
  input:focus,select:focus,textarea:focus{border-color:#C8A84B;}
  select option{background:#12151F;}
  label{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:#6B7191;display:block;margin-bottom:5px;}
  .btn{font-family:'DM Mono',monospace;font-weight:500;border:none;cursor:pointer;border-radius:8px;padding:8px 18px;font-size:12px;transition:all 0.18s;letter-spacing:0.03em;}
  .btn-gold{background:#C8A84B;color:#0B0D14;}.btn-gold:hover{background:#D9BC72;}
  .btn-ghost{background:transparent;color:#E4E0D8;border:1px solid #1E2335;}.btn-ghost:hover{border-color:#C8A84B;color:#C8A84B;}
  .btn-danger{background:#2B1010;color:#E05555;border:1px solid #3D1A1A;}.btn-danger:hover{background:#3D1A1A;}
  .card{background:#171B28;border:1px solid #1E2335;border-radius:14px;}
  .pcard{cursor:pointer;transition:border-color 0.18s,transform 0.18s;}.pcard:hover{border-color:#C8A84B55;transform:translateY(-1px);}
  @media(max-width:768px){
    .nav-desktop{display:none!important;}
    .mobile-nav{display:flex!important;}
    .detail-grid{grid-template-columns:1fr!important;}
    .stat-grid{grid-template-columns:1fr 1fr!important;}
    .hide-mobile{display:none!important;}
  }
  @media(min-width:769px){.mobile-nav{display:none!important;}}
  .mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:#12151F;border-top:1px solid #1E2335;z-index:100;padding:8px 0 max(8px,env(safe-area-inset-bottom));}
  .fade{animation:fadeIn 0.25s ease;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px;backdrop-filter:blur(6px);}
  .modal{background:#12151F;border:1px solid #1E2335;border-radius:18px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;}
  .tab{font-family:'DM Mono',monospace;font-size:11px;background:none;border:none;color:#6B7191;cursor:pointer;padding:8px 14px;border-radius:8px;transition:all 0.18s;letter-spacing:0.05em;}
  .tab.active{background:#1E2335;color:#C8A84B;}.tab:hover{color:#E4E0D8;}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media(max-width:700px){.g2{grid-template-columns:1fr}}
`

const Badge = ({status}) => {
  const c = STATUS_CFG[status]||STATUS_CFG.purchased
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:20,background:c.bg,color:c.fg,fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:600}}>
    <span style={{width:6,height:6,borderRadius:'50%',background:c.dot,flexShrink:0}}/>{c.label}
  </span>
}

const CompanyPill = ({company}) => {
  if (!company) return null
  return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(company.color||'#C8A84B')+'22',color:company.color||'#C8A84B',border:`1px solid ${(company.color||'#C8A84B')}44`}}>{company.abbr}</span>
}

const StatCard = ({icon,label,value,sub,accent,breakdown}) => {
  const [open,setOpen] = useState(false)
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
        <div style={{marginTop:14,borderTop:`1px solid ${T.border}`,paddingTop:12,display:'grid',gap:6}}>
          {breakdown.map((item,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,flex:1}}>{item.label}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:item.color||T.text}}>{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const MONTH_LETTER = ['J','F','M','A','M','J','J','A','S','O','N','D']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getStatusColor(status) {
  if (status==='paid')    return '#2ECC8A'
  if (status==='missed')  return '#E05555'
  if (status==='late') return '#E0943A'
  if (status==='refurb')  return '#4B8FE0'
  return '#3A3F58' // void
}

const RentDots = ({payments, onUpdate, filterYear}) => {
  if (!payments?.length) return null
  const sorted=[...payments].sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month)
  const filtered = filterYear ? sorted.filter(m=>m.year===filterYear) : sorted
  return <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:8}}>
    {filtered.map(m=>{
      const col = getStatusColor(m.status)
      const letter = MONTH_LETTER[(m.month||1)-1]
      return (
        <div key={m.id}
          title={`${m.month_label}: ${m.status}${onUpdate?' — click to update':''}`}
          onClick={onUpdate ? ()=>onUpdate(m) : undefined}
          style={{
            width:18, height:18, borderRadius:3, background:col,
            cursor:onUpdate?'pointer':'default',
            transition:'transform 0.15s, box-shadow 0.15s',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}
          onMouseEnter={e=>{e.currentTarget.style.transform='scale(1.35)';e.currentTarget.style.boxShadow=`0 2px 8px ${col}88`}}
          onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}
        >
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,fontWeight:700,color:'rgba(0,0,0,0.7)',lineHeight:1,userSelect:'none'}}>{letter}</span>
        </div>
      )
    })}
  </div>
}

const Spinner = () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200}}>
  <div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
</div>

export default function App() {
  const {session,user} = useAuth()
  const [properties,  setProperties]  = useState([])
  const [companies,        setCompanies]        = useState([])
  const [companySettings,  setCompanySettings]   = useState({})  // companyId -> settings
  const [loading,     setLoading]      = useState(true)
  const [view,        setView]         = useState('dashboard')
  const [selectedId,  setSelectedId]   = useState(null)
  const [detailTab,   setDetailTab]    = useState('overview')
  const [coFilter,    setCoFilter]     = useState('all')
  const [statusFilter,setStatusFilter] = useState('all')
  const [searchQ,     setSearchQ]      = useState('')
  const [activeCoTab, setActiveCoTab]  = useState(null)
  const [showAddProp, setShowAddProp]  = useState(false)
  const [showAddCo,   setShowAddCo]    = useState(false)
  const [editProp,    setEditProp]     = useState(null)
  const [toast,       setToast]        = useState(null)
  const [editingPayment, setEditingPayment] = useState(null)  // {payment, propId}
  const [showAdmin,        setShowAdmin]        = useState(false)
  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(null)
  const [showImporter,       setShowImporter]       = useState(false)
  const [isAdmin,     setIsAdmin]     = useState(false)
  const [userAccess,  setUserAccess]  = useState([])  // company_ids this user can see

  useEffect(()=>{
    if (!user) return
    async function loadData() {
      setLoading(true)
      try {
        const [cos, props, access] = await Promise.all([
          api.fetchCompanies(),
          api.fetchProperties(),
          api.fetchUserAccess(user.id)
        ])
        const accessIds = access.map(a=>a.company_id)
        const isAdminUser = access.length===0 || access.some(a=>a.is_admin)
        setIsAdmin(isAdminUser)
        setUserAccess(accessIds)
        const visibleCos   = isAdminUser ? cos   : cos.filter(c=>accessIds.includes(c.id))
        const visibleProps = isAdminUser ? props : props.filter(p=>accessIds.includes(p.company_id))
        setCompanies(visibleCos)
        setProperties(visibleProps)
        if(visibleCos.length>0) setActiveCoTab(visibleCos[0].id)
        // Auto-generate future rent months silently in background
        api.ensureFutureRentMonths(visibleProps, 6).then(count=>{
          if(count>0){
            api.fetchProperties().then(refreshed=>{
              const vis = isAdminUser ? refreshed : refreshed.filter(p=>accessIds.includes(p.company_id))
              setProperties(vis)
            })
          }
        }).catch(e=>console.log('Future months:', e))
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
        console.log('Load error, showing all:', e.message)
        setIsAdmin(true)
        const [cos, props] = await Promise.all([api.fetchCompanies(), api.fetchProperties()])
        setCompanies(cos)
        setProperties(props)
        if(cos.length>0) setActiveCoTab(cos[0].id)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  },[user])

  // Expose loadData for refresh after import
  async function refreshData() {
    try {
      const props = await api.fetchProperties()
      setProperties(props)
    } catch(e) { console.log(e) }
  }

  const filtered = useMemo(()=>{
    const f = properties.filter(p=>{
      if(coFilter!=='all'&&p.company_id!==coFilter) return false
      if(statusFilter!=='all'&&p.status!==statusFilter) return false
      if(searchQ&&!p.name.toLowerCase().includes(searchQ.toLowerCase())&&!p.address.toLowerCase().includes(searchQ.toLowerCase())) return false
      return true
    })
    // Sort
    return [...f].sort((a,b)=>{
      switch(sortBy) {
        case 'company-name': {
          const coA = a.company?.name||''; const coB = b.company?.name||''
          if(coA!==coB) return coA.localeCompare(coB)
          return a.name.localeCompare(b.name)
        }
        case 'name':         return a.name.localeCompare(b.name)
        case 'status':       return (a.status||'').localeCompare(b.status||'')
        case 'rent-high':    return (b.rent_pcm||0)-(a.rent_pcm||0)
        case 'rent-low':     return (a.rent_pcm||0)-(b.rent_pcm||0)
        case 'yield-high':   return calcGrossYield(b)-calcGrossYield(a)
        case 'arrears':      return (b.arrears||0)-(a.arrears||0)
        case 'value-high':   return (b.est_value||0)-(a.est_value||0)
        case 'custom':       return (a.sort_order||0)-(b.sort_order||0)
        default:             return 0
      }
    })
  },[properties,coFilter,statusFilter,searchQ,sortBy])

  const stats = useMemo(()=>({
    totalInvested:       properties.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
    totalEstVal:         properties.reduce((s,p)=>s+(p.est_value||0),0),
    monthlyRent:         properties.filter(p=>p.status==='rented').reduce((s,p)=>s+(p.rent_pcm||0),0),
    totalArrears:        properties.reduce((s,p)=>s+(p.arrears||0),0),
    totalMortgage:       properties.reduce((s,p)=>s+(p.mortgage_amount||0),0),
    totalEquity:         properties.reduce((s,p)=>s+(p.est_value||0)-(p.mortgage_amount||0),0),
    monthlyMortgageCost: properties.reduce((s,p)=>{
      if(!p.mortgage_rate||!p.mortgage_amount) return s
      const r=p.mortgage_rate/12, n=(p.mortgage_term||25)*12
      return s+p.mortgage_amount*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1)
    },0),
    mortgaged:           properties.filter(p=>(p.mortgage_amount||0)>0).length,
    rented:              properties.filter(p=>p.status==='rented').length,
    vacant:              properties.filter(p=>p.status==='vacant').length,
    inRefurb:            properties.filter(p=>p.refurb_status==='in-progress').length,
    total:               properties.length,
  }),[properties])

  const companyStats = useMemo(()=>companies.map(c=>{
    const ps=properties.filter(p=>p.company_id===c.id)
    return {...c, count:ps.length,
      invested:    ps.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
      estVal:      ps.reduce((s,p)=>s+(p.est_value||0),0),
      monthlyRent: ps.filter(p=>p.status==='rented').reduce((s,p)=>s+(p.rent_pcm||0),0),
      arrears:     ps.reduce((s,p)=>s+(p.arrears||0),0),
      rented:      ps.filter(p=>p.status==='rented').length,
      vacant:      ps.filter(p=>p.status==='vacant').length,
    }
  }),[companies,properties])


    // Early returns AFTER all hooks
  if (session===undefined) return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style><div style={{width:32,height:32,border:`3px solid #1E2335`,borderTopColor:'#C8A84B',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>
  if (!session) return <LoginPage/>

  function showToast(msg,type='success'){setToast({msg,type});setTimeout(()=>setToast(null),3500)}

  const selected = properties.find(p=>p.id===selectedId)

  function openDetail(p){setSelectedId(p.id);setDetailTab('overview');setView('detail')}

  async function handleSaveProp(formData){
    try{
      if(editProp){
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
      if (error) { showToast('Incorrect password — property not deleted', 'error'); return false }
      await api.deleteProperty(id)
      setProperties(prev=>prev.filter(p=>p.id!==id))
      setView('properties');setSelectedId(null)
      setShowDeleteConfirm(null)
      showToast('Property deleted')
      return true
    }catch(e){showToast(e.message,'error'); return false}
  }

  async function handleSaveCo(formData){
    try{
      const co=await api.createCompany({...formData,user_id:user.id})
      setCompanies(prev=>[...prev,co]);setActiveCoTab(co.id)
      showToast('Company added');setShowAddCo(false)
    }catch(e){showToast(e.message,'error')}
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

  const navItems=[{key:'dashboard',label:'Dashboard',icon:'🏠'},{key:'properties',label:'Properties',icon:'🏘'},{key:'companies',label:'Companies',icon:'🏢'},{key:'rent',label:'Rent Tracker',icon:'💷'},{key:'reports',label:'Reports',icon:'📊'},{key:'contractors',label:'Contractors',icon:'🔧'},{key:'settings',label:'Settings',icon:'⚙️'}]

  return (
    <div style={{fontFamily:"'Fraunces',Georgia,serif",minHeight:'100vh',background:T.bg,color:T.text}}>
      <style>{CSS}</style>
      <header style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 24px',position:'sticky',top:0,zIndex:100}}>
        <div style={{maxWidth:1240,margin:'0 auto',height:60,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:32,height:32,background:`linear-gradient(135deg,${T.gold},#8B6B1F)`,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>🏛</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,letterSpacing:'-0.02em',lineHeight:1}}>Estateflow</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:'0.12em',textTransform:'uppercase'}}>Portfolio Manager</div>
            </div>
          </div>
          <nav style={{display:'flex',gap:2}}>
            {navItems.map(n=>(
              <button key={n.key} className={`tab ${view===n.key||(view==='detail'&&n.key==='properties')?'active':''}`}
                onClick={()=>{setView(n.key);if(n.key!=='detail')setSelectedId(null)}}>
                {n.icon} {n.label}
              </button>
            ))}
          </nav>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-gold" style={{fontSize:11,padding:'7px 14px'}} onClick={()=>{setEditProp(null);setShowAddProp(true)}}>+ Add Property</button>
            <div className="hide-mobile" style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 14px'}} onClick={()=>supabase.auth.signOut()}>Sign Out</button>
            </div>
          </div>
        </div>
      </header>

      <main style={{maxWidth:1240,margin:'0 auto',padding:'28px 24px'}}>
        {loading?<Spinner/>:<>

          {view==='dashboard'&&<div className="fade">
            <div style={{marginBottom:28}}>
              <h1 style={{fontSize:28,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Portfolio Overview</h1>
              <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12}}>{stats.total} properties · {companies.length} companies · {stats.rented} rented · {stats.vacant} vacant</p>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,marginBottom:28}}>
              <StatCard icon="🏛" label="Portfolio Value" value={fmt(stats.totalEstVal)} sub={`Invested ${fmt(stats.totalInvested)}`}
                breakdown={[
                  {label:'Estimated portfolio value', value:fmt(stats.totalEstVal), color:T.gold},
                  {label:'Total invested', value:fmt(stats.totalInvested)},
                  {label:'Purchase prices total', value:fmt(properties.reduce((s,p)=>s+(p.purchase_price||0),0))},
                  {label:'Refurb costs total', value:fmt(properties.reduce((s,p)=>s+(p.refurb_cost||0),0))},
                  {label:'Stamp duty total', value:fmt(properties.reduce((s,p)=>s+(p.stamp_duty||0),0))},
                  {label:'Legal fees total', value:fmt(properties.reduce((s,p)=>s+(p.legal_fees||0),0))},
                  {label:'Unrealised gain', value:fmt(stats.totalEstVal-stats.totalInvested), color:stats.totalEstVal>stats.totalInvested?T.green:T.red},
                ]}
              />
              <StatCard icon="💷" label="Monthly Rental Income" value={fmt(stats.monthlyRent)} sub={fmt(stats.monthlyRent*12)+'/yr'} accent={T.green}
                breakdown={[
                  ...companyStats.map(c=>({label:c.name, value:fmt(c.monthlyRent), color:c.color})),
                  {label:'Annual total', value:fmt(stats.monthlyRent*12), color:T.green},
                  {label:'Rented units', value:`${stats.rented} of ${stats.total}`},
                  {label:'Occupancy rate', value:`${Math.round((stats.rented/Math.max(stats.total,1))*100)}%`, color:T.green},
                ]}
              />
              <StatCard icon="⚠" label="Total Arrears" value={fmt(stats.totalArrears)} sub={`${stats.vacant} vacant`} accent={stats.totalArrears>0?T.red:T.green}
                breakdown={[
                  ...properties.filter(p=>(p.arrears||0)>0).map(p=>({label:p.name, value:fmt(p.arrears), color:T.red})),
                  ...(properties.filter(p=>(p.arrears||0)>0).length===0?[{label:'No arrears — all clear!', value:'✓', color:T.green}]:[]),
                  {label:'Vacant units', value:stats.vacant, color:stats.vacant>0?T.amber:T.green},
                ]}
              />
              <StatCard icon="🔨" label="In Refurbishment" value={stats.inRefurb} sub={`of ${stats.total} total`} accent={T.blue}
                breakdown={[
                  ...properties.filter(p=>p.refurb_status==='in-progress').map(p=>({label:p.name, value:p.company?.abbr||'', color:T.blue})),
                  ...(stats.inRefurb===0?[{label:'No active refurbs', value:'✓', color:T.green}]:[]),
                  {label:'Planned refurbs', value:properties.filter(p=>p.refurb_status==='planned').length},
                  {label:'Completed refurbs', value:properties.filter(p=>p.refurb_status==='complete').length, color:T.green},
                ]}
              />
              <StatCard icon="🏦" label="Mortgages Outstanding" value={fmt(stats.totalMortgage)} sub={`${stats.mortgaged} mortgaged properties`} accent="#9B59B6"
                breakdown={[
                  {label:'Total mortgage debt', value:fmt(stats.totalMortgage), color:'#9B59B6'},
                  {label:'Total portfolio equity', value:fmt(stats.totalEquity), color:stats.totalEquity>0?T.green:T.red},
                  {label:'Monthly repayments', value:fmt(stats.monthlyMortgageCost)},
                  {label:'Annual repayments', value:fmt(stats.monthlyMortgageCost*12)},
                  {label:'Average LTV', value:stats.totalEstVal>0?((stats.totalMortgage/stats.totalEstVal)*100).toFixed(1)+'%':'—'},
                  ...companyStats.map(c=>({
                    label:c.name+' debt',
                    value:fmt(properties.filter(p=>p.company_id===c.id).reduce((s,p)=>s+(p.mortgage_amount||0),0)),
                    color:c.color
                  })),
                ]}
              />
            </div>
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
                      <button className="btn btn-ghost" style={{width:'100%',marginTop:12,fontSize:11}} onClick={()=>{setActiveCoTab(c.id);setView('companies')}}>View Properties →</button>
                    </div>
                  ))}
                </div>
            }
            <SmartAlerts properties={properties} companies={companies} fmt={fmt} openDetail={openDetail}/>
          </div>}

          {view==='properties'&&<div className="fade">
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:22}}>
              <div>
                <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>All Properties</h1>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{filtered.length} of {properties.length} shown</div>
              </div>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:18}}>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search name or address…" style={{width:230,padding:'7px 12px',fontSize:12}}/>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[{id:'all',abbr:'All',color:T.gold},...companies].map(c=>(
                  <button key={c.id} onClick={()=>setCoFilter(c.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${coFilter===c.id?(c.color||T.gold):T.border}`,background:coFilter===c.id?(c.color||T.gold)+'22':'transparent',color:coFilter===c.id?(c.color||T.gold):T.muted,transition:'all 0.18s'}}>{c.abbr}</button>
                ))}
                <div style={{width:1,background:T.border,margin:'0 2px'}}/>
                {['all','rented','vacant','purchased','refurb'].map(f=>(
                  <button key={f} onClick={()=>setStatusFilter(f)} style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:`1px solid ${statusFilter===f?T.gold:T.border}`,background:statusFilter===f?T.gold+'22':'transparent',color:statusFilter===f?T.gold:T.muted,transition:'all 0.18s'}}>{f==='all'?'All Status':STATUS_CFG[f]?.label||f}</button>
                ))}
              </div>
            </div>
            {/* Sort control */}
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',flexShrink:0}}>Sort by:</span>
              {[
                {v:'company-name', l:'Company → Name'},
                {v:'name',         l:'Name A–Z'},
                {v:'status',       l:'Status'},
                {v:'rent-high',    l:'Rent (High–Low)'},
                {v:'yield-high',   l:'Yield (High–Low)'},
                {v:'arrears',      l:'Arrears'},
                {v:'value-high',   l:'Value (High–Low)'},
                {v:'custom',       l:'Custom Order ⠿'},
              ].map(opt=>(
                <button key={opt.v} onClick={()=>setSortBy(opt.v)}
                  style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'4px 12px',borderRadius:20,cursor:'pointer',
                    border:`1px solid ${sortBy===opt.v?T.gold:T.border}`,
                    background:sortBy===opt.v?T.gold+'22':'transparent',
                    color:sortBy===opt.v?T.gold:T.muted,transition:'all 0.18s',whiteSpace:'nowrap'}}>
                  {opt.l}
                </button>
              ))}
            </div>
            <DraggablePropertyList filtered={filtered} fmt={fmt} openDetail={openDetail} calcGrossYield={calcGrossYield} setProperties={setProperties} properties={properties} sortBy={sortBy}/>
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
              const cProps=properties.filter(p=>p.company_id===c.id)
              return <div key={c.id}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:22}}>
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
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:T.gold}}>{calcGrossYield(p).toFixed(1)}%</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted}}>{fmt(p.rent_pcm)>{"mo"}</div>
                      <Badge status={p.status}/>
                    </div>
                  ))}
                  {cProps.length===0&&<div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,padding:'32px',textAlign:'center'}}>No properties for this company yet.</div>}
                </div>
              </div>
            })}
          </div>}

          {view==='rent'&&<RentTrackerOverview companies={companies} properties={properties} fmt={fmt} openDetail={openDetail}/>}
          {view==='settings'&&<SettingsPage companies={companies} companySettings={companySettings} setCompanySettings={setCompanySettings} user={user} showToast={showToast} isAdmin={isAdmin}/>}
          {view==='reports'&&<ReportsPage properties={properties} companies={companies} fmt={fmt} onImport={()=>setShowImporter(true)}/>}
          {view==='contractors'&&<ContractorsPage companies={companies} showToast={showToast}/>}

          {view==='detail'&&selected&&<div className="fade">
            <button className="btn btn-ghost" style={{marginBottom:20,fontSize:11}} onClick={()=>setView('properties')}>← Back</button>
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
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditProp(selected);setShowAddProp(true)}}>Edit</button>
                      <button className="btn btn-ghost" style={{fontSize:11,color:'#6B7191',borderColor:'#1E2335'}}
                          onClick={()=>setShowDeleteConfirm(selected.id)}
                          title="Delete property">⋯</button>
                    </div>
                  </div>
                </div>
                {(()=>{
                  const co = selected?.company_id
                  const cs = companySettings[co] || {}
                  const tabs = ['overview','refurb','rent','financials']
                  if(cs.feature_compliance)  tabs.push('compliance')
                  if(cs.feature_tenancy)     tabs.push('tenancy')
                  if(cs.feature_maintenance) tabs.push('maintenance')
                  if(cs.feature_expenses)    tabs.push('expenses')
                  return (
                    <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
                      {tabs.map(t=>(
                        <button key={t} className={`tab ${detailTab===t?'active':''}`} onClick={()=>setDetailTab(t)} style={{textTransform:'capitalize'}}>{t}</button>
                      ))}
                    </div>
                  )
                })()}
                {detailTab==='overview'&&<OverviewTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={calcGrossYield} isAdmin={isAdmin} user={user} showToast={showToast}/>}
                {false&&detailTab==='overview-old'&&<div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:14}}>
                    {[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)},{l:'Total Invested',v:fmt((selected.purchase_price||0)+(selected.refurb_cost||0)),gold:true},{l:'Est. Value',v:fmt(selected.est_value)},{l:'Gross Yield',v:calcGrossYield(selected).toFixed(1)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0}].map((item,i)=>(
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
                {detailTab==='refurb'&&<RefurbTab prop={selected} onAddPhase={handleAddPhase} onAddCost={handleAddCost} onUpdateField={handleUpdatePropField} isAdmin={isAdmin} user={user}/>}
                {detailTab==='rent'&&<RentTab selected={selected} fmt={fmt} setEditingPayment={setEditingPayment} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties}/>}
                {detailTab==='financials'&&<FinancialsTab selected={selected} fmt={fmt} calcMonthlyMortgage={calcMonthlyMortgage} calcGrossYield={calcGrossYield} calcMonthlyProfit={calcMonthlyProfit} isAdmin={isAdmin} user={user} showToast={showToast}/>}
                {false&&<div style={{display:'grid',gap:12}}>
                  {[{title:'Purchase & Costs',items:[{l:'Purchase Price',v:fmt(selected.purchase_price)},{l:'Deposit',v:fmt(selected.deposit)},{l:'Mortgage Amount',v:fmt(selected.mortgage_amount)},{l:'Stamp Duty',v:fmt(selected.stamp_duty)},{l:'Legal Fees',v:fmt(selected.legal_fees)},{l:'Refurb Cost',v:fmt(selected.refurb_cost)}]},{title:'Mortgage',items:[{l:'Rate',v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'—'},{l:'Term',v:selected.mortgage_term?selected.mortgage_term+' years':'—'},{l:'Monthly (Repay)',v:fmt(calcMonthlyMortgage(selected))},{l:'Monthly (IO)',v:selected.mortgage_amount&&selected.mortgage_rate?fmt(selected.mortgage_amount*selected.mortgage_rate/12):'—'}]},{title:'Returns',items:[{l:'Monthly Rent',v:fmt(selected.rent_pcm),gold:true},{l:'Annual Rent',v:fmt((selected.rent_pcm||0)*12),gold:true},{l:'Gross Yield',v:calcGrossYield(selected).toFixed(2)+'%',gold:true},{l:'Monthly Profit',v:fmt(calcMonthlyProfit(selected)),green:calcMonthlyProfit(selected)>0},{l:'Annual Profit',v:fmt(calcMonthlyProfit(selected)*12),green:calcMonthlyProfit(selected)>0}]}].map((section,si)=>(
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
                {detailTab==='compliance'&&<ComplianceTab propertyId={selected.id} showToast={showToast} isAdmin={isAdmin} user={user} category="compliance"/>}
                {detailTab==='tenancy'&&<TenancyTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="tenancy"/>}
                {detailTab==='maintenance'&&<MaintenanceTab propertyId={selected.id} showToast={showToast} fmt={fmt} isAdmin={isAdmin} user={user} category="maintenance"/>}
                {detailTab==='expenses'&&<ExpensesTab propertyId={selected.id} showToast={showToast} fmt={fmt} rentPcm={selected.rent_pcm||0} isAdmin={isAdmin} user={user} category="expenses"/>}
              </div>
              <div style={{display:'grid',gap:12}}>
                <div className="card" style={{padding:'18px 20px'}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Quick Stats</div>
                  {[{l:'Total Capital In',v:fmt((selected.deposit||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)+(selected.refurb_cost||0))},{l:'Estimated Value',v:fmt(selected.est_value)},{l:'Equity',v:fmt((selected.est_value||0)-(selected.mortgage_amount||0))},{l:'LTV',v:selected.est_value&&selected.mortgage_amount?((selected.mortgage_amount/selected.est_value)*100).toFixed(0)+'%':'—'}].map((item,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8,marginBottom:6}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{item.l}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:T.gold}}>{item.v}</span>
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

      {showAddProp&&<PropertyModal prop={editProp} companies={companies} onClose={()=>{setShowAddProp(false);setEditProp(null)}} onSave={handleSaveProp}/>}
      {showAddCo&&<CompanyModal onClose={()=>setShowAddCo(false)} onSave={handleSaveCo}/>}
      {editingPayment&&<PaymentModal payment={editingPayment.payment} onClose={()=>setEditingPayment(null)} onSave={handleUpdatePayment}/>}
      {/* Access modal now lives inside Settings page */}
      {showImporter&&<StatementImporter properties={properties} companies={companies} showToast={showToast} onClose={()=>{setShowImporter(false); refreshData()}}/>}
      {showDeleteConfirm&&<DeleteConfirmModal propName={properties.find(p=>p.id===showDeleteConfirm)?.name||''} onClose={()=>setShowDeleteConfirm(null)} onConfirm={pwd=>handleDeleteProp(showDeleteConfirm,pwd)}/>}

      {toast&&<div style={{position:'fixed',bottom:24,right:24,zIndex:999,background:toast.type==='error'?'#2B1010':'#0D2B1F',border:`1px solid ${toast.type==='error'?T.red:T.green}`,color:toast.type==='error'?T.red:T.green,fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,padding:'12px 20px',borderRadius:10,animation:'fadeIn 0.2s ease'}}>{toast.msg}</div>}

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" style={{display:'flex',justifyContent:'space-around',alignItems:'center'}}>
        {[
          {key:'dashboard',icon:'◈',label:'Home'},
          {key:'properties',icon:'⊞',label:'Props'},
          {key:'rent',icon:'£',label:'Rent'},
          {key:'reports',icon:'📊',label:'Reports'},
          {key:'settings',icon:'⚙',label:'Settings'},
        ].map(item=>(
          <button key={item.key} onClick={()=>setView(item.key)}
            style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:2,padding:'4px 8px',
              color:view===item.key?T.gold:T.muted,fontSize:10,fontFamily:"'DM Mono',monospace"}}>
            <span style={{fontSize:18}}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function RefurbTab({prop,onAddPhase,onAddCost,onUpdateField,isAdmin,user}){
  const [phaseForm,setPhaseForm]=useState({name:'',start_date:'',end_date:'',done:false,notes:''})
  const [costForm,setCostForm]=useState({trade:'',cost:'',paid:false,date:'',notes:''})
  const [showPF,setShowPF]=useState(false)
  const [showCF,setShowCF]=useState(false)
  const phases=prop.refurb_phases||[]
  const costs=prop.refurb_costs||[]
  const totalCost=costs.reduce((s,i)=>s+(parseFloat(i.cost)||0),0)
  const paidCost=costs.filter(i=>i.paid).reduce((s,i)=>s+(parseFloat(i.cost)||0),0)
  return <div>
    <div className="card" style={{padding:'14px 18px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
      <div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#6B7191',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Refurb Status</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:REFURB_CFG[prop.refurb_status]?.color||'#C8A84B'}}>{REFURB_CFG[prop.refurb_status]?.label||prop.refurb_status}</div>
      </div>
      <div style={{display:'flex',gap:20}}>
        <div style={{textAlign:'right'}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#6B7191',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>Total Cost</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:'#E0943A'}}>{fmt(totalCost)}</div></div>
        <div style={{textAlign:'right'}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#6B7191',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:2}}>Paid Out</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:'#2ECC8A'}}>{fmt(paidCost)}</div></div>
      </div>
      <select value={prop.refurb_status} onChange={e=>onUpdateField(prop.id,'refurb_status',e.target.value)} style={{width:'auto',fontSize:11,padding:'6px 10px'}}>
        <option value="planned">Planned</option><option value="in-progress">In Progress</option><option value="complete">Complete</option>
      </select>
    </div>
    <div style={{marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#6B7191',textTransform:'uppercase',letterSpacing:'0.1em'}}>Phases</div>
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
      {phases.length===0&&!showPF&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#3A3F58',padding:'12px 0'}}>No phases yet.</div>}
      {phases.map(ph=>(
        <div key={ph.id} className="card" style={{padding:'12px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:10,height:10,borderRadius:'50%',background:ph.done?'#2ECC8A':'#E0943A',flexShrink:0}}/>
          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{ph.name}</div>{(ph.start_date||ph.end_date)&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#6B7191'}}>{ph.start_date||'?'} → {ph.end_date||'ongoing'}</div>}</div>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:ph.done?'#2ECC8A':'#E0943A'}}>{ph.done?'✓ Done':'In Progress'}</span>
        </div>
      ))}
    </div>
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#6B7191',textTransform:'uppercase',letterSpacing:'0.1em'}}>Trade Costs</div>
        <button className="btn btn-ghost" style={{fontSize:10,padding:'5px 10px'}} onClick={()=>setShowCF(v=>!v)}>+ Add Cost</button>
      </div>
      {showCF&&<div className="card" style={{padding:'14px 16px',marginBottom:10}}>
        <div className="g2" style={{marginBottom:10}}>
          <div><label>Trade / Description</label><input value={costForm.trade} onChange={e=>setCostForm(f=>({...f,trade:e.target.value}))} placeholder="e.g. Plumber"/></div>
          <div><label>Cost (£)</label><input type="number" value={costForm.cost} onChange={e=>setCostForm(f=>({...f,cost:e.target.value}))} placeholder="0"/></div>
        </div>
        <div className="g2" style={{marginBottom:10}}>
          <div><label>Date</label><input type="date" value={costForm.date} onChange={e=>setCostForm(f=>({...f,date:e.target.value}))}/></div>
          <div style={{display:'flex',alignItems:'center',gap:8,paddingTop:18}}><input type="checkbox" checked={costForm.paid} onChange={e=>setCostForm(f=>({...f,paid:e.target.checked}))} style={{width:'auto'}}/><label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>Paid</label></div>
        </div>
        <div style={{marginBottom:10}}><label>Notes</label><input value={costForm.notes} onChange={e=>setCostForm(f=>({...f,notes:e.target.value}))} placeholder="Optional"/></div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{if(costForm.trade){onAddCost(prop.id,{...costForm,cost:parseFloat(costForm.cost)||0});setCostForm({trade:'',cost:'',paid:false,date:'',notes:''});setShowCF(false)}}}>Add Cost</button>
      </div>}
      {costs.length===0&&!showCF&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'#3A3F58',padding:'12px 0'}}>No costs logged yet.</div>}
      {costs.map(item=>(
        <div key={item.id} className="card" style={{padding:'12px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{item.trade}</div>{item.notes&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#6B7191'}}>{item.notes}</div>}{item.date&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#3A3F58'}}>{item.date}</div>}</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:item.paid?'#2ECC8A':'#E0943A'}}>{fmt(item.cost)}</div>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:item.paid?'#2ECC8A':'#E0943A'}}>{item.paid?'✓ Paid':'Unpaid'}</span>
        </div>
      ))}
    </div>
    <div style={{marginTop:20}}>
      <NotesTimeline propertyId={prop.id} isAdmin={isAdmin} user={user} showToast={()=>{}} category="refurb"/>
    </div>
  </div>
}

function PropertyModal({prop,companies,onClose,onSave}){
  const blank={name:'',company_id:companies[0]?.id||'',address:'',prop_type:'',status:'purchased',refurb_status:'planned',purchase_price:'',refurb_cost:'',est_value:'',mortgage_amount:'',deposit:'',stamp_duty:'',legal_fees:'',rent_pcm:'',mortgage_rate:'',mortgage_term:25,insurance:'',arrears:0,tenancy_end:'',rent_due_day:'',notes:'',managed_by:''}
  const [form,setForm]=useState(prop?{...prop,company_id:prop.company_id||prop.company?.id||'',mortgage_rate:prop.mortgage_rate?(prop.mortgage_rate*100).toFixed(2):''}:blank)
  const s=(k,v)=>setForm(f=>({...f,[k]:v}))
  function handleSave(){
    if(!form.name||!form.address) return
    onSave({...form,purchase_price:parseFloat(form.purchase_price)||0,refurb_cost:parseFloat(form.refurb_cost)||0,est_value:parseFloat(form.est_value)||0,mortgage_amount:parseFloat(form.mortgage_amount)||0,deposit:parseFloat(form.deposit)||0,stamp_duty:parseFloat(form.stamp_duty)||0,legal_fees:parseFloat(form.legal_fees)||0,rent_pcm:parseFloat(form.rent_pcm)||0,mortgage_rate:parseFloat(form.mortgage_rate)/100||0,mortgage_term:parseInt(form.mortgage_term)||25,insurance:parseFloat(form.insurance)||0,arrears:parseFloat(form.arrears)||0})
  }
  return <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal">
      <div style={{padding:'24px 28px 0'}}>
        <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:'#E4E0D8'}}>{prop?'Edit Property':'Add New Property'}</h2>
        <p style={{fontFamily:"'DM Mono',monospace",color:'#6B7191',fontSize:11,marginBottom:20}}>Fill in the details below.</p>
      </div>
      <div style={{padding:'0 28px 28px',display:'flex',flexDirection:'column',gap:12}}>
        <div className="g2"><div><label>Property Name *</label><input value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Flat 1, Station Road"/></div><div><label>Company *</label><select value={form.company_id} onChange={e=>s('company_id',e.target.value)}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
        <div><label>Full Address *</label><input value={form.address} onChange={e=>s('address',e.target.value)}/></div>
        <div className="g2"><div><label>Property Type</label><input value={form.prop_type} onChange={e=>s('prop_type',e.target.value)} placeholder="e.g. 2-Bed Flat"/></div><div><label>Status</label><select value={form.status} onChange={e=>s('status',e.target.value)}>{['purchased','refurb','rented','vacant'].map(x=><option key={x}>{x}</option>)}</select></div></div>
          <div><label>Managed By</label><input value={form.managed_by||''} onChange={e=>s('managed_by',e.target.value)} placeholder="e.g. Propertunity, Rook Matthews Sayer"/></div>
        <div className="g2"><div><label>Purchase Price (£)</label><input type="number" value={form.purchase_price} onChange={e=>s('purchase_price',e.target.value)}/></div><div><label>Estimated Value (£)</label><input type="number" value={form.est_value} onChange={e=>s('est_value',e.target.value)}/></div></div>
        <div className="g2"><div><label>Refurb Cost (£)</label><input type="number" value={form.refurb_cost} onChange={e=>s('refurb_cost',e.target.value)}/></div><div><label>Mortgage Amount (£)</label><input type="number" value={form.mortgage_amount} onChange={e=>s('mortgage_amount',e.target.value)}/></div></div>
        <div className="g2"><div><label>Stamp Duty (£)</label><input type="number" value={form.stamp_duty} onChange={e=>s('stamp_duty',e.target.value)}/></div><div><label>Legal Fees (£)</label><input type="number" value={form.legal_fees} onChange={e=>s('legal_fees',e.target.value)}/></div></div>
        <div className="g2"><div><label>Monthly Rent (£)</label><input type="number" value={form.rent_pcm} onChange={e=>s('rent_pcm',e.target.value)}/></div><div><label>Mortgage Rate (%)</label><input type="number" step="0.01" value={form.mortgage_rate} onChange={e=>s('mortgage_rate',e.target.value)}/></div></div>
        <div className="g2"><div><label>Rent Due Day</label><input value={form.rent_due_day} onChange={e=>s('rent_due_day',e.target.value)} placeholder="e.g. 1st"/></div><div><label>Arrears (£)</label><input type="number" value={form.arrears} onChange={e=>s('arrears',e.target.value)}/></div></div>
        <div><label>Tenancy End</label><input value={form.tenancy_end} onChange={e=>s('tenancy_end',e.target.value)} placeholder="e.g. 31st March 2026"/></div>
        <div><label>Notes</label><textarea value={form.notes} onChange={e=>s('notes',e.target.value)} rows={3} style={{resize:'vertical'}}/></div>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={handleSave}>{prop?'Save Changes':'Add Property'}</button>
        </div>
      </div>
    </div>
  </div>
}

function CompanyModal({onClose,onSave}){
  const [form,setForm]=useState({name:'',abbr:'',color:'#C8A84B'})
  const s=(k,v)=>setForm(f=>({...f,[k]:v}))
  return <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal" style={{maxWidth:420}}>
      <div style={{padding:'24px 28px 0'}}>
        <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:'#E4E0D8'}}>Add Company</h2>
        <p style={{fontFamily:"'DM Mono',monospace",color:'#6B7191',fontSize:11,marginBottom:20}}>Create a new company to group properties under.</p>
      </div>
      <div style={{padding:'0 28px 28px',display:'flex',flexDirection:'column',gap:12}}>
        <div><label>Company Name *</label><input value={form.name} onChange={e=>s('name',e.target.value)} placeholder="e.g. Vale Property Group"/></div>
        <div><label>Short Code (3-4 letters)</label><input value={form.abbr} onChange={e=>s('abbr',e.target.value.toUpperCase())} placeholder="e.g. VPG" maxLength={4}/></div>
        <div><label>Colour</label><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{['#C8A84B','#4B8FE0','#2ECC8A','#E05555','#9B59B6','#E0943A','#1ABC9C','#E74C3C'].map(col=><div key={col} onClick={()=>s('color',col)} style={{width:32,height:32,borderRadius:8,background:col,cursor:'pointer',border:`3px solid ${form.color===col?'#fff':'transparent'}`,transition:'border 0.15s'}}/>)}</div></div>
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={()=>{if(form.name&&form.abbr)onSave(form)}}>Add Company</button>
        </div>
      </div>
    </div>
  </div>
}




// ─── DELETE CONFIRM MODAL ────────────────────────────────────────────────────
function DeleteConfirmModal({propName, onClose, onConfirm}) {
  const T = {bg:'#0B0D14',card:'#171B28',border:'#1E2335',text:'#E4E0D8',muted:'#6B7191',red:'#E05555',gold:'#C8A84B'}
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleConfirm() {
    if (!password) { setError('Please enter your password'); return }
    setLoading(true); setError('')
    const ok = await onConfirm(password)
    if (!ok) setError('Incorrect password. Property not deleted.')
    setLoading(false)
  }

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:420}}>
        <div style={{padding:'28px 28px'}}>
          <div style={{fontSize:32,marginBottom:12,textAlign:'center'}}>⚠️</div>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8,color:T.text,textAlign:'center'}}>Delete Property?</h2>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,marginBottom:6,textAlign:'center'}}>You are about to permanently delete:</p>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.red,fontSize:13,fontWeight:700,marginBottom:20,textAlign:'center'}}>{propName}</p>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:11,marginBottom:16,textAlign:'center'}}>This will delete all associated rent history, refurb data and notes. This cannot be undone.<br/><br/>Enter your password to confirm.</p>
          <div style={{marginBottom:16}}>
            <label>Your Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handleConfirm()}
              placeholder="••••••••" autoFocus/>
          </div>
          {error&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.red,background:'#2B1010',border:'1px solid #3D1A1A',borderRadius:8,padding:'10px 14px',marginBottom:16}}>{error}</div>}
          <div style={{display:'flex',gap:10}}>
            <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
            <button disabled={loading} onClick={handleConfirm}
              style={{flex:1,fontFamily:"'DM Mono',monospace",fontWeight:600,background:loading?'#3D1A1A':'#2B1010',color:'#E05555',border:'1px solid #5C2C2C',borderRadius:8,padding:'10px',fontSize:13,cursor:loading?'not-allowed':'pointer'}}>
              {loading?'Verifying…':'Delete Permanently'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── DRAGGABLE PROPERTY LIST ─────────────────────────────────────────────────
function DraggablePropertyList({filtered, fmt, openDetail, calcGrossYield, setProperties, properties, sortBy}) {
  const T = {
    bg:'#0B0D14', card:'#171B28', border:'#1E2335',
    text:'#E4E0D8', muted:'#6B7191', red:'#E05555', gold:'#C8A84B', faint:'#3A3F58',
  }
  const [items, setItems] = useState(filtered)
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  // Sync when filtered changes (e.g. filter applied)
  useEffect(()=>{
    setItems(filtered)
  },[filtered])

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
    const newItems = [...items]
    const [moved] = newItems.splice(dragging, 1)
    newItems.splice(targetIdx, 0, moved)
    setItems(newItems)
    // Persist new order to DB in background
    newItems.forEach((p, i) => {
      if (p.sort_order !== i) {
        supabase.from('properties').update({sort_order: i}).eq('id', p.id).then(()=>{})
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

  return (
    <div style={{display:'grid',gap:8}}>
      {items.map((p, idx) => {
        // Company group header when sorted by company
        const showCompanyHeader = isByCompany && (idx===0 || items[idx-1].company_id !== p.company_id)
        const co = p.company

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
            borderColor: dragOver===idx && dragging!==idx ? '#C8A84B' : '#1E2335',
            cursor:isCustomSort?'grab':'default'}}>
            {/* Drag handle - only show in custom sort mode */}
            {isCustomSort&&<div style={{color:T.faint,fontSize:14,cursor:'grab',padding:'0 4px',flexShrink:0,userSelect:'none'}} title="Drag to reorder">⠿</div>}
            {!isCustomSort&&<div style={{width:4,flexShrink:0}}/>}
            {/* Content */}
            <div style={{flex:1,minWidth:180,cursor:'pointer'}} onClick={()=>openDetail(p)}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                <span style={{fontSize:15,fontWeight:700}}>{p.name}</span>
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
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:T.gold}}>{calcGrossYield(p).toFixed(1)}% yield</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{fmt(p.rent_pcm)>{"mo"}</div>
              </div>
              <Badge status={p.status}/>
            </div>
          </div>
        </div>
        </div>
        </div>
      )})}
    </div>
  )
}

// ─── RENT TRACKER OVERVIEW PAGE ──────────────────────────────────────────────
function RentTrackerOverview({companies, properties, fmt, openDetail}) {
  const T = {
    bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
    text:'#E4E0D8', muted:'#6B7191', faint:'#3A3F58',
    gold:'#C8A84B', green:'#2ECC8A', red:'#E05555', amber:'#E0943A', blue:'#4B8FE0',
  }

  // Global year filter — applies to all properties
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
        {/* Global year filter */}
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
      </div>

      {/* Companies */}
      {companies.map(c=>{
        const cps = properties.filter(p=>p.company_id===c.id&&(p.rent_payments?.length>0||p.status==='rented'))
        if (!cps.length) return null
        const totals = getCompanyTotals(cps, globalYear)
        const isOpen = expandedCompanies[c.id] !== false // default open

        return (
          <div key={c.id} style={{marginBottom:20}}>
            {/* Company header — clickable to collapse */}
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

            {/* Property rows */}
            {isOpen&&<div style={{border:`1px solid ${T.border}`,borderTop:'none',borderRadius:'0 0 12px 12px',overflow:'hidden'}}>
              {cps.map((p,pi)=>{
                const s = getStats(p.rent_payments||[], globalYear, p.rent_pcm)
                const filteredPayments = globalYear
                  ? (p.rent_payments||[]).filter(pm=>pm.year===globalYear)
                  : (p.rent_payments||[])
                return (
                  <div key={p.id}
                    style={{padding:'14px 18px',borderBottom:pi<cps.length-1?`1px solid ${T.border}`:'none',
                      background:pi%2===0?T.card:T.surface,cursor:'pointer',transition:'background 0.15s'}}
                    onClick={()=>openDetail(p)}
                    onMouseEnter={e=>e.currentTarget.style.background='#1E2335'}
                    onMouseLeave={e=>e.currentTarget.style.background=pi%2===0?T.card:T.surface}>
                    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                      {/* Left: name + dots */}
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontSize:13,fontWeight:600}}>{p.name}</span>
                          {(p.arrears||0)>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.red,fontWeight:700}}>⚠ {fmt(p.arrears)}</span>}
                        </div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:6}}>
                          {fmt(p.rent_pcm)>{"mo"} &middot; Due {p.rent_due_day||'—'}
                        </div>
                        {/* Dots filtered by global year */}
                        <RentDots payments={p.rent_payments||[]} filterYear={globalYear}/>
                      </div>

                      {/* Right: stats + badge */}
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                        <Badge status={p.status}/>
                        {/* Year stats */}
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
                        {/* Income for filtered period */}
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:T.gold}}>
                          {fmt(s.income)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>}
          </div>
        )
      })}

      {companies.every(c=>!properties.some(p=>p.company_id===c.id))&&
        <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,textAlign:'center',padding:40}}>
          No properties found.
        </div>}
    </div>
  )
}

// ─── RENT TAB ────────────────────────────────────────────────────────────────
function RentTab({selected, fmt, setEditingPayment, isAdmin, user, showToast, setProperties}) {
  const T = {
    bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
    text:'#E4E0D8', muted:'#6B7191', faint:'#3A3F58',
    gold:'#C8A84B', green:'#2ECC8A', red:'#E05555', amber:'#E0943A', blue:'#4B8FE0',
  }
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
          {l:'Rent Due',     v:selected.rent_due_day||'—'},
          {l:'Tenancy End',  v:selected.tenancy_end||'—'},
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
        <RentDots payments={payments} onUpdate={m=>setEditingPayment({payment:m,propId:selected.id})} filterYear={filterYear}/>

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

// ─── NOTES TIMELINE ──────────────────────────────────────────────────────────
function NotesTimeline({propertyId, isAdmin, user, showToast, setProperties}) {
  const T = {
    bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
    text:'#E4E0D8', muted:'#6B7191', faint:'#3A3F58', gold:'#C8A84B',
    green:'#2ECC8A', red:'#E05555',
  }
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(()=>{ loadNotes() }, [propertyId])

  async function loadNotes() {
    setLoading(true)
    try {
      const {data,error} = await supabase
        .from('property_notes')
        .select('*')
        .eq('property_id', propertyId)
        .order('created_at', {ascending:false})
      if (!error) setNotes(data||[])
    } catch(e) { console.log('Notes not available yet') }
    setLoading(false)
  }

  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    try {
      const {data,error} = await supabase.from('property_notes').insert({
        property_id: propertyId,
        user_id: user.id,
        user_email: user.email,
        note: newNote.trim(),
      }).select().single()
      if (error) throw error
      setNotes(prev=>[data,...prev])
      setNewNote('')
      showToast('Note saved')
    } catch(e) { showToast(e.message,'error') }
    setSaving(false)
  }

  async function deleteNote(id) {
    try {
      const {error} = await supabase.from('property_notes').delete().eq('id',id)
      if (error) throw error
      setNotes(prev=>prev.filter(n=>n.id!==id))
      showToast('Note deleted')
    } catch(e) { showToast(e.message,'error') }
  }

  function formatDate(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) +
      ' at ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
  }

  return (
    <div className="card" style={{padding:'16px 20px'}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Notes Timeline</div>

      {/* Add note */}
      <div style={{marginBottom:16}}>
        <textarea value={newNote} onChange={e=>setNewNote(e.target.value)}
          placeholder="Add a note about this property…"
          rows={3} style={{resize:'vertical',marginBottom:8,fontSize:13}}/>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={addNote} disabled={saving||!newNote.trim()}>
          {saving?'Saving…':'+ Save Note'}
        </button>
      </div>

      {/* Timeline */}
      {loading
        ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading notes…</div>
        : notes.length===0
          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint}}>No notes yet.</div>
          : <div style={{display:'grid',gap:10}}>
              {notes.map(n=>(
                <div key={n.id} style={{background:T.bg,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${T.gold}`}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:8}}>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:T.gold,background:T.gold+'22',padding:'2px 8px',borderRadius:20}}>{n.user_email}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{formatDate(n.created_at)}</span>
                    </div>
                    {isAdmin&&<button onClick={()=>deleteNote(n.id)}
                      style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:'#E05555',border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer',flexShrink:0}}>
                      Delete
                    </button>}
                  </div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{n.note}</div>
                </div>
              ))}
            </div>
      }
    </div>
  )
}

// ─── PAYMENT MODAL ────────────────────────────────────────────────────────────
function PaymentModal({payment, onClose, onSave}) {
  const T = {
    bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
    text:'#E4E0D8', muted:'#6B7191', gold:'#C8A84B',
    green:'#2ECC8A', red:'#E05555', amber:'#E0943A', faint:'#3A3F58',
  }

  const options = [
    { status:'paid',    label:'Paid',     icon:'✓', color:T.green,  bg:'#0D2B1F', border:'#1A4A2E' },
    { status:'missed',  label:'Not Paid', icon:'✗', color:T.red,    bg:'#2B1010', border:'#5C2C2C' },
    { status:'late', label:'Late',  icon:'⏱', color:T.amber,  bg:'#2B1A0A', border:'#5C3A1A' },
    { status:'refurb',  label:'Refurb',   icon:'🔨', color:T.blue,   bg:'#0A1A2B', border:'#1A3A5C' },
    { status:'void',    label:'Void',     icon:'○', color:T.faint,  bg:'#1A1D27', border:'#2E3044' },
  ]

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:380}}>
        <div style={{padding:'24px 28px'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Update Payment</div>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>{payment.month_label}</h2>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted,marginBottom:24}}>
            Current status: <span style={{color:payment.status==='paid'?T.green:payment.status==='missed'?T.red:payment.status==='late'?T.amber:T.faint,fontWeight:700}}>{payment.status}</span>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:20}}>
            {options.map(opt=>(
              <button key={opt.status}
                onClick={()=>onSave(payment, opt.status)}
                style={{
                  fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:13,
                  background: payment.status===opt.status ? opt.bg : T.surface,
                  color: opt.color,
                  border: `2px solid ${payment.status===opt.status ? opt.color : T.border}`,
                  borderRadius:10, padding:'14px 12px', cursor:'pointer',
                  transition:'all 0.18s', textAlign:'center',
                  display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                }}>
                <span style={{fontSize:20}}>{opt.icon}</span>
                {opt.label}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost" style={{width:'100%',fontSize:12}} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── ACCESS MODAL (Admin only) ────────────────────────────────────────────────
function AccessModal({companies, userId, onClose, showToast}) {
  const T = {
    bg:'#0B0D14', surface:'#12151F', card:'#171B28', border:'#1E2335',
    text:'#E4E0D8', muted:'#6B7191', gold:'#C8A84B', green:'#2ECC8A', red:'#E05555',
  }
  const [users, setUsers] = useState([])
  const [access, setAccess] = useState({})
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')

  useEffect(()=>{
    loadData()
  },[])

  async function loadData() {
    try {
      const {data: accessRows} = await supabase.from('user_company_access').select('*')
      const {data: {users: authUsers}} = await supabase.auth.admin.listUsers().catch(()=>({data:{users:[]}}))
      
      // Group access by user
      const grouped = {}
      if (accessRows) {
        accessRows.forEach(row=>{
          if (!grouped[row.user_id]) grouped[row.user_id] = {email: row.email||row.user_id, companies:[]}
          grouped[row.user_id].companies.push(row.company_id)
        })
      }
      setAccess(grouped)
      setUsers(Object.entries(grouped).map(([id,v])=>({id, email:v.email, companies:v.companies})))
    } catch(e) {
      console.log('Access load error:', e)
    }
    setLoading(false)
  }

  async function toggleAccess(targetUserId, companyId, email) {
    const current = access[targetUserId]?.companies || []
    const has = current.includes(companyId)
    try {
      if (has) {
        await supabase.from('user_company_access')
          .delete().eq('user_id', targetUserId).eq('company_id', companyId)
      } else {
        await supabase.from('user_company_access')
          .insert({user_id: targetUserId, company_id: companyId, email, is_admin: false})
      }
      await loadData()
      showToast('Access updated')
    } catch(e) { showToast(e.message, 'error') }
  }

  async function addUser() {
    if (!newEmail.trim()) return
    // Add user with access to all companies by default
    try {
      for (const co of companies) {
        await supabase.from('user_company_access')
          .upsert({user_id: newEmail, company_id: co.id, email: newEmail, is_admin: false},
            {onConflict:'user_id,company_id'})
      }
      setNewEmail('')
      await loadData()
      showToast('User added — they need to sign up at the app URL first')
    } catch(e) { showToast(e.message, 'error') }
  }

  async function removeUser(targetUserId) {
    try {
      await supabase.from('user_company_access').delete().eq('user_id', targetUserId)
      await loadData()
      showToast('User removed')
    } catch(e) { showToast(e.message, 'error') }
  }

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:580}}>
        <div style={{padding:'24px 28px 0'}}>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>⚙ Company Access Control</h2>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:11,marginBottom:20}}>Control which users can see which companies. Admins (like you) always see everything.</p>
        </div>
        <div style={{padding:'0 28px 28px'}}>

          {/* Add new user */}
          <div style={{marginBottom:20,padding:'16px',background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
            <label>Add User by Email</label>
            <div style={{display:'flex',gap:8,marginTop:6}}>
              <input value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                placeholder="user@example.com" style={{flex:1,fontSize:12}}/>
              <button className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}} onClick={addUser}>Add User</button>
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginTop:8}}>
              Note: The user must first sign up at your app URL. Users with no restrictions here see nothing — add them and then tick their companies below.
            </div>
          </div>

          {loading ? <div style={{textAlign:'center',padding:20,fontFamily:"'DM Mono',monospace",color:T.muted}}>Loading...</div> : (
            users.length===0
              ? <div style={{textAlign:'center',padding:20,fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12}}>No restricted users yet. All signed-up users can currently see everything.</div>
              : users.map(u=>(
                <div key={u.id} style={{marginBottom:16,padding:'14px 16px',background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,fontWeight:600}}>{u.email}</div>
                    <button className="btn btn-danger" style={{fontSize:10,padding:'4px 10px'}} onClick={()=>removeUser(u.id)}>Remove</button>
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                    {companies.map(co=>{
                      const hasAccess = u.companies.includes(co.id)
                      return (
                        <button key={co.id} onClick={()=>toggleAccess(u.id, co.id, u.email)}
                          style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',
                            border:`1px solid ${hasAccess?co.color:T.border}`,
                            background:hasAccess?co.color+'22':'transparent',
                            color:hasAccess?co.color:T.muted,transition:'all 0.18s'}}>
                          {hasAccess?'✓ ':''}{co.abbr} {co.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
          )}

          <button className="btn btn-ghost" style={{width:'100%',marginTop:8,fontSize:12}} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
