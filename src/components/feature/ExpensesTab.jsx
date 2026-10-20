import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'
import { useLoadGuard } from '../../lib/useLoadGuard'
import MoneyInput from '../../lib/MoneyInput'
import { formatDate } from './helpers'
import { NotesTimeline } from './NotesTimeline'
import { SkeletonRows } from '../../lib/Skeleton'
import { Button, EmptyState } from '../ui'

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

  const beginLoad = useLoadGuard()

  const loadExpenses = useCallback(async () => {
    const isCurrent = beginLoad()
    setLoading(true)
    try {
      const rows = await api.fetchExpenses(propertyId)
      if (!isCurrent()) return
      setExpenses(rows)
    } catch(e) {
      if (!isCurrent()) return
      showToast(e.message || 'Failed to load expenses', 'error')
    }
    setLoading(false)
  }, [beginLoad, propertyId, showToast])
  useEffect(()=>{ loadExpenses() },[loadExpenses])

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
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:MONO,fontSize:17,fontWeight:700,color:item.c}}>{item.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontFamily:MONO,fontSize:11,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>Expense Log</div>
        {canEdit && <Button variant="primary" size="sm" onClick={()=>setShowForm(v=>!v)} icon="plus">Add expense</Button>}
      </div>

      {showForm&&<div className="card" style={{padding:'16px 18px',marginBottom:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Category</label><select aria-label="Category" value={form.category} onChange={e=>s('category',e.target.value)}>{CATEGORIES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></div>
          <div><label>Description *</label><input aria-label="Description" value={form.description} onChange={e=>s('description',e.target.value)} placeholder="e.g. Annual buildings insurance"/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><label>Amount *</label><MoneyInput aria-label="Amount" prefix="£" value={form.amount} onChange={v=>s('amount',v)}/></div>
          <div><label>Date *</label><input aria-label="Date" type="date" value={form.date} onChange={e=>s('date',e.target.value)}/></div>
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
        <div style={{marginBottom:12}}><label>Notes</label><input aria-label="Notes" value={form.notes} onChange={e=>s('notes',e.target.value)}/></div>
        <div style={{display:'flex',gap:8}}>
          <Button variant="primary" size="sm" onClick={handleSave}>Save expense</Button>
          <Button variant="secondary" size="sm" onClick={()=>setShowForm(false)}>Cancel</Button>
        </div>
      </div>}

      {loading ? <SkeletonRows rows={3} height={36}/>
       : expenses.length===0 ? <EmptyState compact icon="receipt" title="No expenses logged yet"/>
       : <div style={{display:'grid',gap:8}}>
          {expenses.map(exp=>{
            const cat = CATEGORIES.find(c=>c.v===exp.category)
            return (
              <div key={exp.id} className="card" style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:150}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{exp.description}</div>
                  <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>
                    {cat?.l} · {formatDate(exp.date)}
                    {exp.recurring&&<span style={{marginLeft:6,color:T.blue}}>↻ {exp.recurring_freq}</span>}
                  </div>
                </div>
                <div style={{fontFamily:MONO,fontSize:15,fontWeight:700,color:T.red}}>{fmt(exp.amount)}</div>
                {canEdit && <Button variant="secondary" destructive size="sm" onClick={()=>handleDelete(exp.id)}>Remove</Button>}
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
