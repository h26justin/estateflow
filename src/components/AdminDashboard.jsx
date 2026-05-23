import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { showAppToast } from '../lib/toast'
import RolePermissionsModal from './RolePermissionsModal'

const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)
const mono = "'DM Mono',monospace"
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Helper: get a user's display name from their profile
function userName(user) {
  if (!user) return ''
  const p = user.profile
  if (p?.first_name && p?.last_name) return `${p.first_name} ${p.last_name}`
  if (p?.full_name) return p.full_name
  if (p?.first_name) return p.first_name
  return ''
}
function userInitial(user) {
  const name = userName(user)
  if (name) return name[0].toUpperCase()
  return (user?.email?.[0] || '?').toUpperCase()
}

const STATUS_CFG = {
  active:    { label:'Active',    bg:'#2ECC8A22', color:'#2ECC8A' },
  trialing:  { label:'Trialing',  bg:'#4B8FE022', color:'#4B8FE0' },
  past_due:  { label:'Past due',  bg:'#E0943A22', color:'#E0943A' },
  canceled:  { label:'Cancelled', bg:'#E0555522', color:'#E05555' },
  free_tier: { label:'Free tier', bg:'#C8A84B22', color:'#C8A84B' },
}

export default function AdminDashboard({ onClose, user }) {
  const { T } = useTheme()
  const [tab, setTabInternal] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '')
    const parts = h.split('/').filter(Boolean)
    if (parts[0] === 'admin' && parts[1]) return parts[1]
    return 'revenue'
  })

  // Sync tab changes to URL
  const setTab = (newTab) => {
    setTabInternal(newTab)
    const target = `#/admin/${newTab}`
    if (window.location.hash !== target) {
      window.history.pushState({ view: 'admin', adminTab: newTab }, '', target)
    }
  }

  // Listen for URL-driven tab changes (from browser back/forward)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.tab) setTabInternal(e.detail.tab)
    }
    window.addEventListener('ownproperly:set-admin-tab', handler)
    return () => window.removeEventListener('ownproperly:set-admin-tab', handler)
  }, [])
  const [companies, setCompanies] = useState([])
  const [users, setUsers]         = useState([])
  const [accessRows, setAccessRows] = useState([])
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
      const [cos, us, accessRows] = await Promise.all([
        api.fetchAdminAllCompanies(),
        api.fetchAllUsers().catch(()=>[]),
        api.fetchAllAccessRows().catch(()=>[]),
      ])
      setCompanies(cos); setUsers(us); setAccessRows(accessRows)
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
    const mrrStripe = active.reduce((s,c)=>s+(c.paid_property_count||c.subscriptions?.[0]?.property_count||0),0) * 2
    const mrrProps  = companies.reduce((s,c)=>s+(c.real_property_count||0),0) * 2
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
                accessRows={accessRows} setAccessRows={setAccessRows}
                setCompanies={setCompanies} adminUser={user} fmt={fmt}
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
    {label:'MRR (by properties)',   value:fmt(metrics.mrrProps),  sub:'£2 × all properties',       color:T.green},
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
          const mrr    = status==='active'?props*2:0
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
  const [endingTrial, setEndingTrial] = useState(false)
  const [trialMsg, setTrialMsg]     = useState('')
  const [showRename, setShowRename] = useState(false)
  const [renameName, setRenameName] = useState(co.name||'')
  const [renameAbbr, setRenameAbbr] = useState(co.abbr||'')
  const [renameSaving, setRenameSaving] = useState(false)
  const [deletingCo, setDeletingCo]     = useState(false)
  // Admin password confirmation
  const [adminAction, setAdminAction] = useState(null) // {label, desc, danger, fn}
  const [adminPw, setAdminPw] = useState('')
  const [adminPwErr, setAdminPwErr] = useState('')
  const [adminRunning, setAdminRunning] = useState(false)

  async function confirmAdminAction() {
    if (!adminPw) { setAdminPwErr('Enter your admin password'); return }
    setAdminRunning(true); setAdminPwErr('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: user?.email, password: adminPw })
      if (error) { setAdminPwErr('Incorrect password'); setAdminRunning(false); return }
      await adminAction.fn()
      setAdminAction(null); setAdminPw('')
    } catch(e) { setAdminPwErr(e.message || 'Action failed') }
    setAdminRunning(false)
  }

  function requireConfirm(label, desc, fn, danger=false) {
    setAdminAction({ label, desc, danger, fn })
    setAdminPw(''); setAdminPwErr('')
  }

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
    requireConfirm('Extend trial', `Extend the trial for "${co.name}" by ${extendDays} days.`, async () => {
      setExtending(true)
      try {
        const d = await api.extendTrial(co.id, extendDays)
        setTrialMsg('Trial extended to ' + d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))
      } catch(e) { setTrialMsg('Failed to extend trial') }
      setExtending(false)
    })
  }

  // End trial right now → trial_ends_at = now() + subscription → past_due.
  // After this the customer sees the "💳 Add payment method" CTA on
  // BillingPage on their next login. Destructive flag on requireConfirm
  // because it removes their access path.
  async function endTrialNow() {
    requireConfirm(
      'End trial now',
      `End the trial for "${co.name}" immediately. They will need to add a payment method via Stripe Checkout to keep access. This cannot be undone (you can re-extend the trial if you change your mind).`,
      async () => {
        setEndingTrial(true)
        try {
          await api.endTrialNow(co.id)
          setTrialMsg('Trial ended. Customer must now add payment to continue.')
        } catch (e) {
          setTrialMsg('Failed to end trial: ' + (e?.message || 'unknown error'))
        }
        setEndingTrial(false)
      },
      true,
    )
  }

  async function handleAdminRename() {
    if (!renameName.trim()) return
    requireConfirm('Rename company', `Rename "${co.name}" to "${renameName.trim()}"`, async () => {
      setRenameSaving(true)
      try {
        const abbr = renameAbbr.trim().slice(0,5).toUpperCase() || renameName.trim().slice(0,3).toUpperCase()
        await api.updateCompany(co.id, { name: renameName.trim(), abbr })
        if (onRename) onRename(co.id, renameName.trim(), abbr)
        setShowRename(false)
      } catch(e) {}
      setRenameSaving(false)
    })
  }

  async function handleAdminDeleteCompany() {
    requireConfirm('Delete company', `Permanently delete "${co.name}" and all its properties, rent data, compliance records and documents. This cannot be undone.`, async () => {
      setDeletingCo(true)
      try {
        await api.deleteCompany(co.id)
        if (onDelete) onDelete(co.id)
        onBack()
      } catch(e) { setDeletingCo(false) }
    }, true)
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
                <button onClick={handleAdminDeleteCompany}
                  style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:7,border:'1px solid '+T.red+'44',background:'transparent',color:T.red,cursor:'pointer'}}>
                  Delete
                </button>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Free tier</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:mono,fontSize:11,color:co.is_free_tier?T.gold:T.muted}}>{co.is_free_tier?'Free':'Paid'}</span>
                  <div onClick={()=>requireConfirm(co.is_free_tier?'Remove free tier':'Grant free tier', co.is_free_tier?`Remove free tier from "${co.name}". They will need an active subscription.`:`Grant free tier to "${co.name}". They will not be billed.`, async()=>{ onToggleFreeTier() })} style={{width:44,height:24,borderRadius:12,background:co.is_free_tier?T.gold:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                    <div style={{position:'absolute',top:3,left:co.is_free_tier?22:3,width:18,height:18,borderRadius:9,background:'white',transition:'left 0.2s'}}/>
                  </div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:mono,fontSize:12,color:T.text}}>Flag account</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:mono,fontSize:11,color:co.flagged?T.red:T.muted}}>{co.flagged?'Flagged':'Clear'}</span>
                  <div onClick={()=>requireConfirm(co.flagged?'Unflag account':'Flag account', co.flagged?`Remove the flag from "${co.name}".`:`Flag "${co.name}" for review. This does not affect the account but marks it for admin attention.`, async()=>{ onToggleFlag() })} style={{width:44,height:24,borderRadius:12,background:co.flagged?T.red:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                    <div style={{position:'absolute',top:3,left:co.flagged?22:3,width:18,height:18,borderRadius:9,background:'white',transition:'left 0.2s'}}/>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{background:T.card,border:'1px solid '+T.border,borderRadius:14,padding:'20px 24px'}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Trial controls</div>
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:10}}>
              <select value={extendDays} onChange={e=>setExtendDays(Number(e.target.value))}
                style={{fontFamily:mono,fontSize:12,background:T.surface,border:'1px solid '+T.border,color:T.text,borderRadius:8,padding:'7px 10px',flex:1}}>
                {[7,14,30,60,90].map(d=><option key={d} value={d}>{'+'+d+' days'}</option>)}
              </select>
              <button onClick={extendTrial} disabled={extending||endingTrial}
                style={{fontFamily:mono,fontSize:12,padding:'8px 16px',borderRadius:8,border:'none',background:T.gold,color:T.surface,cursor:'pointer',fontWeight:700}}>
                {extending?'…':'Extend'}
              </button>
            </div>
            {/* End trial — destructive, lives below Extend so the
                non-destructive action is the default tap target. */}
            <button onClick={endTrialNow} disabled={endingTrial||extending}
              style={{fontFamily:mono,fontSize:11,padding:'8px 12px',borderRadius:8,
                border:`1px solid ${T.red}44`,background:T.red+'11',color:T.red,
                cursor:endingTrial?'wait':'pointer',fontWeight:700,width:'100%'}}>
              {endingTrial?'Ending…':'⏹ End trial now — require payment'}
            </button>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:6,lineHeight:1.5}}>
              Sets trial end to today and flips subscription to <em>past due</em>.
              Customer sees “Add payment method” next time they sign in.
            </div>
            {trialMsg&&<div style={{fontFamily:mono,fontSize:11,color:trialMsg.startsWith('Failed')?T.red:T.green,marginTop:10}}>{trialMsg}</div>}
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

      {adminAction&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:800,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:440,padding:'28px',border:`2px solid ${adminAction.danger?T.red+'44':T.gold+'44'}`}}>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:36,marginBottom:10}}>{adminAction.danger?'⚠️':'🔒'}</div>
              <h3 style={{fontFamily:mono,fontSize:15,fontWeight:700,color:adminAction.danger?T.red:T.text,marginBottom:8}}>{adminAction.label}</h3>
              <p style={{fontFamily:mono,fontSize:12,color:T.muted,lineHeight:1.7}}>{adminAction.desc}</p>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.07em'}}>Enter your admin password to confirm</label>
              <input type="password" value={adminPw} onChange={e=>{setAdminPw(e.target.value);setAdminPwErr('')}}
                onKeyDown={e=>e.key==='Enter'&&confirmAdminAction()}
                autoFocus placeholder="Your password"
                style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${adminPwErr?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
              {adminPwErr&&<div style={{fontFamily:mono,fontSize:11,color:T.red,marginTop:6}}>{adminPwErr}</div>}
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>{setAdminAction(null);setAdminPw('')}} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
              <button onClick={confirmAdminAction} disabled={adminRunning||!adminPw}
                style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',
                  background:adminRunning||!adminPw?T.border:adminAction.danger?T.red:T.gold,
                  color:adminAction.danger?'white':'#1A2530',cursor:adminRunning?'wait':'pointer'}}>
                {adminRunning?'Verifying...':'Confirm'}
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
function UsersTab({ users, companies, currentUser, accessRows, setAccessRows, setCompanies, adminUser, fmt, onDelete, T }) {
  const [view, setView] = useState('by-company')
  const [search, setSearch] = useState('')
  const [expandedCompanies, setExpandedCompanies] = useState(new Set())
  const [accessTarget, setAccessTarget] = useState(null)
  const [resetConfirm, setResetConfirm] = useState(null)
  const [createCoTarget, setCreateCoTarget] = useState(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [addUserTarget, setAddUserTarget] = useState(null)
  const [roleTarget, setRoleTarget] = useState(null) // {user, company}
  // Password confirmation state
  const [adminAction, setAdminAction] = useState(null)
  const [adminPw, setAdminPw] = useState('')
  const [adminPwErr, setAdminPwErr] = useState('')
  const [adminRunning, setAdminRunning] = useState(false)

  async function confirmAdminAction() {
    if (!adminPw) { setAdminPwErr('Enter your admin password'); return }
    setAdminRunning(true); setAdminPwErr('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: adminUser?.email, password: adminPw })
      if (error) { setAdminPwErr('Incorrect password'); setAdminRunning(false); return }
      await adminAction.fn()
      setAdminAction(null); setAdminPw('')
    } catch(e) { setAdminPwErr(e.message || 'Action failed') }
    setAdminRunning(false)
  }

  function requireConfirm(label, desc, fn, danger=false) {
    setAdminAction({ label, desc, danger, fn })
    setAdminPw(''); setAdminPwErr('')
  }

  // Build a map: userId -> { owned, shared, all }
  function getUserCompanies(user) {
    const owned = companies.filter(c => c.owner_email === user.email)
    const sharedIds = new Set(accessRows.filter(r => r.user_id === user.id).map(r => r.company_id))
    const shared = companies.filter(c => sharedIds.has(c.id) && c.owner_email !== user.email)
    return { owned, shared, all: [...owned, ...shared] }
  }

  // Build a map: companyId -> { owner, shared: [{user, is_admin}] }
  function getCompanyUsers(company) {
    const owner = users.find(u => u.email === company.owner_email) || null
    const accessMap = {}
    accessRows.filter(r => r.company_id === company.id).forEach(r => { accessMap[r.user_id] = r })
    const sharedIds = new Set(Object.keys(accessMap))
    const sharedUsers = users
      .filter(u => sharedIds.has(u.id) && u.email !== company.owner_email)
      .map(u => ({
        ...u,
        _isAdmin: accessMap[u.id]?.is_admin === true,
        _accessRow: accessMap[u.id],
        _role: accessMap[u.id]?.role || (accessMap[u.id]?.is_admin ? 'admin' : 'editor'),
      }))
    return { owner, shared: sharedUsers }
  }

  // Toggle admin rights for a shared user
  async function doToggleUserAdmin(u, co) {
    const newVal = !u._isAdmin
    try {
      await api.setUserCompanyAdmin(u.id, co.id, newVal)
      setAccessRows(prev => prev.map(r =>
        (r.user_id === u.id && r.company_id === co.id) ? { ...r, is_admin: newVal } : r
      ))
    } catch(e) { showAppToast('Failed: ' + (e.message || 'unknown error'), 'error') }
  }

  const filteredCompanies = useMemo(() => {
    if (!search) return companies
    const q = search.toLowerCase()
    return companies.filter(c => {
      if (c.name?.toLowerCase().includes(q)) return true
      if (c.abbr?.toLowerCase().includes(q)) return true
      if (c.owner_email?.toLowerCase().includes(q)) return true
      const { shared } = getCompanyUsers(c)
      return shared.some(u => u.email?.toLowerCase().includes(q))
    })
  }, [companies, search, users, accessRows])

  const filteredUsers = useMemo(() => {
    if (!search) return users
    const q = search.toLowerCase()
    return users.filter(u => {
      if (u.email?.toLowerCase().includes(q)) return true
      const name = userName(u).toLowerCase()
      if (name && name.includes(q)) return true
      if (u.profile?.phone?.toLowerCase().includes(q)) return true
      return false
    })
  }, [users, search])

  // Users with NO companies
  const orphanUsers = useMemo(() => users.filter(u => getUserCompanies(u).all.length === 0), [users, companies, accessRows])

  async function sendReset(email) {
    await supabase.auth.resetPasswordForEmail(email)
    setResetConfirm(null)
    showAppToast(`Password reset email sent to ${email}`)
  }

  function toggleExpand(coId) {
    setExpandedCompanies(prev => {
      const next = new Set(prev)
      if (next.has(coId)) next.delete(coId); else next.add(coId)
      return next
    })
  }

  function expandAll() { setExpandedCompanies(new Set(filteredCompanies.map(c => c.id))) }
  function collapseAll() { setExpandedCompanies(new Set()) }

  // ── ADMIN ACTIONS ─────────────────────────────────────────────────────────
  async function doRenameCompany(co, newName, newAbbr) {
    requireConfirm('Rename company', `Rename "${co.name}" to "${newName}"`, async () => {
      const abbr = (newAbbr || newName.slice(0,3)).toUpperCase().slice(0,5)
      await api.updateCompany(co.id, { name: newName, abbr })
      setCompanies(prev => prev.map(c => c.id===co.id ? { ...c, name: newName, abbr } : c))
    })
  }

  async function doDeleteCompany(co) {
    requireConfirm('Delete company', `Permanently delete "${co.name}" and all its properties, rent data, compliance records and documents. This cannot be undone.`, async () => {
      await api.deleteCompany(co.id)
      setCompanies(prev => prev.filter(c => c.id !== co.id))
    }, true)
  }

  async function doToggleFreeTier(co) {
    requireConfirm(co.is_free_tier ? 'Remove free tier' : 'Grant free tier', co.is_free_tier ? `Remove free tier status from "${co.name}". They will need an active subscription.` : `Grant free tier status to "${co.name}". They will not be billed.`, async () => {
      await api.setCompanyFreeTier(co.id, !co.is_free_tier)
      setCompanies(prev => prev.map(c => c.id===co.id ? { ...c, is_free_tier: !co.is_free_tier } : c))
    })
  }

  async function doToggleFlag(co) {
    requireConfirm(co.flagged ? 'Unflag account' : 'Flag account', co.flagged ? `Remove flag from "${co.name}".` : `Flag "${co.name}" for admin review.`, async () => {
      await api.setCompanyFlag(co.id, !co.flagged)
      setCompanies(prev => prev.map(c => c.id===co.id ? { ...c, flagged: !co.flagged } : c))
    })
  }

  async function doExtendTrial(co, days) {
    requireConfirm('Extend trial', `Extend the trial for "${co.name}" by ${days} days.`, async () => {
      await api.extendTrial(co.id, days)
      showAppToast(`Trial extended by ${days} days`)
    })
  }

  async function doRemoveUserFromCompany(userToRemove, co) {
    requireConfirm('Remove access', `Remove access to "${co.name}" from ${userToRemove.email}.`, async () => {
      await supabase.from('user_company_access').delete().eq('user_id', userToRemove.id).eq('company_id', co.id)
      setAccessRows(prev => prev.filter(r => !(r.user_id===userToRemove.id && r.company_id===co.id)))
    })
  }

  function exportCSV() {
    const rows = [['Name','Email','Phone','Companies','Signed up'],...users.map(u=>{
      const cos = getUserCompanies(u).all.map(c=>c.name).join(', ')
      return [userName(u), u.email, u.profile?.phone||'', cos, u.created_at?new Date(u.created_at).toLocaleDateString('en-GB'):'']
    })]
    const csv = rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download='ownproperly-users.csv'; a.click()
  }

  // ── PILLS AND HELPERS ─────────────────────────────────────────────────────
  const statusPill = (co) => {
    const status = co.is_free_tier ? 'free' : (co.subscriptions?.[0]?.status || 'trialing')
    const cfg = { active:{bg:T.green+'22',c:T.green,l:'Active'}, trialing:{bg:T.amber+'22',c:T.amber,l:'Trial'}, free:{bg:T.gold+'22',c:T.gold,l:'Free'}, past_due:{bg:T.red+'22',c:T.red,l:'Past due'}, canceled:{bg:T.muted+'22',c:T.muted,l:'Canceled'} }[status] || {bg:T.muted+'22',c:T.muted,l:status}
    return <span style={{fontFamily:mono,fontSize:10,background:cfg.bg,color:cfg.c,padding:'2px 8px',borderRadius:10,fontWeight:700}}>{cfg.l}</span>
  }

  const btnSm = (color, bg, border) => ({fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${border||T.border}`,background:bg||'transparent',color:color||T.muted,fontWeight:600})

  return (
    <div>
      {/* ── TOP BAR: search + view toggle + global actions ── */}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by company, email, or abbreviation…"
          style={{flex:1,minWidth:220,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 14px',outline:'none'}}/>
        <div style={{display:'flex',background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:2,gap:2}}>
          {[['by-company','🏢 By company'],['by-user','👤 By user']].map(([k,l])=>(
            <button key={k} onClick={()=>setView(k)}
              style={{fontFamily:mono,fontSize:11,padding:'6px 12px',borderRadius:6,border:'none',cursor:'pointer',background:view===k?T.gold+'22':'transparent',color:view===k?T.gold:T.muted,fontWeight:view===k?700:400}}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={()=>setMergeOpen(true)} style={btnSm(T.gold, T.gold+'11', T.gold+'44')}>⚡ Merge companies</button>
        <button onClick={exportCSV} style={btnSm()}>↓ Export CSV</button>
      </div>

      {/* ── BY COMPANY VIEW ── */}
      {view==='by-company' && (
        <>
          <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'center'}}>
            <span style={{fontFamily:mono,fontSize:11,color:T.muted}}>{filteredCompanies.length} {filteredCompanies.length===1?'company':'companies'}</span>
            <div style={{flex:1}}/>
            <button onClick={expandAll} style={btnSm()}>Expand all</button>
            <button onClick={collapseAll} style={btnSm()}>Collapse all</button>
          </div>

          {filteredCompanies.length===0 && (
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:'40px 20px',textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>
              No companies match your search.
            </div>
          )}

          {filteredCompanies.map(co => {
            const { owner, shared } = getCompanyUsers(co)
            const isOpen = expandedCompanies.has(co.id)
            const props = co.real_property_count || 0
            const mrr = (co.subscriptions?.[0]?.status==='active') ? props * 2 : 0
            const coColor = co.color || '#C8A84B'

            return (
              <div key={co.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,marginBottom:12,overflow:'hidden',borderLeft:`4px solid ${coColor}`}}>
                {/* Company header row */}
                <div onClick={()=>toggleExpand(co.id)}
                  style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto auto',gap:14,padding:'14px 20px',cursor:'pointer',alignItems:'center',background:isOpen?T.bg:'transparent'}}>
                  <span style={{fontFamily:mono,fontSize:12,color:isOpen?T.gold:T.faint,fontWeight:700}}>
                    {isOpen ? '▼' : '▶'}
                  </span>
                  <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'3px 10px',borderRadius:4,background:coColor+'22',color:coColor,flexShrink:0}}>{co.abbr}</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{co.name}</div>
                      <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {owner ? (userName(owner) ? `${userName(owner)} · ${owner.email}` : owner.email) : (co.owner_email || 'No owner')}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
                    <div style={{fontFamily:mono,fontSize:11,color:T.text,fontWeight:700}}>{props} {props===1?'prop':'props'}</div>
                    <div style={{fontFamily:mono,fontSize:10,color:mrr>0?T.green:T.muted}}>{mrr>0?fmt(mrr)+'/mo':'—'}</div>
                  </div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    {statusPill(co)}
                    {co.flagged && <span style={{fontFamily:mono,fontSize:10,color:T.red}}>⚑</span>}
                    {shared.length>0 && <span style={{fontFamily:mono,fontSize:10,color:T.muted,background:T.bg,padding:'2px 8px',borderRadius:10}}>+{shared.length}</span>}
                  </div>
                </div>

                {/* Expanded: users + admin actions */}
                {isOpen && (
                  <div style={{padding:'16px 20px 20px',borderTop:`1px solid ${T.border}`}}>
                    {/* OWNER */}
                    {owner && (
                      <div style={{marginBottom:14}}>
                        <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Owner</div>
                        <UserRow user={owner} role="Owner" co={co} T={T}
                          onManageAccess={()=>setAccessTarget(owner)}
                          onReset={()=>setResetConfirm(owner)}
                          onDelete={owner.id===currentUser?.id ? null : ()=>onDelete(owner)}
                          onRemove={null}/>
                      </div>
                    )}
                    {!owner && co.owner_email && (
                      <div style={{marginBottom:14,fontFamily:mono,fontSize:11,color:T.muted,padding:'10px 14px',background:T.bg,borderRadius:8}}>
                        Owner email: {co.owner_email} <span style={{color:T.red}}>(user not found)</span>
                      </div>
                    )}

                    {/* SHARED USERS */}
                    {shared.length>0 && (
                      <div style={{marginBottom:14}}>
                        <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Shared access ({shared.length})</div>
                        {shared.map(u=>(
                          <UserRow key={u.id} user={u} role={u._role || 'editor'} co={co} T={T}
                            onManageAccess={()=>setAccessTarget(u)}
                            onManageRole={()=>setRoleTarget({ user: u, company: co, accessRow: u._accessRow })}
                            onReset={()=>setResetConfirm(u)}
                            onToggleAdmin={()=>doToggleUserAdmin(u, co)}
                            isAdminForCo={u._isAdmin}
                            onRemove={()=>doRemoveUserFromCompany(u, co)}
                            onDelete={u.id===currentUser?.id ? null : ()=>onDelete(u)}/>
                        ))}
                      </div>
                    )}

                    {/* COMPANY ADMIN ACTIONS */}
                    <div style={{borderTop:`1px dashed ${T.border}`,paddingTop:14,marginTop:10}}>
                      <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Company actions</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button onClick={()=>setAddUserTarget(co)} style={btnSm(T.blue, T.blue+'11', T.blue+'44')}>+ Add user access</button>
                        <button onClick={()=>{const nm=prompt('New company name:',co.name);if(nm&&nm.trim()){const ab=prompt('New abbreviation:',co.abbr||'');doRenameCompany(co,nm.trim(),ab?.trim()||'')}}} style={btnSm()}>✎ Rename</button>
                        <button onClick={()=>setTransferTarget(co)} style={btnSm()}>↗ Transfer ownership</button>
                        <button onClick={()=>{const d=prompt('Extend trial by how many days?','30');if(d&&!isNaN(+d))doExtendTrial(co,+d)}} style={btnSm()}>⏱ Extend trial</button>
                        <button onClick={()=>doToggleFreeTier(co)} style={btnSm(co.is_free_tier?T.gold:T.muted, co.is_free_tier?T.gold+'11':'transparent')}>
                          {co.is_free_tier ? '✓ Free tier' : 'Grant free tier'}
                        </button>
                        <button onClick={()=>doToggleFlag(co)} style={btnSm(co.flagged?T.red:T.muted, co.flagged?T.red+'11':'transparent', co.flagged?T.red+'44':T.border)}>
                          {co.flagged ? '⚑ Flagged' : 'Flag account'}
                        </button>
                        <div style={{flex:1}}/>
                        <button onClick={()=>doDeleteCompany(co)} style={btnSm(T.red, 'transparent', T.red+'44')}>✕ Delete company</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* ── ORPHAN USERS (no companies) ── */}
          {orphanUsers.length > 0 && (
            <div style={{background:T.card,border:`1px solid ${T.amber}44`,borderRadius:12,padding:'16px 20px',marginTop:20}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                <span style={{fontFamily:mono,fontSize:11,color:T.amber,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em'}}>⚠ Users without companies ({orphanUsers.length})</span>
              </div>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:12,lineHeight:1.6}}>
                These users signed up but don't own or have access to any company. They may need a company created for them, or may be test accounts that can be deleted.
              </div>
              {orphanUsers.map(u => (
                <div key={u.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,padding:'10px 0',borderTop:`1px solid ${T.border}`,alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:30,height:30,borderRadius:15,background:T.amber+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:12,fontWeight:700,color:T.amber}}>
                      {userInitial(u)}
                    </div>
                    <div>
                      <div style={{fontSize:13,color:T.text,fontWeight:600}}>{userName(u) || u.email}</div>
                      <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:2}}>
                        {userName(u) ? u.email : null}
                        {userName(u) && u.profile?.phone ? ' · ' : ''}
                        {u.profile?.phone ? u.profile.phone : null}
                        {!userName(u) && !u.profile?.phone ? `signed up ${u.created_at?new Date(u.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}` : null}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>setCreateCoTarget(u)} style={btnSm(T.gold, T.gold+'11', T.gold+'44')}>+ Create company</button>
                    <button onClick={()=>setResetConfirm(u)} style={btnSm()}>Reset pwd</button>
                    {u.id!==currentUser?.id && <button onClick={()=>onDelete(u)} style={btnSm(T.red, 'transparent', T.red+'44')}>Delete</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── BY USER VIEW ── */}
      {view==='by-user' && (
        <>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:14}}>{filteredUsers.length} of {users.length} users</div>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,overflow:'hidden'}}>
            <div style={{display:'grid',gridTemplateColumns:'1.4fr 220px 110px 280px',gap:8,padding:'10px 20px',background:T.bg,borderBottom:`1px solid ${T.border}`}}>
              {['User','Companies','Signed up','Actions'].map(h=><div key={h} style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>{h}</div>)}
            </div>
            {filteredUsers.map(u=>{
              const { all: userCos } = getUserCompanies(u)
              const isMe = u.id===currentUser?.id
              const orphan = userCos.length === 0
              const name = userName(u)
              const phone = u?.profile?.phone
              return (
                <div key={u.id} style={{display:'grid',gridTemplateColumns:'1.4fr 220px 110px 280px',gap:8,padding:'13px 20px',borderBottom:`1px solid ${T.border}`,alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                    <div style={{width:34,height:34,borderRadius:17,background:(orphan?T.amber:T.gold)+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:700,color:orphan?T.amber:T.gold,flexShrink:0}}>
                      {userInitial(u)}
                    </div>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                        <span style={{fontSize:13,fontWeight:600,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {name || u.email}
                        </span>
                        {isMe&&<span style={{fontFamily:mono,fontSize:9,color:T.gold,background:T.gold+'22',padding:'1px 6px',borderRadius:4}}>you</span>}
                        {orphan&&<span style={{fontFamily:mono,fontSize:9,color:T.amber,background:T.amber+'22',padding:'1px 6px',borderRadius:4}}>orphan</span>}
                      </div>
                      <div style={{fontFamily:mono,fontSize:10,color:T.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {name ? u.email : null}
                        {name && phone ? ' · ' : ''}
                        {phone ? phone : null}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {userCos.length===0?<span style={{fontFamily:mono,fontSize:10,color:T.muted}}>None</span>
                      :userCos.slice(0,4).map(co=><span key={co.id} style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B'}}>{co.abbr}</span>)}
                    {userCos.length>4&&<span style={{fontFamily:mono,fontSize:10,color:T.muted}}>+{userCos.length-4}</span>}
                  </div>
                  <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>
                    {u.created_at?new Date(u.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <button onClick={()=>{
                      if(!confirm(`Impersonate ${u.email}? You'll see their data (read-only). Logged to audit trail.`)) return
                      sessionStorage.setItem('ownproperly_impersonate', JSON.stringify({id:u.id,email:u.email,name:userName(u)}))
                      supabase.from('audit_log').insert({
                        user_id: currentUser?.id,
                        action: 'admin.impersonate_started',
                        entity_type: 'user',
                        entity_id: u.id,
                        entity_name: u.email,
                        metadata: { target_name: userName(u) }
                      }).then(()=>{})
                      window.location.href = '/#/dashboard'
                      window.location.reload()
                    }} style={btnSm('#8B1F1F', '#8B1F1F11', '#8B1F1F44')}>🎭 Impersonate</button>
                    <button onClick={()=>setAccessTarget(u)} style={btnSm(T.gold, T.gold+'11', T.gold+'44')}>Manage access</button>
                    <button onClick={()=>setCreateCoTarget(u)} style={btnSm()}>+ Company</button>
                    <button onClick={()=>setResetConfirm(u)} style={btnSm()}>Reset pwd</button>
                    {!isMe&&<button onClick={()=>onDelete(u)} style={btnSm(T.red, 'transparent', T.red+'44')}>Delete</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── PASSWORD CONFIRMATION MODAL ── */}
      {adminAction && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:800,padding:24}}>
          <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:440,padding:'28px',border:`2px solid ${adminAction.danger?T.red+'44':T.gold+'44'}`}}>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:36,marginBottom:10}}>{adminAction.danger?'⚠️':'🔒'}</div>
              <h3 style={{fontFamily:mono,fontSize:15,fontWeight:700,color:adminAction.danger?T.red:T.text,marginBottom:8}}>{adminAction.label}</h3>
              <p style={{fontFamily:mono,fontSize:12,color:T.muted,lineHeight:1.7}}>{adminAction.desc}</p>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.07em'}}>Enter your admin password</label>
              <input type="password" value={adminPw} onChange={e=>{setAdminPw(e.target.value);setAdminPwErr('')}}
                onKeyDown={e=>e.key==='Enter'&&confirmAdminAction()}
                autoFocus placeholder="Your password"
                style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${adminPwErr?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
              {adminPwErr&&<div style={{fontFamily:mono,fontSize:11,color:T.red,marginTop:6}}>{adminPwErr}</div>}
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>{setAdminAction(null);setAdminPw('')}} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
              <button onClick={confirmAdminAction} disabled={adminRunning||!adminPw}
                style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',
                  background:adminRunning||!adminPw?T.border:adminAction.danger?T.red:T.gold,
                  color:adminAction.danger?'white':'#1A2530',cursor:adminRunning?'wait':'pointer'}}>
                {adminRunning?'Verifying...':'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RESET PASSWORD MODAL ── */}
      {resetConfirm && (
        <div onClick={()=>setResetConfirm(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:700,padding:24}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:400,padding:'28px',border:`1px solid ${T.border}`}}>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:32,marginBottom:10}}>🔑</div>
              <h3 style={{fontFamily:mono,fontSize:15,fontWeight:700,color:T.text,marginBottom:8}}>Send password reset?</h3>
              <p style={{fontFamily:mono,fontSize:12,color:T.muted,lineHeight:1.7}}>
                {"Send a password reset email to "}<strong style={{color:T.gold}}>{resetConfirm.email}</strong>.
              </p>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>setResetConfirm(null)} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
              <button onClick={()=>sendReset(resetConfirm.email)} style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:T.gold,color:'#1A2530',cursor:'pointer'}}>Send reset email</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MANAGE ACCESS MODAL ── */}
      {accessTarget && (
        <ManageAccessModal targetUser={accessTarget} companies={companies} accessRows={accessRows} setAccessRows={setAccessRows} onClose={()=>setAccessTarget(null)} T={T}/>
      )}

      {/* ── CREATE COMPANY FOR USER MODAL ── */}
      {createCoTarget && (
        <CreateCompanyForUserModal target={createCoTarget} adminUser={adminUser} onClose={()=>setCreateCoTarget(null)}
          onCreated={(newCo)=>{setCompanies(prev=>[newCo,...prev]);setCreateCoTarget(null)}} T={T}/>
      )}

      {/* ── MERGE COMPANIES MODAL ── */}
      {mergeOpen && (
        <MergeCompaniesModal companies={companies} adminUser={adminUser} onClose={()=>setMergeOpen(false)}
          onMerged={(removedId)=>{setCompanies(prev=>prev.filter(c=>c.id!==removedId));setMergeOpen(false)}} T={T}/>
      )}

      {/* ── TRANSFER OWNERSHIP MODAL ── */}
      {transferTarget && (
        <TransferCompanyModal co={transferTarget} users={users} adminUser={adminUser} onClose={()=>setTransferTarget(null)}
          onTransferred={(coId,newOwnerId,newOwnerEmail)=>{setCompanies(prev=>prev.map(c=>c.id===coId?{...c,owner_id:newOwnerId,owner_email:newOwnerEmail}:c));setTransferTarget(null)}} T={T}/>
      )}

      {/* ── ADD USER ACCESS MODAL ── */}
      {addUserTarget && (
        <AddUserAccessModal co={addUserTarget} users={users} accessRows={accessRows} adminUser={adminUser}
          onClose={()=>setAddUserTarget(null)}
          onAdded={(newRow)=>{setAccessRows(prev=>[...prev,newRow]);setAddUserTarget(null)}} T={T}/>
      )}

      {/* ── ROLE PERMISSIONS MODAL ── */}
      {roleTarget && (
        <RolePermissionsModal
          user={roleTarget.user}
          company={roleTarget.company}
          accessRow={roleTarget.accessRow}
          showToast={(msg,type)=>window.dispatchEvent(new CustomEvent('ownproperly:toast',{detail:{msg,type}}))}
          onClose={()=>setRoleTarget(null)}
          onSaved={(newRow)=>{
            setAccessRows(prev=>prev.map(r => (r.user_id===newRow.user_id && r.company_id===newRow.company_id) ? { ...r, role: newRow.role, permissions: newRow.permissions, is_admin: newRow.is_admin } : r))
            setRoleTarget(null)
          }}/>
      )}
    </div>
  )
}

