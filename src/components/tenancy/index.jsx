import { MONO, FS, SANS } from '../../lib/styles'
// Tenancy sub-tabs: extracted from FeatureComponents.jsx for maintainability.
// All five components accept `T` (theme tokens) as a prop and use the shared
// api module — no theme-context dependency, no other cross-cutting state.

import { useState, useEffect } from 'react'
import * as api from '../../lib/api'
import { fmt } from '../../lib/format'
import MoneyInput from '../../lib/MoneyInput'
import { Icon } from '../../lib/icons'
import NoticeGenerator from '../NoticeGenerator'
import { GROUNDS, groundLabel, earliestRentIncreaseDate, currentTenancyStart } from '../../lib/possessionRules'
import { SkeletonList } from '../../lib/Skeleton'
import { EmptyState, Button } from '../ui'

// ── RIGHT TO RENT TAB ─────────────────────────────────────────────────────────
export function RightToRentTab({ propertyId, userId, showToast, T }) {
  const mono = MONO
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)
  // Inline required-field highlighting once a save is tried with fields missing.
  const [triedSave, setTriedSave] = useState(false)

  useEffect(() => {
    api.fetchRightToRent(propertyId).then(d => { setRecords(d); setLoading(false) }).catch(() => setLoading(false))
  }, [propertyId])

  const DOC_TYPES = [
    { key: 'passport', label: 'Passport' },
    { key: 'brp', label: 'Biometric Residence Permit' },
    { key: 'visa', label: 'Visa / Entry Clearance' },
    { key: 'share_code', label: 'Online Share Code' },
    { key: 'euss', label: 'EU Settlement Status' },
    { key: 'other', label: 'Other document' },
  ]

  async function save() {
    // Same required fields the save button used to gate on — surfaced
    // inline + via toast instead of a silently disabled button.
    if (!form.tenant_name || !form.check_date) {
      setTriedSave(true)
      showToast('Tenant name and check date are required', 'error')
      return
    }
    setSaving(true)
    try {
      const saved = await api.saveRightToRent({ ...form, property_id: propertyId, user_id: userId })
      if (form.id) setRecords(prev => prev.map(r => r.id === saved.id ? saved : r))
      else setRecords(prev => [saved, ...prev])
      setShowForm(false); setForm({})
      showToast('Right to rent record saved')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  const inp = { fontFamily:mono, fontSize:12, background:T.bg, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'8px 12px', outline:'none', width:'100%' }
  const lbl = { fontFamily: SANS, fontSize: FS.sm, fontWeight: 600, color:T.muted, display:'block', marginBottom:5 }
  const errStyle = { fontFamily:mono, fontSize:FS.xs, color:T.red, display:'block', marginTop:4 }

  const isExpired = (date) => date && new Date(date) < new Date()
  const isExpiring = (date) => {
    if (!date) return false
    const d = new Date(date); const now = new Date()
    return d > now && (d - now) / (1000*60*60*24) <= 90
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div>
          <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em' }}>Right to rent checks</div>
          <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, marginTop:3 }}>Landlords are legally required to check tenants have the right to rent in the UK.</div>
        </div>
        <Button size="sm" icon="plus" style={{ flexShrink:0 }} onClick={() => { setForm({}); setTriedSave(false); setShowForm(true) }}>
          Add check
        </Button>
      </div>

      {showForm && (
        <form onSubmit={e=>{e.preventDefault(); save()}} style={{ background:T.card, border:`1px solid ${T.gold}44`, borderRadius:12, padding:'18px 20px', marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div>
              <label style={lbl} htmlFor="rtr-tenant-name">Tenant name *</label>
              <input id="rtr-tenant-name" value={form.tenant_name||''} onChange={e=>setForm(p=>({...p,tenant_name:e.target.value}))} placeholder="Full legal name"
                style={triedSave && !form.tenant_name ? {...inp, borderColor:T.red} : inp}
                aria-invalid={triedSave && !form.tenant_name ? 'true' : undefined}
                aria-describedby={triedSave && !form.tenant_name ? 'rtr-tenant-name-err' : undefined}/>
              {triedSave && !form.tenant_name && <span id="rtr-tenant-name-err" style={errStyle}>Required</span>}
            </div>
            <div><label style={lbl} htmlFor="rtr-doc-type">Document type</label>
              <select id="rtr-doc-type" value={form.doc_type||'passport'} onChange={e=>setForm(p=>({...p,doc_type:e.target.value}))} style={inp}>
                {DOC_TYPES.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div><label style={lbl} htmlFor="rtr-doc-ref">Document reference / number</label><input id="rtr-doc-ref" value={form.doc_reference||''} onChange={e=>setForm(p=>({...p,doc_reference:e.target.value}))} placeholder="Passport no. etc" style={inp}/></div>
            <div>
              <label style={lbl} htmlFor="rtr-check-date">Check date *</label>
              <input id="rtr-check-date" type="date" value={form.check_date||''} onChange={e=>setForm(p=>({...p,check_date:e.target.value}))}
                style={triedSave && !form.check_date ? {...inp, borderColor:T.red} : inp}
                aria-invalid={triedSave && !form.check_date ? 'true' : undefined}
                aria-describedby={triedSave && !form.check_date ? 'rtr-check-date-err' : undefined}/>
              {triedSave && !form.check_date && <span id="rtr-check-date-err" style={errStyle}>Required</span>}
            </div>
            <div><label style={lbl} htmlFor="rtr-expiry-date">Document expiry date</label><input id="rtr-expiry-date" type="date" value={form.expiry_date||''} onChange={e=>setForm(p=>({...p,expiry_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="rtr-follow-up">Follow-up check date</label><input id="rtr-follow-up" type="date" value={form.follow_up_date||''} onChange={e=>setForm(p=>({...p,follow_up_date:e.target.value}))} style={inp}/></div>
          </div>
          <div style={{ marginBottom:10 }}><label style={lbl} htmlFor="rtr-notes">Notes</label><textarea id="rtr-notes" value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inp,resize:'none'}}/></div>
          <div style={{ display:'flex', gap:8 }}>
            <Button type="submit" size="sm" disabled={saving}>
              {saving?'Saving…':'Save record'}
            </Button>
            <Button variant="secondary" size="sm" onClick={()=>setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {loading ? <SkeletonList count={2} height={64}/>
      : records.length === 0 ? (
        <EmptyState compact icon="id-card" title="No right to rent checks recorded" body="Add a check for each adult tenant before the tenancy starts."/>
      ) : records.map(r => {
        const expired = isExpired(r.expiry_date)
        const expiring = isExpiring(r.expiry_date)
        const followUpDue = r.follow_up_date && new Date(r.follow_up_date) <= new Date()
        return (
          <div key={r.id} style={{ background:T.card, border:`1px solid ${expired?T.red:expiring?T.amber:T.border}`, borderRadius:10, padding:'12px 16px', marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:3 }}>{r.tenant_name}</div>
                <div style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted }}>
                  {DOC_TYPES.find(d=>d.key===r.doc_type)?.label||r.doc_type}
                  {r.doc_reference && ` · ${r.doc_reference}`}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                {expired && <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.red+'22', color:T.red }}>EXPIRED</span>}
                {expiring && <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.amber+'22', color:T.amber }}>Expiring soon</span>}
                {followUpDue && <span style={{ fontFamily:mono, fontSize:FS.xs, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.blue+'22', color:T.blue }}>Follow-up due</span>}
                <button onClick={()=>{setForm(r);setTriedSave(false);setShowForm(true)}} style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, background:'none', border:`1px solid ${T.border}`, borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>Edit</button>
              </div>
            </div>
            <div style={{ display:'flex', gap:16, marginTop:8, flexWrap:'wrap' }}>
              <span style={{ fontFamily:mono, fontSize:FS.xs, color:T.muted }}>Checked: {r.check_date}</span>
              {r.expiry_date && <span style={{ fontFamily:mono, fontSize:FS.xs, color:expired?T.red:expiring?T.amber:T.muted }}>Expires: {r.expiry_date}</span>}
              {r.follow_up_date && <span style={{ fontFamily:mono, fontSize:FS.xs, color:followUpDue?T.blue:T.muted }}>Follow-up: {r.follow_up_date}</span>}
            </div>
            {r.notes && <div style={{ fontFamily:SANS, fontSize:FS.sm, color:T.muted, marginTop:6 }}>{r.notes}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ── DEPOSIT PROTECTION TAB ────────────────────────────────────────────────────
export function DepositProtectionTab({ propertyId, userId, showToast, T }) {
  const mono = MONO
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const SCHEMES = [
    { key: 'dps', label: 'DPS — Deposit Protection Service' },
    { key: 'tds', label: 'TDS — Tenancy Deposit Scheme' },
    { key: 'mydeposits', label: 'mydeposits' },
    { key: 'dps_custodial', label: 'DPS Custodial' },
    { key: 'other', label: 'Other scheme' },
  ]

  useEffect(() => {
    api.fetchDepositProtection(propertyId)
      .then(d => { setRecords(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [propertyId])

  async function save() {
    setSaving(true)
    try {
      const saved = await api.saveDepositProtection({ ...form, property_id: propertyId, user_id: userId })
      if (form.id) setRecords(p => p.map(r => r.id === saved.id ? saved : r))
      else setRecords(p => [saved, ...p])
      setShowForm(false); setForm({})
      showToast('Deposit protection record saved')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none', width: '100%' }
  const lbl = { fontFamily: SANS, fontSize: FS.sm, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Deposit protection</div>
          <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 3 }}>You must protect deposits within 30 days of receipt and provide prescribed information to tenants.</div>
        </div>
        <Button size="sm" icon="plus" style={{ flexShrink: 0 }} onClick={() => { setForm({}); setShowForm(true) }}>
          Add record
        </Button>
      </div>

      {showForm && (
        <form onSubmit={e=>{e.preventDefault(); save()}} style={{ background: T.card, border: `1px solid ${T.gold}44`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl} htmlFor="dp-tenant-name">Tenant name</label><input id="dp-tenant-name" value={form.tenant_name||''} onChange={e=>setForm(p=>({...p,tenant_name:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="dp-amount">Deposit amount</label><MoneyInput id="dp-amount" prefix="£" value={form.amount} onChange={v=>setForm(p=>({...p,amount:v}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="dp-scheme">Protection scheme</label>
              <select id="dp-scheme" value={form.scheme||'dps'} onChange={e=>setForm(p=>({...p,scheme:e.target.value}))} style={inp}>
                {SCHEMES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div><label style={lbl} htmlFor="dp-reference">Certificate / reference number</label><input id="dp-reference" value={form.reference||''} onChange={e=>setForm(p=>({...p,reference:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="dp-registered">Date registered</label><input id="dp-registered" type="date" value={form.registered_date||''} onChange={e=>setForm(p=>({...p,registered_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="dp-info-sent">Prescribed info sent to tenant</label>
              <select id="dp-info-sent" value={form.prescribed_info_sent||'no'} onChange={e=>setForm(p=>({...p,prescribed_info_sent:e.target.value}))} style={inp}>
                <option value="yes">Yes — confirmed sent</option>
                <option value="no">No — not yet sent</option>
              </select>
            </div>
            <div style={{gridColumn:'span 2'}}><label style={lbl} htmlFor="dp-notes">Notes</label><textarea id="dp-notes" value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inp,resize:'none'}}/></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {loading ? <SkeletonList count={2} height={64}/>
      : records.length === 0 ? (
        <EmptyState compact icon="shield-check" title="No deposit protection records" body="Record where each deposit is protected and when prescribed information was sent."/>
      ) : records.map(r => (
        <div key={r.id} style={{ background: T.card, border: `1px solid ${r.prescribed_info_sent!=='yes'?T.amber:T.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>{r.tenant_name} — {SCHEMES.find(s=>s.key===r.scheme)?.label.split('—')[0]||r.scheme}</div>
              <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>
                Ref: {r.reference||'—'} · Registered: {r.registered_date||'—'} · Amount: {r.amount ? fmt(r.amount) : '—'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {r.prescribed_info_sent !== 'yes' && (
                <span style={{ fontFamily: SANS, fontSize: FS.sm, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.amber+'22', color: T.amber }}>Prescribed info not sent</span>
              )}
              <span style={{ fontFamily: mono, fontSize: FS.xs, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.green+'22', color: T.green }}>Protected</span>
              <button onClick={() => { setForm(r); setShowForm(true) }} style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── NOTICE TRACKER (S8 / S13) ─────────────────────────────────────────────────
export function NoticeTrackerTab({ propertyId, userId, showToast, T, property }) {
  const mono = MONO
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  // null | 's8' | 's13' — which generator is open
  const [generator, setGenerator] = useState(null)
  const [lastIncreaseDate, setLastIncreaseDate] = useState('')
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  // Section 21 was abolished in England from 1 May 2026. It stays as a type
  // so older records still display, but can't be chosen for a new notice.
  const NOTICE_TYPES = [
    { key: 's8', label: 'Section 8 — Possession (Form 3A)' },
    { key: 's13', label: 'Section 13 — Rent increase (Form 4A)' },
    { key: 's48', label: 'Section 48 — Landlord address' },
    { key: 'other', label: 'Other notice' },
    { key: 's21', label: 'Section 21 — served before 1 May 2026', legacy: true },
  ]
  const S8_GROUNDS = GROUNDS.map(groundLabel)

  async function openRentIncrease() {
    // Prefill the 52-week rule from the most recent logged increase.
    try {
      const hist = await api.fetchRentHistory(propertyId)
      const last = (hist || []).filter(r => r.change_type === 'increase' && r.effective_date)
        .map(r => r.effective_date).sort().pop()
      setLastIncreaseDate(last || '')
    } catch { setLastIncreaseDate('') }
    setGenerator('s13')
  }
  const STATUSES = [
    { key: 'draft', label: 'Draft', color: T.muted },
    { key: 'served', label: 'Served', color: T.blue },
    { key: 'court_filed', label: 'Court filed', color: T.goldText },
    { key: 'hearing', label: 'Hearing set', color: T.amber },
    { key: 'possession', label: 'Possession granted', color: T.green },
    { key: 'withdrawn', label: 'Withdrawn', color: T.muted },
  ]

  useEffect(() => {
    api.fetchNotices(propertyId).then(d => { setNotices(d); setLoading(false) }).catch(() => setLoading(false))
  }, [propertyId])

  async function save() {
    setSaving(true)
    try {
      const saved = await api.saveNotice({ ...form, property_id: propertyId, user_id: userId })
      if (form.id) setNotices(p => p.map(n => n.id === saved.id ? saved : n))
      else setNotices(p => [saved, ...p])
      setShowForm(false); setForm({})
      showToast('Notice saved')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none', width: '100%' }
  const lbl = { fontFamily: SANS, fontSize: FS.sm, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Legal notices</div>
          <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 3 }}>Prepare and track possession (section 8) and rent increase (section 13) notices. England only; section 21 ended on 1 May 2026.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={() => setGenerator('s8')}
            style={{ fontFamily: SANS, fontSize: FS.sm, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.amber}`, background: T.amber + '14', color: T.text, cursor: 'pointer' }}>
            Prepare Form 3A
          </button>
          <Button variant="secondary" size="sm" onClick={openRentIncrease}>
            Prepare Form 4A
          </Button>
          <Button variant="danger" size="sm" icon="plus" onClick={() => { setForm({ notice_type: 's8', status: 'draft' }); setShowForm(true) }}>
            Log notice
          </Button>
        </div>
      </div>

      {generator && (
        <NoticeGenerator
          key={generator}
          initialType={generator}
          lastIncreaseDate={lastIncreaseDate}
          property={property || { id: propertyId, address: '' }}
          userId={userId}
          showToast={showToast}
          onClose={() => {
            setGenerator(null)
            // Refresh in case a draft was logged
            api.fetchNotices(propertyId).then(setNotices).catch(()=>{})
          }}/>
      )}

      {showForm && (
        <form onSubmit={e=>{e.preventDefault(); save()}} style={{ background: T.card, border: `1px solid ${T.red}44`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl} htmlFor="nt-type">Notice type</label>
              <select id="nt-type" value={form.notice_type||'s8'} onChange={e=>setForm(p=>({...p,notice_type:e.target.value}))} style={inp}>
                {NOTICE_TYPES.filter(n => !n.legacy || form.notice_type === n.key).map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
              </select>
            </div>
            <div><label style={lbl} htmlFor="nt-status">Status</label>
              <select id="nt-status" value={form.status||'draft'} onChange={e=>setForm(p=>({...p,status:e.target.value}))} style={inp}>
                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            {form.notice_type === 's8' && (
              <div style={{gridColumn:'span 2'}}><label style={lbl} htmlFor="nt-grounds">Ground(s)</label>
                <select id="nt-grounds" value={form.grounds||''} onChange={e=>setForm(p=>({...p,grounds:e.target.value}))} style={inp}>
                  <option value="">Select ground…</option>
                  {/* Older records may hold pre-reform labels or several grounds: keep them selectable. */}
                  {(form.grounds && !S8_GROUNDS.includes(form.grounds) ? [form.grounds, ...S8_GROUNDS] : S8_GROUNDS)
                    .map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
            <div><label style={lbl} htmlFor="nt-served">Date served / issued</label><input id="nt-served" type="date" value={form.served_date||''} onChange={e=>setForm(p=>({...p,served_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="nt-expiry">Expiry / possession date</label><input id="nt-expiry" type="date" value={form.expiry_date||''} onChange={e=>setForm(p=>({...p,expiry_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="nt-court">Court hearing date</label><input id="nt-court" type="date" value={form.court_date||''} onChange={e=>setForm(p=>({...p,court_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="nt-ref">Solicitor / agent reference</label><input id="nt-ref" value={form.solicitor_ref||''} onChange={e=>setForm(p=>({...p,solicitor_ref:e.target.value}))} style={inp}/></div>
            <div style={{gridColumn:'span 2'}}><label style={lbl} htmlFor="nt-notes">Notes</label><textarea id="nt-notes" value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inp,resize:'none'}}/></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" variant="danger" size="sm" disabled={saving}>{saving?'Saving…':'Save notice'}</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {loading ? <SkeletonList count={2} height={64}/>
      : notices.length === 0 ? <EmptyState compact icon="file-text" title="No notices logged"/>
      : notices.map(n => {
        const st = STATUSES.find(s => s.key === n.status) || STATUSES[0]
        const nt = NOTICE_TYPES.find(t => t.key === n.notice_type) || NOTICE_TYPES[0]
        const courtDue = n.court_date && new Date(n.court_date) > new Date()
        const daysToHearing = n.court_date ? Math.ceil((new Date(n.court_date) - new Date()) / (1000*60*60*24)) : null
        return (
          <div key={n.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>{nt.label}</div>
                <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>
                  Served: {n.served_date||'—'} · Expiry: {n.expiry_date||'—'}
                  {n.solicitor_ref && ` · Ref: ${n.solicitor_ref}`}
                </div>
                {daysToHearing !== null && daysToHearing > 0 && (
                  <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.amber, marginTop: 4 }}>Hearing in {daysToHearing} days ({n.court_date})</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontFamily: SANS, fontSize: FS.sm, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: st.color+'22', color: st.color }}>{st.label}</span>
                <button onClick={() => { setForm(n); setShowForm(true) }} style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── RENT INCREASE TRACKER ─────────────────────────────────────────────────────
export function RentHistoryTab({ propertyId, userId, showToast, T, property }) {
  const mono = MONO
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showForm4A, setShowForm4A] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.fetchRentHistory(propertyId).then(d => { setHistory(d); setLoading(false) }).catch(() => setLoading(false))
  }, [propertyId])

  async function save() {
    setSaving(true)
    try {
      const saved = await api.saveRentHistory({ ...form, property_id: propertyId, user_id: userId })
      if (form.id) setHistory(p => p.map(r => r.id === saved.id ? saved : r))
      else setHistory(p => [saved, ...p].sort((a,b) => new Date(b.effective_date) - new Date(a.effective_date)))
      setShowForm(false); setForm({})
      showToast('Rent record saved')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  const inp = { fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', outline: 'none', width: '100%' }
  const lbl = { fontFamily: SANS, fontSize: FS.sm, fontWeight: 600, color: T.muted, display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Rent history</div>
          <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 3 }}>Track every rent change with dates and review schedules.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => setShowForm4A(true)}>
            Prepare Form 4A
          </Button>
          <Button size="sm" icon="plus" onClick={() => { setForm({ change_type: 'increase' }); setShowForm(true) }}>
            Log change
          </Button>
        </div>
      </div>

      {!loading && (() => {
        // Section 13: when could a rent increase served today take effect?
        const tenancyStart = currentTenancyStart(property)
        const last = history.filter(r => r.change_type === 'increase' && r.effective_date).map(r => r.effective_date).sort().pop()
        const today = new Date().toISOString().slice(0, 10)
        const { date } = earliestRentIncreaseDate({ dateServed: today, tenancyStart, lastIncreaseDate: last })
        if (!date) return null
        return (
          <div style={{ fontSize: 12, color: T.text, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, lineHeight: 1.55 }}>
            A section 13 increase served today could take effect from <strong>{date}</strong>
            {!tenancyStart && ' (add the tenancy start date for an exact answer)'}.
            {' '}Rent can rise once every 52 weeks, with at least two months&rsquo; notice on Form 4A.
          </div>
        )
      })()}

      {showForm4A && (
        <NoticeGenerator
          initialType="s13"
          lastIncreaseDate={history.filter(r => r.change_type === 'increase' && r.effective_date).map(r => r.effective_date).sort().pop() || ''}
          property={property || { id: propertyId, address: '' }}
          userId={userId}
          showToast={showToast}
          onClose={() => setShowForm4A(false)}/>
      )}

      {showForm && (
        <form onSubmit={e=>{e.preventDefault(); save()}} style={{ background: T.card, border: `1px solid ${T.gold}44`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl} htmlFor="rh-change-type">Change type</label>
              <select id="rh-change-type" value={form.change_type||'increase'} onChange={e=>setForm(p=>({...p,change_type:e.target.value}))} style={inp}>
                <option value="increase">Rent increase</option>
                <option value="decrease">Rent decrease</option>
                <option value="initial">Initial rent (at start)</option>
                <option value="review">Scheduled review</option>
              </select>
            </div>
            <div><label style={lbl} htmlFor="rh-effective">Effective date</label><input id="rh-effective" type="date" value={form.effective_date||''} onChange={e=>setForm(p=>({...p,effective_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="rh-prev-rent">Previous rent</label><MoneyInput id="rh-prev-rent" prefix="£" suffix="/mo" value={form.previous_rent} onChange={v=>setForm(p=>({...p,previous_rent:v}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="rh-new-rent">New rent</label><MoneyInput id="rh-new-rent" prefix="£" suffix="/mo" value={form.new_rent} onChange={v=>setForm(p=>({...p,new_rent:v}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="rh-review">Next review date</label><input id="rh-review" type="date" value={form.next_review_date||''} onChange={e=>setForm(p=>({...p,next_review_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl} htmlFor="rh-notice-served">Notice served to tenant</label>
              <select id="rh-notice-served" value={form.notice_served||'no'} onChange={e=>setForm(p=>({...p,notice_served:e.target.value}))} style={inp}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div style={{gridColumn:'span 2'}}><label style={lbl} htmlFor="rh-notes">Notes</label><input id="rh-notes" value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} style={inp}/></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" size="sm" disabled={saving}>{saving?'Saving…':'Save'}</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {loading ? <SkeletonList count={2} height={64}/>
      : history.length === 0 ? <EmptyState compact icon="trending-up" title="No rent history recorded"/>
      : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 20, top: 0, bottom: 0, width: 1, background: T.border }}/>
          {history.map((r, i) => {
            const pct = r.previous_rent && r.new_rent ? ((r.new_rent - r.previous_rent) / r.previous_rent * 100).toFixed(1) : null
            const isIncrease = parseFloat(pct) >= 0
            return (
              <div key={r.id} style={{ display: 'flex', gap: 16, marginBottom: 14, paddingLeft: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: isIncrease?T.green:T.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4, zIndex: 1 }}>
                  <span style={{ fontFamily: mono, fontSize: FS.xs, color: 'white', fontWeight: 700 }}>{isIncrease?'↑':'↓'}</span>
                </div>
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                        {r.new_rent ? `${fmt(r.new_rent)}/mo` : 'Rent review'}
                        {pct && <span style={{ fontFamily: mono, fontSize: FS.xs, marginLeft: 8, color: isIncrease?T.green:T.blue }}>({isIncrease?'+':''}{pct}%)</span>}
                      </div>
                      {r.previous_rent && <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>Previous: {fmt(r.previous_rent)}/mo</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>{r.effective_date}</div>
                      {r.next_review_date && <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.blue, marginTop: 2 }}>Review: {r.next_review_date}</div>}
                    </div>
                  </div>
                  {r.notes && <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 6 }}>{r.notes}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── TENANCY RENEWAL ALERT ─────────────────────────────────────────────────────
export function TenancyRenewalAlert({ propertyId, rentPcm, showToast, T }) {
  const mono = MONO
  const [tenancy, setTenancy]   = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)
  // Inline required-field highlighting once renewal is tried with no end date.
  const [triedSave, setTriedSave] = useState(false)

  useEffect(() => {
    api.fetchTenancyDetails(propertyId)
      .then(setTenancy)
      .catch(() => {})
  }, [propertyId])

  if (!tenancy?.tenancy_end) return null

  const today = new Date()
  const endDate = new Date(tenancy.tenancy_end)
  const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24))

  if (daysLeft > 90 || daysLeft < -30) return null

  const urgency = daysLeft <= 0 ? 'expired' : daysLeft <= 30 ? 'urgent' : daysLeft <= 60 ? 'soon' : 'upcoming'
  const color = { expired:T.red, urgent:T.amber, soon:T.goldText, upcoming:T.blue }[urgency]

  async function handleRenew() {
    if (!form.new_end_date) { setTriedSave(true); showToast('Enter new end date', 'error'); return }
    setSaving(true)
    try {
      await api.updateTenancyDetails(propertyId, { tenancy_end: form.new_end_date })
      // Rent lives on the property, not tenancy_details.
      if (form.new_rent) await api.updateProperty(propertyId, { rent_pcm: parseFloat(form.new_rent) })
      setTenancy(p => ({ ...p, tenancy_end: form.new_end_date }))
      setShowForm(false)
      showToast('Tenancy renewed ✓')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  return (
    <div style={{ background: color + '11', border: `1px solid ${color}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
            {urgency !== 'expired' && <Icon name="clock" size={13}/>}
            {urgency === 'expired' ? 'Tenancy expired' : `Tenancy ends in ${daysLeft} days`}
          </div>
          <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted }}>
            End date: {new Date(tenancy.tenancy_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {rentPcm ? ` · Current rent: ${fmt(rentPcm)}/mo` : ''}
          </div>
        </div>
        {!showForm && (
          <button onClick={() => { setForm({ new_end_date: '', new_rent: rentPcm || '' }); setTriedSave(false); setShowForm(true) }}
            style={{ fontFamily: SANS, fontSize: FS.sm, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', background: color, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
            Renew tenancy
          </button>
        )}
      </div>
      {showForm && (
        <form onSubmit={e => { e.preventDefault(); handleRenew() }} style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="tr-end-date" style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginBottom: 4, display: 'block' }}>New end date</label>
            <input id="tr-end-date" type="date" value={form.new_end_date || ''} onChange={e => setForm(p => ({ ...p, new_end_date: e.target.value }))}
              aria-invalid={triedSave && !form.new_end_date ? 'true' : undefined}
              aria-describedby={triedSave && !form.new_end_date ? 'tr-end-date-err' : undefined}
              style={{ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${triedSave && !form.new_end_date ? T.red : T.border}`, color: T.text, borderRadius: 6, padding: '6px 10px' }}/>
            {triedSave && !form.new_end_date && <span id="tr-end-date-err" style={{ fontFamily: mono, fontSize: FS.xs, color: T.red, display: 'block', marginTop: 4 }}>Required</span>}
          </div>
          <div>
            <label htmlFor="tr-new-rent" style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginBottom: 4, display: 'block' }}>New rent (optional)</label>
            <MoneyInput id="tr-new-rent" prefix="£" value={form.new_rent} onChange={v => setForm(p => ({ ...p, new_rent: v }))}
              placeholder="Same as current"
              style={{ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 6, padding: '6px 10px', width: 120 }}/>
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Saving…' : 'Confirm renewal'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowForm(false)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}
