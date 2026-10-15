import { useState, useEffect, useRef, Fragment, useCallback } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../../lib/icons'
import { MONO, statusPill, FS } from '../../lib/styles'
import { COMPLIANCE_CATALOGUE, canonicalCertType, requirementsForProperty, canOptOut, isOptedOut, RENEWAL_BOOKING, DOC_CATEGORY_FOR_CERT, TENANCY_PAPERWORK_KEYS } from '../../lib/complianceCatalogue'
import { requirementStatus, itemPredatesTenancy } from '../../lib/complianceStatus'
import EpcBadge from '../EpcBadge'
import InspectionsPanel from '../InspectionsPanel'
import * as api from '../../lib/api'
import { formatDate, daysUntil, ExpiryBadge } from './helpers'
import { NotesTimeline } from './NotesTimeline'
import { SkeletonRows } from '../../lib/Skeleton'
import { EmptyState } from '../ui'

// ── COMPLIANCE TAB ────────────────────────────────────────────────────────────
// Per-property home of the requirement checklist: every certificate /
// document the portfolio Compliance overview tracks for this property is
// listed here whether or not anything is on file, editable in place — no
// hunting through "+ Add Certificate" for the standard items. Optional
// (tier 2/3) requirements can be switched off per property; they persist to
// properties.compliance_optout and render dimmed here AND on the overview.
export function ComplianceTab({propertyId, property = null, companySettings = {}, onPropertyChange, showToast, isAdmin, user, canEdit = true}) {
  const { T, darkMode } = useTheme()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)   // compliance_items.id being edited, null = adding
  const [formAnchor, setFormAnchor] = useState('top') // 'top' | req.key | `other:${item.id}` — which row the form renders under
  const EMPTY_FORM = {cert_type:'gas_safety',cert_name:'Gas Safety (CP12)',issue_date:'',expiry_date:'',reminder_days:30,notes:''}
  const [form, setForm] = useState(EMPTY_FORM)
  const s = (k,v) => setForm(f=>({...f,[k]:v}))
  // Current tenancy (for the "paperwork pre-dates this tenancy" warning).
  const [tenancy, setTenancy] = useState(null)
  // Certificate file attach: one hidden input shared by every row;
  // attachTarget remembers which compliance item the chosen file belongs to.
  const fileRef = useRef(null)
  const [attachTarget, setAttachTarget] = useState(null)
  const [attaching, setAttaching] = useState(false)

  // Full requirement catalogue (insurance lives on its own register, not
  // here) plus a free-text Other. Legacy rows written under alias keys
  // ('gas', 'alarm') resolve via canonicalCertType below.
  const CERT_TYPES = [
    ...COMPLIANCE_CATALOGUE.filter(r=>r.group!=='insurance').map(r=>({value:r.key,label:r.label,icon:r.icon})),
    {value:'other', label:'Other Certificate', icon:'file-text'},
  ]

  const loadItems = useCallback(async () => {
    setLoading(true)
    try { setItems(await api.fetchCompliance(propertyId)) }
    catch(e) { showToast(e.message || 'Failed to load compliance certificates', 'error') }
    setLoading(false)
  }, [propertyId, showToast])

  useEffect(()=>{
    loadItems()
    api.fetchTenancyDetails(propertyId).then(setTenancy).catch(()=>setTenancy(null))
  },[propertyId, loadItems])

  // ── Certificate documents ────────────────────────────────────────────────
  function startAttach(item, reqKey) {
    setAttachTarget({ itemId: item.id, category: DOC_CATEGORY_FOR_CERT[reqKey || canonicalCertType(item.cert_type)] || 'other' })
    fileRef.current?.click()
  }
  async function handleAttachFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !attachTarget) return
    setAttaching(true)
    try {
      const doc = await api.attachComplianceDocument(propertyId, property?.name || '', file, attachTarget.category)
      const updated = await api.updateCompliance(attachTarget.itemId, { document_id: doc.id })
      setItems(prev=>prev.map(i=>i.id===attachTarget.itemId ? updated : i))
      showToast('Certificate file attached')
    } catch(err) { showToast(err.message,'error') }
    setAttaching(false)
    setAttachTarget(null)
  }
  async function viewDocument(documentId) {
    try {
      const url = await api.getDocumentSignedUrlById(documentId)
      if (url) window.open(url, '_blank', 'noopener')
      else showToast('Document not found', 'error')
    } catch(e) { showToast(e.message,'error') }
  }

  // ── Renewal prefill ──────────────────────────────────────────────────────
  // "Renew" creates a NEW row (editingId stays null) so the old certificate
  // remains as history; new expiry = cycle on from the old expiry (or from
  // today if the old one has already lapsed).
  function renewPrefill(row) {
    const { req, item } = row
    const today = new Date().toISOString().slice(0,10)
    let expiry = ''
    if (req.cycleMonths) {
      const base = item?.expiry_date && new Date(item.expiry_date) > new Date() ? new Date(item.expiry_date) : new Date()
      base.setMonth(base.getMonth() + req.cycleMonths)
      expiry = base.toISOString().slice(0,10)
    }
    return { cert_type: req.key, cert_name: item?.cert_name || req.label, issue_date: today, expiry_date: expiry, reminder_days: item?.reminder_days ?? 30 }
  }

  function openForm(prefill, id = null, anchor = 'top') {
    setForm({ ...EMPTY_FORM, ...prefill })
    setEditingId(id)
    setFormAnchor(anchor)
    setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditingId(null); setFormAnchor('top'); setForm(EMPTY_FORM) }

  async function handleSave() {
    if (!form.cert_name) return
    const payload = {
      cert_type: form.cert_type, cert_name: form.cert_name,
      issue_date: form.issue_date || null, expiry_date: form.expiry_date || null,
      reminder_days: form.reminder_days, notes: form.notes,
    }
    try {
      if (editingId) {
        const updated = await api.updateCompliance(editingId, payload)
        setItems(prev=>prev.map(i=>i.id===editingId ? updated : i))
        showToast('Certificate updated')
      } else {
        const created = await api.createCompliance(propertyId, payload)
        setItems(prev=>[...prev, created])
        showToast('Certificate added')
      }
      closeForm()
    } catch(e) { showToast(e.message,'error') }
  }

  async function handleDelete(id) {
    try {
      await api.deleteCompliance(id)
      setItems(prev=>prev.filter(i=>i.id!==id))
      if (editingId === id) closeForm()
      showToast('Removed')
    } catch(e) { showToast(e.message,'error') }
  }

  // Per-property opt-out (tier 2/3 requirements only — tier 1 legal items
  // stay on; applicability flags are the only way those go away).
  // onPropertyChange keeps App state in sync so the portfolio overview
  // dims the item immediately without a full reload.
  async function toggleOptout(key, off) {
    const next = { ...(property?.compliance_optout || {}) }
    if (off) next[key] = true
    else delete next[key]
    try {
      await api.updateProperty(propertyId, { compliance_optout: next })
      onPropertyChange?.({ compliance_optout: next })
      showToast(off ? 'Switched off for this property' : 'Tracking again')
    } catch(e) { showToast(e.message,'error') }
  }

  // Requirement checklist rows — same tracked+applicable set as the
  // portfolio overview card. Insurance is excluded (it lives on the policy
  // register under Compliance → Insurance, not in compliance_items).
  const activeItems = items.filter(i=>!i.deleted_at)
  const reqs = property ? requirementsForProperty(property, companySettings).filter(r => r.group !== 'insurance') : []
  const reqKeys = new Set(reqs.map(r=>r.key))
  const shim = { ...(property||{}), compliance_items: activeItems }
  const reqRows = reqs.map(req => {
    const matching = activeItems.filter(i => canonicalCertType(i.cert_type) === req.key)
      .sort((a,b)=> new Date(b.expiry_date||b.issue_date||0) - new Date(a.expiry_date||a.issue_date||0))
    const off = isOptedOut(property, req.key)
    return { req, item: matching[0] || null, count: matching.length, off,
      status: off ? { state:'off' } : requirementStatus(shim, req) }
  })
  // Anything that doesn't map to a tracked requirement (custom "other"
  // certs, or types switched off at company level) keeps its own list.
  const otherItems = activeItems.filter(i => !reqKeys.has(canonicalCertType(i.cert_type)))
    .sort((a,b)=>{ const da=daysUntil(a.expiry_date)??9999, db=daysUntil(b.expiry_date)??9999; return da-db })

  const pill = (key, txt) => <span style={{...statusPill(key, darkMode), fontSize:FS.xs, whiteSpace:'nowrap'}}>{txt}</span>
  const statusFor = ({ status, req }) => {
    if (status.state === 'off')      return pill('void','Off')
    if (status.state === 'valid')    return status.days == null ? pill('ok','On file') : pill('ok', `${status.days}d remaining`)
    if (status.state === 'expiring') return pill('warn', `Expires in ${status.days}d`)
    if (status.state === 'expired')  return pill('bad', `Expired ${Math.abs(status.days)}d ago`)
    return req.tier <= 2 ? pill('bad','Missing') : pill('void','Not on file')
  }
  const editPrefill = (row) => ({
    cert_type: canonicalCertType(row.item.cert_type),
    cert_name: row.item.cert_name || row.req.label,
    issue_date: row.item.issue_date || '',
    expiry_date: row.item.expiry_date || '',
    reminder_days: row.item.reminder_days ?? 30,
    notes: row.item.notes || '',
  })
  const smallBtnStyle = { fontFamily:MONO, fontSize:FS.xs, padding:'4px 10px', borderRadius:6, cursor:'pointer', background:'transparent', border:`1px solid ${T.border}`, color:T.muted, whiteSpace:'nowrap' }

  // One shared form card, rendered wherever formAnchor points — under the
  // header for the top-level "+ Add Certificate" button, or inline beneath
  // the row whose Add/Edit was clicked, so the user isn't bounced to the top.
  const formCard = showForm && <div className="card" style={{padding:'16px 18px',marginBottom:14}}>
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>{editingId ? 'Edit certificate' : 'Add certificate'}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div>
            <label>Certificate Type</label>
            <select aria-label="Certificate Type" value={form.cert_type} onChange={e=>{
              const t = CERT_TYPES.find(x=>x.value===e.target.value)
              s('cert_type',e.target.value); s('cert_name',t?.label||'')
            }}>
              {CERT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><label>Certificate Name</label><input aria-label="Certificate Name" value={form.cert_name} onChange={e=>s('cert_name',e.target.value)}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Issue Date</label><input aria-label="Issue Date" type="date" value={form.issue_date} onChange={e=>s('issue_date',e.target.value)}/></div>
          <div><label>Expiry Date</label><input aria-label="Expiry Date" type="date" value={form.expiry_date} onChange={e=>s('expiry_date',e.target.value)}/></div>
          <div><label>Remind (days before)</label><input aria-label="Remind (days before)" type="number" value={form.reminder_days} onChange={e=>s('reminder_days',+e.target.value)}/></div>
        </div>
        <div style={{marginBottom:12}}><label>Notes</label><input aria-label="Notes" value={form.notes} onChange={e=>s('notes',e.target.value)} placeholder="Optional notes"/></div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button className="btn btn-gold" style={{fontSize:11}} onClick={handleSave}>{editingId ? 'Update' : 'Save'}</button>
          <button className="btn btn-ghost" style={{fontSize:11}} onClick={closeForm}>Cancel</button>
          {editingId && canEdit && (
            <button onClick={()=>handleDelete(editingId)} style={{marginLeft:'auto',fontFamily:MONO,fontSize:FS.xs,background:'transparent',color:T.red,border:`1px solid ${T.red}55`,borderRadius:6,padding:'5px 12px',cursor:'pointer'}}>Remove</button>
          )}
        </div>
      </div>

  return (
    <div>
      {/* Shared hidden picker for per-row certificate attach */}
      <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{display:'none'}} onChange={handleAttachFile}/>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Compliance & Certificates</div>
        {canEdit && <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>{ (showForm && formAnchor==='top') ? closeForm() : openForm({}) }}>+ Add Certificate</button>}
      </div>

      {formAnchor==='top' && formCard}

      {loading ? <SkeletonRows rows={3} height={36}/>
       : <>
        {/* Requirement checklist — mirrors the portfolio overview card */}
        {reqRows.length > 0 && (
          <div style={{display:'grid',gap:8,marginBottom:18}}>
            {reqRows.map(row=>{
              const { req, item, count, off, status } = row
              const needsAction = !off && ['expired','expiring','missing'].includes(status.state)
              const booking = needsAction ? RENEWAL_BOOKING[req.key] : null
              const stale = !off && item && TENANCY_PAPERWORK_KEYS.includes(req.key) && itemPredatesTenancy(item, tenancy?.tenancy_start)
              return (
                <Fragment key={req.key}>
                <div className="card" style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',opacity:off?0.5:1,borderStyle:off?'dashed':'solid'}}>
                  <span style={{width:34,height:34,borderRadius:9,background:(off?T.faint:T.gold)+'1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <Icon name={ICON_NAMES.includes(req.icon)?req.icon:'file-text'} size={17} color={off?T.faint:T.gold}/>
                  </span>
                  <div style={{flex:1,minWidth:170}}>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:2,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      {req.label}
                      {/* EPC row: register-synced band + MEES messaging,
                          right where the landlord is looking at the cert. */}
                      {req.key==='epc' && !off && <EpcBadge property={property} T={T}/>}
                    </div>
                    <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>
                      {off ? 'Switched off for this property'
                        : item ? <>Issued: {formatDate(item.issue_date)} · Expires: {formatDate(item.expiry_date)}{count>1 && ` · ${count} on file (latest shown)`}</>
                        : 'Nothing on file yet'}
                      {/* Per-tenancy paperwork served before the current
                          tenancy started reads as held but isn't. */}
                      {stale && <span style={{color:T.amber,fontWeight:700}}> · pre-dates current tenancy (started {formatDate(tenancy.tenancy_start)}) — re-serve & update</span>}
                    </div>
                    {booking && (
                      <a href={booking.url} target="_blank" rel="noreferrer"
                        style={{fontFamily:MONO,fontSize:FS.xs,color:T.goldText,textDecoration:'underline'}}>{booking.label} →</a>
                    )}
                  </div>
                  {statusFor(row)}
                  {canEdit && !off && item?.document_id && (
                    <button style={smallBtnStyle} title="View the attached certificate file" onClick={()=>viewDocument(item.document_id)}>View</button>
                  )}
                  {canEdit && !off && item && !item.document_id && (
                    <button style={smallBtnStyle} disabled={attaching} title="Attach the certificate file (PDF or photo)" onClick={()=>startAttach(item, req.key)}>{attaching && attachTarget?.itemId===item.id ? '…' : 'Attach'}</button>
                  )}
                  {canEdit && !off && item && ['expired','expiring'].includes(status.state) && (
                    <button style={{...smallBtnStyle,color:T.amber,borderColor:T.amber+'66'}} title="Record the renewal as a new certificate (keeps this one as history)"
                      onClick={()=>openForm(renewPrefill(row), null, req.key)}>Renew</button>
                  )}
                  {canEdit && !off && (item
                    ? <button style={smallBtnStyle} onClick={()=>{ (showForm && formAnchor===req.key && editingId===item.id) ? closeForm() : openForm(editPrefill(row), item.id, req.key) }}
                        onMouseEnter={e=>{e.currentTarget.style.color=T.gold;e.currentTarget.style.borderColor=T.gold+'66'}}
                        onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>Edit</button>
                    : <button style={{...smallBtnStyle,color:T.goldText,borderColor:T.gold+'66'}} onClick={()=>{ (showForm && formAnchor===req.key && !editingId) ? closeForm() : openForm({cert_type:req.key,cert_name:req.label}, null, req.key) }}>+ Add</button>)}
                  {canEdit && property && canOptOut(req) && (
                    <button style={smallBtnStyle} title={off ? 'Track this requirement again' : "Don't track this on this property — shows dimmed on the overview"}
                      onClick={()=>toggleOptout(req.key, !off)}>{off ? 'Turn on' : 'Turn off'}</button>
                  )}
                </div>
                {formAnchor===req.key && formCard}
                </Fragment>
              )
            })}
          </div>
        )}

        {/* Custom / untracked certificates */}
        {otherItems.length > 0 && (
          <>
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',margin:'4px 0 10px'}}>Other certificates</div>
            <div style={{display:'grid',gap:10,marginBottom:18}}>
              {otherItems.map(item=>{
                const ct = CERT_TYPES.find(t=>t.value===canonicalCertType(item.cert_type))
                return (
                  <Fragment key={item.id}>
                  <div className="card" style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                    <span style={{width:38,height:38,borderRadius:9,background:T.gold+'1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name={ICON_NAMES.includes(ct?.icon)?ct.icon:'file-text'} size={19} color={T.gold}/></span>
                    <div style={{flex:1,minWidth:150}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{item.cert_name}</div>
                      <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>
                        Issued: {formatDate(item.issue_date)} · Expires: {formatDate(item.expiry_date)}
                      </div>
                      {item.notes&&<div style={{fontFamily:MONO,fontSize:FS.xs,color:T.faint,marginTop:2}}>{item.notes}</div>}
                    </div>
                    <ExpiryBadge dateStr={item.expiry_date}/>
                    {canEdit && item.document_id && <button style={smallBtnStyle} title="View the attached certificate file" onClick={()=>viewDocument(item.document_id)}>View</button>}
                    {canEdit && !item.document_id && <button style={smallBtnStyle} disabled={attaching} title="Attach the certificate file (PDF or photo)" onClick={()=>startAttach(item, null)}>Attach</button>}
                    {canEdit && <button style={smallBtnStyle} onClick={()=>{ (showForm && formAnchor===`other:${item.id}`) ? closeForm() : openForm({cert_type:canonicalCertType(item.cert_type),cert_name:item.cert_name||'',issue_date:item.issue_date||'',expiry_date:item.expiry_date||'',reminder_days:item.reminder_days??30,notes:item.notes||''}, item.id, `other:${item.id}`) }}>Edit</button>}
                    {canEdit && <button onClick={()=>handleDelete(item.id)} style={{fontFamily:MONO,fontSize:FS.xs,background:'transparent',color:T.red,border:`1px solid ${T.red}55`,borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>Remove</button>}
                  </div>
                  {formAnchor===`other:${item.id}` && formCard}
                  </Fragment>
                )
              })}
            </div>
          </>
        )}

        {reqRows.length===0 && otherItems.length===0 && (
          <EmptyState compact icon="shield-check" title="No certificates added yet"/>
        )}
      </>}
      {/* Property inspections — scheduled mid-tenancy / check-in / check-out
          with photo evidence. Lives in the Compliance tab because that's
          where landlords already think about compliance + risk in one place. */}
      <InspectionsPanel propertyId={propertyId} canEdit={canEdit} user={user}/>

      <div style={{marginTop:20}}>
        <NotesTimeline propertyId={propertyId} isAdmin={isAdmin} user={user} showToast={showToast} category="compliance"/>
      </div>
    </div>
  )
}
