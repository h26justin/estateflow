// Tenancy sub-tabs: extracted from FeatureComponents.jsx for maintainability.
// All five components accept `T` (theme tokens) as a prop and use the shared
// api module — no theme-context dependency, no other cross-cutting state.

import { useState, useEffect } from 'react'
import * as api from '../../lib/api'
import { fmt } from '../../lib/format'
import MoneyInput from '../../lib/MoneyInput'
import NoticeGenerator from '../NoticeGenerator'

// ── RIGHT TO RENT TAB ─────────────────────────────────────────────────────────
export function RightToRentTab({ propertyId, userId, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)

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
  const lbl = { fontFamily:mono, fontSize:10, color:T.muted, display:'block', marginBottom:5 }

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
          <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em' }}>Right to rent checks</div>
          <div style={{ fontFamily:mono, fontSize:11, color:T.muted, marginTop:3 }}>Landlords are legally required to check tenants have the right to rent in the UK.</div>
        </div>
        <button onClick={() => { setForm({}); setShowForm(true) }}
          style={{ fontFamily:mono, fontSize:11, fontWeight:700, padding:'7px 14px', borderRadius:8, border:'none', background:T.gold, color:'white', cursor:'pointer', flexShrink:0 }}>
          + Add check
        </button>
      </div>

      {showForm && (
        <div style={{ background:T.card, border:`1px solid ${T.gold}44`, borderRadius:12, padding:'18px 20px', marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <div><label style={lbl}>Tenant name *</label><input value={form.tenant_name||''} onChange={e=>setForm(p=>({...p,tenant_name:e.target.value}))} placeholder="Full legal name" style={inp}/></div>
            <div><label style={lbl}>Document type</label>
              <select value={form.doc_type||'passport'} onChange={e=>setForm(p=>({...p,doc_type:e.target.value}))} style={inp}>
                {DOC_TYPES.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Document reference / number</label><input value={form.doc_reference||''} onChange={e=>setForm(p=>({...p,doc_reference:e.target.value}))} placeholder="Passport no. etc" style={inp}/></div>
            <div><label style={lbl}>Check date *</label><input type="date" value={form.check_date||''} onChange={e=>setForm(p=>({...p,check_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Document expiry date</label><input type="date" value={form.expiry_date||''} onChange={e=>setForm(p=>({...p,expiry_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Follow-up check date</label><input type="date" value={form.follow_up_date||''} onChange={e=>setForm(p=>({...p,follow_up_date:e.target.value}))} style={inp}/></div>
          </div>
          <div style={{ marginBottom:10 }}><label style={lbl}>Notes</label><textarea value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inp,resize:'none'}}/></div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={save} disabled={saving||!form.tenant_name||!form.check_date}
              style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'8px 18px', borderRadius:8, border:'none', background:T.gold, color:'white', cursor:'pointer' }}>
              {saving?'Saving…':'Save record'}
            </button>
            <button onClick={()=>setShowForm(false)} style={{ fontFamily:mono, fontSize:12, padding:'8px 14px', borderRadius:8, border:`1px solid ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ fontFamily:mono, fontSize:12, color:T.muted }}>Loading…</div>
      : records.length === 0 ? (
        <div style={{ background:T.bg, borderRadius:10, padding:'20px', textAlign:'center', fontFamily:mono, fontSize:12, color:T.muted }}>
          No right to rent checks recorded for this property.
        </div>
      ) : records.map(r => {
        const expired = isExpired(r.expiry_date)
        const expiring = isExpiring(r.expiry_date)
        const followUpDue = r.follow_up_date && new Date(r.follow_up_date) <= new Date()
        return (
          <div key={r.id} style={{ background:T.card, border:`1px solid ${expired?T.red:expiring?T.amber:T.border}`, borderRadius:10, padding:'12px 16px', marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:3 }}>{r.tenant_name}</div>
                <div style={{ fontFamily:mono, fontSize:10, color:T.muted }}>
                  {DOC_TYPES.find(d=>d.key===r.doc_type)?.label||r.doc_type}
                  {r.doc_reference && ` · ${r.doc_reference}`}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                {expired && <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.red+'22', color:T.red }}>⚑ EXPIRED</span>}
                {expiring && <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:T.amber+'22', color:T.amber }}>Expiring soon</span>}
                {followUpDue && <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'#4B8FE022', color:'#4B8FE0' }}>Follow-up due</span>}
                <button onClick={()=>{setForm(r);setShowForm(true)}} style={{ fontFamily:mono, fontSize:10, color:T.muted, background:'none', border:`1px solid ${T.border}`, borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>Edit</button>
              </div>
            </div>
            <div style={{ display:'flex', gap:16, marginTop:8, flexWrap:'wrap' }}>
              <span style={{ fontFamily:mono, fontSize:10, color:T.muted }}>Checked: {r.check_date}</span>
              {r.expiry_date && <span style={{ fontFamily:mono, fontSize:10, color:expired?T.red:expiring?T.amber:T.muted }}>Expires: {r.expiry_date}</span>}
              {r.follow_up_date && <span style={{ fontFamily:mono, fontSize:10, color:followUpDue?'#4B8FE0':T.muted }}>Follow-up: {r.follow_up_date}</span>}
            </div>
            {r.notes && <div style={{ fontFamily:mono, fontSize:11, color:T.muted, marginTop:6 }}>{r.notes}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ── DEPOSIT PROTECTION TAB ────────────────────────────────────────────────────
export function DepositProtectionTab({ propertyId, userId, showToast, T }) {
  const mono = "'DM Mono',monospace"
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
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Deposit protection</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>You must protect deposits within 30 days of receipt and provide prescribed information to tenants.</div>
        </div>
        <button onClick={() => { setForm({}); setShowForm(true) }}
          style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: 'none', background: T.gold, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
          + Add record
        </button>
      </div>

      {showForm && (
        <div style={{ background: T.card, border: `1px solid ${T.gold}44`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Tenant name</label><input value={form.tenant_name||''} onChange={e=>setForm(p=>({...p,tenant_name:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Deposit amount</label><MoneyInput prefix="£" value={form.amount} onChange={v=>setForm(p=>({...p,amount:v}))} style={inp}/></div>
            <div><label style={lbl}>Protection scheme</label>
              <select value={form.scheme||'dps'} onChange={e=>setForm(p=>({...p,scheme:e.target.value}))} style={inp}>
                {SCHEMES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Certificate / reference number</label><input value={form.reference||''} onChange={e=>setForm(p=>({...p,reference:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Date registered</label><input type="date" value={form.registered_date||''} onChange={e=>setForm(p=>({...p,registered_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Prescribed info sent to tenant</label>
              <select value={form.prescribed_info_sent||'no'} onChange={e=>setForm(p=>({...p,prescribed_info_sent:e.target.value}))} style={inp}>
                <option value="yes">Yes — confirmed sent</option>
                <option value="no">No — not yet sent</option>
              </select>
            </div>
            <div style={{gridColumn:'span 2'}}><label style={lbl}>Notes</label><textarea value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inp,resize:'none'}}/></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving}
              style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: T.gold, color: 'white', cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ fontFamily: mono, fontSize: 12, padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
      : records.length === 0 ? (
        <div style={{ background: T.bg, borderRadius: 10, padding: 20, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No deposit protection records for this property.</div>
      ) : records.map(r => (
        <div key={r.id} style={{ background: T.card, border: `1px solid ${r.prescribed_info_sent!=='yes'?T.amber:T.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>{r.tenant_name} — {SCHEMES.find(s=>s.key===r.scheme)?.label.split('—')[0]||r.scheme}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                Ref: {r.reference||'—'} · Registered: {r.registered_date||'—'} · Amount: {r.amount ? fmt(r.amount) : '—'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {r.prescribed_info_sent !== 'yes' && (
                <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.amber+'22', color: T.amber }}>⚑ Prescribed info not sent</span>
              )}
              <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#2ECC8A22', color: '#2ECC8A' }}>Protected</span>
              <button onClick={() => { setForm(r); setShowForm(true) }} style={{ fontFamily: mono, fontSize: 10, color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── NOTICE TRACKER (S21 / S8) ─────────────────────────────────────────────────
export function NoticeTrackerTab({ propertyId, userId, showToast, T, property }) {
  const mono = "'DM Mono',monospace"
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const NOTICE_TYPES = [
    { key: 's21', label: 'Section 21 — No-fault possession' },
    { key: 's8', label: 'Section 8 — Fault-based possession' },
    { key: 's13', label: 'Section 13 — Rent increase' },
    { key: 's48', label: 'Section 48 — Landlord address' },
    { key: 'other', label: 'Other notice' },
  ]
  const S8_GROUNDS = ['Ground 8 (2mo+ arrears)','Ground 10 (some arrears)','Ground 11 (persistent late)','Ground 12 (breach of tenancy)','Ground 14 (nuisance)','Ground 17 (false statement)']
  const STATUSES = [
    { key: 'draft', label: 'Draft', color: T.muted },
    { key: 'served', label: 'Served', color: '#4B8FE0' },
    { key: 'court_filed', label: 'Court filed', color: '#C8A84B' },
    { key: 'hearing', label: 'Hearing set', color: '#E0943A' },
    { key: 'possession', label: 'Possession granted', color: '#2ECC8A' },
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
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Legal notices</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>Track Section 21, Section 8 and other notices served on tenants.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => setShowGenerator(true)}
            style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.amber}`, background: T.amber + '14', color: T.amber, cursor: 'pointer' }}>
            ✎ Generate S21/S8
          </button>
          <button onClick={() => { setForm({ notice_type: 's21', status: 'draft' }); setShowForm(true) }}
            style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: 'none', background: T.red, color: 'white', cursor: 'pointer' }}>
            + Log notice
          </button>
        </div>
      </div>

      {showGenerator && (
        <NoticeGenerator
          property={property || { id: propertyId, address: '' }}
          userId={userId}
          showToast={showToast}
          onClose={() => {
            setShowGenerator(false)
            // Refresh in case a draft was logged
            api.fetchNotices(propertyId).then(setNotices).catch(()=>{})
          }}/>
      )}

      {showForm && (
        <div style={{ background: T.card, border: `1px solid ${T.red}44`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Notice type</label>
              <select value={form.notice_type||'s21'} onChange={e=>setForm(p=>({...p,notice_type:e.target.value}))} style={inp}>
                {NOTICE_TYPES.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Status</label>
              <select value={form.status||'draft'} onChange={e=>setForm(p=>({...p,status:e.target.value}))} style={inp}>
                {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            {form.notice_type === 's8' && (
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Ground(s)</label>
                <select value={form.grounds||''} onChange={e=>setForm(p=>({...p,grounds:e.target.value}))} style={inp}>
                  <option value="">Select ground…</option>
                  {S8_GROUNDS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
            <div><label style={lbl}>Date served / issued</label><input type="date" value={form.served_date||''} onChange={e=>setForm(p=>({...p,served_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Expiry / possession date</label><input type="date" value={form.expiry_date||''} onChange={e=>setForm(p=>({...p,expiry_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Court hearing date</label><input type="date" value={form.court_date||''} onChange={e=>setForm(p=>({...p,court_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Solicitor / agent reference</label><input value={form.solicitor_ref||''} onChange={e=>setForm(p=>({...p,solicitor_ref:e.target.value}))} style={inp}/></div>
            <div style={{gridColumn:'span 2'}}><label style={lbl}>Notes</label><textarea value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{...inp,resize:'none'}}/></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: T.red, color: 'white', cursor: 'pointer' }}>{saving?'Saving…':'Save notice'}</button>
            <button onClick={() => setShowForm(false)} style={{ fontFamily: mono, fontSize: 12, padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
      : notices.length === 0 ? <div style={{ background: T.bg, borderRadius: 10, padding: 20, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No notices logged.</div>
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
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                  Served: {n.served_date||'—'} · Expiry: {n.expiry_date||'—'}
                  {n.solicitor_ref && ` · Ref: ${n.solicitor_ref}`}
                </div>
                {daysToHearing !== null && daysToHearing > 0 && (
                  <div style={{ fontFamily: mono, fontSize: 10, color: '#E0943A', marginTop: 4 }}>⏰ Hearing in {daysToHearing} days ({n.court_date})</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: st.color+'22', color: st.color }}>{st.label}</span>
                <button onClick={() => { setForm(n); setShowForm(true) }} style={{ fontFamily: mono, fontSize: 10, color: T.muted, background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>Edit</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── RENT INCREASE TRACKER ─────────────────────────────────────────────────────
export function RentHistoryTab({ propertyId, userId, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
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
  const lbl = { fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 5 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Rent history</div>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 3 }}>Track every rent change with dates and review schedules.</div>
        </div>
        <button onClick={() => { setForm({ change_type: 'increase' }); setShowForm(true) }}
          style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#2ECC8A', color: 'white', cursor: 'pointer', flexShrink: 0 }}>
          + Log change
        </button>
      </div>

      {showForm && (
        <div style={{ background: T.card, border: `1px solid ${T.gold}44`, borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Change type</label>
              <select value={form.change_type||'increase'} onChange={e=>setForm(p=>({...p,change_type:e.target.value}))} style={inp}>
                <option value="increase">Rent increase</option>
                <option value="decrease">Rent decrease</option>
                <option value="initial">Initial rent (at start)</option>
                <option value="review">Scheduled review</option>
              </select>
            </div>
            <div><label style={lbl}>Effective date</label><input type="date" value={form.effective_date||''} onChange={e=>setForm(p=>({...p,effective_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Previous rent</label><MoneyInput prefix="£" suffix="/mo" value={form.previous_rent} onChange={v=>setForm(p=>({...p,previous_rent:v}))} style={inp}/></div>
            <div><label style={lbl}>New rent</label><MoneyInput prefix="£" suffix="/mo" value={form.new_rent} onChange={v=>setForm(p=>({...p,new_rent:v}))} style={inp}/></div>
            <div><label style={lbl}>Next review date</label><input type="date" value={form.next_review_date||''} onChange={e=>setForm(p=>({...p,next_review_date:e.target.value}))} style={inp}/></div>
            <div><label style={lbl}>Notice served to tenant</label>
              <select value={form.notice_served||'no'} onChange={e=>setForm(p=>({...p,notice_served:e.target.value}))} style={inp}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div style={{gridColumn:'span 2'}}><label style={lbl}>Notes</label><input value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} style={inp}/></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2ECC8A', color: 'white', cursor: 'pointer' }}>{saving?'Saving…':'Save'}</button>
            <button onClick={() => setShowForm(false)} style={{ fontFamily: mono, fontSize: 12, padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
      : history.length === 0 ? <div style={{ background: T.bg, borderRadius: 10, padding: 20, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No rent history recorded.</div>
      : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 20, top: 0, bottom: 0, width: 1, background: T.border }}/>
          {history.map((r, i) => {
            const pct = r.previous_rent && r.new_rent ? ((r.new_rent - r.previous_rent) / r.previous_rent * 100).toFixed(1) : null
            const isIncrease = parseFloat(pct) >= 0
            return (
              <div key={r.id} style={{ display: 'flex', gap: 16, marginBottom: 14, paddingLeft: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: isIncrease?'#2ECC8A':'#4B8FE0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4, zIndex: 1 }}>
                  <span style={{ fontFamily: mono, fontSize: 10, color: 'white', fontWeight: 700 }}>{isIncrease?'↑':'↓'}</span>
                </div>
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                        {r.new_rent ? `${fmt(r.new_rent)}/mo` : 'Rent review'}
                        {pct && <span style={{ fontFamily: mono, fontSize: 10, marginLeft: 8, color: isIncrease?'#2ECC8A':'#4B8FE0' }}>({isIncrease?'+':''}{pct}%)</span>}
                      </div>
                      {r.previous_rent && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>Previous: {fmt(r.previous_rent)}/mo</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>{r.effective_date}</div>
                      {r.next_review_date && <div style={{ fontFamily: mono, fontSize: 10, color: '#4B8FE0', marginTop: 2 }}>Review: {r.next_review_date}</div>}
                    </div>
                  </div>
                  {r.notes && <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>{r.notes}</div>}
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
export function TenancyRenewalAlert({ propertyId, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [tenancy, setTenancy]   = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    api.fetchTenancyDetails(propertyId)
      .then(setTenancy)
      .catch(() => {})
  }, [propertyId])

  if (!tenancy?.tenancy_end_date) return null

  const today = new Date()
  const endDate = new Date(tenancy.tenancy_end_date)
  const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24))

  if (daysLeft > 90 || daysLeft < -30) return null

  const urgency = daysLeft <= 0 ? 'expired' : daysLeft <= 30 ? 'urgent' : daysLeft <= 60 ? 'soon' : 'upcoming'
  const color = { expired:'#E05555', urgent:'#E0943A', soon:'#C8A84B', upcoming:'#4B8FE0' }[urgency]

  async function handleRenew() {
    if (!form.new_end_date) { showToast('Enter new end date', 'error'); return }
    setSaving(true)
    try {
      await api.updateTenancyDetails(propertyId, {
        tenancy_end_date: form.new_end_date,
        ...(form.new_rent ? { rent_pcm: parseFloat(form.new_rent) } : {})
      })
      setTenancy(p => ({ ...p, tenancy_end_date: form.new_end_date }))
      setShowForm(false)
      showToast('Tenancy renewed ✓')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  return (
    <div style={{ background: color + '11', border: `1px solid ${color}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color, marginBottom: 3 }}>
            {urgency === 'expired' ? '⚑ Tenancy expired' : `⏰ Tenancy ends in ${daysLeft} days`}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T?.muted || '#888' }}>
            End date: {new Date(tenancy.tenancy_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {tenancy.rent_pcm ? ` · Current rent: ${fmt(tenancy.rent_pcm)}/mo` : ''}
          </div>
        </div>
        {!showForm && (
          <button onClick={() => { setForm({ new_end_date: '', new_rent: tenancy.rent_pcm || '' }); setShowForm(true) }}
            style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', background: color, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
            Renew tenancy
          </button>
        )}
      </div>
      {showForm && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T?.muted || '#888', marginBottom: 4 }}>New end date</div>
            <input type="date" value={form.new_end_date || ''} onChange={e => setForm(p => ({ ...p, new_end_date: e.target.value }))}
              style={{ fontFamily: mono, fontSize: 12, background: T?.bg || '#fff', border: `1px solid ${T?.border || '#ddd'}`, color: T?.text || '#333', borderRadius: 6, padding: '6px 10px', outline: 'none' }}/>
          </div>
          <div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T?.muted || '#888', marginBottom: 4 }}>New rent (optional)</div>
            <MoneyInput prefix="£" value={form.new_rent} onChange={v => setForm(p => ({ ...p, new_rent: v }))}
              placeholder="Same as current"
              style={{ fontFamily: mono, fontSize: 12, background: T?.bg || '#fff', border: `1px solid ${T?.border || '#ddd'}`, color: T?.text || '#333', borderRadius: 6, padding: '6px 10px', width: 120, outline: 'none' }}/>
          </div>
          <button onClick={handleRenew} disabled={saving || !form.new_end_date}
            style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2ECC8A', color: 'white', cursor: 'pointer' }}>
            {saving ? 'Saving…' : '✓ Confirm renewal'}
          </button>
          <button onClick={() => setShowForm(false)}
            style={{ fontFamily: mono, fontSize: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T?.border || '#ddd'}`, background: 'transparent', color: T?.muted || '#888', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
