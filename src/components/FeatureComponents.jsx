import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import BillingPage from './BillingPage'
// Exports: ComplianceTab, TenancyTab, MaintenanceTab, ExpensesTab, SettingsPage, NotesTimeline, OverviewTab, FinancialsTab
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'


const fmt = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n||0)

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000*60*60*24))
}

function ExpiryBadge({dateStr}) {
  const days = daysUntil(dateStr)
  if (days === null) return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>No expiry set</span>
  if (days < 0)   return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:T.red,background:'#2B1010',padding:'2px 8px',borderRadius:20}}>EXPIRED {Math.abs(days)}d ago</span>
  if (days <= 30) return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:T.amber,background:'#2B1A0A',padding:'2px 8px',borderRadius:20}}>Expires in {days}d</span>
  if (days <= 90) return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.amber,background:'#2B1A0A',padding:'2px 8px',borderRadius:20}}>{days}d remaining</span>
  return <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.green,background:'#0D2B1F',padding:'2px 8px',borderRadius:20}}>{days}d remaining</span>
}

// ── COMPLIANCE TAB ────────────────────────────────────────────────────────────
export function ComplianceTab({propertyId, showToast, isAdmin, user}) {
  const { T } = useTheme()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({cert_type:'gas',cert_name:'Gas Safety Certificate',issue_date:'',expiry_date:'',reminder_days:30,notes:''})
  const s = (k,v) => setForm(f=>({...f,[k]:v}))

  const CERT_TYPES = [
    {value:'gas',     label:'Gas Safety Certificate',    icon:'🔥'},
    {value:'eicr',    label:'Electrical Safety (EICR)',   icon:'⚡'},
    {value:'epc',     label:'EPC Rating',                 icon:'🌿'},
    {value:'hmo',     label:'HMO Licence',                icon:'🏠'},
    {value:'fire',    label:'Fire Risk Assessment',        icon:'🔴'},
    {value:'pat',     label:'PAT Testing',                 icon:'🔌'},
    {value:'other',   label:'Other Certificate',           icon:'📄'},
  ]

  useEffect(()=>{ loadItems() },[propertyId])

  async function loadItems() {
    setLoading(true)
    try { setItems(await api.fetchCompliance(propertyId)) }
    catch(e) { }
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.cert_name) return
    try {
      const created = await api.createCompliance(propertyId, form)
      setItems(prev=>[...prev, created])
      setShowForm(false)
      setForm({cert_type:'gas',cert_name:'Gas Safety Certificate',issue_date:'',expiry_date:'',reminder_days:30,notes:''})
      showToast('Certificate added')
    } catch(e) { showToast(e.message,'error') }
  }

  async function handleDelete(id) {
    try { await api.deleteCompliance(id); setItems(prev=>prev.filter(i=>i.id!==id)); showToast('Removed') }
    catch(e) { showToast(e.message,'error') }
  }

  const sorted = [...items].sort((a,b)=>{
    const da = daysUntil(a.expiry_date) ?? 9999
    const db = daysUntil(b.expiry_date) ?? 9999
    return da - db
  })

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Compliance & Certificates</div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowForm(v=>!v)}>+ Add Certificate</button>
      </div>

      {showForm&&<div className="card" style={{padding:'16px 18px',marginBottom:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div>
            <label>Certificate Type</label>
            <select value={form.cert_type} onChange={e=>{
              const t = CERT_TYPES.find(x=>x.value===e.target.value)
              s('cert_type',e.target.value); s('cert_name',t?.label||'')
            }}>
              {CERT_TYPES.map(t=><option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
          </div>
          <div><label>Certificate Name</label><input value={form.cert_name} onChange={e=>s('cert_name',e.target.value)}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Issue Date</label><input type="date" value={form.issue_date} onChange={e=>s('issue_date',e.target.value)}/></div>
          <div><label>Expiry Date</label><input type="date" value={form.expiry_date} onChange={e=>s('expiry_date',e.target.value)}/></div>
          <div><label>Remind (days before)</label><input type="number" value={form.reminder_days} onChange={e=>s('reminder_days',+e.target.value)}/></div>
        </div>
        <div style={{marginBottom:12}}><label>Notes</label><input value={form.notes} onChange={e=>s('notes',e.target.value)} placeholder="Optional notes"/></div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleAdd}>Save</button>
          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setShowForm(false)}>Cancel</button>
        </div>
      </div>}

      {loading ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading…</div>
       : sorted.length===0 ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,padding:'20px 0'}}>No certificates added yet.</div>
       : <div style={{display:'grid',gap:10}}>
          {sorted.map(item=>{
            const ct = CERT_TYPES.find(t=>t.value===item.cert_type)
            return (
              <div key={item.id} className="card" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                <span style={{fontSize:24,flexShrink:0}}>{ct?.icon||'📄'}</span>
                <div style={{flex:1,minWidth:150}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{item.cert_name}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                    Issued: {formatDate(item.issue_date)} · Expires: {formatDate(item.expiry_date)}
                  </div>
                  {item.notes&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint,marginTop:2}}>{item.notes}</div>}
                </div>
                <ExpiryBadge dateStr={item.expiry_date}/>
                <button onClick={()=>handleDelete(item.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'3px 10px',cursor:'pointer'}}>Remove</button>
              </div>
            )
          })}
        </div>
      }
      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user} showToast={showToast} category="compliance"/>
      </div>
    </div>
  )
}

// ── TENANCY TAB ───────────────────────────────────────────────────────────────
export function TenancyTab({propertyId, showToast, fmt, isAdmin, user}) {
  const { T } = useTheme()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const s = (k,v) => setForm(f=>({...f,[k]:v}))

  const DEPOSIT_SCHEMES = ['DPS - Deposit Protection Service','mydeposits','TDS - Tenancy Deposit Scheme','Not registered']

  useEffect(()=>{ loadDetails() },[propertyId])

  async function loadDetails() {
    setLoading(true)
    try {
      const d = await api.fetchTenancyDetails(propertyId)
      setDetails(d)
      setForm(d||{})
    } catch(e) { }
    setLoading(false)
  }

  async function handleSave() {
    try {
      const saved = await api.upsertTenancyDetails(propertyId, form)
      setDetails(saved); setEditing(false)
      showToast('Tenancy details saved')
    } catch(e) { showToast(e.message,'error') }
  }

  const renewalDays = details?.tenancy_end ? daysUntil(details.tenancy_end) : null

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Tenancy Details</div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setEditing(v=>!v)}>{editing?'Cancel':'Edit Details'}</button>
      </div>

      {renewalDays!==null && renewalDays<=60 && (
        <div style={{background:'#2B1A0A',border:'1px solid #5C3A1A',borderRadius:10,padding:'12px 16px',marginBottom:14,fontFamily:"'DM Mono',monospace",fontSize:12,color:T.amber}}>
          ⚠ Tenancy {renewalDays<0?`expired ${Math.abs(renewalDays)} days ago`:`expires in ${renewalDays} days`} — consider renewal action
        </div>
      )}

      {loading ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading…</div>
       : editing ? (
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Tenant Name(s)</label><input value={form.tenant_names||''} onChange={e=>s('tenant_names',e.target.value)} placeholder="e.g. John & Jane Smith"/></div>
            <div><label>Tenant Phone</label><input value={form.tenant_phone||''} onChange={e=>s('tenant_phone',e.target.value)} placeholder="07xxx xxxxxx"/></div>
          </div>
          <div style={{marginBottom:12}}><label>Tenant Email</label><input value={form.tenant_email||''} onChange={e=>s('tenant_email',e.target.value)} placeholder="tenant@email.com"/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Tenancy Start</label><input type="date" value={form.tenancy_start||''} onChange={e=>s('tenancy_start',e.target.value)}/></div>
            <div><label>Tenancy End</label><input type="date" value={form.tenancy_end||''} onChange={e=>s('tenancy_end',e.target.value)}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Deposit Amount (£)</label><input type="number" value={form.deposit_amount||''} onChange={e=>s('deposit_amount',+e.target.value)}/></div>
            <div><label>Deposit Scheme</label><select value={form.deposit_scheme||''} onChange={e=>s('deposit_scheme',e.target.value)}><option value="">Select…</option>{DEPOSIT_SCHEMES.map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label>Deposit Reference</label><input value={form.deposit_ref||''} onChange={e=>s('deposit_ref',e.target.value)}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Rent Review Date</label><input type="date" value={form.rent_review_date||''} onChange={e=>s('rent_review_date',e.target.value)}/></div>
            <div><label>Notice Period</label><input value={form.notice_period||''} onChange={e=>s('notice_period',e.target.value)} placeholder="e.g. 2 months"/></div>
          </div>
          <div style={{marginBottom:12}}><label>Break Clause</label><input value={form.break_clause||''} onChange={e=>s('break_clause',e.target.value)} placeholder="e.g. Break at 12 months with 2 months notice"/></div>
          <div style={{marginBottom:14}}><label>Notes</label><textarea value={form.notes||''} onChange={e=>s('notes',e.target.value)} rows={2} style={{resize:'vertical'}}/></div>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleSave}>Save Tenancy Details</button>
        </div>
       ) : details ? (
        <div style={{display:'grid',gap:10}}>
          {[
            {l:'Tenant(s)',       v:details.tenant_names||'—'},
            {l:'Phone',           v:details.tenant_phone||'—'},
            {l:'Email',           v:details.tenant_email||'—'},
            {l:'Tenancy Start',   v:formatDate(details.tenancy_start)},
            {l:'Tenancy End',     v:formatDate(details.tenancy_end), alert:renewalDays!==null&&renewalDays<=60},
            {l:'Deposit',         v:fmt(details.deposit_amount), sub:details.deposit_scheme},
            {l:'Deposit Ref',     v:details.deposit_ref||'—'},
            {l:'Rent Review',     v:formatDate(details.rent_review_date)},
            {l:'Notice Period',   v:details.notice_period||'—'},
            {l:'Break Clause',    v:details.break_clause||'—'},
          ].map((item,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'10px 14px',background:T.bg,borderRadius:8}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,flexShrink:0,marginRight:16}}>{item.l}</span>
              <div style={{textAlign:'right'}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:600,color:item.alert?T.amber:T.text}}>{item.v}</span>
                {item.sub&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{item.sub}</div>}
              </div>
            </div>
          ))}
          {details.notes&&<div className="card" style={{padding:'12px 14px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:6}}>Notes</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text}}>{details.notes}</div>
          </div>}
        </div>
       ) : (
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,padding:'20px 0'}}>No tenancy details recorded. Click Edit Details to add them.</div>
       )
      }
    </div>
  )
}

