import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
const mono = "'DM Mono',monospace"
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const STATUS_CFG = {
  active:    { label:'Active',    bg:'#2ECC8A22', color:'#2ECC8A' },
  trialing:  { label:'Trialing',  bg:'#4B8FE022', color:'#4B8FE0' },
  past_due:  { label:'Past due',  bg:'#E0943A22', color:'#E0943A' },
  canceled:  { label:'Cancelled', bg:'#E0555522', color:'#E05555' },
  free_tier: { label:'Free tier', bg:'#C8A84B22', color:'#C8A84B' },
}

export default function AdminDashboard({ onClose, user }) {
  const { T } = useTheme()
  const [tab, setTab]             = useState('revenue')
  const [companies, setCompanies] = useState([])
  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [saving, setSaving]       = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  // Delete state
  const [deleteTarget, setDeleteTarget]   = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError]     = useState('')
  const [deleting, setDeleting]           = useState(false)

  useEffect(() => {
    loadAll()
    supabase.auth.getUser().then(({data:{user}})=>setCurrentUser(user))
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [cos, us] = await Promise.all([
        api.fetchAdminAllCompanies(),
        api.fetchAllUsers().catch(()=>[]),
      ])
      setCompanies(cos); setUsers(us)
    } catch(e) {}
    setLoading(false)
  }

  async function toggleFreeTier(id, current) {
    setSaving(id)
    try {
      await api.setCompanyFreeTier(id, !current)
      setCompanies(prev=>prev.map(c=>c.id===id?{...c,is_free_tier:!current}:c))
      if (selectedAccount?.id===id) setSelectedAccount(a=>({...a,is_free_tier:!current}))
    } catch(e) {}
    setSaving(null)
  }

  async function toggleFlag(id, current) {
    try {
      await api.setCompanyFlag(id, !current)
      setCompanies(prev=>prev.map(c=>c.id===id?{...c,flagged:!current}:c))
      if (selectedAccount?.id===id) setSelectedAccount(a=>({...a,flagged:!current}))
    } catch(e) {}
  }

  async function handleDeleteUser() {
    setDeleteError('')
    if (!deletePassword) { setDeleteError('Enter your password'); return }
    setDeleting(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: currentUser?.email, password: deletePassword })
      if (error) { setDeleteError('Incorrect password'); setDeleting(false); return }
      await api.deleteUser(deleteTarget.id)
      setUsers(prev=>prev.filter(u=>u.id!==deleteTarget.id))
      setDeleteTarget(null); setDeletePassword('')
    } catch(e) { setDeleteError(e.message||'Delete failed') }
    setDeleting(false)
  }

  // ── COMPUTED METRICS ──────────────────────────────────────────────────────
  const metrics = useMemo(()=>{
    if (!companies.length) return {}
    const active   = companies.filter(c=>c.subscriptions?.[0]?.status==='active')
    const trialing = companies.filter(c=>!c.is_free_tier&&(!c.subscriptions?.[0]?.status||c.subscriptions?.[0]?.status==='trialing'))
    const free     = companies.filter(c=>c.is_free_tier)
    const pastDue  = companies.filter(c=>c.subscriptions?.[0]?.status==='past_due')
    const mrrStripe = active.reduce((s,c)=>s+(c.paid_property_count||c.subscriptions?.[0]?.property_count||0),0)
    const mrrProps  = companies.reduce((s,c)=>s+(c.real_property_count||0),0)
    const newThisMonth = companies.filter(c=>{
      const d=new Date(c.created_at); const n=new Date()
      return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear()
    }).length
    const flagged  = companies.filter(c=>c.flagged).length
    return { active:active.length, trialing:trialing.length, free:free.length, pastDue:pastDue.length,
      mrrStripe, mrrProps, total:companies.length, users:users.length, newThisMonth, flagged }
  },[companies,users])

  const filtered = useMemo(()=>companies.filter(c=>{
    const q=search.toLowerCase()
    const match=!q||c.name?.toLowerCase().includes(q)||c.owner_email?.toLowerCase().includes(q)
    const status=c.is_free_tier?'free_tier':(c.subscriptions?.[0]?.status||'trialing')
    const sf=statusFilter==='all'||status===statusFilter
    return match&&sf
  }),[companies,search,statusFilter])

  // Style helpers
  const tabBtn = k => ({
    fontFamily:mono,fontSize:11,padding:'8px 18px',borderRadius:8,border:'none',cursor:'pointer',
    background:tab===k?T.gold+'22':'transparent',color:tab===k?T.gold:T.muted,fontWeight:tab===k?700:400,
  })
  const card = (accent) => ({
    background:T.card,border:`1px solid ${T.border}`,borderRadius:14,
    ...(accent?{borderLeft:`3px solid ${accent}`}:{})
  })
  const pill = (status) => {
    const cfg=STATUS_CFG[status]||{label:status,bg:T.border,color:T.muted}
    return <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:T.bg,overflowY:'auto',display:'flex',flexDirection:'column'}}>

      {/* ── HEADER ── */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 32px',flexShrink:0,position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',height:60}}>
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            <img src="/logo.svg" alt="OwnProperly" style={{height:28}}/>
            <div style={{width:1,height:24,background:T.border}}/>
            <span style={{fontFamily:mono,fontSize:11,color:T.gold,fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase'}}>Platform Admin</span>
            {metrics.flagged>0&&<span style={{fontFamily:mono,fontSize:10,background:T.red+'22',color:T.red,padding:'2px 8px',borderRadius:10}}>⚑ {metrics.flagged} flagged</span>}
          </div>
          <button onClick={onClose} style={{fontFamily:mono,fontSize:12,background:'none',border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,padding:'6px 16px',cursor:'pointer'}}>← Back to app</button>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:2,paddingBottom:0}}>
          {[['revenue','📊 Revenue'],['accounts','🏢 Accounts'],['users','👥 Users'],['billing','💳 Billing'],['comms','✉️ Comms'],['platform','⚙️ Platform']].map(([k,l])=>(
            <button key={k} style={tabBtn(k)} onClick={()=>setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{flex:1,padding:'28px 32px',maxWidth:1300,margin:'0 auto',width:'100%'}}>
        {loading
          ? <div style={{textAlign:'center',padding:60,fontFamily:mono,fontSize:12,color:T.muted}}>Loading platform data…</div>
          : <>

            {/* ═══ REVENUE TAB ═══ */}
            {tab==='revenue'&&<RevenueTab companies={companies} users={users} metrics={metrics} T={T} fmt={fmt}/>}

            {/* ═══ ACCOUNTS TAB ═══ */}
            {tab==='accounts'&&(
              selectedAccount
                ? <AccountDetail co={selectedAccount} companies={companies} user={user} T={T} fmt={fmt}
                    onBack={()=>setSelectedAccount(null)}
                    onToggleFreeTier={()=>toggleFreeTier(selectedAccount.id,selectedAccount.is_free_tier)}
                    onToggleFlag={()=>toggleFlag(selectedAccount.id,selectedAccount.flagged)}
                    onRename={(id,name,abbr)=>setCompanies(prev=>prev.map(c=>c.id===id?{...c,name,abbr}:c))}
                    onDelete={(id)=>{setCompanies(prev=>prev.filter(c=>c.id!==id));setSelectedAccount(null)}}
                    saving={saving===selectedAccount.id}/>
                : <AccountsTab filtered={filtered} search={search} setSearch={setSearch}
                    statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                    companies={companies} onSelect={setSelectedAccount}
                    toggleFreeTier={toggleFreeTier} saving={saving} T={T} fmt={fmt} pill={pill}/>
            )}

            {/* ═══ USERS TAB ═══ */}
            {tab==='users'&&(
              <UsersTab users={users} companies={companies} currentUser={currentUser}
                onDelete={u=>{setDeleteTarget(u);setDeletePassword('');setDeleteError('')}}
                T={T}/>
            )}

            {/* ═══ BILLING TAB ═══ */}
            {tab==='billing'&&<BillingTab companies={companies} T={T} fmt={fmt} pill={pill}/>}

            {/* ═══ COMMS TAB ═══ */}
            {tab==='comms'&&<CommsTab user={user} users={users} T={T}/>}

            {/* ═══ PLATFORM TAB ═══ */}
            {tab==='platform'&&<PlatformTab user={user} companies={companies} T={T}/>}
          </>
        }
      </div>

      {/* ── DELETE MODAL ── */}
      {deleteTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:600,padding:24}}>
          <div style={{background:T.surface,border:`2px solid ${T.red}44`,borderRadius:18,width:'100%',maxWidth:440,padding:'32px 28px'}}>
            <div style={{textAlign:'center',marginBottom:24}}>
              <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
              <h2 style={{fontSize:18,fontWeight:700,color:T.red,marginBottom:8}}>Delete user account</h2>
              <p style={{fontFamily:mono,fontSize:12,color:T.muted,lineHeight:1.7}}>
                Permanently deletes <strong style={{color:T.text}}>{deleteTarget.email}</strong> and all their data. Cannot be undone.
              </p>
            </div>
            <label style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',display:'block',marginBottom:8}}>Enter your admin password</label>
            <input type="password" value={deletePassword} autoFocus
              onChange={e=>{setDeletePassword(e.target.value);setDeleteError('')}}
              onKeyDown={e=>e.key==='Enter'&&handleDeleteUser()}
              style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${deleteError?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',marginBottom:deleteError?8:16}}/>
            {deleteError&&<div style={{fontFamily:mono,fontSize:11,color:T.red,marginBottom:16}}>{deleteError}</div>}
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setDeleteTarget(null)} style={{flex:1,fontFamily:mono,fontSize:12,padding:'11px',borderRadius:10,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleDeleteUser} disabled={deleting||!deletePassword}
                style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'11px',borderRadius:10,border:'none',background:deleting||!deletePassword?T.border:T.red,color:'white',cursor:'pointer'}}>
                {deleting?'Deleting…':'🗑 Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE TAB
// ═══════════════════════════════════════════════════════════════════════════════
function RevenueTab({ companies, users, metrics, T, fmt }) {
  const kpis = [
    {label:'MRR (Stripe active)',   value:fmt(metrics.mrrStripe), sub:'from paying subscriptions', color:T.green},
    {label:'MRR (by properties)',   value:fmt(metrics.mrrProps),  sub:'£1 × all properties',       color:T.green},
    {label:'ARR (est.)',            value:fmt(metrics.mrrStripe*12), sub:'annualised run rate',     color:T.text},
    {label:'Active accounts',       value:metrics.active,         sub:'paying subscribers',         color:T.green},
    {label:'On trial',              value:metrics.trialing,       sub:'not yet paying',             color:'#4B8FE0'},
    {label:'Free tier',             value:metrics.free,           sub:'manually granted',           color:T.gold},
    {label:'Past due',              value:metrics.pastDue,        sub:'payment failed',             color:T.red},
    {label:'Total accounts',        value:metrics.total,          sub:'all companies',              color:T.text},
    {label:'Total users',           value:metrics.users,          sub:'registered accounts',        color:T.text},
    {label:'New this month',        value:metrics.newThisMonth,   sub:'new signups',                color:T.green},
    {label:'Churn rate',            value:metrics.total>0?`${((metrics.pastDue/metrics.total)*100).toFixed(1)}%`:'—', sub:'based on past due', color:metrics.pastDue>0?T.red:T.green},
    {label:'ARPA',                  value:metrics.active>0?fmt(metrics.mrrStripe/metrics.active):'—', sub:'avg revenue per account', color:T.text},
  ]

  // Signup trend by month (last 12)
  const now = new Date()
  const monthlySignups = Array.from({length:12},(_,i)=>{
    const d = new Date(now.getFullYear(), now.getMonth()-11+i, 1)
    const count = companies.filter(c=>{
      const cd = new Date(c.created_at)
      return cd.getMonth()===d.getMonth()&&cd.getFullYear()===d.getFullYear()
    }).length
    return { label: MONTHS[d.getMonth()], count, year: d.getFullYear() }
  })
  const maxSignups = Math.max(...monthlySignups.map(m=>m.count), 1)

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:28}}>
        {kpis.map((k,i)=>(
          <div key={i} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:24,fontWeight:700,color:k.color,letterSpacing:'-0.02em',marginBottom:3}}>{k.value}</div>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 24px'}}>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:20}}>New signups — last 12 months</div>
        <div style={{display:'flex',gap:8,alignItems:'flex-end',height:120}}>
          {monthlySignups.map((m,i)=>(
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              <div style={{fontFamily:mono,fontSize:10,color:T.gold,fontWeight:700}}>{m.count||''}</div>
              <div style={{width:'100%',background:T.gold+(m.count>0?'':'11'),borderRadius:'4px 4px 0 0',
                height:`${Math.max((m.count/maxSignups)*90,m.count>0?4:0)}px`,transition:'height 0.3s'}}/>
              <div style={{fontFamily:mono,fontSize:9,color:T.muted,textAlign:'center'}}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AccountsTab({ filtered, search, setSearch, statusFilter, setStatusFilter, companies, onSelect, toggleFreeTier, saving, T, fmt, pill }) {
  return (
    <div>
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search company or email…"
          style={{flex:1,minWidth:220,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 14px',outline:'none'}}/>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 12px'}}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_CFG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <span style={{fontFamily:mono,fontSize:11,color:T.muted,display:'flex',alignItems:'center'}}>{filtered.length} of {companies.length}</span>
      </div>

      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 140px 90px 90px 80px 120px 80px',gap:8,padding:'10px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`}}>
          {['Company / Owner','Status','Platform props','Billed props','MRR','Free tier',''].map(h=>(
            <div key={h} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>
          ))}
        </div>
        {filtered.length===0&&<div style={{padding:32,textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>No accounts match your filter</div>}
        {filtered.map(co=>{
          const status = co.is_free_tier?'free_tier':(co.subscriptions?.[0]?.status||'trialing')
          const props  = co.paid_property_count||co.subscriptions?.[0]?.property_count||0
          const mrr    = status==='active'?props:0
          return (
            <div key={co.id} onClick={()=>onSelect(co)}
              style={{display:'grid',gridTemplateColumns:'1fr 140px 90px 90px 80px 120px 80px',gap:8,padding:'13px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center',cursor:'pointer',transition:'background 0.15s'}}
              onMouseEnter={e=>e.currentTarget.style.background=T.surface}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  {co.flagged&&<span style={{fontSize:12,color:T.red}}>⚑</span>}
                  <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B'}}>{co.abbr}</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{co.name}</span>
                </div>
                <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{co.owner_email||'—'}</div>
              </div>
              <div>{pill(status)}</div>
              <div style={{fontFamily:mono,fontSize:12,color:T.text}}>{co.real_property_count||0} <span style={{fontFamily:mono,fontSize:9,color:T.muted}}>total</span></div>
              <div style={{fontFamily:mono,fontSize:12,color:props>0?T.green:T.muted}}>{props>0?props:'—'} {props>0&&<span style={{fontFamily:mono,fontSize:9,color:T.muted}}>billed</span>}</div>
              <div style={{fontFamily:mono,fontSize:12,color:mrr>0?T.green:T.muted}}>{mrr>0?fmt(mrr):'—'}</div>
              <div style={{display:'flex',alignItems:'center',gap:6}} onClick={e=>{e.stopPropagation();toggleFreeTier(co.id,co.is_free_tier)}}>
                <span style={{fontFamily:mono,fontSize:10,color:co.is_free_tier?T.gold:T.muted}}>{co.is_free_tier?'Free':'Paid'}</span>
                <div style={{width:36,height:20,borderRadius:10,background:co.is_free_tier?T.gold:T.border,cursor:'pointer',position:'relative',opacity:saving===co.id?0.5:1,transition:'background 0.2s'}}>
                  <div style={{position:'absolute',top:2,left:co.is_free_tier?18:2,width:16,height:16,borderRadius:8,background:'white',transition:'left 0.2s'}}/>
                </div>
              </div>
              <div style={{fontFamily:mono,fontSize:11,color:T.gold,textAlign:'right'}}>View →</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT DETAIL
// ═══════════════════════════════════════════════════════════════════════════════
function AccountDetail({ co, user, T, fmt, onBack, onToggleFreeTier, onToggleFlag, saving, onRename, onDelete }) {
  const [notes, setNotes]         = useState([])
  const [newNote, setNewNote]     = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [extendDays, setExtendDays] = useState(14)
  const [extending, setExtending]   = useState(false)
  const [trialMsg, setTrialMsg]     = useState('')
  const [showRename, setShowRename] = useState(false)
  const [renameName, setRenameName] = useState(co.name||'')
  const [renameAbbr, setRenameAbbr] = useState(co.abbr||'')
  const [renameSaving, setRenameSaving] = useState(false)
  const [showDeleteCo, setShowDeleteCo] = useState(false)
  const [deletingCo, setDeletingCo]     = useState(false)

  useEffect(()=>{ api.fetchAdminNotes(co.id).then(setNotes).catch(()=>{}) },[co.id])

  async function submitNote() {
    if (!newNote.trim()) return
    setAddingNote(true)
    try {
      const note = await api.addAdminNote(user?.id||user?.sub, co.id, newNote.trim())
      setNotes(prev=>[note,...prev]); setNewNote('')
    } catch(e) {}
    setAddingNote(false)
  }

  async function deleteNote(id) {
    try { await api.deleteAdminNote(id); setNotes(prev=>prev.filter(n=>n.id!==id)) } catch(e) {}
  }

  async function extendTrial() {
    setExtending(true)
    try {
      const d = await api.extendTrial(co.id, extendDays)
      setTrialMsg('Trial extended to ' + d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))
    } catch(e) { setTrialMsg('Failed to extend trial') }
    setExtending(false)
  }

  async function handleAdminRename() {
    if (!renameName.trim()) return
    setRenameSaving(true)
    try {
      const abbr = renameAbbr.trim().slice(0,5).toUpperCase() || renameName.trim().slice(0,3).toUpperCase()
      await api.updateCompany(co.id, { name: renameName.trim(), abbr })
      if (onRename) onRename(co.id, renameName.trim(), abbr)
      setShowRename(false)
    } catch(e) {}
    setRenameSaving(false)
  }

  async function handleAdminDeleteCompany() {
    setDeletingCo(true)
    try {
      await api.deleteCompany(co.id)
      if (onDelete) onDelete(co.id)
      onBack()
    } catch(e) { setDeletingCo(false) }
  }

  const status = co.is_free_tier?'free_tier':(co.subscriptions?.[0]?.status||'trialing')
  const sc = STATUS_CFG[status]||{label:status,bg:T.border,color:T.muted}
  const props = co.subscriptions?.[0]?.property_count||0

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
        <button onClick={onBack} style={{fontFamily:mono,fontSize:11,background:'none',border:'1px solid '+T.border,color:T.muted,borderRadius:8,padding:'6px 14px',cursor:'pointer'}}>Back</button>
        {co.flagged&&<span style={{fontFamily:mono,fontSize:11,background:T.red+'22',color:T.red,padding:'4px 12px',borderRadius:8}}>Flagged</span>}
        <div style={{flex:1,display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'3px 10px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B'}}>{co.abbr}</span>
          <span style={{fontSize:18,fontWeight:700,color:T.text}}>{co.name}</span>
          <span style={{fontFamily:mono,fontSize:11,fontWeight:700,padding:'3px 12px',borderRadius:20,background:sc.bg,color:sc.color}}>{sc.label}</span>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
        <div style={{background:T.card,border:'1px solid '+T.border,borderRadius:14,padding:'20px 24px'}}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Account overview</div>
          {[
            ['Owner email', co.owner_email||'—'],
            ['Platform properties', co.real_property_count||0],
            ['Billed properties', co.paid_property_count||co.subscriptions?.[0]?.property_count||0],
            ['MRR', status==='active'?fmt(props):'—'],
            ['Status', sc.label],
            ['Stripe sub ID', co.subscriptions?.[0]?.stripe_subscription_id||'—'],
            ['Created', co.created_at?new Date(co.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'—'],
            ['Trial ends', co.trial_ends_at?new Date(co.trial_ends_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'—'],
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid '+T.border}}>
              <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>{l}</span>
              <span style={{fontFamily:mono,fontSize:11,color:T.text,fontWeight:600}}>{String(v)}</span>
            </div>
          ))}
        </div>

        <div style={{display:'grid',gap:14,alignContent:'start'}}>
          <div style={{background:T.card,border:'1px solid '+T.border,borderRadius:14,padding:'20px 24px'}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Quick actions</div>
            <div style={{display:'grid',gap:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Rename company</span>
                <button onClick={()=>{setRenameName(co.name||'');setRenameAbbr(co.abbr||'');setShowRename(true)}}
                  style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>
                  Rename
                </button>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:12,color:T.red}}>Delete company</span>
                <button onClick={()=>setShowDeleteCo(true)}
                  style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:'1px solid '+T.red+'44',background:'transparent',color:T.red,cursor:'pointer'}}>
                  Delete
                </button>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Free tier</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:mono,fontSize:11,color:co.is_free_tier?T.gold:T.muted}}>{co.is_free_tier?'Free':'Paid'}</span>
                  <div onClick={onToggleFreeTier} style={{width:44,height:24,borderRadius:12,background:co.is_free_tier?T.gold:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                    <div style={{position:'absolute',top:3,left:co.is_free_tier?22:3,width:18,height:18,borderRadius:9,background:'white',transition:'left 0.2s'}}/>
                  </div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Flag account</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:mono,fontSize:11,color:co.flagged?T.red:T.muted}}>{co.flagged?'Flagged':'Clear'}</span>
                  <div onClick={onToggleFlag} style={{width:44,height:24,borderRadius:12,background:co.flagged?T.red:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                    <div style={{position:'absolute',top:3,left:co.flagged?22:3,width:18,height:18,borderRadius:9,background:'white',transition:'left 0.2s'}}/>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{background:T.card,border:'1px solid '+T.border,borderRadius:14,padding:'20px 24px'}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Extend trial</div>
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:8}}>
              <select value={extendDays} onChange={e=>setExtendDays(Number(e.target.value))}
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:'1px solid '+T.border,color:T.text,borderRadius:8,padding:'7px 10px',flex:1}}>
                {[7,14,30,60,90].map(d=><option key={d} value={d}>{'+'+d+' days'}</option>)}
              </select>
              <button onClick={extendTrial} disabled={extending}
                style={{fontFamily:mono,fontSize:12,padding:'8px 16px',borderRadius:8,border:'none',background:T.gold,color:T.surface,cursor:'pointer',fontWeight:700}}>
                {extending?'…':'Extend'}
              </button>
            </div>
            {trialMsg&&<div style={{fontFamily:mono,fontSize:11,color:T.green}}>{trialMsg}</div>}
          </div>
        </div>
      </div>

      <div style={{background:T.card,border:'1px solid '+T.border,borderRadius:14,padding:'20px 24px'}}>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Admin notes</div>
        <div style={{display:'flex',gap:10,marginBottom:16}}>
          <textarea value={newNote} onChange={e=>setNewNote(e.target.value)} rows={2} placeholder="Add a note about this account..."
            style={{flex:1,fontFamily:mono,fontSize:12,background:T.bg,border:'1px solid '+T.border,color:T.text,borderRadius:8,padding:'10px 12px',resize:'none',outline:'none'}}/>
          <button onClick={submitNote} disabled={addingNote||!newNote.trim()}
            style={{fontFamily:mono,fontSize:12,padding:'0 20px',borderRadius:8,border:'none',background:T.gold,color:T.surface,cursor:'pointer',fontWeight:700,alignSelf:'stretch'}}>
            {addingNote?'…':'Add'}
          </button>
        </div>
        {notes.length===0&&<div style={{fontFamily:mono,fontSize:12,color:T.muted}}>No notes yet.</div>}
        {notes.map(n=>(
          <div key={n.id} style={{padding:'12px 0',borderBottom:'1px solid '+T.border,display:'flex',gap:12,alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:mono,fontSize:12,color:T.text,lineHeight:1.6,marginBottom:4}}>{n.note}</div>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{new Date(n.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
            </div>
            <button onClick={()=>deleteNote(n.id)} style={{fontFamily:mono,fontSize:10,color:T.muted,background:'none',border:'none',cursor:'pointer'}}>x</button>
          </div>
        ))}
      </div>

      {showRename&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:700,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:400,padding:'28px',border:'1px solid '+T.border}}>
            <h3 style={{fontFamily:mono,fontSize:15,fontWeight:700,marginBottom:20,color:T.text}}>Rename company</h3>
            <div style={{marginBottom:12}}>
              <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Company name</label>
              <input value={renameName} onChange={e=>setRenameName(e.target.value)} autoFocus
                style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:'1px solid '+T.border,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Abbreviation</label>
              <input value={renameAbbr} onChange={e=>setRenameAbbr(e.target.value.toUpperCase().slice(0,5))}
                style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:'1px solid '+T.border,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setShowRename(false)}
                style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleAdminRename} disabled={renameSaving}
                style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:T.gold,color:'#1A2530',cursor:'pointer'}}>
                {renameSaving?'Saving...':'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteCo&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:700,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:400,padding:'28px',border:'2px solid '+T.red+'44'}}>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:36,marginBottom:10}}>!</div>
              <h3 style={{fontFamily:mono,fontSize:15,fontWeight:700,color:T.red,marginBottom:8}}>Delete company</h3>
              <p style={{fontFamily:mono,fontSize:12,color:T.muted,lineHeight:1.7}}>Permanently delete <strong style={{color:T.text}}>{co.name}</strong> and all its data. Cannot be undone.</p>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setShowDeleteCo(false)}
                style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleAdminDeleteCompany} disabled={deletingCo}
                style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:deletingCo?T.border:T.red,color:'white',cursor:'pointer'}}>
                {deletingCo?'Deleting...':'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
// ═══════════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function UsersTab({ users, companies, currentUser, onDelete, T }) {
  const [search, setSearch] = useState('')
  const filtered = users.filter(u=>!search||u.email?.toLowerCase().includes(search.toLowerCase()))

  async function sendReset(email) {
    await supabase.auth.resetPasswordForEmail(email)
    alert(`Password reset email sent to ${email}`)
  }

  function exportCSV() {
    const rows = [['Email','Companies','Signed up'],...users.map(u=>{
      const cos = companies.filter(c=>c.owner_email===u.email).map(c=>c.name).join(', ')
      return [u.email, cos, u.created_at?new Date(u.created_at).toLocaleDateString('en-GB'):'']
    })]
    const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download='ownproperly-users.csv'; a.click()
  }

  return (
    <div>
      <div style={{display:'flex',gap:10,marginBottom:20,justifyContent:'space-between',flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by email…"
          style={{flex:1,minWidth:220,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 14px',outline:'none'}}/>
        <button onClick={exportCSV} style={{fontFamily:mono,fontSize:11,padding:'8px 16px',borderRadius:8,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>↓ Export CSV</button>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 180px 110px 200px',gap:8,padding:'10px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`}}>
          {['Email','Companies','Signed up','Actions'].map(h=><div key={h} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>)}
        </div>
        {filtered.map(u=>{
          const userCos = companies.filter(c=>c.owner_email===u.email)
          const isMe = u.id===currentUser?.id
          return (
            <div key={u.id} style={{display:'grid',gridTemplateColumns:'1fr 180px 110px 200px',gap:8,padding:'13px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:30,height:30,borderRadius:15,background:T.gold+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:12,fontWeight:700,color:T.gold,flexShrink:0}}>
                  {(u.email?.[0]||'?').toUpperCase()}
                </div>
                <span style={{fontSize:13,color:T.text}}>{u.email}</span>
                {isMe&&<span style={{fontFamily:mono,fontSize:9,color:T.gold,background:T.gold+'22',padding:'1px 6px',borderRadius:4}}>you</span>}
              </div>
              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                {userCos.length===0?<span style={{fontFamily:mono,fontSize:10,color:T.muted}}>None</span>
                  :userCos.slice(0,3).map(co=><span key={co.id} style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B'}}>{co.abbr}</span>)}
                {userCos.length>3&&<span style={{fontFamily:mono,fontSize:10,color:T.muted}}>+{userCos.length-3}</span>}
              </div>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>
                {u.created_at?new Date(u.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>sendReset(u.email)} style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>Reset pwd</button>
                {!isMe&&<button onClick={()=>onDelete(u)} style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>Delete</button>}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginTop:10}}>{filtered.length} of {users.length} users</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING TAB
// ═══════════════════════════════════════════════════════════════════════════════
function BillingTab({ companies, T, fmt, pill }) {
  const pastDue  = companies.filter(c=>c.subscriptions?.[0]?.status==='past_due')
  const active   = companies.filter(c=>c.subscriptions?.[0]?.status==='active')
  const trialing = companies.filter(c=>!c.is_free_tier&&(!c.subscriptions?.[0]?.status||c.subscriptions?.[0]?.status==='trialing'))
  const mrrByProps = companies.reduce((s,c)=>s+(c.subscriptions?.[0]?.property_count||0),0)

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:24}}>
        {[{label:'Active paying',value:active.length,color:T.green},{label:'Past due',value:pastDue.length,color:pastDue.length>0?T.red:T.green},{label:'Total properties billed',value:mrrByProps,color:T.text}].map(k=>(
          <div key={k.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:28,fontWeight:700,color:k.color}}>{k.value}</div>
          </div>
        ))}
      </div>

      {pastDue.length>0&&(
        <>
          <h3 style={{fontSize:14,fontWeight:700,color:T.red,marginBottom:12}}>⚠ Past due accounts</h3>
          <div style={{background:T.card,border:`1px solid ${T.red}44`,borderRadius:14,overflow:'hidden',marginBottom:24}}>
            {pastDue.map(co=>(
              <div key={co.id} style={{display:'grid',gridTemplateColumns:'1fr 140px 80px',gap:8,padding:'13px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
                <div>
                  <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B',marginRight:8}}>{co.abbr}</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{co.name}</span>
                  <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:2}}>{co.owner_email}</div>
                </div>
                <div>{pill('past_due')}</div>
                <div style={{fontFamily:mono,fontSize:12,color:T.red,fontWeight:700}}>{fmt(co.subscriptions?.[0]?.property_count||0)}/mo</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:12}}>Active subscriptions</h3>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 140px 80px 130px',gap:8,padding:'10px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`}}>
          {['Account','Status','Props','MRR'].map(h=><div key={h} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>)}
        </div>
        {active.map(co=>(
          <div key={co.id} style={{display:'grid',gridTemplateColumns:'1fr 140px 80px 130px',gap:8,padding:'12px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
            <div>
              <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B',marginRight:8}}>{co.abbr}</span>
              <span style={{fontSize:13,color:T.text}}>{co.name}</span>
            </div>
            <div>{pill('active')}</div>
            <div style={{fontFamily:mono,fontSize:12,color:T.text}}>{co.subscriptions?.[0]?.property_count||0}</div>
            <div style={{fontFamily:mono,fontSize:12,color:T.green,fontWeight:700}}>{fmt(co.subscriptions?.[0]?.property_count||0)}/mo</div>
          </div>
        ))}
        {active.length===0&&<div style={{padding:24,textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>No active subscriptions yet</div>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function CommsTab({ user, users, T }) {
  const [to, setTo]           = useState('all')
  const [customEmail, setCustomEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(null)

  async function send() {
    if (!subject.trim()||!message.trim()) return
    setSending(true); setSent(null)
    try {
      const { data:{session} } = await supabase.auth.getSession()
      const recipientTo = to==='individual' ? customEmail : null
      const result = await api.sendAdminEmail(session, recipientTo, subject, message)
      setSent(`✓ Sent to ${result.sent} recipient${result.sent!==1?'s':''} successfully`)
      setSubject(''); setMessage('')
    } catch(e) { setSent(`✗ Error: ${e.message}`) }
    setSending(false)
  }

  return (
    <div style={{maxWidth:680}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'24px 28px'}}>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:20}}>Send email to users</div>

        <div style={{marginBottom:16}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>Recipients</label>
          <select value={to} onChange={e=>setTo(e.target.value)}
            style={{width:'100%',fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'9px 12px'}}>
            <option value="all">All users ({users.length})</option>
            <option value="individual">Individual user…</option>
          </select>
          {to==='individual'&&(
            <input value={customEmail} onChange={e=>setCustomEmail(e.target.value)} placeholder="user@email.com"
              style={{width:'100%',fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'9px 12px',marginTop:8,outline:'none'}}/>
          )}
        </div>

        <div style={{marginBottom:16}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>Subject</label>
          <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Email subject line"
            style={{width:'100%',fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'9px 12px',outline:'none'}}/>
        </div>

        <div style={{marginBottom:20}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>Message</label>
          <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={8} placeholder="Write your message here…"
            style={{width:'100%',fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 12px',resize:'vertical',outline:'none'}}/>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:4}}>Sent from hello@ownproperly.com using your OwnProperly branding</div>
        </div>

        {sent&&<div style={{fontFamily:mono,fontSize:12,color:sent.startsWith('✓')?T.green:T.red,marginBottom:16,padding:'10px 14px',background:sent.startsWith('✓')?T.green+'18':T.red+'18',borderRadius:8}}>{sent}</div>}

        <button onClick={send} disabled={sending||!subject.trim()||!message.trim()||(to==='individual'&&!customEmail.trim())}
          style={{fontFamily:mono,fontSize:13,fontWeight:700,padding:'12px 28px',borderRadius:10,border:'none',background:T.gold,color:T.surface,cursor:'pointer',opacity:sending?0.6:1}}>
          {sending?'Sending…':`Send email${to==='all'?` to all ${users.length} users`:''}`}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM TAB
// ═══════════════════════════════════════════════════════════════════════════════
function PlatformTab({ user, companies, T }) {
  const [announcements, setAnnouncements] = useState([])
  const [newMsg, setNewMsg]   = useState('')
  const [newType, setNewType] = useState('info')
  const [newLink, setNewLink] = useState('')
  const [newLinkText, setNewLinkText] = useState('')
  const [saving, setSaving]   = useState(false)
  const [defaultTrial, setDefaultTrial] = useState(14)

  useEffect(()=>{ api.fetchAnnouncements().then(setAnnouncements).catch(()=>{}) },[])

  async function addAnnouncement() {
    if (!newMsg.trim()) return
    setSaving(true)
    try {
      const a = await api.createAnnouncement(newMsg, newType, newLinkText, newLink, user?.id)
      setAnnouncements(prev=>[a,...prev]); setNewMsg(''); setNewLink(''); setNewLinkText('')
    } catch(e) {}
    setSaving(false)
  }

  async function deactivate(id) {
    try {
      await api.deactivateAnnouncement(id)
      setAnnouncements(prev=>prev.filter(a=>a.id!==id))
    } catch(e) {}
  }

  const typeColors = { info:'#4B8FE0', warning:'#E0943A', success:'#2ECC8A' }

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,alignItems:'start'}}>
      {/* Announcements */}
      <div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 24px',marginBottom:16}}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Platform announcements</div>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:14,lineHeight:1.6}}>
            Announcements appear as a dismissable banner at the top of the app for all users.
          </div>

          <div style={{marginBottom:12}}>
            <textarea value={newMsg} onChange={e=>setNewMsg(e.target.value)} rows={3} placeholder="Announcement message…"
              style={{width:'100%',fontFamily:mono,fontSize:12,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 12px',resize:'none',outline:'none',marginBottom:8}}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
              <select value={newType} onChange={e=>setNewType(e.target.value)}
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 10px'}}>
                <option value="info">Info (blue)</option>
                <option value="warning">Warning (amber)</option>
                <option value="success">Success (green)</option>
              </select>
              <input value={newLinkText} onChange={e=>setNewLinkText(e.target.value)} placeholder="Link text (optional)"
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 10px',outline:'none'}}/>
            </div>
            <input value={newLink} onChange={e=>setNewLink(e.target.value)} placeholder="Link URL (optional)"
              style={{width:'100%',fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'7px 10px',outline:'none',marginBottom:12}}/>
            <button onClick={addAnnouncement} disabled={saving||!newMsg.trim()}
              style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'9px 20px',borderRadius:8,border:'none',background:T.gold,color:T.surface,cursor:'pointer'}}>
              {saving?'Publishing…':'Publish announcement'}
            </button>
          </div>
        </div>

        {/* Active announcements */}
        {announcements.length>0&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
            <div style={{padding:'12px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`,fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Active announcements</div>
            {announcements.map(a=>(
              <div key={a.id} style={{padding:'12px 20px',borderBottom:`1px solid ${T.border}`,display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:8,height:8,borderRadius:4,background:typeColors[a.type]||typeColors.info,marginTop:4,flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontFamily:mono,fontSize:12,color:T.text,lineHeight:1.6}}>{a.message}</div>
                  <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:3}}>{new Date(a.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
                </div>
                <button onClick={()=>deactivate(a.id)} style={{fontFamily:mono,fontSize:10,color:T.muted,background:'none',border:'none',cursor:'pointer',padding:'4px 8px',borderRadius:4}}>Dismiss</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Platform stats */}
      <div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'20px 24px'}}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Platform statistics</div>
          {[
            ['Total accounts',    companies.length],
            ['Total properties',  companies.reduce((s,c)=>s+(c.subscriptions?.[0]?.property_count||0),0)],
            ['Flagged accounts',  companies.filter(c=>c.flagged).length],
            ['Free tier accounts',companies.filter(c=>c.is_free_tier).length],
            ['Past due',          companies.filter(c=>c.subscriptions?.[0]?.status==='past_due').length],
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${T.border}`}}>
              <span style={{fontFamily:mono,fontSize:12,color:T.muted}}>{l}</span>
              <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:T.text}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
