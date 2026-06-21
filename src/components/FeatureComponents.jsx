import { useState, useEffect, lazy, Suspense } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../lib/icons'
import { statusPill } from '../lib/styles'
import BillingPage from './BillingPage'
// HelpCenter is ~800 lines of static guide content only seen on the Settings
// "Help" tab — lazy-load it so it stays out of the main bundle.
const HelpCenter = lazy(() => import('./HelpCenter'))
const BookkeepingRules = lazy(() => import('./BookkeepingRules'))
import TrashPage from './TrashPage'
import BackupsPage from './BackupsPage'
import CalcExplain from './CalcExplain'
import CompanyInboxPanel from './CompanyInboxPanel'
import InspectionsPanel from './InspectionsPanel'
import IntegrationsPanel from './IntegrationsPanel'
import TwoFactorPanel from './TwoFactorPanel'
// Exports: ComplianceTab, TenancyTab, ExpensesTab, SettingsPage, NotesTimeline, OverviewTab, FinancialsTab
import * as api from '../lib/api'
import { supabase } from '../lib/supabase'
import { safeOverlayClose } from '../lib/modalUtils'
import { useConfirm } from '../lib/ConfirmContext'
import MoneyInput from '../lib/MoneyInput'
import { canUseInvestorFeatures } from '../lib/tierGating'


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
  // Theme-aware RAG pill via the redesign STATUS system (was hardcoded
  // dark-mode backgrounds that rendered wrong in light mode).
  const { darkMode } = useTheme()
  const days = daysUntil(dateStr)
  const pill = (key, txt) => <span style={{...statusPill(key, darkMode), fontSize:10}}>{txt}</span>
  if (days === null) return pill('void', 'No expiry set')
  if (days < 0)   return pill('bad',  `Expired ${Math.abs(days)}d ago`)
  if (days <= 30) return pill('warn', `Expires in ${days}d`)
  if (days <= 90) return pill('warn', `${days}d remaining`)
  return pill('ok', `${days}d remaining`)
}

// ── COMPLIANCE TAB ────────────────────────────────────────────────────────────
export function ComplianceTab({propertyId, showToast, isAdmin, user, canEdit = true}) {
  const { T } = useTheme()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({cert_type:'gas',cert_name:'Gas Safety Certificate',issue_date:'',expiry_date:'',reminder_days:30,notes:''})
  const s = (k,v) => setForm(f=>({...f,[k]:v}))

  const CERT_TYPES = [
    {value:'gas',     label:'Gas Safety Certificate',    icon:'flame'},
    {value:'eicr',    label:'Electrical Safety (EICR)',   icon:'zap'},
    {value:'epc',     label:'EPC Rating',                 icon:'leaf'},
    {value:'hmo',     label:'HMO Licence',                icon:'home'},
    {value:'fire',    label:'Fire Risk Assessment',        icon:'alert-triangle'},
    {value:'pat',     label:'PAT Testing',                 icon:'plug'},
    {value:'other',   label:'Other Certificate',           icon:'file-text'},
  ]

  useEffect(()=>{ loadItems() },[propertyId])

  async function loadItems() {
    setLoading(true)
    try { setItems(await api.fetchCompliance(propertyId)) }
    catch(e) { showToast(e.message || 'Failed to load compliance certificates', 'error') }
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
        {canEdit && <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowForm(v=>!v)}>+ Add Certificate</button>}
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
                <span style={{width:38,height:38,borderRadius:9,background:T.gold+'1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Icon name={ICON_NAMES.includes(ct?.icon)?ct.icon:'file-text'} size={19} color={T.gold}/></span>
                <div style={{flex:1,minWidth:150}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{item.cert_name}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>
                    Issued: {formatDate(item.issue_date)} · Expires: {formatDate(item.expiry_date)}
                  </div>
                  {item.notes&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.faint,marginTop:2}}>{item.notes}</div>}
                </div>
                <ExpiryBadge dateStr={item.expiry_date}/>
                {canEdit && <button onClick={()=>handleDelete(item.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'3px 10px',cursor:'pointer'}}>Remove</button>}
              </div>
            )
          })}
        </div>
      }
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