// ── MAINTENANCE TAB ───────────────────────────────────────────────────────────
export function MaintenanceTab({propertyId, showToast, fmt, isAdmin, user}) {
  const { T } = useTheme()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editJob, setEditJob] = useState(null)
  const blank = {title:'',description:'',category:'plumbing',priority:'medium',status:'open',contractor:'',contractor_phone:'',quoted_cost:'',actual_cost:'',date_raised:'',date_resolved:'',notes:''}
  const [form, setForm] = useState(blank)
  const s = (k,v) => setForm(f=>({...f,[k]:v}))

  const CATEGORIES = ['plumbing','electrical','structural','appliance','decoration','roofing','damp','other']
  const PRIORITIES = [{v:'low',c:'#6B7191'},{v:'medium',c:T.amber},{v:'high',c:T.red},{v:'urgent',c:'#FF0000'}]
  const STATUSES   = [{v:'open',c:T.red,l:'Open'},{v:'in-progress',c:T.amber,l:'In Progress'},{v:'complete',c:T.green,l:'Complete'}]

  useEffect(()=>{ loadJobs() },[propertyId])

  async function loadJobs() {
    setLoading(true)
    try { setJobs(await api.fetchMaintenance(propertyId)) }
    catch(e) { }
    setLoading(false)
  }

  async function handleSave() {
    if (!form.title) return
    try {
      const data = {...form, quoted_cost:parseFloat(form.quoted_cost)||null, actual_cost:parseFloat(form.actual_cost)||null}
      if (editJob) {
        const updated = await api.updateMaintenance(editJob.id, data)
        setJobs(prev=>prev.map(j=>j.id===editJob.id?updated:j))
        showToast('Job updated')
      } else {
        const created = await api.createMaintenance(propertyId, data)
        setJobs(prev=>[created,...prev])
        showToast('Job added')
      }
      setShowForm(false); setEditJob(null); setForm(blank)
    } catch(e) { showToast(e.message,'error') }
  }

  async function handleDelete(id) {
    try { await api.deleteMaintenance(id); setJobs(prev=>prev.filter(j=>j.id!==id)); showToast('Job removed') }
    catch(e) { showToast(e.message,'error') }
  }

  const openJobs     = jobs.filter(j=>j.status!=='complete')
  const completedJobs= jobs.filter(j=>j.status==='complete')
  const totalCost    = jobs.reduce((s,j)=>s+(j.actual_cost||j.quoted_cost||0),0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Maintenance & Repairs</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint,marginTop:2}}>{openJobs.length} open · Total cost {fmt(totalCost)}</div>
        </div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditJob(null);setForm(blank);setShowForm(v=>!v)}}>+ Log Job</button>
      </div>

      {showForm&&<div className="card" style={{padding:'16px 18px',marginBottom:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Job Title *</label><input value={form.title} onChange={e=>s('title',e.target.value)} placeholder="e.g. Fix leaking tap"/></div>
          <div><label>Category</label><select value={form.category} onChange={e=>s('category',e.target.value)}>{CATEGORIES.map(c=><option key={c} style={{textTransform:'capitalize'}}>{c}</option>)}</select></div>
        </div>
        <div style={{marginBottom:12}}><label>Description</label><textarea value={form.description} onChange={e=>s('description',e.target.value)} rows={2} style={{resize:'vertical'}}/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Priority</label><select value={form.priority} onChange={e=>s('priority',e.target.value)}>{PRIORITIES.map(p=><option key={p.v} value={p.v} style={{textTransform:'capitalize'}}>{p.v}</option>)}</select></div>
          <div><label>Status</label><select value={form.status} onChange={e=>s('status',e.target.value)}>{STATUSES.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}</select></div>
          <div><label>Date Raised</label><input type="date" value={form.date_raised} onChange={e=>s('date_raised',e.target.value)}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Contractor</label><input value={form.contractor} onChange={e=>s('contractor',e.target.value)} placeholder="e.g. Bob's Plumbing"/></div>
          <div><label>Contractor Phone</label><input value={form.contractor_phone} onChange={e=>s('contractor_phone',e.target.value)}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Quoted Cost (£)</label><input type="number" value={form.quoted_cost} onChange={e=>s('quoted_cost',e.target.value)}/></div>
          <div><label>Actual Cost (£)</label><input type="number" value={form.actual_cost} onChange={e=>s('actual_cost',e.target.value)}/></div>
          <div><label>Date Resolved</label><input type="date" value={form.date_resolved} onChange={e=>s('date_resolved',e.target.value)}/></div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleSave}>{editJob?'Update Job':'Add Job'}</button>
          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setShowForm(false);setEditJob(null);setForm(blank)}}>Cancel</button>
        </div>
      </div>}

      {loading ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading…</div>
       : jobs.length===0 ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,padding:'20px 0'}}>No maintenance jobs logged yet.</div>
       : <div>
          {openJobs.length>0&&<div style={{marginBottom:16}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Open Jobs</div>
            {openJobs.map(job=><JobCard key={job.id} job={job} fmt={fmt} onEdit={j=>{setEditJob(j);setForm({...j,quoted_cost:j.quoted_cost||'',actual_cost:j.actual_cost||''});setShowForm(true)}} onDelete={handleDelete} PRIORITIES={PRIORITIES} STATUSES={STATUSES}/>)}
          </div>}
          {completedJobs.length>0&&<div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Completed</div>
            {completedJobs.map(job=><JobCard key={job.id} job={job} fmt={fmt} onEdit={j=>{setEditJob(j);setForm({...j,quoted_cost:j.quoted_cost||'',actual_cost:j.actual_cost||''});setShowForm(true)}} onDelete={handleDelete} PRIORITIES={PRIORITIES} STATUSES={STATUSES}/>)}
          </div>}
        </div>
      }
      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user} showToast={showToast} category="maintenance"/>
      </div>
    </div>
  )
}

function JobCard({job, fmt, onEdit, onDelete, PRIORITIES, STATUSES}) {
  const pCol = PRIORITIES.find(p=>p.v===job.priority)?.c || T.muted
  const st   = STATUSES.find(s=>s.v===job.status)
  return (
    <div className="card" style={{padding:'12px 16px',marginBottom:8}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:150}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:600}}>{job.title}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:pCol,textTransform:'uppercase'}}>{job.priority}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:st?.c||T.muted,background:st?.c+'22',padding:'1px 8px',borderRadius:20}}>{st?.l}</span>
          </div>
          {job.description&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginBottom:3}}>{job.description}</div>}
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint}}>
            {job.contractor&&`Contractor: ${job.contractor}`}
            {job.contractor_phone&&` · ${job.contractor_phone}`}
            {job.date_raised&&` · Raised: ${formatDate(job.date_raised)}`}
            {job.date_resolved&&` · Resolved: ${formatDate(job.date_resolved)}`}
          </div>
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          {(job.actual_cost||job.quoted_cost)&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:700,color:T.gold}}>{fmt(job.actual_cost||job.quoted_cost)}</div>}
          {job.quoted_cost&&job.actual_cost&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>Quoted {fmt(job.quoted_cost)}</div>}
          <div style={{display:'flex',gap:6,marginTop:6,justifyContent:'flex-end'}}>
            <button onClick={()=>onEdit(job)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'transparent',color:T.gold,border:`1px solid ${T.gold}44`,borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Edit</button>
            <button onClick={()=>onDelete(job.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Remove</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── EXPENSES TAB ──────────────────────────────────────────────────────────────
export function ExpensesTab({propertyId, showToast, fmt, rentPcm, isAdmin, user}) {
  const { T } = useTheme()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const blank = {category:'repairs',description:'',amount:'',date:'',recurring:false,recurring_freq:'',notes:''}
  const [form, setForm] = useState(blank)
  const s = (k,v) => setForm(f=>({...f,[k]:v}))

  const CATEGORIES = [
    {v:'insurance',      l:'Insurance'},
    {v:'agent_fees',     l:'Agent / Management Fees'},
    {v:'repairs',        l:'Repairs & Maintenance'},
    {v:'ground_rent',    l:'Ground Rent'},
    {v:'service_charge', l:'Service Charge'},
    {v:'utilities',      l:'Utilities'},
    {v:'mortgage',       l:'Mortgage Payment'},
    {v:'legal',          l:'Legal Fees'},
    {v:'accountancy',    l:'Accountancy'},
    {v:'other',          l:'Other'},
  ]

  useEffect(()=>{ loadExpenses() },[propertyId])

  async function loadExpenses() {
    setLoading(true)
    try { setExpenses(await api.fetchExpenses(propertyId)) }
    catch(e) { }
    setLoading(false)
  }

  async function handleSave() {
    if (!form.description||!form.amount||!form.date) return
    try {
      const created = await api.createExpense(propertyId, {...form, amount:parseFloat(form.amount)})
      setExpenses(prev=>[created,...prev])
      setForm(blank); setShowForm(false)
      showToast('Expense added')
    } catch(e) { showToast(e.message,'error') }
  }

  async function handleDelete(id) {
    try { await api.deleteExpense(id); setExpenses(prev=>prev.filter(e=>e.id!==id)); showToast('Removed') }
    catch(e) { showToast(e.message,'error') }
  }

  const currentYear = new Date().getFullYear()
  const thisYearExp = expenses.filter(e=>new Date(e.date).getFullYear()===currentYear)
  const totalThisYear = thisYearExp.reduce((s,e)=>s+(e.amount||0),0)
  const totalAllTime  = expenses.reduce((s,e)=>s+(e.amount||0),0)
  const annualRent    = rentPcm * 12
  const netProfit     = annualRent - totalThisYear

  return (
    <div>
      {/* Summary */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:14}}>
        {[
          {l:'Expenses This Year', v:fmt(totalThisYear), c:T.red},
          {l:'Annual Rent Income',  v:fmt(annualRent),    c:T.green},
          {l:'Net Profit (Est.)',   v:fmt(netProfit),     c:netProfit>0?T.green:T.red},
        ].map((item,i)=>(
          <div key={i} style={{background:T.bg,borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:17,fontWeight:700,color:item.c}}>{item.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Expense Log</div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowForm(v=>!v)}>+ Add Expense</button>
      </div>

      {showForm&&<div className="card" style={{padding:'16px 18px',marginBottom:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Category</label><select value={form.category} onChange={e=>s('category',e.target.value)}>{CATEGORIES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></div>
          <div><label>Description *</label><input value={form.description} onChange={e=>s('description',e.target.value)} placeholder="e.g. Annual buildings insurance"/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Amount (£) *</label><input type="number" step="0.01" value={form.amount} onChange={e=>s('amount',e.target.value)}/></div>
          <div><label>Date *</label><input type="date" value={form.date} onChange={e=>s('date',e.target.value)}/></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:12,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <input type="checkbox" checked={form.recurring} onChange={e=>s('recurring',e.target.checked)} style={{width:'auto'}}/>
            <label style={{margin:0,cursor:'pointer',textTransform:'none',fontSize:12,letterSpacing:0}}>Recurring expense</label>
          </div>
          {form.recurring&&<select value={form.recurring_freq} onChange={e=>s('recurring_freq',e.target.value)} style={{width:'auto'}}>
            <option value="">Frequency</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </select>}
        </div>
        <div style={{marginBottom:12}}><label>Notes</label><input value={form.notes} onChange={e=>s('notes',e.target.value)}/></div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleSave}>Save Expense</button>
          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setShowForm(false)}>Cancel</button>
        </div>
      </div>}

      {loading ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading…</div>
       : expenses.length===0 ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,padding:'20px 0'}}>No expenses logged yet.</div>
       : <div style={{display:'grid',gap:8}}>
          {expenses.map(exp=>{
            const cat = CATEGORIES.find(c=>c.v===exp.category)
            return (
              <div key={exp.id} className="card" style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:150}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{exp.description}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                    {cat?.l} · {formatDate(exp.date)}
                    {exp.recurring&&<span style={{marginLeft:6,color:T.blue}}>↻ {exp.recurring_freq}</span>}
                  </div>
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:700,color:T.red}}>{fmt(exp.amount)}</div>
                <button onClick={()=>handleDelete(exp.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'3px 10px',cursor:'pointer'}}>Remove</button>
              </div>
            )
          })}
        </div>
      }
      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user} showToast={showToast} category="expenses"/>
      </div>
    </div>
  )
}

