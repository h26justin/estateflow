import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { useIsMobile } from '../../lib/useWindowSize'
import { defaultRentYear, getMonthlyRentStats, stlPaymentIds } from '../../lib/rentStats'
import { evaluateProperty, collectionStats, arrearsSummary, GO_LIVE } from '../../lib/rentEngine'
import * as api from '../../lib/api'
import { MONO, CV } from '../../lib/styles'
import { NotesTimeline, ReceiptsPanel, ArrearsPanel } from './lazyViews'
import { RentDots } from './RentDots'
import { RentLegend } from './RentTrackerOverview'

// ─── RENT TAB ────────────────────────────────────────────────────────────────
export function RentTab({selected, fmt, setEditingPayment, isAdmin, user, showToast, setProperties, onDayTracker, canEdit = true}) {
  const { T } = useTheme()
  const isMobile = useIsMobile(769)
  const payments = selected.rent_payments || []
  const years = [...new Set(payments.map(p=>p.year))].sort()
  const [filterYear, setFilterYear] = useState(() => defaultRentYear(payments))

  // Stats for selected year — month-collapsed via the shared helper so
  // multi-segment months (changeovers, partial payments) count once and
  // income reflects the amounts actually logged.
  const { paid, missed, late, refurb, voidM, income: totalIncome } = getMonthlyRentStats(payments, filterYear, selected.rent_pcm)
  const lateIncome = late * (selected.rent_pcm||0)

  return (
    <div>
      {/* Key stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
        {[
          {l:'Monthly Rent', v:fmt(selected.rent_pcm), accent:T.green},
          {l:'Rent Due',     v:selected.rent_due_day||'-'},
          {l:'Tenancy End',  v:selected.tenancy_end||'-'},
          {l:'Arrears',      v:fmt(selected.arrears||0), accent:selected.arrears>0?T.red:T.green},
        ].map((item,i)=>(
          <div key={i} style={{background:T.bg,borderRadius:10,padding:'14px 16px'}}>
            <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>{item.l}</div>
            <div style={{fontFamily:MONO,fontSize:18,fontWeight:700,color:item.accent||T.text}}>{item.v}</div>
          </div>
        ))}
      </div>

      {/* Payment history with year filter */}
      {payments.length>0&&<div className="card" style={{padding:'16px 20px',marginBottom:14}}>
        {/* Year filter buttons */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em'}}>
            Payment History <span style={{fontSize:9}}>{canEdit ? '(click dot to update)' : '(read-only)'}</span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setFilterYear(null)}
              style={{fontFamily:MONO,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                border:`1px solid ${filterYear===null?T.gold:T.border}`,
                background:filterYear===null?T.gold:'transparent',
                color:filterYear===null?CV.onGold:T.muted}}>All</button>
            {years.map(yr=>(
              <button key={yr} onClick={()=>setFilterYear(yr)}
                style={{fontFamily:MONO,fontSize:10,padding:'3px 10px',borderRadius:20,cursor:'pointer',
                  border:`1px solid ${filterYear===yr?T.gold:T.border}`,
                  background:filterYear===yr?T.gold:'transparent',
                  color:filterYear===yr?CV.onGold:T.muted}}>{yr}</button>
            ))}
          </div>
        </div>

        {/* Dots */}
        {/* Without edit_rent the dots stay readable but the Day view (the
            live rent editor) is not offered, and the legacy payment modal
            is never opened. */}
        <RentDots payments={payments} stlIds={stlPaymentIds(selected)}
          onUpdate={canEdit ? m=>setEditingPayment({payment:m,propId:selected.id}) : ()=>showToast('You have read-only access to rent for this company','info')}
          filterYear={filterYear} onDayTracker={canEdit ? onDayTracker : undefined}
          property={selected} canEdit={canEdit} showToast={showToast}
          onChanged={()=>api.fetchRentOverrides(selected.id).then(o=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,rent_overrides:o}:p))).catch(()=>{})}/>

        {/* Legend */}
        <div style={{marginTop:10}}><RentLegend small collapsible={isMobile}/></div>

        {/* Year summary */}
        <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
          <div style={{fontFamily:MONO,fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>
            {filterYear ? `${filterYear} Summary` : 'All Time Summary'}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                        {(() => {
              const legacyYear = !!filterYear && filterYear < Number(GO_LIVE.slice(0,4))
              if (legacyYear || selected.status === 'short_term_let') return [
                {l:'Months Paid',    v:paid,    c:T.green,  sub:fmt(totalIncome)},
                {l:'Months Missed',  v:missed,  c:T.red,    sub:fmt(missed*(selected.rent_pcm||0))},
                {l:'Months Late', v:late, c:T.amber,  sub:fmt(lateIncome)},
                {l:'Months Refurb',  v:refurb,  c:T.blue,   sub:''},
                {l:'Months Void',    v:voidM,   c:T.faint,  sub:''},
                {l:'Total Received', v:fmt(totalIncome), c:T.gold, sub:legacyYear ? 'legacy data' : `${paid} months`, big:true},
              ]
              const evals = evaluateProperty(selected).filter(e => !filterYear || e.year === filterYear)
              const cs = collectionStats(evals)
              const ar = arrearsSummary(selected)
              const outSub = `${fmt(cs.overdue)} overdue · ${fmt(cs.inWindow + cs.dueToday)} in window${cs.pendingReview > 0 ? ` · ${fmt(cs.pendingReview)} pending review` : ''}${cs.notYetDue > 0 ? ` · ${fmt(cs.notYetDue)} not yet due` : ''}`
              return [
                {l:'Collection rate', v: cs.rate == null ? '—' : `${cs.rate}%`, c: cs.rate == null ? T.muted : cs.rate>=95?T.green:cs.rate>=85?T.amber:T.red, sub:`${cs.periods} periods due`},
                {l:'Collectible due', v:fmt(cs.due), c:T.text, sub:`${cs.counts.not_collectible} not collectible`},
                {l:'Received', v:fmt(cs.received), c:T.green, sub: cs.excess>0 ? `+${fmt(cs.excess)} overpaid` : `${cs.counts.paid} paid`},
                {l:'Outstanding', v:fmt(cs.outstanding), c: cs.outstanding>0?T.red:T.green, sub:outSub},
                {l:'Historic arrears', v:fmt(ar.balance), c: ar.balance>0?T.amber:T.muted, sub: ar.overlap>0 ? `${fmt(ar.overlap)} dated after 1 Jan 2026, already in the rent periods` : ar.unmatched>0 ? `${fmt(ar.unmatched)} paid with no opening balance recorded` : ar.paid>0 ? `${fmt(ar.paid)} paid off` : (ar.opening ? 'opening balance' : 'none recorded')},
                {l:'Needs backfill', v:cs.counts.needsBackfill, c: cs.counts.needsBackfill>0?T.amber:T.muted, sub: cs.needsInfo>0 ? `${fmt(cs.needsInfo)} more unverified` : cs.counts.legacy ? `${cs.counts.legacy} legacy months` : 'paid months missing an amount'},
              ]
            })().map((item,i)=>(
              <div key={i} style={{background:T.bg,borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontFamily:MONO,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>{item.l}</div>
                <div style={{fontFamily:MONO,fontSize:item.big?15:17,fontWeight:700,color:item.c}}>{item.v}</div>
                {item.sub&&<div style={{fontFamily:MONO,fontSize:9,color:T.faint,marginTop:2}}>{item.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>}

      {/* Arrears in three figures + payment plan (Stage 5) */}
      <ArrearsPanel property={selected} showToast={showToast} canEdit={canEdit} onChanged={pl=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,payment_plans:pl}:p))}/>

      {/* Receipts: dated cash events with allocations (Stage 2) */}
      <ReceiptsPanel property={selected} tenancies={selected.tenancies} showToast={showToast} canEdit={canEdit} onChanged={r=>setProperties(prev=>prev.map(p=>p.id===selected.id?{...p,rent_receipts:r}:p))}/>

      {/* Notes Timeline */}
      <NotesTimeline propertyId={selected.id} isAdmin={isAdmin} user={user} showToast={showToast} setProperties={setProperties} category="rent"/>
    </div>
  )
}