// ── USER ROW (inside expanded company) ─────────────────────────────────────────
function UserRow({ user, role, co, T, onManageAccess, onManageRole, onReset, onRemove, onDelete, onToggleAdmin, isAdminForCo }) {
  const name = userName(user)
  const phone = user?.profile?.phone
  const roleLower = typeof role === 'string' ? role.toLowerCase() : 'editor'
  const isOwner = roleLower === 'owner'
  const ROLE_COLORS = { owner: T.gold, admin: T.gold, editor: T.blue, viewer: '#7B68EE', shared: T.blue }
  const ROLE_ICONS = { owner: '👑', admin: '👑', editor: '✎', viewer: '👁', shared: '✎' }
  const pillColor = ROLE_COLORS[roleLower] || T.blue
  return (
    <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:12,padding:'10px 14px',background:T.bg,borderRadius:8,marginBottom:6,alignItems:'center'}}>
      <div style={{width:32,height:32,borderRadius:16,background:pillColor+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:12,fontWeight:700,color:pillColor}}>
        {userInitial(user)}
      </div>
      <div style={{minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2,flexWrap:'wrap'}}>
          <span style={{fontSize:13,color:T.text,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {name || user.email}
          </span>
          <span style={{fontFamily:mono,fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:4,background:pillColor+'22',color:pillColor,textTransform:'capitalize'}}>
            {ROLE_ICONS[roleLower] || '●'} {roleLower}
          </span>
        </div>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {name ? user.email : null}
          {name && phone ? ' · ' : ''}
          {phone ? phone : null}
        </div>
        <div style={{fontFamily:mono,fontSize:9,color:T.faint,marginTop:2}}>
          signed up {user.created_at?new Date(user.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}
        </div>
      </div>
      <div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'flex-end'}}>
        {onManageRole && !isOwner && <button onClick={onManageRole} style={{fontFamily:mono,fontSize:10,padding:'3px 9px',borderRadius:5,cursor:'pointer',border:`1px solid ${T.gold}44`,background:T.gold+'11',color:T.gold,fontWeight:700}}>⚙ Role</button>}
        {onManageAccess && <button onClick={onManageAccess} style={{fontFamily:mono,fontSize:10,padding:'3px 9px',borderRadius:5,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>Access</button>}
        {onReset && <button onClick={onReset} style={{fontFamily:mono,fontSize:10,padding:'3px 9px',borderRadius:5,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>Reset</button>}
        {onRemove && <button onClick={onRemove} style={{fontFamily:mono,fontSize:10,padding:'3px 9px',borderRadius:5,cursor:'pointer',border:`1px solid ${T.amber}44`,background:'transparent',color:T.amber}}>Remove</button>}
        {onDelete && <button onClick={onDelete} style={{fontFamily:mono,fontSize:10,padding:'3px 9px',borderRadius:5,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>Delete</button>}
      </div>
    </div>
  )
}

// ── CREATE COMPANY FOR USER MODAL ─────────────────────────────────────────────
function CreateCompanyForUserModal({ target, adminUser, onClose, onCreated, T }) {
  const [name, setName] = useState('')
  const [abbr, setAbbr] = useState('')
  const [color, setColor] = useState('#C8A84B')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) { setErr('Enter a company name'); return }
    if (!pw) { setErr('Enter your admin password'); return }
    setSaving(true); setErr('')
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: adminUser?.email, password: pw })
      if (authErr) { setErr('Incorrect password'); setSaving(false); return }
      const co = await api.adminCreateCompanyForUser(target.id, target.email, name.trim(), abbr.trim(), color)
      onCreated({ ...co, owner_email: target.email, real_property_count: 0, paid_property_count: 0, subscriptions: [] })
    } catch(e) { setErr(e.message || 'Failed to create company'); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:800,padding:24}}>
      <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:460,padding:'28px',border:`1px solid ${T.border}`}}>
        <h3 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Create company for user</h3>
        <p style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20}}>Owner will be <strong style={{color:T.gold}}>{target.email}</strong></p>

        <div style={{marginBottom:12}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Company name</label>
          <input value={name} onChange={e=>setName(e.target.value)} autoFocus placeholder="e.g. Vale Property Group"
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 100px',gap:10,marginBottom:12}}>
          <div>
            <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Abbreviation</label>
            <input value={abbr} onChange={e=>setAbbr(e.target.value.toUpperCase().slice(0,5))} placeholder="VPG"
              style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Colour</label>
            <input type="color" value={color} onChange={e=>setColor(e.target.value)}
              style={{width:'100%',height:40,padding:0,border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',background:'transparent'}}/>
          </div>
        </div>
        <div style={{marginBottom:16,marginTop:14,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your admin password</label>
          <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr('')}}
            onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${err?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
          {err && <div style={{fontFamily:mono,fontSize:11,color:T.red,marginTop:6}}>{err}</div>}
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
          <button onClick={submit} disabled={saving||!name.trim()||!pw} style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:saving||!name.trim()||!pw?T.border:T.gold,color:'#1A2530',cursor:saving?'wait':'pointer'}}>{saving?'Creating...':'Create company'}</button>
        </div>
      </div>
    </div>
  )
}

