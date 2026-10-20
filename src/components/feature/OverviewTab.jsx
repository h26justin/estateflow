import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { MONO, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { NotesTimeline } from './NotesTimeline'
import { Icon } from '../../lib/icons'
import { SkeletonRows } from '../../lib/Skeleton'
import { EmptyState } from '../ui'

// ── OVERVIEW TAB ─────────────────────────────────────────────────────────────
export function OverviewTab({selected, fmt, calcMonthlyMortgage, calcGrossYield, isAdmin, user, showToast, canViewFinancial = true, canEditProperty = true}) {
  const { T } = useTheme()
  const [allNotes, setAllNotes] = useState([])
  const [loading, setLoading] = useState(true)

  const CATEGORIES = {
    general:     {label:'General',     color:T.goldText, icon:'file-text'},
    rent:        {label:'Rent',        color:T.green, icon:'pound'},
    refurb:      {label:'Refurb',      color:T.blue, icon:'hammer'},
    financials:  {label:'Financials',  color:T.purple, icon:'wallet'},
    compliance:  {label:'Compliance',  color:T.amber, icon:'clipboard-check'},
    tenancy:     {label:'Tenancy',     color:T.green, icon:'users'},
    maintenance: {label:'Maintenance', color:T.red, icon:'wrench'},
    expenses:    {label:'Expenses',    color:T.red, icon:'pie-chart'},
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
  const HIDDEN = <Icon name="lock" size={14} title="Hidden" style={{display:'inline-block',verticalAlign:'-2px'}}/>

  return (
    <div>
      {/* Quick stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
        {[
          {l:'Purchase Price',   v:canViewFinancial?fmt(selected.purchase_price):HIDDEN,     c:T.goldText},
          {l:'Estimated Value',  v:canViewFinancial?fmt(selected.est_value):HIDDEN,          c:T.goldText},
          {l:'Gross Yield',      v:canViewFinancial?(yield_>0?yield_.toFixed(1)+'%':'—'):HIDDEN, c:T.green},
          {l:'Monthly Rent',     v:canViewFinancial?fmt(selected.rent_pcm):HIDDEN,           c:T.green},
          {l:'Monthly Mortgage', v:canViewFinancial?(mortgage>0?fmt(mortgage):'—'):HIDDEN,   c:T.purple},
          {l:'Arrears',          v:fmt(selected.arrears||0),                                  c:(selected.arrears||0)>0?T.red:T.green},
        ].map((item,i)=>(
          <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
            <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:MONO,fontSize:17,fontWeight:700,color:item.c}}>{item.v}</div>
          </div>
        ))}
      </div>

      {/* Property notes */}
      {selected.notes&&<div className="card" style={{padding:'14px 18px',marginBottom:16,borderLeft:`3px solid ${T.gold}`}}>
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>Property Description</div>
        <div style={{fontFamily:MONO,fontSize:12,color:T.text,lineHeight:1.8}}>{selected.notes}</div>
      </div>}

      {/* All notes timeline */}
      <div className="card" style={{padding:'16px 20px'}}>
        <div style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:16}}>
          All Notes — {allNotes.length} total
        </div>

        {loading
          ? <SkeletonRows rows={3} height={36}/>
          : allNotes.length===0
            ? <EmptyState compact icon="file-text" title="No notes yet" body={isAdmin ? 'Add one below, or from any tab.' : 'Notes added on any tab appear here.'}/>
            : <div style={{display:'grid',gap:10}}>
                {allNotes.map(n=>{
                  const cat = CATEGORIES[n.category||'general'] || CATEGORIES.general
                  return (
                    <div key={n.id} style={{background:T.bg,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${cat.color}`}}>
                      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                          {/* Category tag */}
                          <span style={{fontFamily:MONO,fontSize:FS.xs,fontWeight:700,
                            color:cat.color,background:cat.color+'22',
                            padding:'2px 8px',borderRadius:20,display:'flex',alignItems:'center',gap:3}}>
                            <Icon name={cat.icon} size={12}/> {cat.label}
                          </span>
                          <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.goldText,background:T.gold+'22',padding:'2px 8px',borderRadius:20}}>{n.user_email}</span>
                          <span style={{fontFamily:MONO,fontSize:FS.xs,color:T.muted}}>{formatDate(n.created_at)}</span>
                        </div>
                        {isAdmin&&<button onClick={()=>deleteNote(n.id)}
                          style={{fontFamily:MONO,fontSize:FS.xs,background:T.red+'18',color:T.red,border:`1px solid ${T.red}44`,borderRadius:6,padding:'2px 8px',cursor:'pointer',flexShrink:0}}>
                          Delete
                        </button>}
                      </div>
                      <div style={{fontFamily:MONO,fontSize:12,color:T.text,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{n.note}</div>
                    </div>
                  )
                })}
              </div>
        }

        {/* Add a general note from overview. Composer only — the list
            above already shows every note (general ones included). */}
        {isAdmin&&<div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${T.border}`}}>
          <NotesTimeline propertyId={selected.id} isAdmin={isAdmin} user={user} showToast={showToast} category="general" composerOnly
            onSaved={n=>{ if (n) setAllNotes(prev=>[n,...prev]) }}/>
        </div>}
      </div>
    </div>
  )
}