// ── TENANCY TAB ───────────────────────────────────────────────────────────────
export function TenancyTab({propertyId, showToast, fmt, isAdmin, user, canEdit = true, canViewPersonal = true}) {
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
    } catch(e) { showToast(e.message || 'Failed to load tenancy details', 'error') }
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
        {canEdit && <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setEditing(v=>!v)}>{editing?'Cancel':'Edit Details'}</button>}
      </div>

      {renewalDays!==null && renewalDays<=60 && (
        <div style={{display:'flex',alignItems:'center',gap:9,background:T.amber+'1A',border:`1px solid ${T.amber}44`,borderRadius:10,padding:'12px 16px',marginBottom:14,fontFamily:"'DM Mono',monospace",fontSize:12,color:T.amber}}>
          <Icon name="alert-triangle" size={15}/> Tenancy {renewalDays<0?`expired ${Math.abs(renewalDays)} days ago`:`expires in ${renewalDays} days`} — consider renewal action
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
            <div><label>Deposit Amount</label><MoneyInput prefix="£" value={form.deposit_amount} onChange={v=>s('deposit_amount',v)}/></div>
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

// MaintenanceTab and JobCard moved to ./maintenance/index.jsx
// Imported directly in App.jsx now.


// ── EXPENSES TAB ──────────────────────────────────────────────────────────────
export function ExpensesTab({propertyId, showToast, fmt, rentPcm, isAdmin, user, canEdit = true, canViewFinancial = true}) {
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
    catch(e) { showToast(e.message || 'Failed to load expenses', 'error') }
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
        {canEdit && <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowForm(v=>!v)}>+ Add Expense</button>}
      </div>

      {showForm&&<div className="card" style={{padding:'16px 18px',marginBottom:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Category</label><select value={form.category} onChange={e=>s('category',e.target.value)}>{CATEGORIES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></div>
          <div><label>Description *</label><input value={form.description} onChange={e=>s('description',e.target.value)} placeholder="e.g. Annual buildings insurance"/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Amount *</label><MoneyInput prefix="£" value={form.amount} onChange={v=>s('amount',v)}/></div>
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
                {canEdit && <button onClick={()=>handleDelete(exp.id)} style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:'#2B1010',color:T.red,border:'1px solid #3D1A1A',borderRadius:6,padding:'3px 10px',cursor:'pointer'}}>Remove</button>}
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

// Wraps BookkeepingRules with a company selector for the Settings sub-tab,
// since Settings has no global "active company" the way the detail view does.
function BookkeepingTabBody({ companies, properties = [], T, mono }) {
  const [coId, setCoId] = useState(companies[0]?.id || '')
  const coProps = coId ? properties.filter(p => p.company_id === coId) : properties
  return (
    <div style={{display:'grid',gap:16}}>
      {companies.length > 1 && (
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Company</span>
          <select value={coId} onChange={e=>setCoId(e.target.value)}
            style={{fontFamily:mono,fontSize:12,padding:'6px 10px',borderRadius:8,background:T.bg,color:T.text,border:`1px solid ${T.border}`}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <BookkeepingRules companyId={coId} properties={coProps}/>
    </div>
  )
}

// ── SETTINGS PAGE ─────────────────────────────────────────────────────────────
export function SettingsPage({companies, setCompanies, companySettings, setCompanySettings, user, showToast, isAdmin, isPlatformAdmin, darkMode, setDarkMode, userNavPrefs, setUserNavPrefs, yieldBasis, setYieldBasis, accountType, setAccountType, properties = [], activeFlags = new Set(), companySubs = []}) {
  const { T } = useTheme()
  const [saving, setSaving] = useState(null)
  const [showAccessModal, setShowAccessModal] = useState(false)
  const [settingsTab, setSettingsTabInternal] = useState(() => {
    // Initialize from URL hash if it matches a settings route
    const h = window.location.hash.replace(/^#\/?/, '')
    const parts = h.split('/').filter(Boolean)
    if (parts[0] === 'settings' && parts[1]) return parts[1]
    return 'account'
  })

  // Wrapper that syncs tab changes to the URL
  const setSettingsTab = (tab) => {
    setSettingsTabInternal(tab)
    const target = `#/settings/${tab}`
    if (window.location.hash !== target) {
      window.history.pushState({ view: 'settings', settingsTab: tab }, '', target)
    }
  }

  // Listen for URL-driven tab changes (from browser back/forward)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.tab) setSettingsTabInternal(e.detail.tab)
    }
    window.addEventListener('ownproperly:set-settings-tab', handler)
    return () => window.removeEventListener('ownproperly:set-settings-tab', handler)
  }, [])

  // ── Account state ──────────────────────────────────────────────────────────
  const [fullName, setFullName]             = useState('')
  const [phone, setPhone]                   = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [milestoneConfig, setMilestoneConfig] = useState({})
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
    } catch(e) { showToast(e.message || 'Failed to load profile', 'error') }
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
    {key:'feature_compliance',  label:'Compliance & Certificates', desc:'Track gas safety, EICR, EPC, HMO licences and other certificates with expiry alerts', icon:'shield-check'},
    {key:'feature_tenancy',     label:'Tenancy Details',           desc:'Store tenant contact details, deposit info, rent review dates and break clauses', icon:'users'},
    {key:'feature_maintenance', label:'Maintenance & Repairs',     desc:'Log repair jobs with contractor details, costs and status tracking', icon:'wrench'},
    {key:'feature_documents',   label:'Document Storage',          desc:'Upload and store tenancy agreements, certificates and other documents', icon:'folder'},
    {key:'feature_expenses',    label:'Expenses Tracker',          desc:'Track all property expenses to calculate true net profit per property', icon:'wallet'},
    {key:'feature_reports',     label:'Reports & Export',          desc:'Generate P&L reports and export data to CSV for your accountant', icon:'pie-chart'},
    {key:'feature_statements',  label:'Statement Importer',        desc:'Upload PNE and RMS rental statements to automatically log rent payments, management fees and maintenance costs', icon:'file-text'},
    {key:'feature_tenant_portal',    label:'Tenant Portal',             desc:'Allow tenants to log in and access their own portal — see rent history, tenancy details and documents', icon:'home', section:'tenant'},
    {key:'feature_tenant_messaging', label:'Tenant Messaging',          desc:'Allow tenants to send messages to you directly through the portal — you reply from the inbox on your dashboard', icon:'mail', section:'tenant'},
    {key:'feature_tenant_repairs',   label:'Tenant Repair Requests',    desc:'Allow tenants to submit maintenance requests with photos — appears in your inbox instantly', icon:'wrench', section:'tenant'},
    {key:'feature_tenant_documents', label:'Tenant Document Access',    desc:'Allow tenants to download documents you have shared with them from the portal', icon:'file-text', section:'tenant'},
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
    {key:'mtd',         label:'MTD Tax',      icon:'🏛️'},
    {key:'contractors', label:'Contractors',  icon:'🔧'},
  ]

  const ALL_DEFAULT_NAV = ['dashboard','properties','companies','rent','deals','reports','mtd','contractors','settings']
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

  const accountTabs = [
    { key: 'account',       label: 'Profile' },
    { key: 'security',      label: 'Security & Data' },
    { key: 'backups',       label: 'Backups' },
    { key: 'billing',       label: 'Billing' },
    { key: 'navbar',        label: 'Navigation' },
    { key: 'trash',         label: 'Trash' },
    { key: 'referral',      label: 'Refer a Friend' },
    { key: 'help',          label: 'Help & Guides' },
  ]
  const portfolioTabs = [
    { key: 'branding',      label: 'Branding & Logos' },
    { key: 'tenant',        label: 'Tenant Portal' },
    { key: 'features',      label: 'Features' },
    { key: 'inbox',         label: 'Statement Inbox' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'milestones',    label: 'Deal Milestones' },
    { key: 'integrations',  label: 'Integrations' },
    ...(activeFlags.has('ai_bookkeeping') && canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin })
      ? [{ key: 'bookkeeping', label: 'AI Bookkeeping' }] : []),
  ]
  const preferencesTabs = [
    { key: 'display',       label: 'Display' },
    { key: 'reporting',     label: 'Reporting' },
    { key: 'team',          label: 'Team & Access' },
    ...(isPlatformAdmin ? [{ key: 'admin', label: 'Developer' }] : []),
  ]
  const settingsTabs = [...accountTabs, ...portfolioTabs, ...preferencesTabs]

  return (
    <div className="fade">
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:26,fontWeight:700,letterSpacing:'-0.03em',marginBottom:4}}>Settings</h1>
        <p style={{fontFamily:mono,color:T.muted,fontSize:12}}>Manage your profile, portfolio setup and personal preferences.</p>
      </div>

      {/* Three-group settings nav */}
      <div style={{marginBottom:24,borderBottom:`1px solid ${T.border}`,paddingBottom:12,display:'grid',gap:12}}>
        <div>
          <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:6}}>My Account</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            {accountTabs.map(t=>(
              <button key={t.key} onClick={()=>setSettingsTab(t.key)} style={{
                fontFamily:mono,fontSize:11,padding:'6px 13px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${settingsTab===t.key?T.gold:T.border}`,
                background:settingsTab===t.key?T.gold+'22':'transparent',
                color:settingsTab===t.key?T.gold:T.muted,fontWeight:settingsTab===t.key?700:400,
              }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:6}}>Portfolio Setup</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            {portfolioTabs.map(t=>(
              <button key={t.key} onClick={()=>setSettingsTab(t.key)} style={{
                fontFamily:mono,fontSize:11,padding:'6px 13px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${settingsTab===t.key?T.gold:T.border}`,
                background:settingsTab===t.key?T.gold+'22':'transparent',
                color:settingsTab===t.key?T.gold:T.muted,fontWeight:settingsTab===t.key?700:400,
              }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.12em',marginBottom:6}}>Preferences</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            {preferencesTabs.map(t=>(
              <button key={t.key} onClick={()=>setSettingsTab(t.key)} style={{
                fontFamily:mono,fontSize:11,padding:'6px 13px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${settingsTab===t.key?(t.key==='admin'?T.red:T.gold):T.border}`,
                background:settingsTab===t.key?(t.key==='admin'?T.red+'22':T.gold+'22'):'transparent',
                color:settingsTab===t.key?(t.key==='admin'?T.red:T.gold):T.muted,fontWeight:settingsTab===t.key?700:400,
              }}>{t.label}</button>
            ))}
          </div>
        </div>
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
                <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:5}}>To change your email or password go to the Security tab.</div>
              </div>
              <button className="btn btn-gold" onClick={saveProfile} disabled={profileSaving} style={{marginTop:8}}>
                {profileSaving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>

            <AccountTypePanel T={T} mono={mono} user={user} accountType={accountType} setAccountType={setAccountType}/>

            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>App Tour</div>
              <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:12}}>Replay the getting started tour at any time.</div>
              <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>window.dispatchEvent(new CustomEvent('ownproperly:restart-tour'))}>Replay tour</button>
            </div>
          </>
      )}

      {/* ── SECURITY TAB ── */}
      {settingsTab==='security' && (
        <>
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
          <TwoFactorPanel T={T}/>
          <SecurityDataPanel user={user} T={T} showToast={showToast}/>
        </>
      )}

      {/* ── DISPLAY TAB ── */}
      {settingsTab==='display' && (
        <>
          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Colour Mode</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:2}}>Theme</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>{darkMode?'Dark mode — easier on the eyes':'Light mode — clean and bright'}</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={async()=>{setDarkMode(true);try{await api.upsertUserProfile(user?.id,user?.email,{dark_mode:true})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                    border:`1px solid ${darkMode?T.gold:T.border}`,
                    background:darkMode?T.gold+'22':'transparent',
                    color:darkMode?T.gold:T.muted,transition:'all 0.2s'}}>
                  Dark
                </button>
                <button onClick={async()=>{setDarkMode(false);try{await api.upsertUserProfile(user?.id,user?.email,{dark_mode:false})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',
                    border:`1px solid ${!darkMode?T.gold:T.border}`,
                    background:!darkMode?T.gold+'22':'transparent',
                    color:!darkMode?T.gold:T.muted,transition:'all 0.2s'}}>
                  Light
                </button>
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Yield Calculation</div>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16}}>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,color:T.text,marginBottom:4}}>Yield basis</div>
                <div style={{fontFamily:mono,fontSize:11,color:T.muted,lineHeight:1.6}}>
                  {yieldBasis==='cost'
                    ? 'Calculated on purchase price + refurb cost — your return on actual money invested.'
                    : "Calculated on current property value — yield at today's market price."}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:8,flexShrink:0}}>
                <button onClick={async()=>{setYieldBasis('cost');try{await api.upsertUserProfile(user?.id,user?.email,{yield_basis:'cost'})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',textAlign:'left',
                    border:`1px solid ${yieldBasis==='cost'?T.gold:T.border}`,
                    background:yieldBasis==='cost'?T.gold+'22':'transparent',
                    color:yieldBasis==='cost'?T.gold:T.muted,transition:'all 0.2s'}}>
                  Purchase + refurb cost
                </button>
                <button onClick={async()=>{setYieldBasis('value');try{await api.upsertUserProfile(user?.id,user?.email,{yield_basis:'value'})}catch(e){}}}
                  style={{fontFamily:mono,fontSize:11,padding:'7px 14px',borderRadius:8,cursor:'pointer',textAlign:'left',
                    border:`1px solid ${yieldBasis==='value'?T.gold:T.border}`,
                    background:yieldBasis==='value'?T.gold+'22':'transparent',
                    color:yieldBasis==='value'?T.gold:T.muted,transition:'all 0.2s'}}>
                  Current property value
                </button>
              </div>
            </div>
          </div>
        </>
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
              {/* Core features */}
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6,marginTop:4}}>Core features</div>
            {FEATURES.filter(f=>!f.section).map(feature=>{
                const isOn = settings[feature.key] !== false
                const isSaving = saving===`${company.id}-${feature.key}`
                return (
                  <div key={feature.key} style={{display:'flex',alignItems:'center',gap:16,padding:'14px 16px',background:T.bg,borderRadius:10,flexWrap:'wrap'}}>
                    <span style={{flexShrink:0,display:'flex'}}>{ICON_NAMES.includes(feature.icon)?<Icon name={feature.icon} size={20} color={T.gold}/>:<span style={{fontSize:20}}>{feature.icon}</span>}</span>
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

            {/* Tenant portal features */}
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6,marginTop:16,paddingTop:16,borderTop:`1px solid ${T.border}`}}>Tenant portal features</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginBottom:10,lineHeight:1.6}}>Control what tenants can do when they log into their portal for this company.</div>
            {FEATURES.filter(f=>f.section==='tenant').map(feature=>{
                const isOn = settings[feature.key] !== false
                const isSaving = saving===`${company.id}-${feature.key}`
                // If portal is off, disable all sub-features
                const portalEnabled = settings['feature_tenant_portal'] !== false
                const disabled = feature.key !== 'feature_tenant_portal' && !portalEnabled
                return (
                  <div key={feature.key} style={{display:'flex',alignItems:'center',gap:16,padding:'14px 16px',background:T.bg,borderRadius:10,flexWrap:'wrap',opacity:disabled?0.4:1}}>
                    <span style={{flexShrink:0,display:'flex'}}>{ICON_NAMES.includes(feature.icon)?<Icon name={feature.icon} size={20} color={T.gold}/>:<span style={{fontSize:20}}>{feature.icon}</span>}</span>
                    <div style={{flex:1,minWidth:200}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{feature.label}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{feature.desc}</div>
                      {disabled && <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:3}}>Enable Tenant Portal first</div>}
                    </div>
                    <div onClick={()=>!isSaving&&!disabled&&toggleFeature(company.id, feature.key, isOn)}
                      style={{
                        width:44, height:24, borderRadius:12, cursor:disabled?'not-allowed':'pointer',
                        background: isOn && !disabled ? company.color : T.faint,
                        position:'relative', transition:'background 0.2s', flexShrink:0,
                        opacity: isSaving ? 0.6 : 1,
                      }}>
                      <div style={{
                        width:18, height:18, borderRadius:'50%', background:'white',
                        position:'absolute', top:3,
                        left: isOn && !disabled ? 23 : 3,
                        transition:'left 0.2s',
                        boxShadow:'0 1px 3px rgba(0,0,0,0.3)',
                      }}/>
                    </div>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:isOn&&!disabled?company.color:T.muted,fontWeight:600,width:20,flexShrink:0}}>
                      {isSaving?'…':isOn&&!disabled?'ON':'OFF'}
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

      {settingsTab==='integrations' && (
        <IntegrationsPanel T={T} mono={mono} companies={companies} properties={properties}/>
      )}

      {settingsTab==='bookkeeping' && activeFlags.has('ai_bookkeeping') && canUseInvestorFeatures({ subs: companySubs, companies, isPlatformAdmin }) && (
        <Suspense fallback={null}>
          <BookkeepingTabBody companies={companies} properties={properties} T={T} mono={mono}/>
        </Suspense>
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
          setCompanies={setCompanies}
          companySettings={companySettings}
          setCompanySettings={setCompanySettings}
          user={user}
          showToast={showToast}
          T={T}
        />
      )}

      {settingsTab==='tenant' && (
        <TenantPortalSettings companies={companies} companySettings={companySettings} setCompanySettings={setCompanySettings} showToast={showToast} T={T}/>
      )}

      {settingsTab==='inbox' && (
        <CompanyInboxPanel companies={companies} T={T}/>
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

      {settingsTab==='trash' && (
        <TrashPage user={user}/>
      )}

      {settingsTab==='backups' && (
        <BackupsPage user={user} showToast={showToast}/>
      )}

      {settingsTab==='referral' && (
        <ReferralPanel user={user} T={T} showToast={showToast}/>
      )}

      {/* ── HELP & GUIDES TAB ── */}
      {settingsTab==='help' && (
        <Suspense fallback={null}>
          <HelpCenter/>
        </Suspense>
      )}

      {/* ── REPORTING TAB ── */}
      {settingsTab==='reporting' && (
        <div style={sectionStyle}>
          <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14}}>Default Reporting Period</div>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20,lineHeight:1.7}}>
            Choose whether reports default to the UK tax year (6 Apr — 5 Apr), the calendar year (1 Jan — 31 Dec), or a custom date range you set yourself. You can always override this when running individual reports.
          </div>
          {companies.map(company => {
            const cs = companySettings[company.id] || {}
            // Normalise legacy short forms ('tax'/'calendar') to the canonical keys.
            const rawType = cs.year_type || 'tax_year'
            const yearType = rawType==='tax' ? 'tax_year' : rawType==='calendar' ? 'calendar_year' : rawType
            // Persist a patch on top of the company's existing settings row.
            const saveSettings = async(patch)=>{
              const updated={...cs,...patch}
              try{
                const saved=await api.upsertCompanySettings(company.id,updated)
                setCompanySettings(prev=>({...prev,[company.id]:saved||updated}))
                showToast('Reporting period saved')
              }catch(e){showToast(e.message,'error')}
            }
            const dateInputStyle={fontFamily:mono,fontSize:12,padding:'8px 10px',borderRadius:8,border:`1px solid ${T.border}`,background:T.bg,color:T.text}
            return (
              <div key={company.id} style={{marginBottom:20,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                  <span style={{fontFamily:mono,fontSize:10,fontWeight:700,color:company.color,background:company.color+'22',padding:'2px 8px',borderRadius:4}}>{company.abbr}</span>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{company.name}</span>
                </div>
                <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                  {[{k:'tax_year',label:'UK Tax Year',sub:'6 Apr — 5 Apr'},{k:'calendar_year',label:'Calendar Year',sub:'1 Jan — 31 Dec'},{k:'custom',label:'Custom Dates',sub:'Set your own range'}].map(opt=>(
                    <button key={opt.k} onClick={()=>saveSettings({year_type:opt.k})}
                    style={{fontFamily:mono,fontSize:11,padding:'10px 16px',borderRadius:10,cursor:'pointer',textAlign:'left',
                      border:`2px solid ${yearType===opt.k?T.gold:T.border}`,
                      background:yearType===opt.k?T.gold+'11':T.bg,
                      color:yearType===opt.k?T.gold:T.text,transition:'all 0.2s'}}>
                      <div style={{fontWeight:700,marginBottom:2}}>{opt.label}</div>
                      <div style={{fontSize:10,color:yearType===opt.k?T.gold:T.muted}}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
                {yearType==='custom' && (
                  <div style={{display:'flex',gap:14,flexWrap:'wrap',marginTop:14}}>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      <label style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Start date</label>
                      <input type="date" value={cs.custom_period_start||''} max={cs.custom_period_end||undefined}
                        onChange={e=>{
                          const start=e.target.value
                          if(cs.custom_period_end && start && start>cs.custom_period_end){showToast('Start date must be on or before the end date','error');return}
                          saveSettings({year_type:'custom',custom_period_start:start||null})
                        }}
                        style={dateInputStyle}/>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      <label style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>End date</label>
                      <input type="date" value={cs.custom_period_end||''} min={cs.custom_period_start||undefined}
                        onChange={e=>{
                          const end=e.target.value
                          if(cs.custom_period_start && end && end<cs.custom_period_start){showToast('End date must be on or after the start date','error');return}
                          saveSettings({year_type:'custom',custom_period_end:end||null})
                        }}
                        style={dateInputStyle}/>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── TEAM & ACCESS TAB ── */}
      {settingsTab==='team' && (
        <>
          {isAdmin&&(
            <div style={sectionStyle}>
              <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>User Access</div>
              <div style={{fontFamily:mono,fontSize:12,color:T.text,marginBottom:4}}>Manage who can access each company in your portfolio.</div>
              <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:16}}>Signed in as <span style={{color:T.gold}}>{user?.email}</span></div>
              <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowAccessModal(true)}>Manage User Access</button>
            </div>
          )}
          <div style={sectionStyle}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Audit Log</div>
            <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:16,lineHeight:1.7}}>A full record of all actions taken in your account — for GDPR compliance and dispute resolution.</div>
            <AuditLogPanel user={user} companies={companies} T={T}/>
          </div>
        </>
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
  // OCR state
  const [expandedOcrId, setExpandedOcrId] = useState(null)
  const [ocrRunning, setOcrRunning] = useState(null)
  // Map of documentId -> linked compliance_items.id (or null if not linked).
  // Loaded lazily on demand when a doc card expands.
  const [complianceLinks, setComplianceLinks] = useState({})
  const [complianceBusy, setComplianceBusy] = useState(null)
  const fileInputRef = useState(null)
  const inputRef = { current: null }

  // When a doc panel expands, check if it's already linked to a compliance row.
  async function ensureComplianceLink(doc) {
    if (complianceLinks[doc.id] !== undefined) return  // cached
    try {
      const link = await api.fetchComplianceForDocument(doc.id)
      setComplianceLinks(prev => ({ ...prev, [doc.id]: link?.id || null }))
    } catch (e) {
      // If the column doesn't exist yet (migration not run), fail silent
      setComplianceLinks(prev => ({ ...prev, [doc.id]: null }))
    }
  }

  async function addToCompliance(doc) {
    setComplianceBusy(doc.id)
    try {
      const candidate = api.buildComplianceFromDoc(doc)
      if (!candidate) { showToast('Could not auto-detect cert details', 'error'); return }
      const created = await api.createCompliance(propertyId, candidate)
      setComplianceLinks(prev => ({ ...prev, [doc.id]: created.id }))
      showToast(`Added ${candidate.cert_name} to Compliance`)
    } catch (e) {
      showToast('Failed to add: ' + (e.message || 'unknown'), 'error')
    }
    setComplianceBusy(null)
  }

  useEffect(()=>{ loadDocs() },[propertyId])

  async function loadDocs() {
    setLoading(true)
    try {
      const {data} = await supabase.from('property_documents')
        .select('*').eq('property_id', propertyId)
        .is('deleted_at', null)
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

        // Upload to Supabase Storage (private bucket).
        const {data:uploadData, error:uploadErr} = await supabase.storage
          .from('property-documents')
          .upload(filePath, file, {cacheControl:'3600', upsert:false})

        if (uploadErr) throw uploadErr

        // Save record to DB. We deliberately DO NOT store a public URL anymore —
        // the bucket is private and signed URLs are minted on demand at view time.
        // file_url is left blank for new uploads; older rows may still have a stale
        // public URL but it won't work and we ignore it during render.
        const {error:dbErr} = await supabase.from('property_documents').insert({
          property_id: propertyId,
          user_id: u.id,
          name: docName || file.name,
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
      const { data: { user: u } } = await supabase.auth.getUser()
      // Soft-delete: flip deleted_at/deleted_by. Keep Storage file intact
      // so the doc can be restored from Trash for 30 days.
      const { error } = await supabase.from('property_documents')
        .update({ deleted_at: new Date().toISOString(), deleted_by: u?.id })
        .eq('id', doc.id)
      if (error) throw error
      setDocs(prev => prev.filter(d => d.id !== doc.id))
      showToast('Document moved to Trash')
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
                const ocrEligible = isPDF || isImage
                const status = doc.extraction_status || 'not_requested'
                const isExpanded = expandedOcrId === doc.id
                const extractedFields = doc.extracted_fields

                async function runOcr() {
                  if (!ocrEligible) { showToast('OCR only works on PDFs and images', 'error'); return }
                  try {
                    setOcrRunning(doc.id)
                    await api.markDocumentForExtraction(doc.id)
                    // Optimistically update UI to show processing
                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, extraction_status: 'processing' } : d))
                    await api.triggerDocumentOCR(doc.id)
                    // Refetch this document to get extracted fields
                    const updated = await api.fetchDocumentExtraction(doc.id)
                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, ...updated } : d))
                    setExpandedOcrId(doc.id)
                    showToast('Fields extracted!')
                  } catch(e) {
                    showToast('Extraction failed: ' + (e.message || 'unknown'), 'error')
                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, extraction_status: 'failed', extraction_error: e.message } : d))
                  } finally {
                    setOcrRunning(null)
                  }
                }

                return (
                  <div key={doc.id} style={{background:T.bg,borderRadius:10,padding:'12px 16px',
                    display:'flex',flexDirection:'column',gap:8,
                    border:`1px solid ${T.border}`}}>
                    <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
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
                          {/* OCR status badge */}
                          {status === 'processing' && <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.blue,background:T.blue+'22',padding:'1px 6px',borderRadius:20}}>Extracting…</span>}
                          {status === 'completed' && <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.green,background:T.green+'22',padding:'1px 6px',borderRadius:20}}>AI-extracted</span>}
                          {status === 'failed' && <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.red,background:T.red+'22',padding:'1px 6px',borderRadius:20}} title={doc.extraction_error}>Extraction failed</span>}
                        </div>
                      </div>
                      {/* Actions */}
                      <div style={{display:'flex',gap:6,flexShrink:0,flexWrap:'wrap'}}>
                        {ocrEligible && isAdmin && status !== 'processing' && (
                          <button onClick={runOcr} disabled={ocrRunning === doc.id}
                            style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 10px',
                              background: status === 'completed' ? T.surface : T.gold+'22',
                              color: status === 'completed' ? T.muted : T.gold,
                              border: `1px solid ${T.gold}44`,
                              borderRadius:8,cursor: ocrRunning === doc.id ? 'wait' : 'pointer',opacity: ocrRunning === doc.id ? 0.6 : 1}}>
                            {ocrRunning === doc.id ? '🤖 …' : status === 'completed' ? 'Re-extract' : 'Extract'}
                          </button>
                        )}
                        {status === 'completed' && (
                          <button onClick={()=>setExpandedOcrId(isExpanded ? null : doc.id)}
                            style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 10px',
                              background:T.surface,color:T.text,border:`1px solid ${T.border}`,
                              borderRadius:8,cursor:'pointer'}}>
                            {isExpanded ? '▲ Hide' : '▼ View fields'}
                          </button>
                        )}
                        <button onClick={async()=>{
                          try {
                            const url = await api.getDocumentSignedUrl(doc.file_path)
                            if (url) window.open(url, '_blank', 'noopener,noreferrer')
                            else showToast('Could not generate view link', 'error')
                          } catch(e) { showToast('Could not view: ' + (e.message||'unknown'), 'error') }
                        }}
                          style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',
                            background:T.surface,color:T.gold,border:`1px solid ${T.gold}44`,
                            borderRadius:8,cursor:'pointer'}}>
                          View
                        </button>
                        {isAdmin&&<button onClick={()=>handleDelete(doc)}
                          style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 10px',
                            background:T.surface,color:T.muted,border:`1px solid ${T.border}`,
                            borderRadius:8,cursor:'pointer',transition:'color 0.15s, border-color 0.15s'}}
                          onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'66'}}
                          onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>
                          Delete
                        </button>}
                      </div>
                    </div>

                    {/* Expanded OCR fields */}
                    {isExpanded && status === 'completed' && extractedFields && (
                      <div style={{background:T.surface,borderRadius:8,padding:'12px 16px',border:`1px dashed ${T.green}44`,marginTop:4}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
                            AI-extracted fields {doc.extracted_at && <span style={{color:T.faint,textTransform:'none',letterSpacing:0,marginLeft:6}}>— extracted {formatDate(doc.extracted_at)}</span>}
                          </div>
                        </div>
                        {extractedFields._parse_error ? (
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.amber,lineHeight:1.6}}>
                            <strong>Raw AI response (couldn't parse as JSON):</strong>
                            <div style={{background:T.bg,padding:10,borderRadius:6,marginTop:6,whiteSpace:'pre-wrap',maxHeight:280,overflow:'auto'}}>{extractedFields._raw_response}</div>
                          </div>
                        ) : (
                          <div style={{display:'grid',gap:6}}>
                            {Object.entries(extractedFields).map(([key, value]) => {
                              if (value === null || value === undefined || value === '') return null
                              const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                              // Format a single item (primitive or {label,value} / {date,description} / etc.)
                              const fmtItem = v => {
                                if (v === null || v === undefined) return '—'
                                if (typeof v !== 'object') return String(v)
                                if (Array.isArray(v)) return v.map(fmtItem).join(', ')
                                // Object: prefer common human-readable shapes
                                const labelKey = v.label ?? v.name ?? v.type ?? v.description ?? v.date
                                const valueKey = v.value ?? v.amount ?? v.date ?? v.description
                                if (labelKey && valueKey && labelKey !== valueKey) return `${labelKey}: ${valueKey}`
                                if (labelKey) return String(labelKey)
                                // Fallback: pretty key/value pairs, not raw JSON
                                return Object.entries(v)
                                  .filter(([,vv]) => vv !== null && vv !== undefined && vv !== '')
                                  .map(([k,vv]) => `${k.replace(/_/g,' ')}: ${fmtItem(vv)}`)
                                  .join(', ')
                              }
                              // For arrays of objects, render each on its own line for readability
                              const isArrayOfObjects = Array.isArray(value) && value.length > 0
                                && value.some(v => v && typeof v === 'object' && !Array.isArray(v))
                              let displayValue
                              if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No'
                              else if (Array.isArray(value)) displayValue = value.length === 0 ? '—' : value.map(fmtItem).join(isArrayOfObjects ? '\n' : ', ')
                              else if (typeof value === 'object') displayValue = fmtItem(value)
                              else displayValue = String(value)
                              return (
                                <div key={key} style={{display:'flex',gap:10,padding:'6px 10px',background:T.bg,borderRadius:6,alignItems:'flex-start'}}>
                                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,minWidth:140,flexShrink:0,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
                                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.text,wordBreak:'break-word',whiteSpace:'pre-line'}}>{displayValue}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {/* Compliance auto-link CTA. Triggers ensureComplianceLink on first render
                            via the IIFE — keeps logic local to the panel without an extra useEffect. */}
                        {(() => {
                          const cat = doc.category
                          const cert = ['gas','eicr','epc','insurance'].includes(cat)
                          if (!cert || extractedFields._parse_error) return null
                          const candidate = api.buildComplianceFromDoc(doc)
                          if (!candidate) return null
                          // Lazy-check link state
                          if (complianceLinks[doc.id] === undefined) ensureComplianceLink(doc)
                          const linked = complianceLinks[doc.id]
                          if (linked) {
                            return (
                              <div style={{marginTop:10,padding:'10px 12px',background:T.green+'11',border:`1px solid ${T.green}44`,borderRadius:8,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.green,display:'flex',alignItems:'center',gap:8}}>
                                <span>Linked to Compliance — {candidate.cert_name} expires {candidate.expiry_date}</span>
                              </div>
                            )
                          }
                          return (
                            <div style={{marginTop:10,padding:'10px 12px',background:T.gold+'11',border:`1px dashed ${T.gold}66`,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.text,lineHeight:1.5}}>
                                Looks like a <strong>{candidate.cert_name}</strong> expiring <strong>{candidate.expiry_date}</strong>.
                              </div>
                              <button onClick={()=>addToCompliance(doc)} disabled={complianceBusy===doc.id}
                                style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'6px 14px',
                                  background:T.gold,color:'white',border:'none',borderRadius:8,
                                  cursor:complianceBusy===doc.id?'wait':'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
                                {complianceBusy===doc.id ? 'Adding…' : '+ Add to Compliance'}
                              </button>
                            </div>
                          )
                        })()}
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.faint,marginTop:10,lineHeight:1.5}}>
                          AI extraction is best-effort. Always verify critical values against the original document.
                        </div>
                      </div>
                    )}

                    {/* Failed extraction details */}
                    {status === 'failed' && doc.extraction_error && (
                      <div style={{background:T.red+'11',borderRadius:6,padding:'8px 12px',border:`1px solid ${T.red}44`,fontFamily:"'DM Mono',monospace",fontSize:10,color:T.red,lineHeight:1.5}}>
                        <strong>Extraction error:</strong> {doc.extraction_error.slice(0,200)}
                      </div>
                    )}
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
export function OverviewTab({selected, fmt, calcMonthlyMortgage, calcGrossYield, isAdmin, user, showToast, canViewFinancial = true, canEditProperty = true}) {
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
  const HIDDEN = '🔒'

  return (
    <div>
      {/* Quick stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
        {[
          {l:'Purchase Price',   v:canViewFinancial?fmt(selected.purchase_price):HIDDEN,     c:'#C8A84B'},
          {l:'Estimated Value',  v:canViewFinancial?fmt(selected.est_value):HIDDEN,          c:'#C8A84B'},
          {l:'Gross Yield',      v:canViewFinancial?(yield_>0?yield_.toFixed(1)+'%':'—'):HIDDEN, c:'#2ECC8A'},
          {l:'Monthly Rent',     v:canViewFinancial?fmt(selected.rent_pcm):HIDDEN,           c:'#2ECC8A'},
          {l:'Monthly Mortgage', v:canViewFinancial?(mortgage>0?fmt(mortgage):'—'):HIDDEN,   c:'#9B59B6'},
          {l:'Arrears',          v:fmt(selected.arrears||0),                                  c:(selected.arrears||0)>0?'#E05555':'#2ECC8A'},
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
export function FinancialsTab({selected, fmt, calcMonthlyMortgage, calcGrossYield, calcMonthlyProfit, isAdmin, user, showToast, canViewFinancial = true, canEditFinancial = true}) {
  const { T } = useTheme()

  if (!canViewFinancial) {
    return (
      <div style={{padding:40, textAlign:'center'}}>
        <div style={{fontSize:48, marginBottom:12}}>🔒</div>
        <div style={{fontFamily:"'DM Mono',monospace", fontSize:12, color:T.muted, marginBottom:8}}>Financial data is hidden</div>
        <div style={{fontFamily:"'DM Mono',monospace", fontSize:11, color:T.faint, maxWidth:420, margin:'0 auto', lineHeight:1.6}}>
          You don't have permission to view financial information for this property. Ask the company owner to grant you the "View financial data" permission.
        </div>
      </div>
    )
  }

  const mortgage = calcMonthlyMortgage(selected)
  const yield_ = calcGrossYield(selected)
  const monthlyProfit = calcMonthlyProfit(selected)
  const totalInvested = (selected.purchase_price||0)+(selected.refurb_cost||0)+(selected.stamp_duty||0)+(selected.legal_fees||0)
  const currentVal = selected.current_value || selected.est_value || 0
  const equity = currentVal - (selected.mortgage_amount||0)
  const ltv = currentVal ? (((selected.mortgage_amount||0)/currentVal)*100).toFixed(1) : '—'

  // Yield calc — match calcGrossYield in App.jsx. yieldBasis from settings
  // determines whether the denominator is purchase+refurb ('cost') or current value.
  // Default is 'cost' so we describe that path; if the user has switched to 'value'
  // the actual number from calcGrossYield reflects that, but for transparency we
  // show the inputs that match what they'd see today.
  const yieldDenom = (selected.purchase_price||0)+(selected.refurb_cost||0)
  const annualRent = (selected.rent_pcm||0)*12
  const usingCurrentValue = !!selected.current_value && selected.current_value !== selected.est_value

  const sections = [
    {title:'Purchase & Costs', items:[
      {l:'Purchase Price',    v:fmt(selected.purchase_price)},
      {l:'Deposit',          v:fmt(selected.deposit)},
      {l:'Refurb Cost',      v:fmt(selected.refurb_cost)},
      {l:'Stamp Duty',       v:fmt(selected.stamp_duty)},
      {l:'Legal Fees',       v:fmt(selected.legal_fees)},
      {l:'Total Invested',   v:fmt(totalInvested), bold:true, color:'#C8A84B',
        explain: {
          title: 'Total Invested',
          formula: 'Purchase Price + Refurb + Stamp Duty + Legal Fees',
          inputs: [
            { label: 'Purchase Price', value: fmt(selected.purchase_price) },
            { label: 'Refurb Cost',    value: fmt(selected.refurb_cost) },
            { label: 'Stamp Duty',     value: fmt(selected.stamp_duty) },
            { label: 'Legal Fees',     value: fmt(selected.legal_fees) },
          ],
          result: fmt(totalInvested),
          note: 'This is your gross capital outlay. If you used a mortgage, your actual cash-in is lower (deposit + costs, not full purchase price).',
        }},
    ]},
    {title:'Mortgage', items:[
      {l:'Mortgage Amount',  v:fmt(selected.mortgage_amount)},
      {l:'Mortgage Rate',    v:selected.mortgage_rate?(selected.mortgage_rate*100).toFixed(2)+'%':'—'},
      {l:'Mortgage Term',    v:selected.mortgage_term?`${selected.mortgage_term} years`:'—'},
      {l:'Monthly Payment',  v:mortgage>0?fmt(mortgage):'—'},
      {l:'Annual Payments',  v:mortgage>0?fmt(mortgage*12):'—'},
      {l:'Loan to Value',    v:ltv!=='—'?ltv+'%':'—', color:'#9B59B6',
        explain: {
          title: 'Loan to Value (LTV)',
          formula: 'Mortgage Amount ÷ Current Value × 100',
          inputs: [
            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
            { label: 'Current Value',   value: fmt(currentVal) },
          ],
          result: ltv !== '—' ? ltv + '%' : '—',
          note: usingCurrentValue
            ? 'Using your updated current value. To use the original estimated value instead, clear the Current Value field on Overview.'
            : 'Current Value falls back to Estimated Value when not set separately.',
        }},
    ]},
    {title:'Returns', items:[
      {l:'Estimated Value',  v:fmt(selected.est_value), color:'#C8A84B'},
      {l:'Current Value',    v:fmt(currentVal), color:'#C8A84B'},
      {l:'Equity',           v:fmt(equity), color:equity>0?'#2ECC8A':'#E05555',
        explain: {
          title: 'Equity',
          formula: 'Current Value − Mortgage Amount',
          inputs: [
            { label: 'Current Value',   value: fmt(currentVal) },
            { label: 'Mortgage Amount', value: fmt(selected.mortgage_amount) },
          ],
          result: fmt(equity),
          note: 'Your stake in the property today. Goes negative if mortgage > value (negative equity).',
        }},
      {l:'Monthly Rent',     v:fmt(selected.rent_pcm), color:'#2ECC8A'},
      {l:'Annual Rent',      v:fmt(annualRent), color:'#2ECC8A'},
      {l:'Gross Yield',      v:yield_>0?yield_.toFixed(2)+'%':'—', color:'#2ECC8A',
        explain: {
          title: 'Gross Yield',
          formula: '(Monthly Rent × 12) ÷ Cost Basis × 100',
          inputs: [
            { label: 'Monthly Rent',   value: fmt(selected.rent_pcm) },
            { label: 'Annual Rent',    value: fmt(annualRent) },
            { label: 'Purchase Price', value: fmt(selected.purchase_price) },
            { label: 'Refurb Cost',    value: fmt(selected.refurb_cost) },
            { label: 'Cost Basis',     value: fmt(yieldDenom) },
          ],
          result: yield_ > 0 ? yield_.toFixed(2) + '%' : '—',
          note: 'Cost basis defaults to Purchase Price + Refurb. You can switch to Current Value in Settings → Display.',
        }},
      {l:'Monthly Profit',   v:monthlyProfit>0?fmt(monthlyProfit):'—', color:monthlyProfit>0?'#2ECC8A':'#E05555',
        explain: {
          title: 'Monthly Profit',
          formula: 'Monthly Rent − Monthly Mortgage − (Insurance ÷ 12)',
          inputs: [
            { label: 'Monthly Rent',     value: fmt(selected.rent_pcm) },
            { label: 'Monthly Mortgage', value: mortgage > 0 ? fmt(mortgage) : '£0' },
            { label: 'Insurance ÷ 12',   value: fmt((selected.insurance||0)/12) },
          ],
          result: fmt(monthlyProfit),
          note: 'Simple cashflow estimate. Doesn\'t include voids, agent fees, maintenance reserve, or tax.',
        }},
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
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:item.bold?700:600,color:item.color||T.text,display:'inline-flex',alignItems:'center',gap:2}}>
                    {item.v||'—'}
                    {item.explain && <CalcExplain {...item.explain}/>}
                  </span>
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
        const filePath = `${u.id}/company_documents/${companyId}/${Date.now()}-${file.name}`

        const {error:uploadErr} = await supabase.storage
          .from('property-documents')
          .upload(filePath, file, {cacheControl:'3600', upsert:false})
        if (uploadErr) throw uploadErr

        // Private bucket — no public URL stored. Signed URL minted at view time.
        await supabase.from('company_documents').insert({
          company_id: companyId,
          user_id: u.id,
          name: docName || file.name,
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
                      <button onClick={async()=>{
                        try {
                          const url = await api.getDocumentSignedUrl(doc.file_path)
                          if (url) window.open(url, '_blank', 'noopener,noreferrer')
                          else showToast('Could not generate view link', 'error')
                        } catch(e) { showToast('Could not view: ' + (e.message||'unknown'), 'error') }
                      }}
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 12px',
                          background:T.surface,color:T.gold,border:`1px solid ${T.gold}44`,
                          borderRadius:8,cursor:'pointer'}}>
                        View
                      </button>
                      {isAdmin&&<button onClick={()=>handleDelete(doc)}
                        style={{fontFamily:"'DM Mono',monospace",fontSize:11,padding:'5px 10px',
                          background:T.surface,color:T.muted,border:`1px solid ${T.border}`,
                          borderRadius:8,cursor:'pointer'}}
                        onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'66'}}
                        onMouseLeave={e=>{e.currentTarget.style.color=T.muted;e.currentTarget.style.borderColor=T.border}}>
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
  const confirmDialog = useConfirm()
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
      // SECURITY: filter access rows to only those on companies the current user has shared
      const myCompanyIds = new Set((companies || []).map(c => c.id))
      const relevantRows = rows.filter(r => myCompanyIds.has(r.company_id))

      const map = {}
      relevantRows.forEach(row => {
        if (!map[row.user_id]) map[row.user_id] = []
        if (row.company_id) map[row.user_id].push(row.company_id)
      })
      setAccess(map)

      // Only show users who ALREADY have access to one of my companies.
      // Do NOT expose the platform-wide user list to non-platform-admins.
      const allowedUserIds = new Set(relevantRows.map(r => r.user_id))
      const filteredUsers = authUsers.filter(u => allowedUserIds.has(u.id))

      if (filteredUsers.length > 0) {
        setUsers(filteredUsers.map(u => ({ id: u.id, email: u.email })))
      } else {
        const fromRows = {}
        relevantRows.forEach(row => {
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
    if (!await confirmDialog({ title: 'Remove this user completely?', body: 'They will lose access to all your companies.', confirmLabel: 'Remove', destructive: true })) return
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
    <div className="overlay" onClick={safeOverlayClose(newEmail.trim().length > 0, onClose)}>
      <div className="modal" style={{maxWidth:660}}>
        <div style={{padding:'22px 26px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
            <h2 style={{fontSize:20,fontWeight:700,color:T.text}}>User Access Management</h2>
            <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
          </div>
          <p style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:20}}>
            Manage who can access your companies. Send invitations to new users.
          </p>

          {/* Tabs */}
          <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:0,flexWrap:'wrap'}}>
            <button style={tabStyle('users')} onClick={()=>setTab('users')}>
              Users ({users.length})
            </button>
            <button style={tabStyle('invites')} onClick={()=>setTab('invites')}>
              Pending Invites ({invites.length})
            </button>
            <button style={tabStyle('links')} onClick={()=>setTab('links')}>
              Shareable Links
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
                {adding ? 'Sending…' : 'Send Invite'}
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

              {/* ── SHAREABLE LINKS TAB ── */}
              {tab === 'links' && (
                <ShareableLinksTab companies={companies} showToast={showToast} T={T}/>
              )}
            </>
          }

          <button className="btn btn-ghost" style={{width:'100%',marginTop:16,fontSize:12}} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── SHAREABLE LINKS TAB ─────────────────────────────────────────────────────
// Lets owners/admins generate shareable invite links (or short codes) for any
// of their companies. Each invite is a row in `company_invites` and can be
// configured with max_uses, expires_at, and is_admin. Shows active invites
// with copy-to-clipboard + revoke. Revoked invites stay in DB for audit but
// disappear from this list.
function ShareableLinksTab({ companies, showToast, T }) {
  const mono = "'DM Mono',monospace"
  // Group invites by company for the active list
  const [invitesByCompany, setInvitesByCompany] = useState({})
  const [loading, setLoading] = useState(true)

  // Form state for creating a new invite
  const [formCompanyId, setFormCompanyId] = useState(companies[0]?.id || '')
  const [formMaxUses,   setFormMaxUses]   = useState('')   // '' = unlimited
  const [formExpiry,    setFormExpiry]    = useState('7d') // preset key
  // Role joiners get when they redeem this code. Defaults to 'editor' which
  // matches what most "I'm sharing this with my team" cases want.
  const [formRole,      setFormRole]      = useState('editor')
  const [formLabel,     setFormLabel]     = useState('')
  const [creating,      setCreating]      = useState(false)

  // Track which invite was last "copied" so we can show "Copied!" briefly
  const [copiedId, setCopiedId] = useState(null)

  const EXPIRY_OPTIONS = [
    { v: '1d',     l: '1 day' },
    { v: '7d',     l: '7 days' },
    { v: '30d',    l: '30 days' },
    { v: 'never',  l: 'Never expires' },
  ]
  function expiryToTimestamp(key) {
    if (key === 'never') return null
    const days = key === '1d' ? 1 : key === '7d' ? 7 : 30
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString()
  }

  useEffect(() => { loadInvites() }, [])

  async function loadInvites() {
    setLoading(true)
    try {
      const grouped = {}
      for (const co of companies) {
        const list = await api.fetchCompanyInvites(co.id).catch(()=>[])
        grouped[co.id] = list
      }
      setInvitesByCompany(grouped)
    } catch(e) { /* non-fatal */ }
    setLoading(false)
  }

  async function createInvite(e) {
    if (e) e.preventDefault()
    if (!formCompanyId || creating) return
    setCreating(true)
    try {
      const maxUses = formMaxUses === '' ? null : Math.max(1, parseInt(formMaxUses) || 1)
      const expiresAt = expiryToTimestamp(formExpiry)
      const created = await api.createCompanyInvite(formCompanyId, {
        maxUses, expiresAt, role: formRole, label: formLabel.trim()
      })
      // Optimistically update the grouped list
      setInvitesByCompany(prev => ({
        ...prev,
        [formCompanyId]: [created, ...(prev[formCompanyId] || [])]
      }))
      setFormLabel('')
      setFormMaxUses('')
      showToast(`Invite created · code ${created.code}`)
    } catch(e) {
      showToast(e.message || 'Failed to create invite', 'error')
    }
    setCreating(false)
  }

  async function revoke(invite) {
    try {
      await api.revokeCompanyInvite(invite.id)
      setInvitesByCompany(prev => ({
        ...prev,
        [invite.company_id]: (prev[invite.company_id] || []).filter(i => i.id !== invite.id)
      }))
      showToast('Invite revoked')
    } catch(e) {
      showToast(e.message || 'Failed to revoke', 'error')
    }
  }

  function inviteUrl(code) {
    return `${window.location.origin}/?invite=${encodeURIComponent(code)}`
  }

  async function copy(text, id) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(c => c === id ? null : c), 1500)
    } catch(e) {
      // Fallback for older browsers / restricted contexts: show in a prompt
      window.prompt('Copy this:', text)
    }
  }

  // Format an expiry timestamp as "in 6 days" or "Never"
  function expiryLabel(ts) {
    if (!ts) return 'Never expires'
    const d = new Date(ts)
    const days = Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24))
    if (days < 0) return 'Expired'
    if (days === 0) return 'Expires today'
    if (days === 1) return 'Expires tomorrow'
    return `Expires in ${days} days`
  }

  function usesLabel(invite) {
    if (invite.max_uses == null) {
      return `${invite.used_count} ${invite.used_count === 1 ? 'use' : 'uses'}`
    }
    return `${invite.used_count} / ${invite.max_uses} uses`
  }

  const totalActive = Object.values(invitesByCompany).reduce((s, arr) => s + (arr?.length || 0), 0)

  return (
    <>
      {/* Explainer */}
      <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 6 }}>
          🔗 <strong style={{ color: T.text }}>Shareable invite links</strong>
        </div>
        <p style={{ fontFamily: mono, fontSize: 11, color: T.faint, lineHeight: 1.6 }}>
          Generate a link or code that anyone can use to join your company —
          no need to type their email upfront. Useful for inviting via WhatsApp,
          Slack, or in person. Set a usage limit and expiry to keep it secure.
        </p>
      </div>

      {/* Create invite form */}
      <form onSubmit={createInvite}
        style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Generate new invite
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Company</label>
            <select value={formCompanyId} onChange={e => setFormCompanyId(e.target.value)}
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Max uses</label>
            <input type="number" min={1} placeholder="Unlimited" value={formMaxUses}
              onChange={e => setFormMaxUses(e.target.value)}
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}/>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Expires</label>
            <select value={formExpiry} onChange={e => setFormExpiry(e.target.value)}
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}>
              {EXPIRY_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Label (optional)</label>
            <input value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="e.g. WhatsApp share"
              style={{ width: '100%', fontFamily: mono, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text }}/>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Role for joiners</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { v: 'viewer', l: 'Viewer',  desc: 'Read-only access' },
              { v: 'editor', l: 'Editor',  desc: 'Edit properties, rent, compliance' },
              { v: 'admin',  l: 'Admin',   desc: 'Editor + manage users & settings' },
            ].map(opt => {
              const active = formRole === opt.v
              return (
                <label key={opt.v}
                  style={{
                    flex: '1 1 140px', cursor: 'pointer',
                    border: `1px solid ${active ? T.gold : T.border}`,
                    background: active ? T.gold + '11' : 'transparent',
                    borderRadius: 8, padding: '8px 12px',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}>
                  <input type="radio" name="formRole" value={opt.v} checked={active}
                    onChange={() => setFormRole(opt.v)}
                    style={{ marginRight: 6, verticalAlign: 'middle' }}/>
                  <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: active ? T.gold : T.text, verticalAlign: 'middle' }}>
                    {opt.l}
                  </span>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2, marginLeft: 22 }}>
                    {opt.desc}
                  </div>
                </label>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
          <button type="submit" disabled={creating || !formCompanyId} className="btn btn-gold" style={{ fontSize: 11 }}>
            {creating ? 'Generating…' : '+ Generate invite'}
          </button>
        </div>
      </form>

      {/* Active invites */}
      {loading
        ? <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, textAlign: 'center', padding: 24 }}>Loading invites…</div>
        : totalActive === 0
          ? <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, textAlign: 'center', padding: 32, background: T.bg, borderRadius: 10 }}>
              No active invites yet. Generate one above to share with your team.
            </div>
          : <div style={{ display: 'grid', gap: 14 }}>
              {companies.map(co => {
                const list = invitesByCompany[co.id] || []
                if (!list.length) return null
                return (
                  <div key={co.id}>
                    <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      <span style={{ color: co.color || T.gold }}>{co.abbr}</span> {co.name} · {list.length} active
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {list.map(inv => {
                        const isCopied = copiedId === inv.id
                        const isUrl = inv.code && true  // we always have a code
                        return (
                          <div key={inv.id}
                            style={{ background: T.bg, borderRadius: 10, border: `1px solid ${T.border}`, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: '0.05em' }}>
                                  {inv.code}
                                </span>
                                {/* Role badge — colour-coded per role.
                                    Older rows pre-date the `role` column so we
                                    fall back to is_admin → Admin / Editor. */}
                                {(() => {
                                  const role = inv.role || (inv.is_admin ? 'admin' : 'editor')
                                  const meta = {
                                    admin:  { label: 'Admin',  bg: T.gold,  text: T.gold },
                                    editor: { label: 'Editor', bg: T.blue || '#4B8FE0', text: T.blue || '#4B8FE0' },
                                    viewer: { label: 'Viewer', bg: T.muted, text: T.muted },
                                  }[role] || { label: role, bg: T.muted, text: T.muted }
                                  return (
                                    <span style={{ fontFamily: mono, fontSize: 9, color: meta.text, background: meta.bg + '22', padding: '2px 6px', borderRadius: 4 }}>
                                      {meta.label}
                                    </span>
                                  )
                                })()}
                                {inv.label && (
                                  <span style={{ fontFamily: mono, fontSize: 10, color: T.faint, fontStyle: 'italic' }}>{inv.label}</span>
                                )}
                              </div>
                              <button onClick={() => revoke(inv)}
                                style={{ fontFamily: mono, fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.red}`, color: T.red, background: T.red + '11' }}>
                                Revoke
                              </button>
                            </div>
                            {/* URL row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <input readOnly value={inviteUrl(inv.code)}
                                onClick={e => e.target.select()}
                                style={{ flex: 1, fontFamily: mono, fontSize: 11, padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.muted, minWidth: 0 }}/>
                              <button onClick={() => copy(inviteUrl(inv.code), inv.id + '-url')}
                                style={{ fontFamily: mono, fontSize: 10, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.border}`, background: copiedId === inv.id + '-url' ? T.green + '22' : 'transparent', color: copiedId === inv.id + '-url' ? T.green : T.text, whiteSpace: 'nowrap' }}>
                                {copiedId === inv.id + '-url' ? 'Copied' : 'Copy URL'}
                              </button>
                              <button onClick={() => copy(inv.code, inv.id + '-code')}
                                style={{ fontFamily: mono, fontSize: 10, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${T.border}`, background: copiedId === inv.id + '-code' ? T.green + '22' : 'transparent', color: copiedId === inv.id + '-code' ? T.green : T.text, whiteSpace: 'nowrap' }}>
                                {copiedId === inv.id + '-code' ? 'Copied' : 'Copy code'}
                              </button>
                            </div>
                            {/* Status row */}
                            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              <span>{usesLabel(inv)}</span>
                              <span>·</span>
                              <span>{expiryLabel(inv.expires_at)}</span>
                              <span>·</span>
                              <span>Created {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
      }
    </>
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
                      <span style={{ fontFamily: mono, fontSize: 9, color: T.gold, marginLeft: 8 }}>recommended</span>
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
          { label: 'Est. MRR',       value: fmt(mrr),         color: T.green },
        ].map(m => (
          <div key={m.label} style={{ background: T.bg, borderRadius: 12, padding: '16px 18px', border: `1px solid ${T.border}` }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: m.color, letterSpacing: '-0.02em' }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${T.border}` }}>
        <button style={tabBtn('accounts')} onClick={() => setTab('accounts')}>Accounts ({companies.length})</button>
        <button style={tabBtn('users')} onClick={() => setTab('users')}>Users ({users.length})</button>
        <button style={tabBtn('flags')} onClick={() => setTab('flags')}>Feature Flags</button>
        <button style={tabBtn('revenue')} onClick={() => setTab('revenue')}>Revenue</button>
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
                      <div style={{ fontFamily: mono, fontSize: 12, color: monthlyRev > 0 ? T.green : T.muted }}>{monthlyRev > 0 ? fmt(monthlyRev) : '—'}</div>
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

          {/* FEATURE FLAGS TAB */}
          {tab === 'flags' && <FeatureFlagsPanel users={users} companies={companies} T={T} showToast={showToast}/>}

          {/* REVENUE TAB */}
          {tab === 'revenue' && <RevenueAnalyticsPanel companies={companies} T={T} showToast={showToast}/>}
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
                {deleting ? 'Verifying & deleting…' : 'Permanently delete user'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── FEATURE FLAGS PANEL (Developer only) ─────────────────────────────────────
function FeatureFlagsPanel({ users, companies, T, showToast }) {
  const mono = "'DM Mono',monospace"
  const confirmDialog = useConfirm()
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingFlag, setEditingFlag] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newFlag, setNewFlag] = useState({ key:'', name:'', description:'', enabled_globally:false })

  useEffect(()=>{ load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await api.fetchFeatureFlags()
      setFlags(data)
    } catch(e) { showToast('Failed to load flags','error') }
    setLoading(false)
  }

  async function toggleGlobal(flag) {
    try {
      await api.updateFeatureFlag(flag.key, { enabled_globally: !flag.enabled_globally })
      await load()
      showToast(`${flag.name} ${!flag.enabled_globally ? 'enabled' : 'disabled'} globally`)
    } catch(e) { showToast('Update failed','error') }
  }

  async function createFlag() {
    if (!newFlag.key || !newFlag.name) { showToast('Key and name required','error'); return }
    try {
      await api.createFeatureFlag(newFlag)
      setShowNew(false)
      setNewFlag({ key:'', name:'', description:'', enabled_globally:false })
      await load()
      showToast('Flag created')
    } catch(e) { showToast(e.message || 'Create failed','error') }
  }

  async function removeFlag(key) {
    if (!await confirmDialog({ title: `Delete flag "${key}"?`, body: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) return
    try {
      await api.deleteFeatureFlag(key)
      await load()
      showToast('Flag deleted')
    } catch(e) { showToast('Delete failed','error') }
  }

  if (loading) return <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:40,textAlign:'center'}}>Loading flags…</div>

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Feature Flags</div>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>Enable features globally, per user, or per company. Priority: user override → company override → global.</div>
        </div>
        <button className="btn btn-gold" style={{fontSize:11}} onClick={()=>setShowNew(true)}>+ New Flag</button>
      </div>

      {showNew && (
        <div style={{background:T.bg,border:`2px dashed ${T.gold}`,borderRadius:10,padding:16,marginBottom:16}}>
          <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:10,textTransform:'uppercase',letterSpacing:'0.1em'}}>New feature flag</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:4}}>Key (snake_case, unique)</label>
              <input value={newFlag.key} onChange={e=>setNewFlag({...newFlag,key:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'_')})}
                placeholder="eg. advanced_reports" style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:mono,fontSize:12}}/>
            </div>
            <div>
              <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:4}}>Display name</label>
              <input value={newFlag.name} onChange={e=>setNewFlag({...newFlag,name:e.target.value})}
                placeholder="eg. Advanced Reports" style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:mono,fontSize:12}}/>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={{fontFamily:mono,fontSize:10,color:T.muted,display:'block',marginBottom:4}}>Description</label>
            <input value={newFlag.description} onChange={e=>setNewFlag({...newFlag,description:e.target.value})}
              placeholder="What does this feature do?" style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:mono,fontSize:12}}/>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,fontFamily:mono,fontSize:11,color:T.text,marginBottom:12,cursor:'pointer'}}>
            <input type="checkbox" checked={newFlag.enabled_globally} onChange={e=>setNewFlag({...newFlag,enabled_globally:e.target.checked})}/>
            Enable globally by default
          </label>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-gold" style={{fontSize:11}} onClick={createFlag}>Create</button>
            <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{display:'grid',gap:10}}>
        {flags.length === 0 && <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:30,textAlign:'center'}}>No flags yet. Create your first flag above.</div>}
        {flags.map(flag => (
          <div key={flag.key} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4,flexWrap:'wrap'}}>
                  <span style={{fontSize:14,fontWeight:700,color:T.text}}>{flag.name}</span>
                  <code style={{fontFamily:mono,fontSize:10,background:T.bg,padding:'2px 8px',borderRadius:4,color:T.muted}}>{flag.key}</code>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:flag.enabled_globally?T.green+'22':T.muted+'22',color:flag.enabled_globally?T.green:T.muted,textTransform:'uppercase'}}>
                    {flag.enabled_globally ? 'Globally ON' : 'Globally OFF'}
                  </span>
                </div>
                {flag.description && <div style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:6}}>{flag.description}</div>}
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>toggleGlobal(flag)}
                  style={{fontFamily:mono,fontSize:10,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${flag.enabled_globally?T.red:T.green}`,background:(flag.enabled_globally?T.red:T.green)+'22',color:flag.enabled_globally?T.red:T.green}}>
                  {flag.enabled_globally ? 'Disable globally' : 'Enable globally'}
                </button>
                <button onClick={()=>setEditingFlag(flag)}
                  style={{fontFamily:mono,fontSize:10,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:T.bg,color:T.text}}>
                  Overrides →
                </button>
                <button onClick={()=>removeFlag(flag.key)}
                  style={{fontFamily:mono,fontSize:10,padding:'5px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.red}44`,background:'transparent',color:T.red}}>
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editingFlag && <FlagOverridesModal flag={editingFlag} users={users} companies={companies} onClose={()=>setEditingFlag(null)} T={T} showToast={showToast}/>}
    </div>
  )
}