// ── SETTINGS PAGE ─────────────────────────────────────────────────────────────
export function SettingsPage({companies, companySettings, setCompanySettings, user, showToast, isAdmin, isPlatformAdmin, darkMode, setDarkMode, userNavPrefs, setUserNavPrefs}) {
  const { T } = useTheme()
  const [saving, setSaving] = useState(null)
  const [showAccessModal, setShowAccessModal] = useState(false)
  const [settingsTab, setSettingsTab] = useState('account')

  // ── Account state ──────────────────────────────────────────────────────────
  const [fullName, setFullName]             = useState('')
  const [phone, setPhone]                   = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [milestoneConfig, setMilestoneConfig] = useState({})
  const [milestoneLoading, setMilestoneLoading] = useState(false)
  const [profileSaving, setProfileSaving]   = useState(false)
  const [newEmail, setNewEmail]             = useState('')
  const [emailSaving, setEmailSaving]       = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving]             = useState(false)
  const [showPw, setShowPw]                 = useState(false)
  const [notifSaving, setNotifSaving]       = useState(false)
  const [notifs, setNotifs] = useState({
    rent_arrears: true, lease_expiry: true, compliance_expiry: true,
    vacant_properties: true, weekly_summary: false,
  })

  useEffect(() => { loadProfile() }, [])

  async function loadProfile() {
    setProfileLoading(true)
    try {
      const data = await api.fetchUserProfile(user?.id)
      if (data) {
        setFullName(data.full_name || '')
        setPhone(data.phone || '')
        if (data.notifications) setNotifs(prev => ({ ...prev, ...data.notifications }))
      }
      const mc = await api.fetchMilestoneDefaults(user?.id)
      setMilestoneConfig(mc || {})
    } catch(e) {}
    setProfileLoading(false)
  }

  async function saveProfile() {
    setProfileSaving(true)
    try {
      await api.upsertUserProfile(user?.id, user?.email, { full_name: fullName, phone })
      showToast('Profile saved')
    } catch(e) { showToast(e.message, 'error') }
    setProfileSaving(false)
  }

  async function saveNotifications() {
    setNotifSaving(true)
    try {
      await api.upsertUserProfile(user?.id, user?.email, { notifications: notifs })
      showToast('Notification preferences saved')
    } catch(e) { showToast(e.message, 'error') }
    setNotifSaving(false)
  }

  async function updateEmail() {
    if (!newEmail.trim()) return
    setEmailSaving(true)
    try {
      await api.updateUserEmail(newEmail.trim())
      showToast('Confirmation sent to ' + newEmail + ' — check your inbox')
      setNewEmail('')
    } catch(e) { showToast(e.message, 'error') }
    setEmailSaving(false)
  }

  async function updatePassword() {
    if (!newPassword) return
    if (newPassword !== confirmPassword) { showToast('Passwords do not match', 'error'); return }
    if (newPassword.length < 8) { showToast('Password must be at least 8 characters', 'error'); return }
    setPwSaving(true)
    try {
      await api.updateUserPassword(currentPassword, newPassword, user?.email)
      showToast('Password updated successfully')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch(e) { showToast(e.message, 'error') }
    setPwSaving(false)
  }

  async function sendResetEmail() {
    try {
      await api.sendPasswordReset(user?.email)
      showToast('Reset email sent to ' + user?.email)
    } catch(e) { showToast(e.message, 'error') }
  }

  const FEATURES = [
    {key:'feature_compliance',  label:'Compliance & Certificates', desc:'Track gas safety, EICR, EPC, HMO licences and other certificates with expiry alerts', icon:'📋'},
    {key:'feature_tenancy',     label:'Tenancy Details',           desc:'Store tenant contact details, deposit info, rent review dates and break clauses', icon:'🤝'},
    {key:'feature_maintenance', label:'Maintenance & Repairs',     desc:'Log repair jobs with contractor details, costs and status tracking', icon:'🔧'},
    {key:'feature_documents',   label:'Document Storage',          desc:'Upload and store tenancy agreements, certificates and other documents', icon:'📁'},
    {key:'feature_expenses',    label:'Expenses Tracker',          desc:'Track all property expenses to calculate true net profit per property', icon:'💰'},
    {key:'feature_reports',     label:'Reports & Export',          desc:'Generate P&L reports and export data to CSV for your accountant', icon:'📊'},
    {key:'feature_statements',  label:'Statement Importer',        desc:'Upload PNE and RMS rental statements to automatically log rent payments, management fees and maintenance costs', icon:'📄'},
  ]

  async function toggleFeature(companyId, featureKey, currentValue) {
    setSaving(`${companyId}-${featureKey}`)
    try {
      const current = companySettings[companyId] || {}
      const updated = { ...current, [featureKey]: !currentValue }
      const saved = await api.upsertCompanySettings(companyId, updated)
      setCompanySettings(prev=>({...prev, [companyId]: saved || updated}))
      showToast('Settings saved')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  const mono = "'DM Mono',monospace"
  const sectionStyle = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 28px', marginBottom: 16 }
  const fieldStyle = { marginBottom: 14 }
  const labelStyle = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }

  const ALL_NAV_OPTIONS = [
    {key:'companies',   label:'Companies',    icon:'🏢'},
    {key:'rent',        label:'Rent Tracker', icon:'💷'},
    {key:'deals',       label:'Deals',        icon:'🎯'},
    {key:'reports',     label:'Reports',      icon:'📊'},
    {key:'contractors', label:'Contractors',  icon:'🔧'},
  ]

  const ALL_DEFAULT_NAV = ['dashboard','properties','companies','rent','deals','reports','contractors','settings']
  async function saveNavPref(key, enabled) {
    const current = (userNavPrefs||[]).length > 0 ? userNavPrefs : ALL_DEFAULT_NAV
    const next = enabled
      ? [...current, key].filter((v,i,a)=>a.indexOf(v)===i)
      : current.filter(k=>k!==key)
    if(setUserNavPrefs) setUserNavPrefs(next)
    try {
      await supabase.from('user_profiles').upsert(
        { user_id: user?.id, email: user?.email, nav_items: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      showToast('Navigation updated')
    } catch(e) { showToast(e.message,'error') }
  }

  const settingsTabs = [
    { key: 'account',       label: '👤 Account' },
    { key: 'appearance',    label: '🎨 Appearance' },
    { key: 'billing',       label: '💳 Billing' },
    { key: 'navbar',        label: '🧭 Navigation' },
    { key: 'branding',      label: '🎨 Company Branding' },
    { key: 'branding',      label: '🎨 Branding & Logos' },
    { key: 'milestones',    label: '📍 Deal Milestones' },
    ...(isPlatformAdmin ? [{ key: 'admin', label: '🔐 Platform Admin' }] : []),
    { key: 'features',      label: '⚙ Features' },
    { key: 'notifications', label: '🔔 Notifications' },
  ]

  return (
    <div className="fade">
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Settings</h1>
        <p style={{fontFamily:mono,color:T.muted,fontSize:12}}>Manage your account, appearance and property features.</p>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:6,marginBottom:24,borderBottom:`1px solid ${T.border}`,paddingBottom:0,flexWrap:'wrap'}}>
        {settingsTabs.map(t=>(
          <button key={t.key} onClick={()=>setSettingsTab(t.key)} style={{
            fontFamily:mono, fontSize:11, padding:'8px 16px', borderRadius:'8px 8px 0 0',
            background: settingsTab===t.key ? T.card : 'transparent',
            color: settingsTab===t.key ? T.gold : T.muted,
            border: `1px solid ${settingsTab===t.key ? T.border : 'transparent'}`,
            borderBottom: settingsTab===t.key ? `1px solid ${T.card}` : 'transparent',
            cursor:'pointer', transition:'all 0.15s', marginBottom:-1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── ACCOUNT TAB ── */}
      {settingsTab==='account' && (
        profileLoading
          ? <div style={{fontFamily:mono,color:T.muted,fontSize:12}}>Loading…</div>
          : <>
            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Personal Information</div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Full Name</label>
                <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your full name"/>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Phone Number</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 000000"/>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Email Address</label>
                <input value={user?.email||''} disabled style={{opacity:0.5,cursor:'not-allowed'}}/>
                <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:5}}>To change your email go to the Security section below.</div>
              </div>
              <button className="btn btn-gold" onClick={saveProfile} disabled={profileSaving} style={{marginTop:8}}>
                {profileSaving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>

            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Change Email Address</div>
              <div style={fieldStyle}>
                <label style={labelStyle}>New Email Address</label>
                <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder={user?.email} type="email"/>
              </div>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginBottom:12,lineHeight:1.6}}>A confirmation link will be sent to both addresses. The change takes effect once confirmed.</div>
              <button className="btn btn-gold" onClick={updateEmail} disabled={emailSaving||!newEmail.trim()}>
                {emailSaving ? 'Sending…' : 'Update Email'}
              </button>
            </div>

            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Change Password</div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Current Password</label>
                <input value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} type={showPw?'text':'password'} placeholder="Your current password"/>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>New Password</label>
                <input value={newPassword} onChange={e=>setNewPassword(e.target.value)} type={showPw?'text':'password'} placeholder="At least 8 characters"/>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Confirm New Password</label>
                <input value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} type={showPw?'text':'password'} placeholder="Repeat new password"/>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                <input type="checkbox" id="showpwS" checked={showPw} onChange={e=>setShowPw(e.target.checked)} style={{width:'auto',margin:0}}/>
                <label htmlFor="showpwS" style={{fontFamily:mono,fontSize:10,color:T.muted,cursor:'pointer',margin:0}}>Show passwords</label>
              </div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <button className="btn btn-gold" onClick={updatePassword} disabled={pwSaving||!currentPassword||!newPassword||!confirmPassword}>
                  {pwSaving ? 'Updating…' : 'Update Password'}
                </button>
                <button className="btn btn-ghost" onClick={sendResetEmail} style={{fontSize:11}}>Send Reset Email Instead</button>
              </div>
            </div>

            <div style={sectionStyle}>
                <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>App Tour</div>
                <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:12}}>Replay the getting started tour at any time.</div>
                <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>window.dispatchEvent(new CustomEvent('ownproperly:restart-tour'))}>▶ Replay tour</button>
              </div>

            {isAdmin&&(
              <div style={sectionStyle}>
                <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>User Access</div>
                <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:12}}>Signed in as <span style={{color:T.gold}}>{user?.email}</span></div>
                <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setShowAccessModal(true)}>⚙ Manage User Access</button>
              </div>
            )}
          </>
      )}

      {/* ── APPEARANCE TAB ── */}
      {settingsTab==='appearance' && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Theme</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:2}}>Colour Mode</div>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{darkMode?'Dark mode — easier on the eyes':'Light mode — clean and bright'}</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={async()=>{setDarkMode(true);try{await api.upsertUserProfile(user?.id,user?.email,{dark_mode:true})}catch(e){}}}
                style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                  border:`1px solid ${darkMode?T.gold:T.border}`,
                  background:darkMode?T.gold+'22':'transparent',
                  color:darkMode?T.gold:T.muted,transition:'all 0.2s'}}>
                🌙 Dark
              </button>
              <button onClick={async()=>{setDarkMode(false);try{await api.upsertUserProfile(user?.id,user?.email,{dark_mode:false})}catch(e){}}}
                style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                  border:`1px solid ${!darkMode?T.gold:T.border}`,
                  background:!darkMode?T.gold+'22':'transparent',
                  color:!darkMode?T.gold:T.muted,transition:'all 0.2s'}}>
                ☀️ Light
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {settingsTab==='notifications' && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>Alert Preferences</div>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginBottom:16,lineHeight:1.6}}>Control which alerts appear in your Smart Alerts dashboard panel.</div>
          {[
            {key:'rent_arrears',      label:'Rent Arrears',      desc:'Alert when a property has overdue rent'},
            {key:'lease_expiry',      label:'Lease Expiry',      desc:'Alert when tenancy agreements are expiring'},
            {key:'compliance_expiry', label:'Compliance Expiry', desc:'Alert for gas, electrical, EPC certificates nearing expiry'},
            {key:'vacant_properties', label:'Vacant Properties', desc:'Alert when properties are sitting vacant'},
            {key:'weekly_summary',    label:'Weekly Summary',    desc:'Receive a weekly portfolio summary email (coming soon)'},
          ].map(item=>(
            <div key={item.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:`1px solid ${T.border}`}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{item.label}</div>
                <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{item.desc}</div>
              </div>
              <div onClick={()=>setNotifs(n=>({...n,[item.key]:!n[item.key]}))} style={{
                width:42,height:24,borderRadius:12,cursor:'pointer',transition:'background 0.2s',flexShrink:0,
                background:notifs[item.key]?T.gold:T.border,position:'relative',marginLeft:16,
              }}>
                <div style={{position:'absolute',top:3,left:notifs[item.key]?21:3,width:18,height:18,
                  borderRadius:9,background:'white',transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}/>
              </div>
            </div>
          ))}
          <button className="btn btn-gold" onClick={saveNotifications} disabled={notifSaving} style={{marginTop:20}}>
            {notifSaving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>
      )}

      {/* ── FEATURES TAB ── */}
      {settingsTab==='features' && <>
      {companies.map(company=>{
        const settings = companySettings[company.id] || {}
        return (
          <div key={company.id} className="card" style={{padding:'22px 26px',marginBottom:16,borderLeft:`3px solid ${company.color}`}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:company.color,background:company.color+'22',padding:'3px 10px',borderRadius:4}}>{company.abbr}</div>
              <h2 style={{fontSize:17,fontWeight:700}}>{company.name}</h2>
            </div>

            <div style={{display:'grid',gap:12}}>
              {FEATURES.map(feature=>{
                const isOn = settings[feature.key] !== false
                const isSaving = saving===`${company.id}-${feature.key}`
                return (
                  <div key={feature.key} style={{display:'flex',alignItems:'center',gap:16,padding:'14px 16px',background:T.bg,borderRadius:10,flexWrap:'wrap'}}>
                    <span style={{fontSize:20,flexShrink:0}}>{feature.icon}</span>
                    <div style={{flex:1,minWidth:200}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{feature.label}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{feature.desc}</div>
                    </div>
                    {/* Toggle switch */}
                    <div onClick={()=>!isSaving&&toggleFeature(company.id, feature.key, isOn)}
                      style={{
                        width:44, height:24, borderRadius:12, cursor:'pointer',
                        background: isOn ? company.color : T.faint,
                        position:'relative', transition:'background 0.2s', flexShrink:0,
                        opacity: isSaving ? 0.6 : 1,
                      }}>
                      <div style={{
                        width:18, height:18, borderRadius:'50%', background:'white',
                        position:'absolute', top:3,
                        left: isOn ? 23 : 3,
                        transition:'left 0.2s',
                        boxShadow:'0 1px 3px rgba(0,0,0,0.3)',
                      }}/>
                    </div>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:isOn?company.color:T.muted,fontWeight:600,width:20,flexShrink:0}}>
                      {isSaving?'…':isOn?'ON':'OFF'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      </>}

      {settingsTab==='billing' && (
        <BillingPage companies={companies} user={user} isPlatformAdmin={isPlatformAdmin}/>
      )}

      {settingsTab==='navbar' && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Navigation bar</div>
          <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:16}}>Choose which sections appear in your navigation. Dashboard, Properties and Settings are always shown.</div>
          <div style={{display:'grid',gap:10}}>
            {ALL_NAV_OPTIONS.map(item=>{
              const enabled = (userNavPrefs||[]).includes(item.key)
              return (
                <div key={item.key} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',background:T.bg,borderRadius:10,border:`1px solid ${T.border}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <span style={{fontSize:18}}>{item.icon}</span>
                    <span style={{fontFamily:mono,fontSize:13,color:T.text}}>{item.label}</span>
                  </div>
                  <div onClick={()=>saveNavPref(item.key,!enabled)}
                    style={{width:44,height:24,borderRadius:12,background:enabled?T.gold:T.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
                    <div style={{position:'absolute',top:3,left:enabled?22:3,width:18,height:18,borderRadius:9,background:'white',transition:'left 0.2s'}}/>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {settingsTab==='admin' && isPlatformAdmin && (
        <AdminSettingsPanel user={user} T={T} showToast={showToast}/>
      )}

      {settingsTab==='branding' && (
        <BrandingSettingsPanel
          companies={companies}
          companySettings={companySettings}
          setCompanySettings={setCompanySettings}
          user={user}
          showToast={showToast}
          T={T}
        />
      )}

      {settingsTab==='branding' && (
        <BrandingPanel companies={companies} companySettings={companySettings} setCompanySettings={setCompanySettings} user={user} showToast={showToast} T={T}/>
      )}

      {settingsTab==='milestones' && (
        <MilestoneSettingsPanel
          user={user}
          config={milestoneConfig}
          onChange={setMilestoneConfig}
          showToast={showToast}
          T={T}
        />
      )}

      {showAccessModal&&<AccessModal companies={companies} onClose={()=>setShowAccessModal(false)} showToast={showToast}/>}
    </div>
  )
}

// ── NOTES TIMELINE ───────────────────────────────────────────────────────────
export function NotesTimeline({propertyId, isAdmin, user, showToast, setProperties, category, compact}) {
  const { T } = useTheme()
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    if (!propertyId) return
    setLoading(true)
    let q = supabase.from('property_notes').select('*').eq('property_id', propertyId)
    if (category) q = q.eq('category', category)
    q.order('created_at', {ascending:false})
      .then(({data})=>{ setNotes(data||[]); setLoading(false) })
      .catch(()=>setLoading(false))
  },[propertyId, category])

  async function handleSave() {
    if (!newNote.trim() || !user) return
    setSaving(true)
    try {
      const data = await api.createNote(propertyId, newNote.trim(), category||'general', user.id, user.email)
      setNotes(prev=>[data,...prev])
      setNewNote('')
      if (showToast) showToast('Note saved')
    } catch(e) {
      if (showToast) showToast(e.message, 'error')
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    try {
      await api.deleteNote(id)
      setNotes(prev=>prev.filter(n=>n.id!==id))
    } catch(e) {}
  }

  function formatDate(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) +
      ' ' + new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
  }

  return (
    <div style={{background:T.card,borderRadius:12,padding:'16px 20px',border:`1px solid ${T.border}`}}>
      {!compact&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>
        {category ? category.charAt(0).toUpperCase()+category.slice(1)+' Notes' : 'Notes Timeline'}
      </div>}
      {isAdmin&&<>
        <textarea value={newNote} onChange={e=>setNewNote(e.target.value)}
          placeholder="Add a note about this property..."
          style={{width:'100%',minHeight:72,resize:'vertical',marginBottom:8,fontSize:12}}/>
        <button className="btn btn-gold" style={{fontSize:11,marginBottom:16}} onClick={handleSave} disabled={saving}>
          {saving?'Saving...':'+ Save Note'}
        </button>
      </>}
      {loading
        ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading...</div>
        : notes.length===0
          ? <div style={{fontFamily:"'DM Mono',monospace",color:T.faint,fontSize:11}}>No notes yet.</div>
          : <div style={{display:'grid',gap:10}}>
              {notes.map(n=>(
                <div key={n.id} style={{background:T.bg,borderRadius:8,padding:'10px 14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6,flexWrap:'wrap',gap:6}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.gold}}>{n.user_email}</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{formatDate(n.created_at)}</span>
                    </div>
                    {isAdmin&&<button onClick={()=>handleDelete(n.id)}
                      style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>
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


// ── DOCUMENTS TAB ────────────────────────────────────────────────────────────
const DOC_CATEGORIES = [
  {value:'tenancy',     label:'Tenancy Agreement',  icon:'📝'},
  {value:'gas',         label:'Gas Safety',          icon:'🔥'},
  {value:'eicr',        label:'EICR / Electric',     icon:'⚡'},
  {value:'epc',         label:'EPC',                 icon:'🏠'},
  {value:'insurance',   label:'Insurance',           icon:'🛡'},
  {value:'mortgage',    label:'Mortgage',            icon:'🏦'},
  {value:'inventory',   label:'Inventory',           icon:'📋'},
  {value:'legal',       label:'Legal',               icon:'⚖️'},
  {value:'maintenance', label:'Maintenance',         icon:'🔧'},
  {value:'other',       label:'Other',               icon:'📄'},
]

export function DocumentsTab({propertyId, propertyName, showToast, isAdmin, user}) {
  const { T } = useTheme()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('other')
  const [filterCategory, setFilterCategory] = useState('all')
  const [docName, setDocName] = useState('')
  const fileInputRef = useState(null)
  const inputRef = { current: null }

  useEffect(()=>{ loadDocs() },[propertyId])

  async function loadDocs() {
    setLoading(true)
    try {
      const {data} = await supabase.from('property_documents')
        .select('*').eq('property_id', propertyId)
        .order('created_at', {ascending:false})
      setDocs(data||[])
    } catch(e) { }
    setLoading(false)
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return
    setUploading(true)
    let uploaded = 0

    for (const file of Array.from(files)) {
      try {
        const {data:{user:u}} = await supabase.auth.getUser()
        const ext = file.name.split('.').pop()
        const filePath = `${u.id}/${propertyId}/${Date.now()}-${file.name}`

        // Upload to Supabase Storage
        const {data:uploadData, error:uploadErr} = await supabase.storage
          .from('property-documents')
          .upload(filePath, file, {cacheControl:'3600', upsert:false})

        if (uploadErr) throw uploadErr

        // Get public URL
        const {data:{publicUrl}} = supabase.storage
          .from('property-documents')
          .getPublicUrl(filePath)

        // Save record to DB
        const {error:dbErr} = await supabase.from('property_documents').insert({
          property_id: propertyId,
          user_id: u.id,
          name: docName || file.name,
          file_url: publicUrl,
          file_path: filePath,
          file_type: file.type,
          file_size: file.size,
          category: selectedCategory,
        })

        if (dbErr) throw dbErr
        uploaded++
      } catch(e) {
        showToast('Upload failed: ' + e.message, 'error')
      }
    }

    if (uploaded > 0) {
      showToast(uploaded + ' document' + (uploaded>1?'s':'') + ' uploaded')
      setDocName('')
      await loadDocs()
    }
    setUploading(false)
  }

  async function handleDelete(doc) {
    try {
      // Delete from storage
      if (doc.file_path) {
        await supabase.storage.from('property-documents').remove([doc.file_path])
      }
      // Delete from DB

      setDocs(prev=>prev.filter(d=>d.id!==doc.id))
      showToast('Document deleted')
    } catch(e) {
      showToast(e.message, 'error')
    }
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB'
    return (bytes/(1024*1024)).toFixed(1) + ' MB'
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
  }

  function getCatInfo(val) {
    return DOC_CATEGORIES.find(c=>c.value===val) || DOC_CATEGORIES[DOC_CATEGORIES.length-1]
  }

  const filtered = filterCategory==='all' ? docs : docs.filter(d=>d.category===filterCategory)
  const byCategory = DOC_CATEGORIES.reduce((acc,cat)=>{
    const catDocs = filtered.filter(d=>d.category===cat.value)
    if (catDocs.length>0) acc[cat.value] = catDocs
    return acc
  },{})

  return (
    <div>
      {/* Upload area */}
      {isAdmin&&<div
        onDrop={e=>{e.preventDefault();setDragOver(false);handleUpload(e.dataTransfer.files)}}
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>inputRef.current?.click()}
        style={{
          border:`2px dashed ${dragOver?T.gold:T.border}`,
          borderRadius:12,padding:'24px 20px',textAlign:'center',
          cursor:'pointer',marginBottom:16,transition:'all 0.2s',
          background:dragOver?T.gold+'11':'transparent'
        }}>
        <div style={{fontSize:28,marginBottom:8}}>📁</div>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>
          {uploading?'Uploading...':'Drop files here or click to browse'}
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:12}}>
          PDF, images, Word docs — any file type accepted
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
          <select value={selectedCategory} onChange={e=>{e.stopPropagation();setSelectedCategory(e.target.value)}}
            onClick={e=>e.stopPropagation()}
            style={{fontSize:11,padding:'4px 8px',width:'auto'}}>
            {DOC_CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <input value={docName} onChange={e=>{e.stopPropagation();setDocName(e.target.value)}}
            onClick={e=>e.stopPropagation()}
            placeholder="Custom name (optional)"
            style={{fontSize:11,padding:'4px 8px',width:180}}/>
        </div>
        <input ref={el=>inputRef.current=el} type="file" multiple accept="*/*"
          style={{display:'none'}} onChange={e=>handleUpload(e.target.files)}/>
      </div>}

      {/* Filter bar */}
      {docs.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
        <button onClick={()=>setFilterCategory('all')}
          style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
            border:`1px solid ${filterCategory==='all'?T.gold:T.border}`,
            background:filterCategory==='all'?T.gold+'22':'transparent',
            color:filterCategory==='all'?T.gold:T.muted}}>
          All ({docs.length})
        </button>
        {DOC_CATEGORIES.filter(c=>docs.some(d=>d.category===c.value)).map(c=>(
          <button key={c.value} onClick={()=>setFilterCategory(c.value)}
            style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
              border:`1px solid ${filterCategory===c.value?T.gold:T.border}`,
              background:filterCategory===c.value?T.gold+'22':'transparent',
              color:filterCategory===c.value?T.gold:T.muted}}>
            {c.icon} {c.label} ({docs.filter(d=>d.category===c.value).length})
          </button>
        ))}
      </div>}

      {/* Document list */}
      {loading
        ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading...</div>
        : filtered.length===0
          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,textAlign:'center',padding:32,
              background:T.bg,borderRadius:12}}>
              No documents yet. Upload tenancy agreements, certificates and other files here.
            </div>
          : <div style={{display:'grid',gap:8}}>
              {filtered.map(doc=>{
                const cat = getCatInfo(doc.category)
                const isPDF = doc.file_type?.includes('pdf') || doc.name?.endsWith('.pdf')
                const isImage = doc.file_type?.includes('image')
                return (
                  <div key={doc.id} style={{background:T.bg,borderRadius:10,padding:'12px 16px',
                    display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',
                    border:`1px solid ${T.border}`}}>
                    {/* Icon */}
                    <div style={{fontSize:24,flexShrink:0}}>
                      {isPDF?'📄':isImage?'🖼':cat.icon}
                    </div>
                    {/* Info */}
                    <div style={{flex:1,minWidth:150}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{doc.name}</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,
                          background:T.gold+'22',padding:'1px 6px',borderRadius:20}}>
                          {cat.icon} {cat.label}
                        </span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                          {formatDate(doc.created_at)}
                        </span>
                        {doc.file_size&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint}}>
                          {formatSize(doc.file_size)}
                        </span>}
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{display:'flex',gap:6,flexShrink:0}}>
                      <a href={doc.file_url} target="_blank" rel="noreferrer"
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',
                          background:T.surface,color:T.gold,border:`1px solid ${T.gold}44`,
                          borderRadius:8,cursor:'pointer',textDecoration:'none'}}>
                        ⬇ View
                      </a>
                      {isAdmin&&<button onClick={()=>handleDelete(doc)}
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 10px',
                          background:'#2B1010',color:T.red,border:`1px solid #3D1A1A`,
                          borderRadius:8,cursor:'pointer'}}>
                        Delete
                      </button>}
                    </div>
                  </div>
                )
              })}
            </div>
      }

      {/* Notes for this tab */}
      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user}
          showToast={showToast} category="documents"/>
      </div>
    </div>
  )
}


