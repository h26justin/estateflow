import { useState, useMemo } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { monthDominantStatus } from '../../lib/rentStats'
import { evaluateProperty, groupByMonth, STATE_LABEL } from '../../lib/rentEngine'
import { activePlan } from '../../lib/paymentPlans'
import * as api from '../../lib/api'
import { MONO, CV } from '../../lib/styles'
import { STL_PAIR, STL_PENDING_PAIR, rentStatusPair, enginePair } from '../../lib/rentColors'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Rent arithmetic (month collapse, default year, monthly stats, STL ids) lives
// in lib/rentStats.js so it is unit-tested and shared; see the import above.

// ── DAY POPOVER ──────────────────────────────────────────────────────────────
function DayPopover({ payment, allPayments, stlIds, onClose, onDayTracker, monthEval, property, canEdit, onChanged, showToast }) {
  const { T, darkMode } = useTheme()
  const mono = MONO
  const [ovOpen, setOvOpen] = useState(false)
  const [ovState, setOvState] = useState('not_collectible')
  const [ovReason, setOvReason] = useState('')
  const [ovSaving, setOvSaving] = useState(false)
  const fmtGBP = n => n == null ? '—' : `£${Number(n).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`
  const fmtD = d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—'
  async function saveOverride() {
    if (!monthEval || ovSaving) return
    if (ovReason.trim().length < 3) { showToast?.('Give a reason for the override', 'error'); return }
    const target = monthEval.evals.find(e => e.state === monthEval.state) || monthEval.evals[0]
    setOvSaving(true)
    try {
      await api.createRentOverride({ rent_payment_id: target.id, property_id: property.id, state: ovState, reason: ovReason })
      showToast?.('Override recorded')
      onChanged?.(); onClose()
    } catch (e) { showToast?.(e.message || 'Override failed', 'error') }
    setOvSaving(false)
  }
  const year = payment.year, month = payment.month
  const days = new Date(year, month, 0).getDate()
  const firstDow = (new Date(year, month-1, 1).getDay() + 6) % 7

  // Paid STL segments render as the pseudo-status 'stl' (purple) so
  // short-term-let days read differently from long-term rent.
  const segStatus = p => stlIds?.has(p.id)
    ? (p.status === 'paid' ? 'stl' : p.status === 'pending' ? 'stl_pending' : p.status)
    : p.status

  function getDayStatus(day) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    if (dateStr > todayStr) return 'future'
    // Dated segments win over legacy whole-month rows (two passes).
    for (const p of allPayments) {
      if (p.period_start && p.period_end && dateStr >= p.period_start && dateStr <= p.period_end) return segStatus(p)
    }
    for (const p of allPayments) {
      if (!p.period_start && p.year === year && p.month === month) return segStatus(p)
    }
    return 'void'
  }

  // Day cells share the month grid's AA tint/text pairs (this map used to
  // restate the legacy raw hues with white labels).
  const pairFor = (status) => status === 'stl'
    ? (darkMode ? STL_PAIR.dark : STL_PAIR.light)
    : status === 'stl_pending'
      ? (darkMode ? STL_PENDING_PAIR.dark : STL_PENDING_PAIR.light)
      : rentStatusPair(status, darkMode)
  const monthName = new Date(year, month-1).toLocaleString('en-GB', {month:'long', year:'numeric'})
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  const statuses = Array.from({length:days},(_,i)=>getDayStatus(i+1))
  const paidDays = statuses.filter(s=>s==='paid'||s==='stl').length
  const voidDays = statuses.filter(s=>s==='void').length
  const missedDays = statuses.filter(s=>s==='overdue'||s==='missed').length

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={onClose}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:20,width:300,boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div style={{fontFamily:mono,fontSize:13,fontWeight:700,color:T.text}}>{monthName}</div>
          <button onClick={onClose} aria-label="Close day view" style={{background:'none',border:'none',fontSize:18,color:T.muted,cursor:'pointer',lineHeight:1,padding:'6px 8px',margin:'-6px -8px'}}>×</button>
        </div>
        {monthEval && (() => {
          const m = monthEval
          const pair = enginePair(m, darkMode)
          const ev = m.evals.find(e => e.state === m.state) || m.evals[0]
          const benefit = ev?.tenancy && ev.tenancy.payment_source && ev.tenancy.payment_source !== 'tenant'
          const allocs = m.evals.flatMap(e => e.allocations || [])
          const rows = m.state === 'legacy' ? [
            ['Legacy status', ev?.legacyStatus || '—'],
            ['Amount recorded', fmtGBP(ev?.legacyAmount)],
          ] : m.state === 'stl' ? [
            ['Booked income', fmtGBP(m.received)],
          ] : [
            ['Rent expected', fmtGBP(m.expected)],
            ...(benefit ? [['Tenant share', fmtGBP(m.evals.reduce((a,e)=>a+(e.tenantShare||0),0))],['Benefit share', fmtGBP(m.evals.reduce((a,e)=>a+(e.benefitShare||0),0))]] : []),
            ['Received', m.needsBackfill ? 'Paid, amount not entered' : fmtGBP(m.received)],
            ['Outstanding', fmtGBP(m.outstanding)],
            ...(m.excess > 0 ? [['Overpaid', fmtGBP(m.excess)]] : []),
            ...(ev?.dueDate ? [['Due', `${fmtD(ev.dueDate)} · window to ${fmtD(ev.windowEnd)}${ev.benefitDue ? ` · benefit ${fmtD(ev.benefitDue)}` : ''}`]] : []),
          ]
          return (
            <div style={{marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${T.border}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                <span style={{fontFamily:mono,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:pair?.bg,color:pair?.text,border:`1px solid ${pair?.text}44`}}>{STATE_LABEL[m.state] || m.state}</span>
                {m.needsBackfill && <span style={{fontFamily:mono,fontSize:9,padding:'2px 6px',borderRadius:20,background:T.amber+'22',color:T.amber}}>Needs backfill</span>}
                {m.state === 'legacy' && <span style={{fontFamily:mono,fontSize:9,padding:'2px 6px',borderRadius:20,background:T.border,color:T.muted}}>Legacy data</span>}
                {m.override && <span style={{fontFamily:mono,fontSize:9,padding:'2px 6px',borderRadius:20,background:T.blue+'22',color:T.blue}}>Override</span>}
                {ev?.fallback && <span title="No tenancy record yet: using the property's rent and due day" style={{fontFamily:mono,fontSize:9,color:T.muted}}>no tenancy record</span>}
              </div>
              <div style={{display:'grid',gap:4}}>
                {rows.map(([l,v])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',gap:10,fontFamily:mono,fontSize:11}}>
                    <span style={{color:T.muted}}>{l}</span><span style={{color:T.text,fontWeight:600,textAlign:'right'}}>{v}</span>
                  </div>
                ))}
              </div>
              {allocs.length > 0 && (
                <div style={{marginTop:8}}>
                  <div style={{fontFamily:mono,fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Receipts</div>
                  {allocs.map(a=>(
                    <div key={a.id} style={{display:'flex',justifyContent:'space-between',fontFamily:mono,fontSize:10,color:T.text}}>
                      <span>{fmtD(a.receipt?.received_date)} · {(a.receipt?.payer||'tenant').replace('_',' ')}{a.receipt?.kind && a.receipt.kind!=='receipt' ? ` · ${a.receipt.kind}` : ''}</span>
                      <span style={{color:Number(a.amount)<0?T.red:T.text}}>{fmtGBP(a.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {ev?.reasons?.length > 0 && <div style={{fontFamily:mono,fontSize:9,color:T.faint,marginTop:6}}>{ev.reasons.join(' · ')}</div>}
              {m.override && <div style={{fontFamily:mono,fontSize:9,color:T.muted,marginTop:4}}>Override by {m.override.created_by ? 'a user' : 'system'} on {new Date(m.override.created_at).toLocaleDateString('en-GB')}: {m.override.reason}</div>}
              {canEdit && m.state !== 'legacy' && m.state !== 'stl' && m.state !== 'future' && (
                ovOpen ? (
                  <div style={{marginTop:8,display:'grid',gap:6}}>
                    <select value={ovState} onChange={e=>setOvState(e.target.value)} style={{fontFamily:mono,fontSize:11}}>
                      {['paid','due','part_paid','missed','not_collectible','pending_review'].map(k=><option key={k} value={k}>{STATE_LABEL[k]}{k==='pending_review'?' (set aside for review, not a write-off)':''}</option>)}
                      {m.override && <option value="clear">Remove override</option>}
                    </select>
                    <textarea value={ovReason} onChange={e=>setOvReason(e.target.value)} rows={2} placeholder="Reason (required, recorded with your name and the time)" style={{fontFamily:mono,fontSize:11,resize:'vertical'}}/>
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-gold" style={{fontSize:11}} onClick={saveOverride} disabled={ovSaving}>{ovSaving?'Saving…':'Save override'}</button>
                      <button className="btn" style={{fontSize:11}} onClick={()=>setOvOpen(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn" style={{fontSize:10,marginTop:8}} onClick={()=>setOvOpen(true)}>Override status…</button>
                )
              )}
            </div>
          )
        })()}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:4}}>
          {['M','T','W','T','F','S','S'].map((d,i)=>(
            <div key={i} style={{fontFamily:mono,fontSize:9,color:T.muted,textAlign:'center'}}>{d}</div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:14}}>
          {cells.map((d,i)=>{
            if (!d) return <div key={`b${i}`}/>
            const status = statuses[d-1]
            const isFuture = status==='future'
            const pair = isFuture ? null : pairFor(status)
            return (
              <div key={d} title={`${d}: ${status}`} style={{
                aspectRatio:'1',borderRadius:3,
                background:isFuture?'transparent':pair.bg,
                border:isFuture?`1px dashed ${T.border}`:`1px solid ${pair.text}44`,
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>
                <span style={{fontFamily:mono,fontSize:8,color:isFuture?T.muted:pair.text,fontWeight:700}}>{d}</span>
              </div>
            )
          })}
        </div>
        <div style={{display:'flex',gap:14,marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${T.border}`,flexWrap:'wrap'}}>
          {[[paidDays,rentStatusPair('paid',darkMode).text,'paid'],[voidDays,rentStatusPair('void',darkMode).text,'void'],[missedDays,rentStatusPair('missed',darkMode).text,'missed']].map(([v,c,l])=>(
            <div key={l} style={{fontFamily:mono,fontSize:10}}>
              <span style={{color:c,fontWeight:700}}>{v}</span>
              <span style={{color:T.muted}}> {l}</span>
            </div>
          ))}
          {payment.period_start&&<div style={{fontFamily:mono,fontSize:9,color:T.muted,marginLeft:'auto'}}>{payment.period_start} → {payment.period_end}</div>}
        </div>
        {onDayTracker
          ? <button onClick={()=>{onClose();onDayTracker()}}
              style={{width:'100%',fontFamily:mono,fontSize:11,fontWeight:700,padding:'9px 0',borderRadius:8,
                border:'none',background:T.gold,color:CV.onGold,cursor:'pointer'}}>
              View full day tracker →
            </button>
          : <div style={{fontFamily:mono,fontSize:10,color:T.muted,textAlign:'center',padding:'6px 0'}}>Read-only: you cannot edit rent for this company</div>}
      </div>
    </div>
  )
}

export const RentDots = ({payments, onUpdate, filterYear, onDayTracker, stlIds, property, canEdit, onChanged, showToast}) => {
  const { darkMode } = useTheme()
  const [popover, setPopover] = useState(null)
  // Stage 3: when the property is supplied the tiles come from the rent
  // engine (tenancy dates, due windows, receipts, overrides). The legacy
  // month-collapse path below remains for callers that only have payments.
  const engineMonths = useMemo(() => property ? groupByMonth(evaluateProperty(property)) : null, [property])
  if (!payments?.length) return null
  const scoped = filterYear ? payments.filter(m=>m.year===filterYear) : payments
  // Collapse multiple segments per month into one representative dot.
  const byMonth = new Map()
  for (const p of scoped) {
    const key = `${p.year}-${p.month}`
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(p)
  }
  const evalByKey = new Map((engineMonths || []).map(m => [`${m.year}-${m.month}`, m]))
  const filtered = [...byMonth.values()]
    .map(segs => ({ ...segs[0], status: monthDominantStatus(segs), isStl: !!stlIds && segs.some(s => stlIds.has(s.id)), eng: evalByKey.get(`${segs[0].year}-${segs[0].month}`) || null }))
    .sort((a,b)=>a.year!==b.year?a.year-b.year:a.month-b.month)
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  return <>
    <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:8}}>
      {filtered.map(m=>{
        const isFuture = m.year > currentYear || (m.year === currentYear && m.month > currentMonth)
        const isCurrent = m.year === currentYear && m.month === currentMonth
        const isStlPaid = m.isStl && m.status === 'paid'
        const isStlPending = m.isStl && m.status === 'pending'
        // Redesign: full 3-letter month name in the cell, STATUS TINT as the
        // fill with the AA text colour for the label (the previous raw-hue
        // fill + white label read at ~1.8:1 on paid-green), gold outline for
        // the current month, hatched fill for future months.
        const eng = m.eng && m.eng.state !== 'future' ? m.eng : null
        const pair = eng ? enginePair(eng, darkMode) : (isStlPaid ? (darkMode ? STL_PAIR.dark : STL_PAIR.light) : isStlPending ? (darkMode ? STL_PENDING_PAIR.dark : STL_PENDING_PAIR.light) : rentStatusPair(m.status, darkMode))
        const name = MONTH_NAMES[(m.month||1)-1]
        const statusLabel = isFuture ? 'future' : eng ? `${STATE_LABEL[eng.state]}${eng.needsBackfill ? ', needs backfill' : ''}${eng.override ? ', overridden' : ''}${eng.state!=='legacy' && activePlan(property?.payment_plans||[], eng.evals?.[0]?.periodEnd) ? ', payment plan' : ''}` : (isStlPaid ? 'short-term let, paid' : isStlPending ? 'short-term let, booked, stay not yet completed' : (m.status || 'void'))
        const isGrey = eng && eng.state === 'not_collectible'
        const isLegacy = eng && eng.state === 'legacy'
        const boxStyle = isFuture
          ? { background:'repeating-linear-gradient(135deg, rgba(128,128,128,0.10) 0 5px, transparent 5px 10px)', border:'1px dashed rgba(128,128,128,0.40)', cursor:'default' }
          : isCurrent
            ? { background:pair.bg, border:`2px solid #B8902F`, cursor:'pointer' }
            : { background:pair.bg, border:`1px solid ${pair.text}55`, cursor:'pointer' }
        if (isGrey) boxStyle.background = `repeating-linear-gradient(135deg, ${pair.text}22 0 4px, ${pair.bg} 4px 8px)`
        if (isLegacy) boxStyle.borderBottom = `2px dotted ${pair.text}88`
        const letterColor = isFuture ? 'rgba(128,128,128,0.6)' : pair.text
        return (
          // A real <button>: these cells are the primary interaction on the
          // Rent Tracker and were mouse-only divs whose title tooltip never
          // appeared on touch.
          <button key={m.id} type="button"
            aria-label={`${m.month_label || `${name} ${m.year}`}: ${statusLabel}${isFuture ? '' : ' — open day view'}`}
            title={isFuture ? `${m.month_label}: future` : `${m.month_label}: ${isStlPaid ? 'STL stayed (paid)' : isStlPending ? 'STL booked, not yet stayed' : m.status} — click for day view`}
            disabled={isFuture}
            onClick={!isFuture ? (e)=>{e.stopPropagation();setPopover(m)} : undefined}
            style={{width:44,height:30,borderRadius:7,transition:'transform 0.15s, box-shadow 0.15s',padding:0,position:'relative',
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,...boxStyle}}
            onMouseEnter={e=>{if(!isFuture){e.currentTarget.style.transform='scale(1.12)';e.currentTarget.style.boxShadow=`0 2px 8px ${pair.text}55`}}}
            onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}
          >
            <span style={{fontFamily:MONO,fontSize:10,fontWeight:700,color:letterColor,lineHeight:1,userSelect:'none',letterSpacing:'0.02em'}}>{name}</span>
            {eng?.needsBackfill && <span aria-hidden="true" style={{position:'absolute',top:2,right:3,width:6,height:6,borderRadius:'50%',background:CV.amber}}/>}
            {eng?.override && <span aria-hidden="true" style={{position:'absolute',bottom:2,right:3,width:6,height:6,borderRadius:'50%',border:`1.5px solid ${pair.text}`}}/>}
            {eng && eng.state!=='legacy' && activePlan(property?.payment_plans||[], eng.evals?.[0]?.periodEnd) && <span aria-hidden="true" title="Historic arrears on a payment plan" style={{position:'absolute',top:2,left:3,width:6,height:6,borderRadius:'50%',background:CV.blue}}/>}
          </button>
        )
      })}
    </div>
    {popover&&<DayPopover payment={popover} allPayments={payments} stlIds={stlIds} onClose={()=>setPopover(null)} onDayTracker={onDayTracker} monthEval={popover.eng||null} property={property} canEdit={canEdit} onChanged={onChanged} showToast={showToast}/>}
  </>
}
