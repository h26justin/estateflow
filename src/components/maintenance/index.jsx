// Maintenance & Repairs UI — extracted from FeatureComponents.jsx
//
// Exports a single MaintenanceTab component and keeps JobCard private.
// Owns its own copy of the formatDate helper because the original sat at
// module level inside FeatureComponents and isn't re-exported.
//
// NOTE: The notes section at the bottom of MaintenanceTab still depends on
// NotesTimeline, which is defined in FeatureComponents. We import it across.
// If/when NotesTimeline moves to its own module, update this import.

import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import * as api from '../../lib/api'
import { NotesTimeline } from '../FeatureComponents'
import MoneyInput from '../../lib/MoneyInput'
import TriageButton from './TriageButton'

// Local copy of formatDate (used by JobCard for raised/resolved dates).
// Matches the implementation in FeatureComponents.jsx so behaviour is identical.
function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── MAINTENANCE TAB ───────────────────────────────────────────────────────────
export function MaintenanceTab({propertyId, showToast, fmt, isAdmin, user, canEdit = true, activeFlags = new Set()}) {
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
    catch(e) { showToast(e.message || 'Failed to load maintenance jobs', 'error') }
    setLoading(false)
  }

  async function handleSave() {
    if (!form.title) return
    try {
      // Postgres date columns reject '' — empty date inputs must be null.
      const data = {...form, quoted_cost:parseFloat(form.quoted_cost)||null, actual_cost:parseFloat(form.actual_cost)||null, date_raised:form.date_raised||null, date_resolved:form.date_resolved||null}
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

  function handleTriaged(jobId, triage, at) {
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j, ai_triage:triage, ai_severity:triage?.severity ?? j.ai_severity, ai_triaged_at:at}:j))
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
        {canEdit && <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{setEditJob(null);setForm(blank);setShowForm(v=>!v)}}>+ Log Job</button>}
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
          <div><label>Quoted Cost</label><MoneyInput prefix="£" value={form.quoted_cost} onChange={v=>s('quoted_cost',v)}/></div>
          <div><label>Actual Cost</label><MoneyInput prefix="£" value={form.actual_cost} onChange={v=>s('actual_cost',v)}/></div>
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
            {openJobs.map(job=><JobCard key={job.id} job={job} fmt={fmt} onEdit={j=>{setEditJob(j);setForm({...j,quoted_cost:j.quoted_cost||'',actual_cost:j.actual_cost||''});setShowForm(true)}} onDelete={handleDelete} PRIORITIES={PRIORITIES} STATUSES={STATUSES} canEdit={canEdit} activeFlags={activeFlags} showToast={showToast} onTriaged={handleTriaged}/>)}
          </div>}
          {completedJobs.length>0&&<div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Completed</div>
            {completedJobs.map(job=><JobCard key={job.id} job={job} fmt={fmt} onEdit={j=>{setEditJob(j);setForm({...j,quoted_cost:j.quoted_cost||'',actual_cost:j.actual_cost||''});setShowForm(true)}} onDelete={handleDelete} PRIORITIES={PRIORITIES} STATUSES={STATUSES} canEdit={canEdit} activeFlags={activeFlags} showToast={showToast} onTriaged={handleTriaged}/>)}
          </div>}
        </div>
      }
      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user} showToast={showToast} category="maintenance"/>
      </div>
    </div>
  )
}

function JobCard({job, fmt, onEdit, onDelete, PRIORITIES, STATUSES, canEdit = true, activeFlags = new Set(), showToast, onTriaged}) {
  const { T } = useTheme()
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
            {job.reported_by_tenant && (
              <span title="Submitted by tenant via portal"
                style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,color:T.blue,background:T.blue+'22',padding:'1px 8px',borderRadius:20,letterSpacing:'0.05em'}}>
                👤 TENANT
              </span>
            )}
          </div>
          {Array.isArray(job.photos) && job.photos.length > 0 && (
            <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
              {job.photos.slice(0,4).map((p,i) => (
                <span key={i} title={p.name || ''}
                  style={{fontFamily:"'DM Mono',monospace",fontSize:9,padding:'2px 6px',borderRadius:4,background:T.bg,border:`1px solid ${T.border}`,color:T.muted}}>
                  📷 {p.name?.slice(0,18) || `photo ${i+1}`}
                </span>
              ))}
              {job.photos.length > 4 && (
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>+ {job.photos.length - 4} more</span>
              )}
            </div>
          )}
          {activeFlags.has('ai_maintenance_triage') && (
            <TriageButton
              job={job}
              canTriage={canEdit}
              showToast={showToast}
              onTriaged={(triage, at) => onTriaged?.(job.id, triage, at)}
              onApplyPriority={(p) => onEdit({ ...job, priority: p })}
            />
          )}
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
            {canEdit && <button onClick={()=>onEdit(job)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'transparent',color:T.gold,border:`1px solid ${T.gold}44`,borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Edit</button>}
            {canEdit && <button onClick={()=>onDelete(job.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'2px 8px',cursor:'pointer'}}>Remove</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