function FlagOverridesModal({ flag, users, companies, onClose, T, showToast }) {
  const mono = "'DM Mono',monospace"
  const [userOverrides, setUserOverrides] = useState([])
  const [companyOverrides, setCompanyOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [pickMode, setPickMode] = useState(null) // 'user' | 'company' | null
  const [search, setSearch] = useState('')

  useEffect(()=>{ load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [u, c] = await Promise.all([
        api.fetchFlagUserOverrides(flag.key),
        api.fetchFlagCompanyOverrides(flag.key),
      ])
      setUserOverrides(u)
      setCompanyOverrides(c)
    } catch(e) {}
    setLoading(false)
  }

  async function addUserOverride(userId, enabled) {
    try { await api.setFlagUserOverride(flag.key, userId, enabled); await load(); setPickMode(null); setSearch('') } catch(e) { showToast('Failed','error') }
  }
  async function removeUserOverride(userId) {
    try { await api.removeFlagUserOverride(flag.key, userId); await load() } catch(e) { showToast('Failed','error') }
  }
  async function addCompanyOverride(companyId, enabled) {
    try { await api.setFlagCompanyOverride(flag.key, companyId, enabled); await load(); setPickMode(null); setSearch('') } catch(e) { showToast('Failed','error') }
  }
  async function removeCompanyOverride(companyId) {
    try { await api.removeFlagCompanyOverride(flag.key, companyId); await load() } catch(e) { showToast('Failed','error') }
  }

  const userOverrideIds = new Set(userOverrides.map(o => o.user_id))
  const companyOverrideIds = new Set(companyOverrides.map(o => o.company_id))

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={onClose}>
      <div style={{background:T.surface,borderRadius:14,maxWidth:700,width:'100%',maxHeight:'90vh',overflow:'auto',padding:24}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:2}}>🚩 {flag.name}</h2>
            <code style={{fontFamily:mono,fontSize:10,color:T.muted}}>{flag.key}</code>
          </div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:T.muted,fontSize:20,cursor:'pointer'}}>✕</button>
        </div>
        <p style={{fontFamily:mono,fontSize:11,color:T.muted,marginBottom:16,lineHeight:1.6}}>
          Global: <strong style={{color:flag.enabled_globally?T.green:T.muted}}>{flag.enabled_globally ? 'ON' : 'OFF'}</strong>. Overrides below take priority.
        </p>

        {/* USER OVERRIDES */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Per-user overrides ({userOverrides.length})</div>
            <button onClick={()=>setPickMode('user')} style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.gold}}>+ Add user</button>
          </div>
          {userOverrides.length === 0 && <div style={{fontFamily:mono,fontSize:11,color:T.muted,padding:10}}>No user overrides.</div>}
          {userOverrides.map(o => {
            const u = users.find(u=>u.id===o.user_id)
            return (
              <div key={o.user_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:T.bg,borderRadius:6,marginBottom:6}}>
                <span style={{fontFamily:mono,fontSize:11,color:T.text}}>{u?.email || o.user_id}</span>
                <div style={{display:'flex',gap:6}}>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:o.enabled?T.green+'22':T.red+'22',color:o.enabled?T.green:T.red,textTransform:'uppercase'}}>
                    {o.enabled ? 'FORCED ON' : 'FORCED OFF'}
                  </span>
                  <button onClick={()=>removeUserOverride(o.user_id)} style={{fontFamily:mono,fontSize:9,padding:'2px 8px',borderRadius:4,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>✕</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* COMPANY OVERRIDES */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Per-company overrides ({companyOverrides.length})</div>
            <button onClick={()=>setPickMode('company')} style={{fontFamily:mono,fontSize:10,padding:'4px 10px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.gold}`,background:T.gold+'22',color:T.gold}}>+ Add company</button>
          </div>
          {companyOverrides.length === 0 && <div style={{fontFamily:mono,fontSize:11,color:T.muted,padding:10}}>No company overrides.</div>}
          {companyOverrides.map(o => {
            const c = companies.find(c=>c.id===o.company_id)
            return (
              <div key={o.company_id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:T.bg,borderRadius:6,marginBottom:6}}>
                <span style={{fontFamily:mono,fontSize:11,color:T.text}}>{c?.name || o.company_id}</span>
                <div style={{display:'flex',gap:6}}>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:o.enabled?T.green+'22':T.red+'22',color:o.enabled?T.green:T.red,textTransform:'uppercase'}}>
                    {o.enabled ? 'FORCED ON' : 'FORCED OFF'}
                  </span>
                  <button onClick={()=>removeCompanyOverride(o.company_id)} style={{fontFamily:mono,fontSize:9,padding:'2px 8px',borderRadius:4,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>✕</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* PICK SUBJECT */}
        {pickMode && (
          <div style={{background:T.bg,border:`2px dashed ${T.gold}`,borderRadius:10,padding:14,marginTop:10}}>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginBottom:8,textTransform:'uppercase',letterSpacing:'0.1em'}}>
              Select {pickMode === 'user' ? 'user' : 'company'} to add override
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
              style={{width:'100%',padding:'8px 10px',borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:mono,fontSize:12,marginBottom:10}}/>
            <div style={{maxHeight:260,overflow:'auto'}}>
              {pickMode === 'user' && users.filter(u => !userOverrideIds.has(u.id) && (!search || u.email?.toLowerCase().includes(search.toLowerCase()))).slice(0,30).map(u => (
                <div key={u.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',marginBottom:4,background:T.surface,borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:T.text}}>{u.email}</span>
                  <div style={{display:'flex',gap:4}}>
                    <button onClick={()=>addUserOverride(u.id, true)} style={{fontFamily:mono,fontSize:9,padding:'3px 8px',borderRadius:4,cursor:'pointer',border:`1px solid ${T.green}`,background:T.green+'22',color:T.green}}>Force ON</button>
                    <button onClick={()=>addUserOverride(u.id, false)} style={{fontFamily:mono,fontSize:9,padding:'3px 8px',borderRadius:4,cursor:'pointer',border:`1px solid ${T.red}`,background:T.red+'22',color:T.red}}>Force OFF</button>
                  </div>
                </div>
              ))}
              {pickMode === 'company' && companies.filter(c => !companyOverrideIds.has(c.id) && (!search || c.name?.toLowerCase().includes(search.toLowerCase()))).slice(0,30).map(c => (
                <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',marginBottom:4,background:T.surface,borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:T.text}}>{c.name}</span>
                  <div style={{display:'flex',gap:4}}>
                    <button onClick={()=>addCompanyOverride(c.id, true)} style={{fontFamily:mono,fontSize:9,padding:'3px 8px',borderRadius:4,cursor:'pointer',border:`1px solid ${T.green}`,background:T.green+'22',color:T.green}}>Force ON</button>
                    <button onClick={()=>addCompanyOverride(c.id, false)} style={{fontFamily:mono,fontSize:9,padding:'3px 8px',borderRadius:4,cursor:'pointer',border:`1px solid ${T.red}`,background:T.red+'22',color:T.red}}>Force OFF</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>{setPickMode(null);setSearch('')}} style={{marginTop:8,fontFamily:mono,fontSize:10,padding:'5px 12px',borderRadius:6,cursor:'pointer',border:`1px solid ${T.border}`,background:'transparent',color:T.muted}}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── REVENUE ANALYTICS PANEL (Developer only) ────────────────────────────────
function RevenueAnalyticsPanel({ companies, T, showToast }) {
  const mono = "'DM Mono',monospace"
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ totalUsers: 0, activeUsers: 0, totalCompanies: 0, totalProperties: 0, mrr: 0, signupsLast30: 0, signupsLast7: 0, cohorts: [] })

  useEffect(()=>{ load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [users, properties] = await Promise.all([
        api.fetchAllUsers().catch(()=>[]),
        supabase.from('properties').select('id, user_id, company_id, created_at').then(r=>r.data||[]),
      ])
      const totalUsers = users.length
      const totalCompanies = companies.length
      const totalProperties = properties.length
      const mrr = totalProperties * 2  // £2/property/month

      const now = Date.now()
      const signupsLast30 = users.filter(u => new Date(u.created_at).getTime() > now - 30*24*60*60*1000).length
      const signupsLast7 = users.filter(u => new Date(u.created_at).getTime() > now - 7*24*60*60*1000).length
      const propertyOwnerIds = new Set(properties.map(p=>p.user_id))
      const activeUsers = propertyOwnerIds.size

      // Build monthly signup cohorts (last 6 months)
      const cohorts = []
      const today = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
        const nextD = new Date(today.getFullYear(), today.getMonth() - i + 1, 1)
        const monthUsers = users.filter(u => {
          const t = new Date(u.created_at).getTime()
          return t >= d.getTime() && t < nextD.getTime()
        })
        const monthActive = monthUsers.filter(u => propertyOwnerIds.has(u.id)).length
        cohorts.push({
          month: d.toLocaleDateString('en-GB', { month:'short', year:'2-digit' }),
          signups: monthUsers.length,
          active: monthActive,
          retention: monthUsers.length > 0 ? (monthActive/monthUsers.length*100) : 0,
        })
      }

      setStats({ totalUsers, activeUsers, totalCompanies, totalProperties, mrr, signupsLast30, signupsLast7, cohorts })
    } catch(e) { showToast('Failed to load revenue data','error') }
    setLoading(false)
  }

  if (loading) return <div style={{fontFamily:mono,fontSize:12,color:T.muted,padding:40,textAlign:'center'}}>Loading revenue analytics…</div>

  const arpu = stats.activeUsers > 0 ? stats.mrr / stats.activeUsers : 0
  const conversionRate = stats.totalUsers > 0 ? (stats.activeUsers / stats.totalUsers) * 100 : 0
  const fmt = n => '£'+(n||0).toLocaleString('en-GB',{maximumFractionDigits:0})

  return (
    <div>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Revenue Analytics</div>
        <div style={{fontFamily:mono,fontSize:11,color:T.muted}}>Key metrics updated in real-time. MRR assumes £2/property/month.</div>
      </div>

      {/* KPI cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:12,marginBottom:24}}>
        {[
          { label:'MRR', value: fmt(stats.mrr), color:T.gold, sub:`${fmt(stats.mrr*12)} ARR projected`},
          { label:'Total users', value: stats.totalUsers, color:T.text, sub:`${stats.activeUsers} with properties (${conversionRate.toFixed(1)}% activation)`},
          { label:'ARPU', value: fmt(arpu), color:T.green, sub:'per active user per month'},
          { label:'Total properties', value: stats.totalProperties, color:T.blue, sub:`across ${stats.totalCompanies} companies`},
          { label:'Signups (30d)', value: stats.signupsLast30, color:T.gold, sub:`${stats.signupsLast7} last 7 days`},
        ].map((k,i) => (
          <div key={i} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:14}}>
            <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{k.label}</div>
            <div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:k.color,marginBottom:4}}>{k.value}</div>
            <div style={{fontFamily:mono,fontSize:10,color:T.muted}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Monthly signup cohorts */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:16,marginBottom:20}}>
        <div style={{fontFamily:mono,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12}}>Monthly cohort performance</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontFamily:mono,fontSize:11}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${T.border}`}}>
                <th style={{textAlign:'left',padding:'6px 8px',color:T.muted,fontWeight:700}}>Cohort</th>
                <th style={{textAlign:'right',padding:'6px 8px',color:T.muted,fontWeight:700}}>Signups</th>
                <th style={{textAlign:'right',padding:'6px 8px',color:T.muted,fontWeight:700}}>Activated</th>
                <th style={{textAlign:'right',padding:'6px 8px',color:T.muted,fontWeight:700}}>Retention %</th>
              </tr>
            </thead>
            <tbody>
              {stats.cohorts.map((c,i) => (
                <tr key={i} style={{borderBottom:`1px solid ${T.border}`}}>
                  <td style={{padding:'8px',color:T.text}}>{c.month}</td>
                  <td style={{padding:'8px',textAlign:'right',color:T.text}}>{c.signups}</td>
                  <td style={{padding:'8px',textAlign:'right',color:T.green}}>{c.active}</td>
                  <td style={{padding:'8px',textAlign:'right',fontWeight:700,color:c.retention>=50?T.green:c.retention>=25?T.amber:T.red}}>
                    {c.signups === 0 ? '—' : c.retention.toFixed(0)+'%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{fontFamily:mono,fontSize:10,color:T.muted,marginTop:10,lineHeight:1.6}}>
          "Activated" = user has created at least one property. Retention = % of signups who activated.
        </div>
      </div>
    </div>
  )
}

// ── COMPANY BRANDING SETTINGS PANEL ──────────────────────────────────────────
function BrandingSettingsPanel({ companies, setCompanies, companySettings, setCompanySettings, user, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [selectedCo, setSelectedCo] = useState(companies[0]?.id || '')
  const [uploading, setUploading]   = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const [savingColor, setSavingColor] = useState(false)
  const [colorDraft, setColorDraft]   = useState(null)

  const co = companies.find(c => c.id === selectedCo)
  const cs = companySettings[selectedCo] || {}

  useEffect(() => {
    if (selectedCo && companySettings[selectedCo]) {
      setLogoPreview(companySettings[selectedCo].logo_url || null)
    }
    setColorDraft(null)
  }, [selectedCo, companySettings])

  async function updateCompanyColor(newColor) {
    if (!co || !newColor) return
    if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) { showToast('Enter a valid hex colour (e.g. #4B8FE0)', 'error'); return }
    if (newColor.toLowerCase() === (co.color || '').toLowerCase()) { setColorDraft(null); return }
    setSavingColor(true)
    try {
      const { error } = await supabase.from('companies').update({ color: newColor }).eq('id', co.id)
      if (error) throw error
      setCompanies(prev => prev.map(c => c.id === co.id ? { ...c, color: newColor } : c))
      setColorDraft(null)
      showToast('Report colour updated')
    } catch(e) { showToast(e.message || 'Failed to save colour', 'error') }
    setSavingColor(false)
  }

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

          {/* Report accent colour */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px' }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Report colour</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 16, lineHeight: 1.7 }}>
              PDF report headers and accents will use this colour. It is also used as the accent colour for this company throughout the app.
            </div>

            {/* Preset swatches */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {['#C8A84B','#4B8FE0','#2ECC8A','#E0943A','#9B59B6','#E05555','#16A085','#34495E','#D35400','#7F8C8D'].map(c => {
                const selected = (co.color || '').toLowerCase() === c.toLowerCase()
                return (
                  <button key={c} onClick={() => updateCompanyColor(c)}
                    disabled={savingColor}
                    style={{ width: 36, height: 36, borderRadius: 8, cursor: savingColor ? 'wait' : 'pointer',
                      border: `2px solid ${selected ? T.text : 'transparent'}`,
                      background: c, padding: 0, outline: 'none',
                      boxShadow: selected ? `0 0 0 2px ${T.card}, 0 0 0 3px ${c}` : 'none' }}
                    title={c}/>
                )
              })}
            </div>

            {/* Custom colour picker + hex input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="color" value={co.color || '#C8A84B'}
                  onChange={e => setColorDraft(e.target.value)}
                  onBlur={e => updateCompanyColor(e.target.value)}
                  disabled={savingColor}
                  style={{ width: 48, height: 36, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer', background: 'transparent', padding: 2 }}/>
                <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Custom</span>
              </label>
              <input type="text" value={colorDraft !== null ? colorDraft : (co.color || '#C8A84B')}
                onChange={e => setColorDraft(e.target.value)}
                onBlur={() => { if (colorDraft && /^#[0-9A-Fa-f]{6}$/.test(colorDraft)) updateCompanyColor(colorDraft); else setColorDraft(null) }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                placeholder="#C8A84B"
                style={{ fontFamily: mono, fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '8px 12px', width: 110, outline: 'none' }}/>
              {savingColor && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Saving…</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current:</div>
              <div style={{ width: 48, height: 24, borderRadius: 6, background: co.color || T.gold }}/>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.text, fontWeight: 700 }}>{co.color || '#C8A84B'}</span>
            </div>
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

// ── TENANT PORTAL SETTINGS ────────────────────────────────────────────────────
function TenantPortalSettings({ companies, companySettings, setCompanySettings, showToast, T }) {
  const mono = "'DM Mono',monospace"
  const [selectedCo, setSelectedCo] = useState(companies[0]?.id || '')
  const [mode, setMode]           = useState('landlord')
  const [agentName, setAgentName] = useState('')
  const [agentPhone, setAgentPhone] = useState('')
  const [agentEmail, setAgentEmail] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [bankName, setBankName]   = useState('')
  const [bankSort, setBankSort]   = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankRef, setBankRef]     = useState('RENT')
  const [saving, setSaving]       = useState(false)
  const [savingBank, setSavingBank] = useState(false)
  const [notifyEmail, setNotifyEmail] = useState('')
  const [savingNotify, setSavingNotify] = useState(false)
  const [inviteProperty, setInviteProperty] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [properties, setProperties] = useState([])

  const co = companies.find(c => c.id === selectedCo)

  // Auto-generate subdomain from company name
  function generateSubdomain(name) {
    return name
      .toLowerCase()
      .replace(/\s+(property|group|ltd|limited|co|company|management|properties)\s*/gi, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
  }

  useEffect(() => {
    if (!selectedCo) return
    const c = companies.find(x => x.id === selectedCo)
    setMode(c?.contact_mode || 'landlord')
    setAgentName(c?.agent_name || '')
    setAgentPhone(c?.agent_phone || '')
    setAgentEmail(c?.agent_email || '')
    // Auto-generate subdomain if not already set
    setSubdomain(c?.subdomain || generateSubdomain(c?.name || ''))
    setInviteLink('')
    supabase.from('properties').select('id,name,address').eq('company_id', selectedCo)
      .then(({data}) => { setProperties(data||[]); setInviteProperty(data?.[0]?.id||'') })
    // Load bank details
    api.fetchCompanyBankDetails(selectedCo).then(b => {
      setBankName(b.bank_name||''); setBankSort(b.bank_sort_code||'')
      setBankAccount(b.bank_account_no||''); setBankRef(b.bank_reference_prefix||'RENT')
      setNotifyEmail(b.tenant_notification_email||'')
    }).catch(()=>{})
  }, [selectedCo])

  async function saveContact() {
    setSaving(true)
    try {
      await api.saveCompanyContactMode(selectedCo, mode, agentName, agentPhone, agentEmail)
      if (subdomain) await api.saveCompanySubdomain(selectedCo, subdomain)
      showToast('Settings saved')
    } catch(e) { showToast(e.message,'error') }
    setSaving(false)
  }

  async function saveBank() {
    setSavingBank(true)
    try {
      await api.saveCompanyBankDetails(selectedCo, { bank_name:bankName, bank_sort_code:bankSort, bank_account_no:bankAccount, bank_reference_prefix:bankRef })
      showToast('Bank details saved')
    } catch(e) { showToast(e.message,'error') }
    setSavingBank(false)
  }

  async function saveNotifyEmail() {
    setSavingNotify(true)
    try {
      await api.saveTenantNotificationEmail(selectedCo, notifyEmail)
      showToast('Notification email saved')
    } catch(e) { showToast(e.message,'error') }
    setSavingNotify(false)
  }

  async function generateInviteLink() {
    if (!inviteProperty) { showToast('Select a property first','error'); return }
    try {
      // Invites are DB-issued single-use tokens (tenant_invites) — raw
      // `?tenant_property=<uuid>` links are no longer honoured.
      const { data: { session } } = await supabase.auth.getSession()
      const { signupUrl } = await api.inviteTenant(inviteProperty, null, session?.user?.id ?? null)
      setInviteLink(signupUrl)
      showToast('Invite link generated')
    } catch(e) { showToast(e.message,'error') }
  }

  const inp = { fontFamily:mono, fontSize:12, background:T.surface, border:`1px solid ${T.border}`, color:T.text, borderRadius:8, padding:'8px 12px', outline:'none', width:'100%' }
  const lbl = { fontFamily:mono, fontSize:10, color:T.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.08em' }

  return (
    <div>
      {companies.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Company</label>
          <select value={selectedCo} onChange={e=>setSelectedCo(e.target.value)} style={inp}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Subdomain */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Tenant portal subdomain</div>
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12 }}>
          <input value={subdomain} onChange={e=>setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}
            placeholder="e.g. nouchette"
            style={{...inp, width:'auto', flex:1}}/>
          <span style={{ fontFamily:mono, fontSize:12, color:T.muted, flexShrink:0 }}>.ownproperly.com</span>
        </div>
        {subdomain && (
          <div style={{ background:T.gold+'18', border:`1px solid ${T.gold}44`, borderRadius:8, padding:'10px 14px', marginBottom:10 }}>
            <div style={{ fontFamily:mono, fontSize:11, color:T.muted, marginBottom:4 }}>Tenant portal URL:</div>
            <div style={{ fontFamily:mono, fontSize:13, fontWeight:700, color:T.gold }}>
              https://{subdomain}.ownproperly.com
            </div>
          </div>
        )}
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, lineHeight:1.6 }}>
          Auto-generated from company name. Lowercase letters, numbers and hyphens only.
        </div>
      </div>

      {/* Contact mode */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>Contact mode</div>
        <div style={{ display:'grid', gap:10, marginBottom:16 }}>
          {[
            ['landlord','Landlord mode','Tenants message you via the portal. No direct contact details shown.'],
            ['agent','Managing agent mode','Tenants see the agent name, phone and email instead of yours.'],
          ].map(([k,l,d])=>(
            <div key={k} onClick={()=>setMode(k)} style={{ display:'flex', gap:14, padding:'14px 16px', borderRadius:10, cursor:'pointer',
              border:`2px solid ${mode===k?T.gold:T.border}`, background:mode===k?T.gold+'11':T.bg }}>
              <div style={{ width:18, height:18, borderRadius:9, border:`2px solid ${mode===k?T.gold:T.border}`, background:mode===k?T.gold:'transparent', flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{l}</div>
                <div style={{ fontFamily:mono, fontSize:11, color:T.muted }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
        {mode==='agent' && (
          <div style={{ background:T.bg, borderRadius:10, padding:16, marginBottom:16 }}>
            <div style={{ display:'grid', gap:10 }}>
              <div><label style={lbl}>Agent / company name</label><input value={agentName} onChange={e=>setAgentName(e.target.value)} placeholder="Smith Property Management" style={inp}/></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><label style={lbl}>Phone</label><input value={agentPhone} onChange={e=>setAgentPhone(e.target.value)} placeholder="01234 567890" style={inp}/></div>
                <div><label style={lbl}>Email</label><input value={agentEmail} onChange={e=>setAgentEmail(e.target.value)} placeholder="agent@firm.com" style={inp}/></div>
              </div>
            </div>
          </div>
        )}
        <button onClick={saveContact} disabled={saving} style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'10px 22px', borderRadius:8, border:'none', background:T.gold, color:'white', cursor:'pointer' }}>
          {saving?'Saving…':'Save contact & subdomain settings'}
        </button>
      </div>

      {/* Bank details */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Bank payment details</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, marginBottom:14, lineHeight:1.7 }}>
          These details are shown to tenants on their Home and Rent tabs so they know where to pay.
        </div>
        <div style={{ display:'grid', gap:10, marginBottom:14 }}>
          <div><label style={lbl}>Bank name</label><input value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. NatWest" style={inp}/></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div><label style={lbl}>Sort code</label><input value={bankSort} onChange={e=>setBankSort(e.target.value)} placeholder="00-00-00" style={inp}/></div>
            <div><label style={lbl}>Account number</label><input value={bankAccount} onChange={e=>setBankAccount(e.target.value)} placeholder="12345678" style={inp}/></div>
          </div>
          <div><label style={lbl}>Reference prefix</label>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <input value={bankRef} onChange={e=>setBankRef(e.target.value.toUpperCase())} placeholder="RENT" style={{...inp,width:'auto'}}/>
              <span style={{ fontFamily:mono, fontSize:11, color:T.muted }}>e.g. RENT-14MAPLESTREET</span>
            </div>
          </div>
        </div>
        <button onClick={saveBank} disabled={savingBank} style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'10px 22px', borderRadius:8, border:'none', background:T.gold, color:'white', cursor:'pointer' }}>
          {savingBank?'Saving…':'Save bank details'}
        </button>
      </div>

      {/* Notification email */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Tenant notification email</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, marginBottom:14, lineHeight:1.7 }}>
          When a tenant submits a repair request or sends a message, we will email this address instantly. Leave blank to disable email notifications.
        </div>
        <div style={{ display:'flex', gap:10, marginBottom:0 }}>
          <input value={notifyEmail} onChange={e=>setNotifyEmail(e.target.value)} type="email"
            placeholder="e.g. justin@jvhammond.com"
            style={{...inp, flex:1}}/>
          <button onClick={saveNotifyEmail} disabled={savingNotify}
            style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'9px 18px', borderRadius:8, border:'none', background:T.gold, color:'white', cursor:'pointer', flexShrink:0 }}>
            {savingNotify?'Saving…':'Save'}
          </button>
        </div>
      </div>

      {/* Invite tenant */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'20px 24px' }}>
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Invite a tenant</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, marginBottom:14, lineHeight:1.7 }}>
          Generate a sign-up link for a specific property. Share it with your tenant — when they create an account, they're automatically linked to that property.
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={lbl}>Property</label>
          <select value={inviteProperty} onChange={e=>setInviteProperty(e.target.value)} style={inp}>
            {properties.map(p=><option key={p.id} value={p.id}>{p.address||p.name}</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:10, marginBottom: inviteLink ? 14 : 0, flexWrap:'wrap' }}>
          <button onClick={generateInviteLink} disabled={!inviteProperty} style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'10px 22px', borderRadius:8, border:'none', background:T.gold, color:'white', cursor:'pointer' }}>
            Generate invite link
          </button>
          {inviteLink && (
            <div style={{ display:'flex', gap:8, alignItems:'center', flex:1, minWidth:240 }}>
              <input
                type="email"
                placeholder="tenant@email.com"
                id="tenant-invite-email"
                style={{ ...inp, flex:1 }}
              />
              <button
                onClick={async () => {
                  const emailInput = document.getElementById('tenant-invite-email')
                  const email = emailInput?.value?.trim()
                  if (!email) { showToast('Enter tenant email first', 'error'); return }
                  try {
                    const { data: { session } } = await supabase.auth.getSession()
                    const prop = properties.find(p => p.id === inviteProperty)
                    const co = companies.find(c => c.id === selectedCo)
                    await api.sendTenantInviteEmail(session, email, inviteProperty, prop?.address || prop?.name, co?.name)
                    showToast(`Invite sent to ${email}`)
                    if (emailInput) emailInput.value = ''
                  } catch(e) { showToast(e.message || 'Failed to send', 'error') }
                }}
                style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'10px 16px', borderRadius:8, border:'none', background:'#4B8FE0', color:'white', cursor:'pointer', flexShrink:0 }}>
                Email invite
              </button>
            </div>
          )}
        </div>
        {inviteLink && (
          <div style={{ background:T.bg, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontFamily:mono, fontSize:10, color:T.muted, marginBottom:8 }}>Share this with your tenant:</div>
            <div style={{ display:'flex', gap:10 }}>
              <input readOnly value={inviteLink} style={{ ...inp, color:T.gold, fontWeight:600 }}/>
              <button onClick={()=>{navigator.clipboard.writeText(inviteLink);showToast('Copied!')}}
                style={{ fontFamily:mono, fontSize:11, padding:'8px 14px', borderRadius:8, border:`1px solid ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer', flexShrink:0 }}>
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}



// ── SECURITY & DATA PANEL ─────────────────────────────────────────────────────
function SecurityDataPanel({ user, T, showToast }) {
  const mono = "'DM Mono',monospace"
  const [exporting, setExporting] = useState(false)
  const [deletedProps, setDeletedProps] = useState([])
  const [loadingTrash, setLoadingTrash] = useState(true)
  const [restoring, setRestoring] = useState(null)

  useEffect(() => {
    api.fetchDeletedProperties(user?.id).then(d => { setDeletedProps(d); setLoadingTrash(false) }).catch(() => setLoadingTrash(false))
  }, [])

  async function handleExport() {
    setExporting(true)
    try {
      const data = await api.exportUserData(user?.id)
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ownproperly-data-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('Data exported successfully')
    } catch(e) { showToast('Export failed: ' + e.message, 'error') }
    setExporting(false)
  }

  async function handleRestore(prop) {
    setRestoring(prop.id)
    try {
      await api.restoreProperty(prop.id, user?.id)
      setDeletedProps(prev => prev.filter(p => p.id !== prop.id))
      showToast(`${prop.name} restored`)
    } catch(e) { showToast(e.message, 'error') }
    setRestoring(null)
  }

  const sectionCard = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 16 }

  return (
    <div>
      {/* GDPR Data Export */}
      <div style={sectionCard}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Your data</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.8, marginBottom: 16 }}>
          Under GDPR you have the right to data portability and to request deletion of your account. Download your complete data at any time from the Backups tab, or request account deletion here.
        </div>
        <div style={{ background: T.bg, borderRadius: 10, padding: '14px 18px', marginBottom: 16, fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.8 }}>
          <div style={{ color: T.green, marginBottom: 6 }}>✓ <strong>Weekly automatic backups</strong> — saved and restorable from the Backups tab</div>
          <div style={{ color: T.green, marginBottom: 6 }}>✓ <strong>30-day Trash</strong> — deleted items can be restored from the Trash tab</div>
          <div style={{ color: T.green, marginBottom: 6 }}>✓ <strong>Full audit log</strong> — every change is logged to the audit trail</div>
          <div style={{ color: T.green }}>✓ <strong>Row-level security</strong> — your data is isolated from other users at the database level</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => window.open('mailto:hello@ownproperly.com?subject=Data deletion request', '_blank')}
            style={{ fontFamily: mono, fontSize: 12, padding: '10px 22px', borderRadius: 8, border: `1px solid ${T.red}44`, background: 'transparent', color: T.red, cursor: 'pointer' }}>
            Request account deletion
          </button>
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 12, lineHeight: 1.7 }}>
          For account deletion requests, we'll respond within 30 days. Note: financial records may be retained for 7 years to comply with HMRC requirements.
        </div>
      </div>

      {/* Deleted properties trash */}
      <div style={sectionCard}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Recently deleted properties</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.8, marginBottom: 16 }}>
          Deleted properties are kept here for 30 days before permanent removal. You can restore any property within that window.
        </div>
        {loadingTrash ? (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
        ) : deletedProps.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: '16px 0' }}>No deleted properties — your trash is empty.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {deletedProps.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.name}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
                    Deleted {new Date(p.deleted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {p.company && ` · ${p.company.name}`}
                  </div>
                </div>
                <button onClick={() => handleRestore(p)} disabled={restoring === p.id}
                  style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', background: T.green + '22', color: T.green, cursor: 'pointer' }}>
                  {restoring === p.id ? '…' : '↩ Restore'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Privacy policy link */}
      <div style={sectionCard}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Legal</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={() => window.dispatchEvent(new CustomEvent('ownproperly:show-privacy'))}
            style={{ fontFamily: mono, fontSize: 12, color: T.gold, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Privacy Policy →
          </button>
          <a href="mailto:hello@ownproperly.com" style={{ fontFamily: mono, fontSize: 12, color: T.muted, textDecoration: 'none' }}>
            hello@ownproperly.com
          </a>
        </div>
      </div>
    </div>
  )
}

// ── AUDIT LOG PANEL ───────────────────────────────────────────────────────────
function AuditLogPanel({ user, companies, T }) {
  const mono = "'DM Mono',monospace"
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')

  useEffect(() => { loadLogs() }, [companyFilter])

  async function loadLogs() {
    setLoading(true)
    try {
      const data = await api.fetchAuditLog(user?.id, companyFilter||null)
      setLogs(data)
    } catch(e) {}
    setLoading(false)
  }

  const ACTION_LABELS = {
    'property.created':            { label: 'Property added',       color: '#2ECC8A' },
    'property.deleted':            { label: 'Property deleted',     color: '#E05555' },
    'property.restored':           { label: 'Property restored',    color: '#4B8FE0' },
    'property.updated':            { label: 'Property updated',     color: '#C8A84B' },
    'rent.paid':                   { label: 'Rent marked paid',     color: '#2ECC8A' },
    'rent.updated':                { label: 'Rent updated',         color: '#C8A84B' },
    'compliance.added':            { label: 'Certificate added',    color: '#2ECC8A' },
    'compliance.expired':          { label: 'Certificate expired',  color: '#E05555' },
    'compliance.deleted':          { label: 'Certificate deleted',  color: '#E05555' },
    'expense.created':             { label: 'Expense added',        color: '#2ECC8A' },
    'expense.deleted':             { label: 'Expense deleted',      color: '#E05555' },
    'deal.created':                { label: 'Deal created',         color: '#C8A84B' },
    'deal.deleted':                { label: 'Deal deleted',         color: '#E05555' },
    'deal.updated':                { label: 'Deal updated',         color: '#C8A84B' },
    'tenancy.created':             { label: 'Tenancy added',        color: '#2ECC8A' },
    'tenancy.updated':             { label: 'Tenancy updated',      color: '#C8A84B' },
    'user.login':                  { label: 'Signed in',            color: '#4B8FE0' },
    'user.logout':                 { label: 'Signed out',           color: '#888EA8' },
    'company.created':             { label: 'Company created',      color: '#2ECC8A' },
    'company.updated':             { label: 'Company updated',      color: '#C8A84B' },
    'company.deleted':             { label: 'Company deleted',      color: '#E05555' },
    'user_company_access.created': { label: 'Access granted',       color: '#2ECC8A' },
    'user_company_access.deleted': { label: 'Access revoked',       color: '#E05555' },
    'user_company_access.updated': { label: 'Access updated',       color: '#C8A84B' },
    'invite.created':              { label: 'Invite sent',          color: '#4B8FE0' },
    'invite.redeemed':             { label: 'Invite redeemed',      color: '#2ECC8A' },
    'subscription.created':        { label: 'Subscription started', color: '#2ECC8A' },
    'subscription.updated':        { label: 'Subscription changed', color: '#C8A84B' },
    'subscription.canceled':       { label: 'Subscription cancelled', color: '#E05555' },
    'document.uploaded':           { label: 'Document uploaded',    color: '#4B8FE0' },
    'document.deleted':            { label: 'Document deleted',     color: '#E05555' },
    'maintenance.created':         { label: 'Maintenance job',      color: '#C8A84B' },
    'inspection.created':          { label: 'Inspection scheduled', color: '#4B8FE0' },
  }

  // Neutralise CSV formula injection: a cell starting with = + - @ or a tab
  // executes as a formula in Excel/Sheets. Prefix a quote unless the value is
  // purely numeric.
  function csvSafe(v) {
    const s = String(v == null ? '' : v)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) return "'" + s
    return s
  }

  function exportAuditCSV() {
    const rows = [
      ['Date', 'Action', 'Entity', 'Details'],
      ...logs.map(l => [
        new Date(l.created_at).toLocaleString('en-GB'),
        ACTION_LABELS[l.action]?.label || l.action,
        l.entity_name || l.entity_type || '—',
        JSON.stringify(l.metadata || {}),
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${csvSafe(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = 'ownproperly-audit-log.csv'; a.click()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: 0, marginBottom: 4 }}>Activity audit log</h3>
          <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>A record of all significant actions taken in your account</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {companies.length > 1 && (
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
              style={{ fontFamily: mono, fontSize: 12, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: '7px 12px' }}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={exportAuditCSV} style={{ fontFamily: mono, fontSize: 11, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
            ↓ Export
          </button>
        </div>
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr 1fr', gap: 8, padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
          {['Date & time', 'Action', 'Item', 'Details'].map(h => (
            <div key={h} style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>Loading audit log…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>No activity recorded yet. Actions you take in OwnProperly will appear here.</div>
        ) : (
          logs.map(log => {
            const cfg = ACTION_LABELS[log.action] || { label: log.action, color: T.muted }
            return (
              <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '85px minmax(150px, 200px) minmax(0, 1.5fr) minmax(0, 2fr)', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
                  {new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  <br/>
                  {new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ minWidth: 0 }}>
                  {/* inline-block + max-width so long labels truncate inside their column
                      instead of overlapping into the entity column */}
                  <span style={{ display: 'inline-block', maxWidth: '100%', fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: cfg.color + '22', color: cfg.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box' }}
                    title={log.action}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                  title={log.entity_name || log.entity_type || ''}>
                  {log.entity_name || log.entity_type || '—'}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                  title={log.metadata && Object.keys(log.metadata).length > 0 ? JSON.stringify(log.metadata) : ''}>
                  {log.metadata && Object.keys(log.metadata).length > 0 ? JSON.stringify(log.metadata) : '—'}
                </div>
              </div>
            )
          })
        )}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 10 }}>{logs.length} events · Last 100 shown</div>
    </div>
  )
}

// ── REFERRAL PANEL ────────────────────────────────────────────────────────────
function ReferralPanel({ user, T, showToast }) {
  const mono = "'DM Mono',monospace"
  const [code, setCode]         = useState('')
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading]   = useState(true)
  const [copied, setCopied]     = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const c = await api.fetchOrCreateReferralCode(user?.id, user?.email)
        setCode(c)
        const r = await api.fetchReferrals(user?.id)
        setReferrals(r)
      } catch(e) {}
      setLoading(false)
    }
    load()
  }, [])

  const referralUrl = `https://www.ownproperly.com?ref=${code}`
  const paying = referrals.filter(r => r.status === 'paying' || r.status === 'rewarded').length

  function copy() {
    navigator.clipboard.writeText(referralUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    showToast('Referral link copied!')
  }

  return (
    <div>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:'24px', marginBottom:16 }}>
        <div style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:12 }}>Refer a landlord, get a free month</div>
        <div style={{ fontFamily:mono, fontSize:12, color:T.text, lineHeight:1.8, marginBottom:20 }}>
          Share your referral link with another landlord. When they sign up and become a paying customer, we'll give you both a free month.
        </div>
        {loading ? <div style={{ fontFamily:mono, fontSize:12, color:T.muted }}>Generating your link…</div> : (
          <>
            <div style={{ display:'flex', gap:10, marginBottom:14 }}>
              <input readOnly value={referralUrl}
                style={{ flex:1, fontFamily:mono, fontSize:12, background:T.bg, border:`1px solid ${T.border}`, color:T.gold, borderRadius:8, padding:'9px 12px', outline:'none' }}/>
              <button onClick={copy}
                style={{ fontFamily:mono, fontSize:12, fontWeight:700, padding:'9px 18px', borderRadius:8, border:'none', background:copied?T.green:T.gold, color:'white', cursor:'pointer', transition:'background 0.2s', flexShrink:0 }}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
              {[
                { label:'Links shared', value: referrals.length },
                { label:'Signed up', value: referrals.filter(r=>r.status!=='pending').length },
                { label:'Free months earned', value: paying },
              ].map(k => (
                <div key={k.label} style={{ background:T.bg, borderRadius:8, padding:'12px 14px' }}>
                  <div style={{ fontFamily:mono, fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>{k.label}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:k.value>0?T.green:T.text }}>{k.value}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {referrals.length > 0 && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'10px 20px', background:T.bg, borderBottom:`1px solid ${T.border}`, fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em' }}>Referral history</div>
          {referrals.map(r => (
            <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 20px', borderBottom:`1px solid ${T.border}` }}>
              <div>
                <div style={{ fontFamily:mono, fontSize:12, color:T.text }}>{r.referred_email || 'Link shared'}</div>
                <div style={{ fontFamily:mono, fontSize:10, color:T.muted }}>{new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
              </div>
              <span style={{ fontFamily:mono, fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:20,
                background: r.status==='paying'?T.green+'22':r.status==='signed_up'?T.blue+'22':T.border,
                color: r.status==='paying'?T.green:r.status==='signed_up'?T.blue:T.muted }}>
                {r.status === 'paying' ? 'Paying' : r.status === 'signed_up' ? 'Signed up' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ACCOUNT TYPE PANEL ──────────────────────────────────────────────
// Lets the user say whether they file taxes as a sole-trader (individual),
// via a limited company (SPV), or both. Used to hide MTD ITSA from the
// nav for limited-company users (they file Corp Tax instead).
function AccountTypePanel({ T, mono, user, accountType, setAccountType }) {
  const [saving, setSaving] = useState(false)
  const options = [
    { key: 'individual',      label: 'Sole-trader / individual',  desc: 'You file Self Assessment as a person. MTD ITSA applies from Apr 2026.' },
    { key: 'limited_company', label: 'Limited company (SPV)',     desc: 'Property held in a company — you file Corporation Tax annually. MTD ITSA does NOT apply.' },
    { key: 'mixed',           label: 'Both',                       desc: 'Some properties personal, some in a company. We\'ll show everything.' },
  ]
  async function pick(key) {
    setSaving(true)
    try {
      await api.upsertUserProfile(user.id, user.email, { account_type: key })
      setAccountType(key)
      showAppToast('Saved')
    } catch (e) {
      showAppToast('Save failed: ' + e.message, 'error')
    }
    setSaving(false)
  }
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 24px', marginBottom: 16 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
        Tax setup
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 14, lineHeight: 1.5 }}>
        How do you hold your properties? Drives which features appear in your nav.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {options.map(o => {
          const active = accountType === o.key
          return (
            <button key={o.key} onClick={() => pick(o.key)} disabled={saving}
              style={{
                textAlign: 'left', padding: '12px 14px',
                background: active ? T.gold + '14' : T.bg,
                border: `1px solid ${active ? T.gold + '88' : T.border}`,
                borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? T.gold : T.text, marginBottom: 3 }}>
                {o.label} {active && <span style={{ fontFamily: mono, fontSize: 10, color: T.gold, marginLeft: 4 }}>selected</span>}
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.45 }}>{o.desc}</div>
            </button>
          )
        })}
      </div>
      {!accountType && (
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 10 }}>
          Not picked yet — by default we show everything.
        </div>
      )}
    </div>
  )
}

