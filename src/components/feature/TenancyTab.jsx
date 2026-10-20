import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { Icon } from '../../lib/icons'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { useLoadGuard } from '../../lib/useLoadGuard'
import MoneyInput from '../../lib/MoneyInput'
import { formatDate, daysUntil } from './helpers'
import { SkeletonRows } from '../../lib/Skeleton'
import { Button } from '../ui'

// ── TENANCY TAB ───────────────────────────────────────────────────────────────
export function TenancyTab({propertyId, showToast, fmt, isAdmin, user, canEdit = true, canViewPersonal = true}) {
  const { T } = useTheme()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const s = (k,v) => setForm(f=>({...f,[k]:v}))

  const DEPOSIT_SCHEMES = ['DPS - Deposit Protection Service','mydeposits','TDS - Tenancy Deposit Scheme','Not registered']

  const beginLoad = useLoadGuard()

  const loadDetails = useCallback(async () => {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const d = await api.fetchTenancyDetails(propertyId)
      if (!isCurrent()) return
      setDetails(d)
      setForm(d||{})
    } catch(e) {
      if (!isCurrent()) return
      showToast(e.message || 'Failed to load tenancy details', 'error')
    }
    setLoading(false)
  }, [beginLoad, propertyId, showToast])
  useEffect(()=>{ loadDetails() },[loadDetails])

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
        <div style={{fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Tenancy details</div>
        {canEdit && <Button variant="primary" size="sm" onClick={()=>setEditing(v=>!v)}>{editing?'Cancel':'Edit Details'}</Button>}
      </div>

      {renewalDays!==null && renewalDays<=60 && (
        <div style={{display:'flex',alignItems:'center',gap:9,background:T.amber+'1A',border:`1px solid ${T.amber}44`,borderRadius:10,padding:'12px 16px',marginBottom:14,fontFamily:MONO,fontSize:12,color:T.amber}}>
          <Icon name="alert-triangle" size={15}/> Tenancy {renewalDays<0?`expired ${Math.abs(renewalDays)} days ago`:`expires in ${renewalDays} days`} — consider renewal action
        </div>
      )}

      {loading ? <SkeletonRows rows={3} height={36}/>
       : editing ? (
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Tenant Name(s)</label><input value={form.tenant_names||''} onChange={e=>s('tenant_names',e.target.value)} placeholder="e.g. John & Jane Smith"/></div>
            <div><label>Tenant phone</label><input value={form.tenant_phone||''} onChange={e=>s('tenant_phone',e.target.value)} placeholder="07xxx xxxxxx"/></div>
          </div>
          <div style={{marginBottom:12}}><label>Tenant email</label><input value={form.tenant_email||''} onChange={e=>s('tenant_email',e.target.value)} placeholder="tenant@email.com"/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Tenancy start</label><input type="date" value={form.tenancy_start||''} onChange={e=>s('tenancy_start',e.target.value)}/></div>
            <div><label>Tenancy end</label><input type="date" value={form.tenancy_end||''} onChange={e=>s('tenancy_end',e.target.value)}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Deposit amount</label><MoneyInput prefix="£" value={form.deposit_amount} onChange={v=>s('deposit_amount',v)}/></div>
            <div><label>Deposit scheme</label><select value={form.deposit_scheme||''} onChange={e=>s('deposit_scheme',e.target.value)}><option value="">Select…</option>{DEPOSIT_SCHEMES.map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label>Deposit reference</label><input value={form.deposit_ref||''} onChange={e=>s('deposit_ref',e.target.value)}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
            <div><label>Rent review date</label><input type="date" value={form.rent_review_date||''} onChange={e=>s('rent_review_date',e.target.value)}/></div>
            <div><label>Notice period</label><input value={form.notice_period||''} onChange={e=>s('notice_period',e.target.value)} placeholder="e.g. 2 months"/></div>
          </div>
          <div style={{marginBottom:12}}><label>Break clause</label><input value={form.break_clause||''} onChange={e=>s('break_clause',e.target.value)} placeholder="e.g. Break at 12 months with 2 months notice"/></div>
          <div style={{marginBottom:14}}><label>Notes</label><textarea value={form.notes||''} onChange={e=>s('notes',e.target.value)} rows={2} style={{resize:'vertical'}}/></div>
          <Button variant="primary" size="sm" onClick={handleSave}>Save tenancy details</Button>
        </div>
       ) : details ? (
        <div style={{display:'grid',gap:10}}>
          {[
            {l:'Tenant(s)',       v: canViewPersonal ? (details.tenant_names||'—') : 'Hidden'},
            {l:'Phone',           v: canViewPersonal ? (details.tenant_phone||'—') : 'Hidden'},
            {l:'Email',           v: canViewPersonal ? (details.tenant_email||'—') : 'Hidden'},
            {l:'Tenancy Start',   v:formatDate(details.tenancy_start)},
            {l:'Tenancy End',     v:formatDate(details.tenancy_end), alert:renewalDays!==null&&renewalDays<=60},
            {l:'Deposit',         v:fmt(details.deposit_amount), sub:details.deposit_scheme},
            {l:'Deposit Ref',     v:details.deposit_ref||'—'},
            {l:'Rent Review',     v:formatDate(details.rent_review_date)},
            {l:'Notice Period',   v:details.notice_period||'—'},
            {l:'Break Clause',    v:details.break_clause||'—'},
          ].map((item,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'10px 14px',background:T.bg,borderRadius:8}}>
              <span style={{fontFamily:MONO,fontSize:11,color:T.muted,flexShrink:0,marginRight:16}}>{item.l}</span>
              <div style={{textAlign:'right'}}>
                <span style={{fontFamily:MONO,fontSize:11,fontWeight:600,color:item.alert?T.amber:T.text}}>{item.v}</span>
                {item.sub&&<div style={{fontFamily:SANS,fontSize:FS.sm,color:T.muted}}>{item.sub}</div>}
              </div>
            </div>
          ))}
          {details.notes&&<div className="card" style={{padding:'12px 14px'}}>
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,marginBottom:6}}>Notes</div>
            <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.text}}>{details.notes}</div>
          </div>}
        </div>
       ) : (
        <div style={{fontFamily:SANS,fontSize:FS.sm,color:T.faint,padding:'20px 0'}}>No tenancy details recorded. Click Edit Details to add them.</div>
       )
      }
    </div>
  )
}