// ── MERGE COMPANIES MODAL ─────────────────────────────────────────────────────
function MergeCompaniesModal({ companies, adminUser, onClose, onMerged, T }) {
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const source = companies.find(c => c.id === sourceId)
  const target = companies.find(c => c.id === targetId)

  async function submit() {
    if (!sourceId || !targetId) { setErr('Select both companies'); return }
    if (sourceId === targetId) { setErr('Source and target must be different'); return }
    if (!pw) { setErr('Enter your admin password'); return }
    setSaving(true); setErr('')
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: adminUser?.email, password: pw })
      if (authErr) { setErr('Incorrect password'); setSaving(false); return }
      await api.adminMergeCompanies(sourceId, targetId)
      onMerged(sourceId)
    } catch(e) { setErr(e.message || 'Merge failed'); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:800,padding:24}}>
      <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:520,padding:'28px',border:`2px solid ${T.red}44`}}>
        <div style={{textAlign:'center',marginBottom:16}}>
          <div style={{fontSize:36,marginBottom:8}}>⚡</div>
          <h3 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Merge companies</h3>
          <p style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.6}}>All properties and shared access from source will move into target. The source company will be permanently deleted.</p>
        </div>

        <div style={{marginBottom:12}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Source company (will be deleted)</label>
          <select value={sourceId} onChange={e=>setSourceId(e.target.value)}
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}>
            <option value="">Select company...</option>
            {companies.map(c=><option key={c.id} value={c.id}>{c.name} ({c.abbr}) · {c.real_property_count||0} props · {c.owner_email||'—'}</option>)}
          </select>
        </div>

        <div style={{textAlign:'center',margin:'8px 0',fontFamily:mono,fontSize:18,color:T.muted}}>↓</div>

        <div style={{marginBottom:12}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Target company (keeps everything)</label>
          <select value={targetId} onChange={e=>setTargetId(e.target.value)}
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}>
            <option value="">Select company...</option>
            {companies.filter(c=>c.id!==sourceId).map(c=><option key={c.id} value={c.id}>{c.name} ({c.abbr}) · {c.real_property_count||0} props · {c.owner_email||'—'}</option>)}
          </select>
        </div>

        {source && target && (
          <div style={{background:T.bg,borderRadius:10,padding:'12px 14px',marginBottom:14,fontFamily:mono,fontSize:11,color:T.text,lineHeight:1.7}}>
            {(source.real_property_count||0)} properties will move from <strong style={{color:source.color||T.gold}}>{source.name}</strong> into <strong style={{color:target.color||T.gold}}>{target.name}</strong>, then <strong style={{color:T.red}}>{source.name}</strong> will be deleted.
          </div>
        )}

        <div style={{marginBottom:16,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your admin password</label>
          <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr('')}}
            onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${err?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
          {err && <div style={{fontFamily:mono,fontSize:11,color:T.red,marginTop:6}}>{err}</div>}
        </div>

        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
          <button onClick={submit} disabled={saving||!sourceId||!targetId||!pw} style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:saving||!sourceId||!targetId||!pw?T.border:T.red,color:'white',cursor:saving?'wait':'pointer'}}>{saving?'Merging...':'Merge and delete source'}</button>
        </div>
      </div>
    </div>
  )
}