// ── OVERVIEW TAB ─────────────────────────────────────────────────────────────
export function OverviewTab({selected, fmt, calcMonthlyMortgage, calcGrossYield, isAdmin, user, showToast}) {
  const { T } = useTheme()
  const [allNotes, setAllNotes] = useState([])
  const [loading, setLoading] = useState(true)

  const CATEGORIES = {
    general:     {label:'General',     color:'#C8A84B', icon:'📝'},
    rent:        {label:'Rent',        color:'#2ECC8A', icon:'💷'},
    refurb:      {label:'Refurb',      color:'#4B8FE0', icon:'🔨'},
    financials:  {label:'Financials',  color:'#9B59B6', icon:'💰'},
    compliance:  {label:'Compliance',  color:'#E0943A', icon:'📋'},
    tenancy:     {label:'Tenancy',     color:'#2ECC8A', icon:'🤝'},
    maintenance: {label:'Maintenance', color:'#E05555', icon:'🔧'},
    expenses:    {label:'Expenses',    color:'#E05555', icon:'📊'},
  }

  useEffect(()=>{
    setLoading(true)
    api.fetchNotes(selected.id, null)
      .then(data=>{ setAllNotes(data||[]); setLoading(false) })
      .catch(()=>setLoading(false))
  },[selected.id])

  async function deleteNote(id) {
    await api.deleteNote(id)
    setAllNotes(prev=>prev.filter(n=>n.id!==id))
  }

  function formatDate(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) +
      ' at ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
  }

  const mortgage = calcMonthlyMortgage(selected)
  const yield_ = calcGrossYield(selected)

  return (
    <div>
      {/* Quick stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
        {[
          {l:'Purchase Price',   v:fmt(selected.purchase_price),    c:'#C8A84B'},
          {l:'Estimated Value',  v:fmt(selected.est_value),         c:'#C8A84B'},
          {l:'Gross Yield',      v:yield_>0?yield_.toFixed(1)+'%':'—', c:'#2ECC8A'},
          {l:'Monthly Rent',     v:fmt(selected.rent_pcm),          c:'#2ECC8A'},
          {l:'Monthly Mortgage', v:mortgage>0?fmt(mortgage):'—',    c:'#9B59B6'},
          {l:'Arrears',          v:fmt(selected.arrears||0),        c:(selected.arrears||0)>0?'#E05555':'#2ECC8A'},
        ].map((item,i)=>(
          <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:17,fontWeight:700,color:item.c}}>{item.v}</div>
          </div>
        ))}
      </div>

      {/* Property notes */}
      {selected.notes&&<div className="card" style={{padding:'14px 18px',marginBottom:16,borderLeft:`3px solid ${T.gold}`}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Property Description</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
      </div>}

      {/* All notes timeline */}
      <div className="card" style={{padding:'16px 20px'}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>
          All Notes — {allNotes.length} total
        </div>

        {loading
          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading…</div>
          : allNotes.length===0
            ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint}}>No notes yet. Add notes from any tab.</div>
            : <div style={{display:'grid',gap:10}}>
                {allNotes.map(n=>{
                  const cat = CATEGORIES[n.category||'general'] || CATEGORIES.general
                  return (
                    <div key={n.id} style={{background:T.bg,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${cat.color}`}}>
                      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                          {/* Category tag */}
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,
                            color:cat.color,background:cat.color+'22',
                            padding:'2px 8px',borderRadius:20,display:'flex',alignItems:'center',gap:3}}>
                            {cat.icon} {cat.label}
                          </span>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.gold,background:T.gold+'22',padding:'2px 8px',borderRadius:20}}>{n.user_email}</span>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{formatDate(n.created_at)}</span>
                        </div>
                        {isAdmin&&<button onClick={()=>deleteNote(n.id)}
                          style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:'#E05555',border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer',flexShrink:0}}>
                          Delete
                        </button>}
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{n.note}</div>
                    </div>
                  )
                })}
              </div>
        }

        {/* Add a general note from overview */}
        <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${T.border}`}}>
          <NotesTimeline propertyId={selected.id} isAdmin={isAdmin} user={user} showToast={showToast} category="general" compact={true}/>
        </div>
      </div>
    </div>
  )
}

// ── FINANCIALS TAB ────────────────────────────────────────────────────────────
export function FinancialsTab({selected, fmt, calcMonthlyMortgage, calcGrossYield, calcMonthlyProfit, isAdmin, user, showToast}) {
  const { T } = useTheme()
  const mortgage = calcMonthlyMortgage(selected)
  const yield_ = calcGrossYield(selected)
  const monthlyProfit = calcMonthlyProfit(selected)
  const totalInvested = (selected.purchase_price||0)+(selected.refurb_cost||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)
  const equity = (selected.est_value||0)-(selected.mortgage_amount||0)
  const ltv = selected.est_value ? (((selected.mortgage_amount||0)/selected.est_value)*100).toFixed(1) : '—'

  const sections = [
    {title:'Purchase & Costs', items:[
      {l:'Purchase Price',    v:fmt(selected.purchase_price)},
      {l:'Deposit',          v:fmt(selected.deposit)},
      {l:'Refurb Cost',      v:fmt(selected.refurb_cost)},
      {l:'Stamp Duty',       v:fmt(selected.stamp_duty)},
      {l:'Legal Fees',       v:fmt(selected.legal_fees)},
      {l:'Total Invested',   v:fmt(totalInvested), bold:true, color:'#C8A84B'},
    ]},
    {title:'Mortgage', items:[
      {l:'Mortgage Amount',  v:fmt(selected.mortgage_amount)},
      {l:'Mortgage Rate',    v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'—'},
      {l:'Mortgage Term',    v:selected.mortgage_term?`${selected.mortgage_term} years`:'—'},
      {l:'Monthly Payment',  v:mortgage>0?fmt(mortgage):'—'},
      {l:'Annual Payments',  v:mortgage>0?fmt(mortgage*12):'—'},
      {l:'Loan to Value',    v:ltv!=='—'?ltv+'%':'—', color:'#9B59B6'},
    ]},
    {title:'Returns', items:[
      {l:'Estimated Value',  v:fmt(selected.est_value), color:'#C8A84B'},
      {l:'Equity',           v:fmt(equity), color:equity>0?'#2ECC8A':'#E05555'},
      {l:'Monthly Rent',     v:fmt(selected.rent_pcm), color:'#2ECC8A'},
      {l:'Annual Rent',      v:fmt((selected.rent_pcm||0)*12), color:'#2ECC8A'},
      {l:'Gross Yield',      v:yield_>0?yield_.toFixed(2)+'%':'—', color:'#2ECC8A'},
      {l:'Monthly Profit',   v:monthlyProfit>0?fmt(monthlyProfit):'—', color:monthlyProfit>0?'#2ECC8A':'#E05555'},
    ]},
  ]

  return (
    <div>
      <div style={{display:'grid',gap:12,marginBottom:20}}>
        {sections.map((section,si)=>(
          <div key={si} className="card" style={{padding:'18px 22px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>{section.title}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {section.items.map((item,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:T.bg,borderRadius:8}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{item.l}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:item.bold?700:600,color:item.color||T.text}}>{item.v||'—'}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <NotesTimeline propertyId={selected.id} isAdmin={isAdmin} user={user} showToast={showToast} category="financials"/>
    </div>
  )
}


// ── COMPANY DOCUMENTS TAB ────────────────────────────────────────────────────
export function CompanyDocumentsTab({companyId, showToast, isAdmin, user}) {
  const { T } = useTheme()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('other')
  const [docName, setDocName] = useState('')
  const inputRef = { current: null }

  const COMPANY_DOC_CATEGORIES = [
    {value:'insurance',   label:'Company Insurance',   icon:'🛡'},
    {value:'bank',        label:'Bank / Finance',      icon:'🏦'},
    {value:'legal',       label:'Legal',               icon:'⚖️'},
    {value:'tax',         label:'Tax / HMRC',          icon:'📊'},
    {value:'accounts',    label:'Annual Accounts',     icon:'📑'},
    {value:'contracts',   label:'Contracts',           icon:'📝'},
    {value:'other',       label:'Other',               icon:'📄'},
  ]

  useEffect(()=>{ loadDocs() },[companyId])

  async function loadDocs() {
    setLoading(true)
    try {
      const {data} = await supabase.from('company_documents')
        .select('*').eq('company_id', companyId)
        .order('created_at', {ascending:false})
      setDocs(data||[])
    } catch(e) { }
    setLoading(false)
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return
    setUploading(true)

    for (const file of Array.from(files)) {
      try {
        const {data:{user:u}} = await supabase.auth.getUser()
        const filePath = `companies/${u.id}/${companyId}/${Date.now()}-${file.name}`

        const {error:uploadErr} = await supabase.storage
          .from('property-documents')
          .upload(filePath, file, {cacheControl:'3600', upsert:false})
        if (uploadErr) throw uploadErr

        const {data:{publicUrl}} = supabase.storage
          .from('property-documents').getPublicUrl(filePath)

        await supabase.from('company_documents').insert({
          company_id: companyId,
          user_id: u.id,
          name: docName || file.name,
          file_url: publicUrl,
          file_path: filePath,
          file_type: file.type,
          file_size: file.size,
          category: selectedCategory,
        })
        showToast('Document uploaded')
        setDocName('')
        await loadDocs()
      } catch(e) {
        showToast('Upload failed: ' + e.message, 'error')
      }
    }
    setUploading(false)
  }

  async function handleDelete(doc) {
    try {
      await api.deleteCompanyDocument(doc)
      setDocs(prev=>prev.filter(d=>d.id!==doc.id))
      showToast('Deleted')
    } catch(e) { showToast(e.message,'error') }
  }

  function formatSize(b) {
    if (!b) return ''
    if (b<1024) return b+'B'
    if (b<1024*1024) return (b/1024).toFixed(1)+'KB'
    return (b/(1024*1024)).toFixed(1)+'MB'
  }

  function getCat(val) {
    return COMPANY_DOC_CATEGORIES.find(c=>c.value===val)||COMPANY_DOC_CATEGORIES[COMPANY_DOC_CATEGORIES.length-1]
  }

  return (
    <div>
      {isAdmin&&<div
        onDrop={e=>{e.preventDefault();setDragOver(false);handleUpload(e.dataTransfer.files)}}
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>inputRef.current?.click()}
        style={{border:`2px dashed ${dragOver?T.gold:T.border}`,borderRadius:12,
          padding:'20px',textAlign:'center',cursor:'pointer',marginBottom:14,
          background:dragOver?T.gold+'11':'transparent',transition:'all 0.2s'}}>
        <div style={{fontSize:24,marginBottom:6}}>📁</div>
        <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>
          {uploading?'Uploading...':'Drop company documents here or click to browse'}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:8,flexWrap:'wrap'}}>
          <select value={selectedCategory} onChange={e=>{e.stopPropagation();setSelectedCategory(e.target.value)}}
            onClick={e=>e.stopPropagation()} style={{fontSize:11,padding:'4px 8px',width:'auto'}}>
            {COMPANY_DOC_CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <input value={docName} onChange={e=>{e.stopPropagation();setDocName(e.target.value)}}
            onClick={e=>e.stopPropagation()} placeholder="Custom name (optional)"
            style={{fontSize:11,padding:'4px 8px',width:160}}/>
        </div>
        <input ref={el=>inputRef.current=el} type="file" multiple style={{display:'none'}}
          onChange={e=>handleUpload(e.target.files)}/>
      </div>}

      {loading
        ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Loading...</div>
        : docs.length===0
          ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,textAlign:'center',
              padding:24,background:T.bg,borderRadius:10}}>
              No company documents yet.
            </div>
          : <div style={{display:'grid',gap:8}}>
              {docs.map(doc=>{
                const cat = getCat(doc.category)
                return (
                  <div key={doc.id} style={{background:T.bg,borderRadius:10,padding:'12px 16px',
                    display:'flex',alignItems:'center',gap:12,border:`1px solid ${T.border}`,flexWrap:'wrap'}}>
                    <div style={{fontSize:22,flexShrink:0}}>{cat.icon}</div>
                    <div style={{flex:1,minWidth:150}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{doc.name}</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,
                          background:T.gold+'22',padding:'1px 6px',borderRadius:20}}>
                          {cat.icon} {cat.label}
                        </span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                          {new Date(doc.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                        </span>
                        {doc.file_size&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint}}>
                          {formatSize(doc.file_size)}
                        </span>}
                      </div>
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <a href={doc.file_url} target="_blank" rel="noreferrer"
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',
                          background:T.surface,color:T.gold,border:`1px solid ${T.gold}44`,
                          borderRadius:8,cursor:'pointer',textDecoration:'none'}}>
                        ⬇ View
                      </a>
                      {isAdmin&&<button onClick={()=>handleDelete(doc)}
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 10px',
                          background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',
                          borderRadius:8,cursor:'pointer'}}>
                        Delete
                      </button>}
                    </div>
                  </div>
                )
              })}
            </div>
      }
    </div>
  )
}


