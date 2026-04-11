import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
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
    catch(e) { console.log(e) }
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
    } catch(e) { console.log(e) }
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
    catch(e) { console.log(e) }
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
    catch(e) { console.log(e) }
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
export function SettingsPage({companies, companySettings, setCompanySettings, user, showToast, isAdmin, darkMode, setDarkMode}) {
  const { T } = useTheme()
  const [saving, setSaving] = useState(null)
  const [showAccessModal, setShowAccessModal] = useState(false)

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

  return (
    <div className="fade">
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Settings</h1>
        <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12}}>Enable or disable features per company. Changes take effect immediately.</p>
      </div>

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

      {/* Theme toggle */}
      <div className="card" style={{padding:'20px 24px',marginTop:8}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Appearance</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:2}}>Theme</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{darkMode?'Dark mode — easier on the eyes':'Light mode — high contrast'}</div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={async()=>{setDarkMode(true);try{await supabase.from('user_profiles').upsert({user_id:user?.id,email:user?.email,dark_mode:true,updated_at:new Date().toISOString()},{onConflict:'user_id'})}catch(e){}}}
              style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                border:`1px solid ${darkMode?T.gold:T.border}`,
                background:darkMode?T.gold+'22':'transparent',
                color:darkMode?T.gold:T.muted,transition:'all 0.2s'}}>
              🌙 Dark
            </button>
            <button onClick={async()=>{setDarkMode(false);try{await supabase.from('user_profiles').upsert({user_id:user?.id,email:user?.email,dark_mode:false,updated_at:new Date().toISOString()},{onConflict:'user_id'})}catch(e){}}}
              style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                border:`1px solid ${!darkMode?T.gold:T.border}`,
                background:!darkMode?T.gold+'22':'transparent',
                color:!darkMode?T.gold:T.muted,transition:'all 0.2s'}}>
              ☀️ Light
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:'20px 24px',marginTop:8}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Account</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,marginBottom:12}}>Signed in as <span style={{color:T.gold}}>{user?.email}</span></div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:16}}>To change your password, sign out and use the "Forgot password" link on the login page.</div>
        {isAdmin&&<button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setShowAccessModal(true)}>⚙ Manage User Access</button>}
      </div>

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
      const {data, error} = await supabase.from('property_notes').insert({
        property_id: propertyId,
        user_id: user.id,
        user_email: user.email,
        note: newNote.trim(),
        category: category || 'general',
      }).select().single()
      if (error) throw error
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
      await supabase.from('property_notes').delete().eq('id', id)
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
    } catch(e) { console.log(e) }
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
      await supabase.from('property_documents').delete().eq('id', doc.id)
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
    supabase.from('property_notes').select('*').eq('property_id', selected.id)
      .order('created_at', {ascending:false})
      .then(({data})=>{ setAllNotes(data||[]); setLoading(false) })
      .catch(()=>setLoading(false))
  },[selected.id])

  async function deleteNote(id) {
    await supabase.from('property_notes').delete().eq('id',id)
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
    } catch(e) { console.log(e) }
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
      if (doc.file_path) await supabase.storage.from('property-documents').remove([doc.file_path])
      await supabase.from('company_documents').delete().eq('id', doc.id)
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
function AccessModal({companies, onClose, showToast}) {
  const { T } = useTheme()
  const [users, setUsers]     = useState([])   // all auth users
  const [access, setAccess]   = useState({})   // { user_id: [company_id,...] }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(null)
  const [newEmail, setNewEmail] = useState('')
  const [adding, setAdding]   = useState(false)

  useEffect(()=>{ loadData() },[])

  async function loadData() {
    setLoading(true)
    try {
      // Get all signed-up users via SECURITY DEFINER function
      const { data: authUsers, error: rpcErr } = await supabase.rpc('list_auth_users')
      if (rpcErr) console.warn('list_auth_users RPC error:', rpcErr.message)

      // Get all access rows
      const { data: rows } = await supabase.from('user_company_access').select('*')

      // Build access map { user_id -> [company_id,...] }
      const map = {}
      ;(rows || []).forEach(row => {
        if (!map[row.user_id]) map[row.user_id] = []
        if (row.company_id) map[row.user_id].push(row.company_id)
      })
      setAccess(map)

      if (authUsers && authUsers.length > 0) {
        setUsers(authUsers.map(u => ({ id: u.id, email: u.email })))
      } else {
        // Fallback: build from access rows if RPC not yet created
        const fromRows = {}
        ;(rows || []).forEach(row => {
          if (!fromRows[row.user_id]) fromRows[row.user_id] = { id: row.user_id, email: row.email || row.user_id }
        })
        setUsers(Object.values(fromRows))
      }
    } catch(e) { console.log('AccessModal loadData error:', e) }
    setLoading(false)
  }

  async function toggleCompany(userId, companyId, userEmail) {
    const has = (access[userId]||[]).includes(companyId)
    setSaving(userId + companyId)
    try {
      if (has) {
        await supabase.from('user_company_access')
          .delete().eq('user_id', userId).eq('company_id', companyId)
      } else {
        await supabase.from('user_company_access')
          .insert({user_id: userId, company_id: companyId, email: userEmail, is_admin: false})
      }
      // Update local access map
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
    setSaving(userId + 'all')
    try {
      await supabase.from('user_company_access').delete().eq('user_id', userId)
      if (giveAll) {
        const rows = companies.map(co=>({
          user_id: userId, company_id: co.id, email: userEmail, is_admin: false
        }))
        await supabase.from('user_company_access').insert(rows)
      }
      setAccess(prev => ({ ...prev, [userId]: giveAll ? companies.map(c=>c.id) : [] }))
      showToast(giveAll ? 'Access granted to all companies' : 'All access removed')
    } catch(e) { showToast(e.message,'error') }
    setSaving(null)
  }

  async function removeUser(userId) {
    if (!confirm('Remove this user completely?')) return
    try {
      await supabase.from('user_company_access').delete().eq('user_id', userId)
      setUsers(prev=>prev.filter(u=>u.id!==userId))
      showToast('User removed')
    } catch(e) { showToast(e.message,'error') }
  }

  async function addUser() {
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    setAdding(true)
    try {
      const existing = users.find(u=>u.email?.toLowerCase()===email)
      if (existing) { showToast('User already in list', 'error'); setAdding(false); return }
      // If they've signed up we already have their UUID in the users list
      // If not, we can't add them yet - they must sign up first
      if (!existing) {
        showToast('No account found for that email. Ask them to sign up first, then refresh.', 'error')
        setAdding(false)
        return
      }
    } catch(e) { showToast(e.message,'error') }
    setAdding(false)
  }

  const totalAccess = (u) => (access[u.id]||[]).length
  const hasAll = (u) => companies.every(co=>(access[u.id]||[]).includes(co.id))
  const hasNone = (u) => (access[u.id]||[]).length === 0

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:640}}>
        <div style={{padding:'22px 26px'}}>
          {/* Header */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <h2 style={{fontSize:20,fontWeight:700,color:T.text}}>⚙ User Access Management</h2>
            <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
          </div>
          <p style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginBottom:20}}>
            Control which companies each user can see. Tick the company pills to grant or revoke access. Users can only view — they cannot edit data unless you also grant write access.
          </p>

          {/* Add user */}
          <div style={{background:T.bg,borderRadius:10,padding:'14px 16px',marginBottom:20,border:`1px solid ${T.border}`}}>
            <label>Invite user by email address</label>
            <div style={{display:'flex',gap:8,marginTop:6}}>
              <input value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&addUser()}
                placeholder="user@example.com" style={{flex:1,fontSize:12}}/>
              <button className="btn btn-gold" style={{fontSize:11,whiteSpace:'nowrap'}}
                onClick={addUser} disabled={adding}>
                {adding?'Adding…':'+ Add User'}
              </button>
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginTop:8,lineHeight:1.6}}>
              The user must first sign up at <span style={{color:T.gold}}>ownproperly.com</span> using this email address before they can log in.
            </div>
          </div>

          {/* User list */}
          {loading
            ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,padding:20,textAlign:'center'}}>Loading users…</div>
            : users.length === 0
              ? <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.faint,textAlign:'center',padding:32,background:T.bg,borderRadius:10}}>
                  No signed-up users found. Make sure the <span style={{color:T.gold}}>list_auth_users</span> SQL function has been created in Supabase.
                </div>
              : <div style={{display:'grid',gap:12}}>
                  {users.map(u=>(
                    <div key={u.id} style={{background:T.bg,borderRadius:12,padding:'16px 18px',border:`1px solid ${T.border}`}}>
                      {/* User header */}
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          {/* Avatar */}
                          <div style={{width:34,height:34,borderRadius:17,background:T.gold+'33',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:T.gold,flexShrink:0}}>
                            {(u.email[0]||'?').toUpperCase()}
                          </div>
                          <div>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <div style={{fontSize:13,fontWeight:600,color:T.text}}>{u.email}</div>
                              {hasNone(u)&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,background:T.gold+'22',color:T.gold,border:`1px solid ${T.gold}44`,borderRadius:4,padding:'2px 6px'}}>ADMIN</span>}
                            </div>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                              {hasNone(u)?'Full admin access':hasAll(u)?'All companies':totalAccess(u)+' of '+companies.length+' companies'}
                            </div>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={()=>setAllCompanies(u.id,u.email,true)}
                            disabled={saving===u.id+'all'||hasAll(u)}
                            style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'4px 10px',borderRadius:6,
                              cursor:'pointer',border:`1px solid ${T.green}`,color:T.green,
                              background:T.green+'11',opacity:hasAll(u)?0.4:1}}>
                            All ✓
                          </button>
                          <button onClick={()=>setAllCompanies(u.id,u.email,false)}
                            disabled={saving===u.id+'all'||hasNone(u)}
                            style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'4px 10px',borderRadius:6,
                              cursor:'pointer',border:`1px solid ${T.amber}`,color:T.amber,
                              background:T.amber+'11',opacity:hasNone(u)?0.4:1}}>
                            None ✗
                          </button>
                          <button onClick={()=>removeUser(u.id)}
                            style={{fontFamily:"'DM Mono',monospace",fontSize:10,padding:'4px 10px',borderRadius:6,
                              cursor:'pointer',border:`1px solid ${T.red}`,color:T.red,
                              background:T.red+'11'}}>
                            Remove
                          </button>
                        </div>
                      </div>

                      {/* Company pills */}
                      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                        {companies.map(co=>{
                          const has = (access[u.id]||[]).includes(co.id)
                          const isSaving = saving === u.id + co.id
                          return (
                            <button key={co.id}
                              onClick={()=>toggleCompany(u.id,co.id,u.email)}
                              disabled={!!saving}
                              style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'6px 14px',
                                borderRadius:20,cursor:'pointer',transition:'all 0.18s',
                                border:`1.5px solid ${has?co.color:T.border}`,
                                background:has?co.color+'22':'transparent',
                                color:has?co.color:T.muted,
                                opacity:isSaving?0.5:1}}>
                              {has&&<span style={{marginRight:4}}>✓</span>}
                              {co.abbr} — {co.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
          }

          <button className="btn btn-ghost" style={{width:'100%',marginTop:16,fontSize:12}} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