// ── TRANSFER COMPANY OWNERSHIP MODAL ──────────────────────────────────────────
function TransferCompanyModal({ co, users, adminUser, onClose, onTransferred, T }) {
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = users.filter(u => u.email?.toLowerCase().includes(search.toLowerCase()) && u.email !== co.owner_email).slice(0, 8)

  async function submit() {
    if (!selectedUser) { setErr('Select a new owner'); return }
    if (!pw) { setErr('Enter your admin password'); return }
    setSaving(true); setErr('')
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: adminUser?.email, password: pw })
      if (authErr) { setErr('Incorrect password'); setSaving(false); return }
      await api.adminTransferCompany(co.id, selectedUser.id, selectedUser.email)
      onTransferred(co.id, selectedUser.id, selectedUser.email)
    } catch(e) { setErr(e.message || 'Transfer failed'); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:800,padding:24}}>
      <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:480,padding:'28px',border:`1px solid ${T.border}`}}>
        <h3 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Transfer ownership</h3>
        <p style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:18}}>Transfer <strong style={{color:co.color||T.gold}}>{co.name}</strong> from {co.owner_email || 'current owner'} to another user.</p>

        <div style={{marginBottom:12}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Search new owner by email</label>
          <input value={search} onChange={e=>{setSearch(e.target.value);setSelectedUser(null)}} autoFocus placeholder="user@example.com"
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
        </div>

        {search && !selectedUser && (
          <div style={{maxHeight:200,overflowY:'auto',marginBottom:12,background:T.bg,borderRadius:8,border:`1px solid ${T.border}`}}>
            {filtered.length===0 ? <div style={{padding:12,fontFamily:mono,fontSize:11,color:T.muted,textAlign:'center'}}>No matching users</div>
              : filtered.map(u => {
                const n = userName(u)
                return (
                  <div key={u.id} onClick={()=>{setSelectedUser(u);setSearch(u.email)}} style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${T.border}`}}>
                    {n && <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{n}</div>}
                    <div style={{fontFamily:mono,fontSize:11,color:n?T.muted:T.text}}>{u.email}</div>
                  </div>
                )
              })}
          </div>
        )}

        {selectedUser && (
          <div style={{background:T.gold+'11',borderRadius:8,padding:'10px 14px',marginBottom:14,fontFamily:mono,fontSize:11,color:T.text}}>
            New owner: <strong style={{color:T.gold}}>{selectedUser.email}</strong>
          </div>
        )}

        <div style={{marginBottom:16,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your admin password</label>
          <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr('')}}
            onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${err?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
          {err && <div style={{fontFamily:mono,fontSize:11,color:T.red,marginTop:6}}>{err}</div>}
        </div>

        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
          <button onClick={submit} disabled={saving||!selectedUser||!pw} style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:saving||!selectedUser||!pw?T.border:T.gold,color:'#1A2530',cursor:saving?'wait':'pointer'}}>{saving?'Transferring...':'Transfer ownership'}</button>
        </div>
      </div>
    </div>
  )
}

// ── ADD USER ACCESS MODAL (grants a user access to one company) ──────────────
function AddUserAccessModal({ co, users, accessRows, adminUser, onClose, onAdded, T }) {
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  // Exclude users who already have access (owner or shared)
  const existingUserIds = new Set([
    ...users.filter(u => u.email === co.owner_email).map(u => u.id),
    ...accessRows.filter(r => r.company_id === co.id).map(r => r.user_id),
  ])
  const filtered = users
    .filter(u => !existingUserIds.has(u.id))
    .filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8)

  async function submit() {
    if (!selectedUser) { setErr('Select a user'); return }
    if (!pw) { setErr('Enter your admin password'); return }
    setSaving(true); setErr('')
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: adminUser?.email, password: pw })
      if (authErr) { setErr('Incorrect password'); setSaving(false); return }
      const { data, error } = await supabase.from('user_company_access').insert({
        user_id: selectedUser.id,
        company_id: co.id,
        email: selectedUser.email,
      }).select().single()
      if (error) throw error
      onAdded(data)
    } catch(e) { setErr(e.message || 'Failed to add access'); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:800,padding:24}}>
      <div style={{background:T.surface,borderRadius:18,width:'100%',maxWidth:480,padding:'28px',border:`1px solid ${T.border}`}}>
        <h3 style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Add user access</h3>
        <p style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:18}}>Grant a user access to <strong style={{color:co.color||T.gold}}>{co.name}</strong>. They will be able to view and manage all properties in this company.</p>

        <div style={{marginBottom:12}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Search user by email</label>
          <input value={search} onChange={e=>{setSearch(e.target.value);setSelectedUser(null)}} autoFocus placeholder="user@example.com"
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
        </div>

        {!selectedUser && (
          <div style={{maxHeight:220,overflowY:'auto',marginBottom:12,background:T.bg,borderRadius:8,border:`1px solid ${T.border}`}}>
            {filtered.length===0 ? <div style={{padding:14,fontFamily:mono,fontSize:11,color:T.muted,textAlign:'center'}}>{search ? 'No matching users' : 'Start typing to search'}</div>
              : filtered.map(u => {
                const n = userName(u)
                return (
                  <div key={u.id} onClick={()=>{setSelectedUser(u);setSearch(u.email)}} style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:28,height:28,borderRadius:14,background:T.gold+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:11,fontWeight:700,color:T.gold,flexShrink:0}}>
                      {userInitial(u)}
                    </div>
                    <div style={{minWidth:0,flex:1}}>
                      {n && <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:1}}>{n}</div>}
                      <div style={{fontFamily:mono,fontSize:11,color:n?T.muted:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</div>
                    </div>
                  </div>
                )
              })}
          </div>
        )}

        {selectedUser && (
          <div style={{background:T.gold+'11',borderRadius:8,padding:'10px 14px',marginBottom:14,fontFamily:mono,fontSize:11,color:T.text,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>Grant access to: <strong style={{color:T.gold}}>{selectedUser.email}</strong></span>
            <button onClick={()=>{setSelectedUser(null);setSearch('')}} style={{background:'none',border:'none',color:T.muted,fontFamily:mono,fontSize:10,cursor:'pointer'}}>change</button>
          </div>
        )}

        <div style={{marginBottom:16,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
          <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.07em'}}>Your admin password</label>
          <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr('')}}
            onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{width:'100%',fontFamily:mono,fontSize:13,background:T.bg,border:`1.5px solid ${err?T.red:T.border}`,color:T.text,borderRadius:8,padding:'10px 14px',outline:'none',boxSizing:'border-box'}}/>
          {err && <div style={{fontFamily:mono,fontSize:11,color:T.red,marginTop:6}}>{err}</div>}
        </div>

        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose} style={{flex:1,fontFamily:mono,fontSize:12,padding:'10px',borderRadius:9,border:'1px solid '+T.border,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
          <button onClick={submit} disabled={saving||!selectedUser||!pw} style={{flex:2,fontFamily:mono,fontSize:12,fontWeight:700,padding:'10px',borderRadius:9,border:'none',background:saving||!selectedUser||!pw?T.border:T.gold,color:'#1A2530',cursor:saving?'wait':'pointer'}}>{saving?'Adding...':'Grant access'}</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGE ACCESS MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function ManageAccessModal({ targetUser, companies, accessRows, setAccessRows, onClose, T }) {
  const ownedIds  = new Set(companies.filter(c => c.owner_email === targetUser.email).map(c => c.id))
  const currentAccessIds = new Set(accessRows.filter(r => r.user_id === targetUser.id).map(r => r.company_id))
  // Pre-check: everything they currently have access to (owned + shared)
  const [selectedIds, setSelectedIds] = useState(() => new Set([...ownedIds, ...currentAccessIds]))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function toggle(companyId) {
    if (ownedIds.has(companyId)) return // can't untick owned
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(companyId)) next.delete(companyId)
      else next.add(companyId)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      // Only shared companies (not owned) get written to user_company_access
      const sharedToGrant = [...selectedIds].filter(id => !ownedIds.has(id))
      await api.setAllCompanyAccess(targetUser.id, targetUser.email, sharedToGrant)
      // Update local state: drop all existing rows for this user, add fresh ones
      setAccessRows(prev => {
        const filtered = prev.filter(r => r.user_id !== targetUser.id)
        const newRows = sharedToGrant.map(cid => ({
          user_id: targetUser.id, company_id: cid, email: targetUser.email, is_admin: false
        }))
        return [...filtered, ...newRows]
      })
      onClose()
    } catch(e) { setError(e.message || 'Failed to save') }
    setSaving(false)
  }

  // Sort: owned first, then others alphabetical
  const sorted = [...companies].sort((a, b) => {
    const ao = ownedIds.has(a.id) ? 0 : 1
    const bo = ownedIds.has(b.id) ? 0 : 1
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  })

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:700,padding:'40px 16px',overflowY:'auto'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,width:'100%',maxWidth:600,padding:'28px 32px'}}>
        <div style={{marginBottom:20}}>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:4,color:T.text}}>Manage company access</h2>
          <p style={{fontFamily:mono,fontSize:12,color:T.muted,lineHeight:1.6}}>
            Grant or revoke access for <span style={{color:T.gold,fontWeight:700}}>{targetUser.email}</span>.
            Owned companies cannot be removed here.
          </p>
        </div>

        <div style={{maxHeight:420,overflowY:'auto',border:`1px solid ${T.border}`,borderRadius:10,marginBottom:16}}>
          {sorted.map(co => {
            const isOwner   = ownedIds.has(co.id)
            const isChecked = selectedIds.has(co.id)
            return (
              <label key={co.id} onClick={()=>toggle(co.id)}
                style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderBottom:`1px solid ${T.border}`,cursor:isOwner?'not-allowed':'pointer',opacity:isOwner?0.75:1}}>
                <input type="checkbox" checked={isChecked} disabled={isOwner} readOnly
                  style={{width:18,height:18,accentColor:co.color||T.gold,margin:0,cursor:isOwner?'not-allowed':'pointer'}}/>
                <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,background:(co.color||'#C8A84B')+'22',color:co.color||'#C8A84B',minWidth:40,textAlign:'center'}}>{co.abbr}</span>
                <span style={{flex:1,fontSize:13,color:T.text}}>{co.name}</span>
                {isOwner && <span style={{fontFamily:mono,fontSize:9,color:T.green,background:T.green+'22',padding:'2px 6px',borderRadius:4,fontWeight:700}}>OWNER</span>}
              </label>
            )
          })}
          {companies.length === 0 && (
            <div style={{padding:24,textAlign:'center',fontFamily:mono,fontSize:12,color:T.muted}}>No companies yet.</div>
          )}
        </div>

        {error && <div style={{fontFamily:mono,fontSize:11,color:T.red,marginBottom:12}}>{error}</div>}

        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{fontFamily:mono,fontSize:12,padding:'9px 20px',borderRadius:10,border:`1px solid ${T.border}`,background:'transparent',color:T.muted,cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{fontFamily:mono,fontSize:12,fontWeight:700,padding:'9px 20px',borderRadius:10,border:'none',background:saving?T.border:T.gold,color:'#1A2530',cursor:saving?'wait':'pointer'}}>
            {saving ? 'Saving…' : 'Save access'}
          </button>
        </div>
      </div>
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
