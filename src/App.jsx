
import { useState, useEffect, useMemo } from 'react'
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

const StatCard = ({icon,label,value,sub,accent}) => (
  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'20px 22px'}}>
    <div style={{fontSize:20,marginBottom:8}}>{icon}</div>
    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,color:accent||T.gold,letterSpacing:'-0.02em',marginBottom:2}}>{value}</div>
    {sub&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint}}>{sub}</div>}
  </div>
)

const RentDots = ({payments}) => {
  if (!payments?.length) return null
  const sorted=[...payments].sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month)
  return <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:8}}>
    {sorted.map(m=>{
      const col=m.status==='void'?T.faint:m.status==='paid'?T.green:T.red
      return <div key={m.id} title={`${m.month_label}: ${m.status}`} style={{width:10,height:10,borderRadius:2,background:col}}/>
    })}
  </div>
}

const Spinner = () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200}}>
  <div style={{width:32,height:32,border:`3px solid ${T.border}`,borderTopColor:T.gold,borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
</div>

export default function App() {
  const {session,user} = useAuth()
  const [properties,  setProperties]  = useState([])
  const [companies,   setCompanies]    = useState([])
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

  useEffect(()=>{
    if (!user) return
    setLoading(true)
    Promise.all([api.fetchCompanies(), api.fetchProperties()])
      .then(([cos,props])=>{ setCompanies(cos); setProperties(props); if(cos.length>0) setActiveCoTab(cos[0].id) })
      .catch(console.error).finally(()=>setLoading(false))
  },[user])

  // Early returns AFTER all hooks
  if (session===undefined) return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style><div style={{width:32,height:32,border:`3px solid #1E2335`,borderTopColor:'#C8A84B',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/></div>
  if (!session) return <LoginPage/>

  function showToast(msg,type='success'){setToast({msg,type});setTimeout(()=>setToast(null),3500)}

  const selected = properties.find(p=>p.id===selectedId)

  const filtered = useMemo(()=>properties.filter(p=>{
    if(coFilter!=='all'&&p.company_id!==coFilter) return false
    if(statusFilter!=='all'&&p.status!==statusFilter) return false
    if(searchQ&&!p.name.toLowerCase().includes(searchQ.toLowerCase())&&!p.address.toLowerCase().includes(searchQ.toLowerCase())) return false
    return true
  }),[properties,coFilter,statusFilter,searchQ])

  const stats = useMemo(()=>({
    totalInvested: properties.reduce((s,p)=>s+(p.purchase_price||0)+(p.refurb_cost||0),0),
    totalEstVal:   properties.reduce((s,p)=>s+(p.est_value||0),0),
    monthlyRent:   properties.filter(p=>p.status==='rented').reduce((s,p)=>s+(p.rent_pcm||0),0),
    totalArrears:  properties.reduce((s,p)=>s+(p.arrears||0),0),
    rented:        properties.filter(p=>p.status==='rented').length,
    vacant:        properties.filter(p=>p.status==='vacant').length,
    inRefurb:      properties.filter(p=>p.refurb_status==='in-progress').length,
    total:         properties.length,
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

  async function handleDeleteProp(id){
    if(!window.confirm('Delete this property? This cannot be undone.')) return
    try{
      await api.deleteProperty(id)
      setProperties(prev=>prev.filter(p=>p.id!==id))
      setView('properties');setSelectedId(null)
      showToast('Property deleted')
    }catch(e){showToast(e.message,'error')}
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

  const navItems=[{key:'dashboard',label:'Dashboard',icon:'◈'},{key:'properties',label:'Properties',icon:'⊞'},{key:'companies',label:'Companies',icon:'◎'},{key:'rent',label:'Rent Tracker',icon:'£'}]

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
            <button className="btn btn-ghost" style={{fontSize:11,padding:'7px 14px'}} onClick={()=>supabase.auth.signOut()}>Sign Out</button>
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
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:28}}>
              <StatCard icon="🏛" label="Total Invested" value={fmt(stats.totalInvested)} sub={`Est. value ${fmt(stats.totalEstVal)}`}/>
              <StatCard icon="💷" label="Monthly Rental Income" value={fmt(stats.monthlyRent)} sub={fmt(stats.monthlyRent*12)+'/yr'} accent={T.green}/>
              <StatCard icon="⚠" label="Total Arrears" value={fmt(stats.totalArrears)} sub={`${stats.vacant} vacant`} accent={stats.totalArrears>0?T.red:T.green}/>
              <StatCard icon="🔨" label="In Refurbishment" value={stats.inRefurb} sub={`of ${stats.total} total`} accent={T.blue}/>
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
            <h2 style={{fontSize:18,fontWeight:600,letterSpacing:'-0.02em',marginBottom:14}}>Needs Attention</h2>
            <div style={{display:'grid',gap:10}}>
              {properties.filter(p=>(p.arrears||0)>0||p.status==='vacant').slice(0,10).map(p=>(
                <div key={p.id} className="card pcard" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}} onClick={()=>openDetail(p)}>
                  <div style={{flex:1,minWidth:150}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>{p.name}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{p.address}</div>
                  </div>
                  <CompanyPill company={p.company}/><Badge status={p.status}/>
                  {(p.arrears||0)>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,color:T.red}}>Arrears {fmt(p.arrears)}</div>}
                </div>
              ))}
              {properties.filter(p=>(p.arrears||0)>0||p.status==='vacant').length===0&&
                <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,textAlign:'center',padding:32,background:T.card,borderRadius:12}}>✓ All properties healthy</div>}
            </div>
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
            <div style={{display:'grid',gap:10}}>
              {filtered.map(p=>(
                <div key={p.id} className="card pcard" style={{padding:'16px 20px',display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}} onClick={()=>openDetail(p)}>
                  <div style={{flex:1,minWidth:180}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                      <span style={{fontSize:15,fontWeight:700}}>{p.name}</span><CompanyPill company={p.company}/>
                    </div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{p.prop_type} · {p.address}</div>
                  </div>
                  <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
                    {p.arrears>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.red,fontWeight:700}}>⚠ {fmt(p.arrears)}</div>}
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:T.gold}}>{calcGrossYield(p).toFixed(1)}% yield</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{fmt(p.rent_pcm)}/mo</div>
                    </div>
                    <Badge status={p.status}/>
                  </div>
                </div>
              ))}
              {filtered.length===0&&<div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,textAlign:'center',padding:40}}>No properties match this filter.</div>}
            </div>
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
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{p.prop_type} · {p.address}</div>
                      </div>
                      {p.arrears>0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.red}}>⚠ {fmt(p.arrears)}</div>}
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:T.gold}}>{calcGrossYield(p).toFixed(1)}%</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.muted}}>{fmt(p.rent_pcm)}/mo</div>
                      <Badge status={p.status}/>
                    </div>
                  ))}
                  {cProps.length===0&&<div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,padding:'32px',textAlign:'center'}}>No properties for this company yet.</div>}
                </div>
              </div>
            })}
          </div>}

          {view==='rent'&&<div className="fade">
            <div style={{marginBottom:20}}>
              <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:8}}>Rent Tracker</h1>
              <div style={{display:'flex',gap:16,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>
                {[{c:T.green,l:'Paid'},{c:T.red,l:'Missed'},{c:T.faint,l:'Void'}].map(x=>(
                  <span key={x.l} style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:x.c,display:'inline-block'}}/>{x.l}</span>
                ))}
              </div>
            </div>
            {companies.map(c=>{
              const cps=properties.filter(p=>p.company_id===c.id&&p.rent_payments?.length>0)
              if(!cps.length) return null
              return <div key={c.id} style={{marginBottom:28}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                  <div style={{width:3,height:20,background:c.color,borderRadius:2}}/>
                  <h2 style={{fontSize:16,fontWeight:600}}>{c.name}</h2>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{cps.length} properties</span>
                </div>
                <div style={{display:'grid',gap:8}}>
                  {cps.map(p=>{
                    const paid=p.rent_payments.filter(m=>m.status==='paid').length
                    const missed=p.rent_payments.filter(m=>m.status==='missed').length
                    return <div key={p.id} className="card pcard" style={{padding:'12px 16px'}} onClick={()=>openDetail(p)}>
                      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:600,marginBottom:1}}>{p.name}</div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:2}}>
                            {fmt(p.rent_pcm)}/mo · Due {p.rent_due_day||'—'}
                            {(p.arrears||0)>0&&<span style={{color:T.red,marginLeft:8}}>⚠ Arrears {fmt(p.arrears)}</span>}
                          </div>
                          <RentDots payments={p.rent_payments}/>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <Badge status={p.status}/>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginTop:4}}>{paid} paid · {missed} missed</div>
                        </div>
                      </div>
                    </div>
                  })}
                </div>
              </div>
            })}
            {companies.every(c=>!properties.some(p=>p.company_id===c.id&&p.rent_payments?.length>0))&&
              <div style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,textAlign:'center',padding:40}}>No rent payment history yet. Add properties and log payments to see them here.</div>}
          </div>}

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
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditProp(selected);setShowAddProp(true)}}>Edit</button>
                      <button className="btn btn-danger" style={{fontSize:11}} onClick={()=>handleDeleteProp(selected.id)}>Delete</button>
                    </div>
                  </div>
                </div>
                <div style={{display:'flex',gap:4,marginBottom:14,flexWrap:'wrap'}}>
                  {['overview','refurb','rent','financials'].map(t=>(
                    <button key={t} className={`tab ${detailTab===t?'active':''}`} onClick={()=>setDetailTab(t)} style={{textTransform:'capitalize'}}>{t}</button>
                  ))}
                </div>
                {detailTab==='overview'&&<div>
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
                {detailTab==='refurb'&&<RefurbTab prop={selected} onAddPhase={handleAddPhase} onAddCost={handleAddCost} onUpdateField={handleUpdatePropField}/>}
                {detailTab==='rent'&&<div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                    {[{l:'Monthly Rent',v:fmt(selected.rent_pcm),accent:T.green},{l:'Rent Due',v:selected.rent_due_day||'—'},{l:'Tenancy End',v:selected.tenancy_end||'—'},{l:'Arrears',v:fmt(selected.arrears||0),accent:selected.arrears>0?T.red:T.green}].map((item,i)=>(
                      <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:item.accent||T.text}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  {selected.notes&&<div className="card" style={{padding:'14px 18px',marginBottom:14}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.1em'}}>Notes</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
                  </div>}
                  {selected.rent_payments?.length>0&&<div className="card" style={{padding:'16px 20px'}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Payment History</div>
                    <RentDots payments={selected.rent_payments}/>
                  </div>}
                </div>}
                {detailTab==='financials'&&<div style={{display:'grid',gap:12}}>
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
      {toast&&<div style={{position:'fixed',bottom:24,right:24,zIndex:999,background:toast.type==='error'?'#2B1010':'#0D2B1F',border:`1px solid ${toast.type==='error'?T.red:T.green}`,color:toast.type==='error'?T.red:T.green,fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:500,padding:'12px 20px',borderRadius:10,animation:'fadeIn 0.2s ease'}}>{toast.msg}</div>}
    </div>
  )
}

function RefurbTab({prop,onAddPhase,onAddCost,onUpdateField}){
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
  </div>
}

function PropertyModal({prop,companies,onClose,onSave}){
  const blank={name:'',company_id:companies[0]?.id||'',address:'',prop_type:'',status:'purchased',refurb_status:'planned',purchase_price:'',refurb_cost:'',est_value:'',mortgage_amount:'',deposit:'',stamp_duty:'',legal_fees:'',rent_pcm:'',mortgage_rate:'',mortgage_term:25,insurance:'',arrears:0,tenancy_end:'',rent_due_day:'',notes:''}
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