// ── ACCESS MODAL (Admin only) ─────────────────────────────────────────────────

// ── USER ACCESS MANAGEMENT ────────────────────────────────────────────────────
function AccessModal({companies, onClose, showToast}) {
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
  const [users, setUsers]           = useState([])
  const [access, setAccess]         = useState({})
  const [invites, setInvites]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(null)
  const [newEmail, setNewEmail]         = useState('')
  const [newIsAdmin, setNewIsAdmin]     = useState(false)
  const [selectedCoIds, setSelectedCoIds] = useState([]) // populated after companies load
  const [showCoSelect, setShowCoSelect] = useState(false)
  const [adding, setAdding]             = useState(false)
  const [tab, setTab]                   = useState('users')

  useEffect(()=>{ loadData() },[])

  async function loadData() {
    setLoading(true)
    try {
      const [authUsers, rows] = await Promise.all([
        api.fetchAllUsers().catch(()=>[]),
        api.fetchAllAccessRows().catch(()=>[])
      ])
      const map = {}
      rows.forEach(row => {
        if (!map[row.user_id]) map[row.user_id] = []
        if (row.company_id) map[row.user_id].push(row.company_id)
      })
      setAccess(map)
      if (authUsers.length > 0) {
        setUsers(authUsers.map(u => ({ id: u.id, email: u.email })))
      } else {
        const fromRows = {}
        rows.forEach(row => {
          if (!fromRows[row.user_id]) fromRows[row.user_id] = { id: row.user_id, email: row.email || row.user_id }
        })
        setUsers(Object.values(fromRows))
      }
      // Load pending invites for all companies
      const allInvites = []
      for (const co of companies) {
        const inv = await api.fetchPendingInvitations(co.id).catch(()=>[])
        inv.forEach(i => allInvites.push({ ...i, companyName: co.name, companyAbbr: co.abbr, companyColor: co.color }))
      }
      setInvites(allInvites)
      // Default: all companies selected
      setSelectedCoIds(companies.map(c => c.id))
    } catch(e) {}
    setLoading(false)
  }

  async function toggleCompany(userId, companyId, userEmail) {
    const has = (access[userId]||[]).includes(companyId)
    setSaving(userId + companyId)
    try {
      if (has) await api.revokeCompanyAccess(userId, companyId)
      else await api.grantCompanyAccess(userId, companyId, userEmail)
      setAccess(prev => ({
        ...prev,
        [userId]: has
          ? (prev[userId]||[]).filter(c=>c!==companyId)
          : [...(prev[userId]||[]), companyId]
      }))
      showToast('Access updated')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  async function setAllCompanies(userId, userEmail, giveAll) {
    setSaving(userId+'all')
    try {
      await api.setAllCompanyAccess(userId, userEmail, giveAll ? companies.map(c=>c.id) : [])
      setAccess(prev => ({ ...prev, [userId]: giveAll ? companies.map(c=>c.id) : [] }))
      showToast(giveAll ? 'Full access granted' : 'All access removed')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  async function removeUser(userId) {
    if (!confirm('Remove this user completely?')) return
    try {
      await api.removeUserAccess(userId)
      setUsers(prev=>prev.filter(u=>u.id!==userId))
      setAccess(prev=>{ const n={...prev}; delete n[userId]; return n })
      showToast('User removed')
    } catch(e) { showToast(e.message,'error') }
  }

  async function sendInvite() {
    const email = newEmail.trim().toLowerCase()
    if (!email || companies.length === 0) return
    setAdding(true)
    try {
      const coIds = selectedCoIds.length > 0 ? selectedCoIds : companies.map(c => c.id)
      const result = await api.sendInvitation(coIds, email, newIsAdmin)
      setNewEmail('')
      setNewIsAdmin(false)
      setSelectedCoIds(companies.map(c => c.id))
      setShowCoSelect(false)
      await loadData()
      if (result?.emailSent === false) {
        showToast(`Invite saved but email failed: ${result.emailError}`, 'error')
      } else {
        showToast(`Invitation email sent to ${email} ✓`)
      }
    } catch(e) { showToast(e.message,'error') }
    setAdding(false)
  }

  async function cancelInvite(id) {
    try {
      await api.deleteInvitation(id)
      setInvites(prev=>prev.filter(i=>i.id!==id))
      showToast('Invitation cancelled')
    } catch(e) { showToast(e.message,'error') }
  }

  const totalAccess = (u) => (access[u.id]||[]).length
  const hasAll = (u) => companies.every(co=>(access[u.id]||[]).includes(co.id))
  const hasNone = (u) => (access[u.id]||[]).length === 0

  const tabStyle = (k) => ({
    fontFamily: mono, fontSize: 11, padding: '7px 16px', borderRadius: 8,
    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
    background: tab===k ? T.gold+'22' : 'transparent',
    color: tab===k ? T.gold : T.muted,
    fontWeight: tab===k ? 600 : 400,
  })

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:660}}>
        <div style={{padding:'22px 26px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
            <h2 style={{fontSize:20,fontWeight:700,color:T.text}}>⚙ User Access Management</h2>
            <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
          </div>
          <p style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20}}>
            Manage who can access your companies. Send invitations to new users.
          </p>

          {/* Tabs */}
          <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:0}}>
            <button style={tabStyle('users')} onClick={()=>setTab('users')}>
              👥 Users ({users.length})
            </button>
            <button style={tabStyle('invites')} onClick={()=>setTab('invites')}>
              ✉ Pending Invites ({invites.length})
            </button>
          </div>

          {/* ── INVITE NEW USER ── */}
          <div style={{background:T.bg,borderRadius:10,padding:'14px 16px',marginBottom:20,border:`1px solid ${T.border}`}}>
            <label style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Invite user by email</label>
            <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
              <input value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&sendInvite()}
                placeholder="colleague@example.com"
                style={{flex:1,minWidth:200,fontFamily:mono,fontSize:12,background:T.surface,border:`1px solid ${T.border}`,color:T.text,borderRadius:8,padding:'8px 12px',outline:'none'}}/>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <input type="checkbox" id="invite-admin" checked={newIsAdmin} onChange={e=>setNewIsAdmin(e.target.checked)} style={{width:'auto',margin:0}}/>
                <label htmlFor="invite-admin" style={{fontFamily:mono,fontSize:10,color:T.muted,cursor:'pointer',whiteSpace:'nowrap'}}>Make admin</label>
              </div>
              <button className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}}
                onClick={sendInvite} disabled={adding||!newEmail.trim()}>
                {adding ? 'Sending…' : '✉ Send Invite'}
              </button>
            </div>
            {/* Company selector — only show if more than 1 company */}
            {companies.length > 1 && (
              <div style={{marginTop:10}}>
                <button onClick={()=>setShowCoSelect(s=>!s)}
                  style={{fontFamily:mono,fontSize:10,color:T.muted,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline',textUnderlineOffset:2}}>
                  {showCoSelect ? '▲ Hide' : '▼ Choose'} which companies ({selectedCoIds.length} of {companies.length} selected)
                </button>
                {showCoSelect && (
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
                    {companies.map(co=>{
                      const sel = selectedCoIds.includes(co.id)
                      return (
                        <button key={co.id}
                          onClick={()=>setSelectedCoIds(prev=>sel?prev.filter(id=>id!==co.id):[...prev,co.id])}
                          style={{fontFamily:mono,fontSize:11,padding:'5px 12px',borderRadius:20,cursor:'pointer',transition:'all 0.15s',
                            border:`1px solid ${sel?co.color:T.border}`,
                            background:sel?co.color+'22':'transparent',
                            color:sel?co.color:T.muted}}>
                          {sel?'✓ ':''}{co.abbr} {co.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:8,lineHeight:1.6}}>
              An invitation link will be sent. They must sign up at <span style={{color:T.gold}}>www.ownproperly.com</span> to accept it.
            </div>
          </div>

          {loading
            ? <div style={{fontFamily:mono,fontSize:11,color:T.muted,padding:20,textAlign:'center'}}>Loading…</div>
            : <>
              {/* ── USERS TAB ── */}
              {tab==='users' && (
                users.length===0
                  ? <div style={{fontFamily:mono,fontSize:11,color:T.faint,textAlign:'center',padding:32,background:T.bg,borderRadius:10}}>
                      No users yet. Send an invitation above.
                    </div>
                  : <div style={{display:'grid',gap:10}}>
                      {users.map(u=>(
                        <div key={u.id} style={{background:T.bg,borderRadius:12,padding:'14px 16px',border:`1px solid ${T.border}`}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <div style={{width:34,height:34,borderRadius:17,background:T.gold+'33',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:700,color:T.gold,flexShrink:0}}>
                                {(u.email[0]||'?').toUpperCase()}
                              </div>
                              <div>
                                <div style={{fontSize:13,fontWeight:600,color:T.text}}>{u.email}</div>
                                <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>
                                  {hasNone(u)?'No access':hasAll(u)?'All companies':totalAccess(u)+' of '+companies.length+' companies'}
                                </div>
                              </div>
                            </div>
                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button onClick={()=>setAllCompanies(u.id,u.email,true)}
                                disabled={!!saving||hasAll(u)}
                                style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.green}`,color:T.green,background:T.green+'11',opacity:hasAll(u)?0.4:1}}>
                                All ✓
                              </button>
                              <button onClick={()=>setAllCompanies(u.id,u.email,false)}
                                disabled={!!saving||hasNone(u)}
                                style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.amber}`,color:T.amber,background:T.amber+'11',opacity:hasNone(u)?0.4:1}}>
                                None ✗
                              </button>
                              <button onClick={()=>removeUser(u.id)}
                                style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}`,color:T.red,background:T.red+'11'}}>
                                Remove
                              </button>
                            </div>
                          </div>
                          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                            {companies.map(co=>{
                              const has = (access[u.id]||[]).includes(co.id)
                              return (
                                <button key={co.id} onClick={()=>toggleCompany(u.id,co.id,u.email)}
                                  disabled={!!saving}
                                  style={{fontFamily:mono,fontSize:11,padding:'6px 14px',borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                                    border:`1px solid ${has?co.color:T.border}`,
                                    background:has?co.color+'22':'transparent',
                                    color:has?co.color:T.muted}}>
                                  {has?'✓ ':''}{co.abbr} {co.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
              )}

              {/* ── INVITES TAB ── */}
              {tab==='invites' && (
                invites.length===0
                  ? <div style={{fontFamily:mono,fontSize:11,color:T.faint,textAlign:'center',padding:32,background:T.bg,borderRadius:10}}>
                      No pending invitations.
                    </div>
                  : <div style={{display:'grid',gap:8}}>
                      {invites.map(inv=>(
                        <div key={inv.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:T.bg,borderRadius:10,border:`1px solid ${T.border}`,gap:12,flexWrap:'wrap'}}>
                          <div>
                            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{inv.email}</div>
                            <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>
                              Invited to <span style={{color:inv.companyColor||T.gold}}>{inv.companyAbbr}</span> {inv.companyName}
                              {inv.is_admin && <span style={{marginLeft:8,background:T.gold+'22',color:T.gold,padding:'1px 6px',borderRadius:4}}>Admin</span>}
                            </div>
                            <div style={{fontFamily:mono,fontSize:10,color:T.faint,marginTop:2}}>
                              Expires {new Date(inv.expires_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                            </div>
                          </div>
                          <button onClick={()=>cancelInvite(inv.id)}
                            style={{fontFamily:mono,fontSize:10,padding:'5px 12px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}`,color:T.red,background:T.red+'11',flexShrink:0}}>
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
              )}
            </>
          }

          <button className="btn btn-ghost" style={{width:'100%',marginTop:16,fontSize:12}} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}


// ── MASTER MILESTONE SETTINGS PANEL ──────────────────────────────────────────
function MilestoneSettingsPanel({ user, config, onChange, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [saving, setSaving] = useState(false)

  // Get all milestone definitions from api (imported at top)
  const ALL_MILESTONES = [
    ...api.DEFAULT_MILESTONES_STANDARD,
    ...api.DEFAULT_MILESTONES_AUCTION.filter(m => !api.DEFAULT_MILESTONES_STANDARD.find(s => s.key === m.key)),
    ...api.DEFAULT_MILESTONES_BRRR,
  ]

  const STAGE_LABELS = {
    offer: 'Offer Stage',
    professionals: 'Instructing Professionals',
    legal: 'Legal Due Diligence',
    exchange: 'Exchange',
    completion: 'Completion & Post-Completion',
    pre_auction: 'Pre-Auction',
    auction_day: 'Auction Day',
    brrr: 'BRRR — Refinance',
  }

  const stages = [...new Set(ALL_MILESTONES.map(m => m.stage))]

  async function toggle(key, currentEnabled) {
    const next = { ...config, [key]: !currentEnabled }
    onChange(next)
    setSaving(true)
    try {
      await api.saveMilestoneDefaults(user?.id, user?.email, next)
      showToast('Default updated — applies to new deals')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  async function resetAll(on) {
    const next = {}
    ALL_MILESTONES.forEach(m => { next[m.key] = on })
    onChange(next)
    setSaving(true)
    try {
      await api.saveMilestoneDefaults(user?.id, user?.email, next)
      showToast(on ? 'All steps enabled by default' : 'All steps disabled by default')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Master deal milestone defaults</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 16, lineHeight: 1.7 }}>
          Configure which steps appear by default when you create a new deal. You can still toggle individual steps on or off inside each deal — these are just the starting defaults.
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => resetAll(true)} disabled={saving}>
            Enable all
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => resetAll(false)} disabled={saving}>
            Disable all
          </button>
          {saving && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, display: 'flex', alignItems: 'center' }}>Saving…</span>}
        </div>
      </div>

      {stages.map(stage => {
        const stageMilestones = ALL_MILESTONES.filter(m => m.stage === stage)
        return (
          <div key={stage} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {STAGE_LABELS[stage] || stage}
              </span>
            </div>
            {stageMilestones.map(m => {
              const enabled = config[m.key] !== false // default true
              return (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${T.border}`, opacity: enabled ? 1 : 0.5 }}>
                  <div onClick={() => toggle(m.key, enabled)}
                    style={{ width: 36, height: 20, borderRadius: 10, background: enabled ? T.blue : T.border, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 2, left: enabled ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }}/>
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: mono, fontSize: 12, color: T.text }}>{m.label}</span>
                    {m.required && (
                      <span style={{ fontFamily: mono, fontSize: 9, color: T.gold, marginLeft: 8 }}>★ recommended</span>
                    )}
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 10, color: enabled ? T.blue : T.muted }}>
                    {enabled ? 'Default ON' : 'Default OFF'}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}

      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 12, lineHeight: 1.6 }}>
        Changes apply to new deals only. Existing deals keep their current step configuration.
      </div>
    </div>
  )
}

// ── ADMIN SETTINGS PANEL ──────────────────────────────────────────────────────
function AdminSettingsPanel({ user, T, showToast }) {
  const mono = "'DM Mono',monospace"
  const [tab, setTab]           = useState('accounts')
  const [companies, setCompanies] = useState([])
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [saving, setSaving]         = useState(null)
  const [filter, setFilter]         = useState('all')
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, email }
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError]   = useState('')
  const [deleting, setDeleting]         = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [cos, us] = await Promise.all([
        api.fetchAdminAllCompanies(),
        api.fetchAllUsers().catch(() => []),
      ])
      setCompanies(cos)
      setUsers(us)
    } catch(e) { showToast('Failed to load admin data', 'error') }
    setLoading(false)
  }

  async function handleDeleteUser() {
    setDeleteError('')
    if (!deletePassword) { setDeleteError('Please enter your password'); return }
    setDeleting(true)
    try {
      // Re-authenticate to verify password
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email, password: deletePassword
      })
      if (authErr) { setDeleteError('Incorrect password — please try again'); setDeleting(false); return }
      // Password verified — delete the user
      await api.deleteUser(deleteTarget.id)
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id))
      setCompanies(prev => prev.filter(c => c.owner_email !== deleteTarget.email))
      setDeleteTarget(null)
      setDeletePassword('')
      showToast(`${deleteTarget.email} has been deleted`)
    } catch(e) {
      setDeleteError(e.message || 'Delete failed')
    }
    setDeleting(false)
  }

  async function toggleFreeTier(companyId, current) {
    setSaving(companyId)
    try {
      await api.setCompanyFreeTier(companyId, !current, user.id)
      setCompanies(prev => prev.map(c => c.id === companyId
        ? { ...c, is_free_tier: !current }
        : c))
      showToast(!current ? 'Free tier granted' : 'Moved to paid billing')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(null)
  }

  const filtered = companies.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !q || c.name?.toLowerCase().includes(q) || c.owner_email?.toLowerCase().includes(q)
    const status = c.is_free_tier ? 'free_tier' : (c.subscriptions?.[0]?.status || 'trialing')
    const matchFilter = filter === 'all' || status === filter
    return matchSearch && matchFilter
  })

  // KPIs
  const active   = companies.filter(c => c.subscriptions?.[0]?.status === 'active').length
  const trialing = companies.filter(c => !c.is_free_tier && (!c.subscriptions?.[0]?.status || c.subscriptions?.[0]?.status === 'trialing')).length
  const freeTier = companies.filter(c => c.is_free_tier).length
  const pastDue  = companies.filter(c => c.subscriptions?.[0]?.status === 'past_due').length
  const mrr      = companies.filter(c => c.subscriptions?.[0]?.status === 'active')
    .reduce((s, c) => s + (c.subscriptions?.[0]?.property_count || 0), 0)

  const STATUS_CFG = {
    active:    { label: 'Active',    color: T.green },
    trialing:  { label: 'Trialing',  color: T.blue  },
    past_due:  { label: 'Past due',  color: T.amber },
    canceled:  { label: 'Cancelled', color: T.red   },
    free_tier: { label: 'Free tier', color: T.gold  },
  }

  const tabBtn = k => ({
    fontFamily: mono, fontSize: 11, padding: '7px 16px', borderRadius: 8,
    border: 'none', cursor: 'pointer',
    background: tab === k ? T.gold + '22' : 'transparent',
    color: tab === k ? T.gold : T.muted,
    fontWeight: tab === k ? 700 : 400,
  })

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 22px' }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total accounts', value: companies.length, color: T.text },
          { label: 'Active paying',  value: active,           color: T.green },
          { label: 'On trial',       value: trialing,         color: T.blue  },
          { label: 'Past due',       value: pastDue,          color: T.amber },
          { label: 'Est. MRR',       value: `£${mrr}`,        color: T.green },
        ].map(m => (
          <div key={m.label} style={{ background: T.bg, borderRadius: 12, padding: '16px 18px', border: `1px solid ${T.border}` }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: m.color, letterSpacing: '-0.02em' }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${T.border}` }}>
        <button style={tabBtn('accounts')} onClick={() => setTab('accounts')}>🏢 Accounts ({companies.length})</button>
        <button style={tabBtn('users')} onClick={() => setTab('users')}>👥 Users ({users.length})</button>
      </div>

      {loading ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: 40, textAlign: 'center' }}>Loading all accounts…</div>
      ) : (
        <>
          {/* ACCOUNTS TAB */}
          {tab === 'accounts' && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by company or email…"
                  style={{ flex: 1, minWidth: 200, fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none' }}/>
                <select value={filter} onChange={e => setFilter(e.target.value)}
                  style={{ fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px' }}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                  <option value="past_due">Past due</option>
                  <option value="free_tier">Free tier</option>
                </select>
              </div>

              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 60px 80px 120px', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                  {['Company / Owner', 'Status', 'Props', 'MRR', 'Free tier'].map(h => (
                    <div key={h} style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
                  ))}
                </div>
                {filtered.length === 0 && (
                  <div style={{ padding: 32, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No accounts match your search</div>
                )}
                {filtered.map(co => {
                  const status = co.is_free_tier ? 'free_tier' : (co.subscriptions?.[0]?.status || 'trialing')
                  const sc = STATUS_CFG[status] || { label: status, color: T.muted }
                  const propCount = co.subscriptions?.[0]?.property_count || 0
                  const monthlyRev = status === 'active' ? propCount : 0
                  return (
                    <div key={co.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 60px 80px 120px', gap: 8, padding: '13px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (co.color || '#C8A84B') + '22', color: co.color || '#C8A84B' }}>{co.abbr}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{co.name}</span>
                        </div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{co.owner_email || '—'}</div>
                      </div>
                      <div>
                        <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: sc.color + '22', color: sc.color }}>{sc.label}</span>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.text }}>{propCount}</div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: monthlyRev > 0 ? T.green : T.muted }}>{monthlyRev > 0 ? `£${monthlyRev}` : '—'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: mono, fontSize: 10, color: co.is_free_tier ? T.gold : T.muted }}>{co.is_free_tier ? 'Free' : 'Paid'}</span>
                        <div onClick={() => saving !== co.id && toggleFreeTier(co.id, co.is_free_tier)}
                          style={{ width: 38, height: 22, borderRadius: 11, background: co.is_free_tier ? T.gold : T.border, cursor: saving === co.id ? 'wait' : 'pointer', position: 'relative', transition: 'background 0.2s', opacity: saving === co.id ? 0.5 : 1, flexShrink: 0 }}>
                          <div style={{ position: 'absolute', top: 3, left: co.is_free_tier ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }}/>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 10 }}>
                {filtered.length} of {companies.length} accounts · Toggle free tier to exempt from billing
              </div>
            </>
          )}

          {/* USERS TAB */}
          {tab === 'users' && (
            <>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by email…"
                style={{ width: '100%', maxWidth: 340, fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none', marginBottom: 16 }}/>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 100px 80px', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                  {['Email', 'Companies', 'Signed up', ''].map(h => (
                    <div key={h} style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
                  ))}
                </div>
                {users.filter(u => !search || u.email?.toLowerCase().includes(search.toLowerCase())).map(u => {
                  const userCos = companies.filter(c => c.owner_email === u.email)
                  return (
                    <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 180px 100px 80px', gap: 8, padding: '13px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 16, background: T.gold + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.gold, flexShrink: 0 }}>
                          {(u.email?.[0] || '?').toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, color: T.text }}>{u.email}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {userCos.length === 0
                          ? <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>No companies</span>
                          : userCos.slice(0, 3).map(co => (
                            <span key={co.id} style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (co.color || '#C8A84B') + '22', color: co.color || '#C8A84B' }}>{co.abbr}</span>
                          ))
                        }
                        {userCos.length > 3 && <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>+{userCos.length - 3}</span>}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                      </div>
                      <div>
                        {u.id !== user?.id && (
                          <button
                            onClick={() => { setDeleteTarget({ id: u.id, email: u.email }); setDeletePassword(''); setDeleteError('') }}
                            title="Delete user"
                            style={{ fontFamily: mono, fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.red}44`, background: 'transparent', color: T.red }}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 10 }}>{users.length} total users · Your own account cannot be deleted</div>
            </>
          )}
        </>
      )}

      {/* ── DELETE USER MODAL ── */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 24 }}>
          <div style={{ background: T.surface, border: `2px solid ${T.red}44`, borderRadius: 18, width: '100%', maxWidth: 440, padding: '32px 28px' }}>
            {/* Warning header */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: T.red, marginBottom: 8 }}>Delete user account</h2>
              <p style={{ fontFamily: mono, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
                This will permanently delete <strong style={{ color: T.text }}>{deleteTarget.email}</strong> and all their data including companies, properties, deals and documents.
              </p>
              <p style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 8, fontWeight: 700 }}>This cannot be undone.</p>
            </div>

            {/* Password confirmation */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                Enter your admin password to confirm
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeleteError('') }}
                onKeyDown={e => e.key === 'Enter' && handleDeleteUser()}
                placeholder="Your password"
                autoFocus
                style={{ width: '100%', fontFamily: mono, fontSize: 13, background: T.bg, border: `1.5px solid ${deleteError ? T.red : T.border}`, color: T.text, borderRadius: 8, padding: '10px 14px', outline: 'none' }}
              />
              {deleteError && (
                <div style={{ fontFamily: mono, fontSize: 11, color: T.red, marginTop: 8 }}>{deleteError}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setDeleteTarget(null); setDeletePassword(''); setDeleteError('') }}
                style={{ flex: 1, fontFamily: mono, fontSize: 12, padding: '11px 20px', borderRadius: 10, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={deleting || !deletePassword}
                style={{ flex: 2, fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '11px 20px', borderRadius: 10, border: 'none', background: deleting || !deletePassword ? T.border : T.red, color: 'white', cursor: deleting || !deletePassword ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}>
                {deleting ? 'Verifying & deleting…' : '🗑 Permanently delete user'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── COMPANY BRANDING SETTINGS PANEL ──────────────────────────────────────────
function BrandingSettingsPanel({ companies, companySettings, setCompanySettings, user, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [selectedCo, setSelectedCo] = useState(companies[0]?.id || '')
  const [uploading, setUploading]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [yearType, setYearType]     = useState('tax_year')
  const [logoPreview, setLogoPreview] = useState(null)

  const co = companies.find(c => c.id === selectedCo)
  const cs = companySettings[selectedCo] || {}

  useEffect(() => {
    if (selectedCo && companySettings[selectedCo]) {
      setYearType(companySettings[selectedCo].year_type || 'tax_year')
      setLogoPreview(companySettings[selectedCo].logo_url || null)
    }
  }, [selectedCo, companySettings])

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { showToast('Logo must be under 2MB', 'error'); return }
    setUploading(true)
    try {
      const url = await api.uploadCompanyLogo(selectedCo, file)
      setLogoPreview(url)
      setCompanySettings(prev => ({
        ...prev,
        [selectedCo]: { ...prev[selectedCo], logo_url: url }
      }))
      showToast('Logo uploaded')
    } catch(e) { showToast(e.message, 'error') }
    setUploading(false)
  }

  async function saveSettings() {
    setSaving(true)
    try {
      await api.saveReportSettings(selectedCo, { year_type: yearType })
      setCompanySettings(prev => ({
        ...prev,
        [selectedCo]: { ...prev[selectedCo], year_type: yearType }
      }))
      showToast('Report settings saved')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  async function removeLogo() {
    try {
      await api.saveReportSettings(selectedCo, { logo_url: null, logo_path: null })
      setLogoPreview(null)
      setCompanySettings(prev => ({
        ...prev,
        [selectedCo]: { ...prev[selectedCo], logo_url: null, logo_path: null }
      }))
      showToast('Logo removed')
    } catch(e) { showToast(e.message, 'error') }
  }

  if (companies.length === 0) return (
    <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: 40, textAlign: 'center' }}>
      No companies yet. Add a company first.
    </div>
  )

  return (
    <div>
      {/* Company selector */}
      {companies.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Select company</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {companies.map(c => (
              <button key={c.id} onClick={() => setSelectedCo(c.id)}
                style={{ fontFamily: mono, fontSize: 11, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${selectedCo === c.id ? (c.color || T.gold) : T.border}`,
                  background: selectedCo === c.id ? (c.color || T.gold) + '22' : 'transparent',
                  color: selectedCo === c.id ? (c.color || T.gold) : T.muted,
                  fontWeight: selectedCo === c.id ? 700 : 400 }}>
                {c.abbr} {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {co && (
        <div style={{ display: 'grid', gap: 16 }}>

          {/* Logo upload */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Company logo for reports</div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Preview */}
              <div style={{ width: 160, height: 80, background: T.bg, border: `1px dashed ${T.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {logoPreview
                  ? <img src={logoPreview} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}/>
                  : <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>No logo</span>
                }
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 8, lineHeight: 1.7 }}>
                  Upload your company logo to brand PDF report exports. Recommended: PNG or SVG with transparent background, max 2MB.
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ cursor: 'pointer' }}>
                    <span className="btn btn-gold" style={{ fontSize: 11 }}>
                      {uploading ? 'Uploading…' : logoPreview ? '↑ Replace logo' : '↑ Upload logo'}
                    </span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} disabled={uploading}/>
                  </label>
                  {logoPreview && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, color: T.red, borderColor: T.red + '44' }} onClick={removeLogo}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Year type preference */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Default reporting period</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 16, lineHeight: 1.7 }}>
              Choose whether reports default to the UK tax year (6 Apr – 5 Apr) or calendar year. You can always switch inside any report.
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {[
                { k: 'tax_year', label: '🇬🇧 UK Tax year', sub: '6 April – 5 April' },
                { k: 'calendar', label: '📅 Calendar year', sub: '1 January – 31 December' },
              ].map(opt => (
                <div key={opt.k} onClick={() => setYearType(opt.k)}
                  style={{ flex: 1, padding: '14px 16px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                    border: `2px solid ${yearType === opt.k ? T.gold : T.border}`,
                    background: yearType === opt.k ? T.gold + '11' : T.bg }}>
                  <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: yearType === opt.k ? T.gold : T.text, marginBottom: 4 }}>{opt.label}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{opt.sub}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>

          {/* Report accent colour */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Report colour</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 12, lineHeight: 1.7 }}>
              PDF report headers and accents will use your company colour: <span style={{ fontWeight: 700, color: co.color || T.gold }}>{co.color || '#C8A84B'}</span>. To change this, update your company colour in the Companies section.
            </div>
            <div style={{ width: 48, height: 24, borderRadius: 6, background: co.color || T.gold }}/>
          </div>

        </div>
      )}
    </div>
  )
}

// ── BRANDING PANEL ────────────────────────────────────────────────────────────
function BrandingPanel({ companies, companySettings, setCompanySettings, user, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [uploading, setUploading] = useState(null)

  async function handleLogoUpload(companyId, file) {
    if (!file) return
    setUploading(companyId)
    try {
      const url = await api.uploadCompanyLogo(companyId, file)
      setCompanySettings(prev => ({
        ...prev,
        [companyId]: { ...(prev[companyId]||{}), logo_url: url }
      }))
      showToast('Logo uploaded successfully')
    } catch(e) { showToast(e.message || 'Upload failed', 'error') }
    setUploading(null)
  }

  async function removeLogo(companyId) {
    try {
      await supabase.from('company_settings').upsert(
        { company_id: companyId, logo_url: null, logo_path: null },
        { onConflict: 'company_id' }
      )
      setCompanySettings(prev => ({
        ...prev,
        [companyId]: { ...(prev[companyId]||{}), logo_url: null }
      }))
      showToast('Logo removed')
    } catch(e) { showToast(e.message, 'error') }
  }

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Company logos for PDF reports</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.7 }}>
          Upload a logo for each company. It will appear on all PDF reports generated for that company. Supported formats: PNG, JPG, SVG. Recommended: PNG with transparent background, at least 400px wide.
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {companies.map(co => {
          const cs = companySettings?.[co.id] || {}
          const isUploading = uploading === co.id
          return (
            <div key={co.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', borderLeft: `3px solid ${co.color||T.gold}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: co.color||T.gold, background: (co.color||T.gold)+'22', padding: '3px 10px', borderRadius: 4 }}>{co.abbr}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{co.name}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                {/* Logo preview */}
                <div style={{ width: 180, height: 80, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                  {cs.logo_url
                    ? <img src={cs.logo_url} alt={co.name} style={{ maxWidth: '90%', maxHeight: '70%', objectFit: 'contain' }}/>
                    : <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>No logo uploaded</span>
                  }
                </div>

                {/* Upload controls */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ cursor: 'pointer' }}>
                      <span className="btn btn-gold" style={{ fontSize: 11, display: 'inline-block' }}>
                        {isUploading ? 'Uploading…' : cs.logo_url ? '↑ Replace logo' : '↑ Upload logo'}
                      </span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={isUploading}
                        onChange={e => handleLogoUpload(co.id, e.target.files?.[0])}/>
                    </label>
                    {cs.logo_url && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, color: T.red, borderColor: T.red+'44' }} onClick={() => removeLogo(co.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 8, lineHeight: 1.6 }}>
                    This logo will appear on all PDF reports for {co.name}.<br/>
                    PNG with transparent background works best on dark PDF headers.
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
