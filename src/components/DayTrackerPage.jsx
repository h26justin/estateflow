import { useState, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'

const mono = "'DM Mono',monospace"

// Convert a YYYY-MM-DD string or Date to a plain date key YYYY-MM-DD
function toKey(y, m, d) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function getDayStatus(day, year, month, payments) {
  const dateStr = toKey(year, month, day)
  const now = new Date()
  const today = toKey(now.getFullYear(), now.getMonth()+1, now.getDate())
  if (dateStr > today) return 'future'

  // Check payments that have period dates
  for (const p of payments) {
    if (p.period_start && p.period_end) {
      if (dateStr >= p.period_start && dateStr <= p.period_end) {
        return p.status
      }
    } else if (p.year === year && p.month === month) {
      // No day-level data — treat whole month as that status
      return p.status
    }
  }
  return 'void'
}

const STATUS_COLOR = {
  paid:    '#2ECC8A',
  missed:  '#E05555',
  late:    '#E0943A',
  refurb:  '#4B8FE0',
  void:    '#888EA8',
  future:  'transparent',
}

const STATUS_LABEL = { paid:'Paid', missed:'Missed', late:'Late', refurb:'Refurb', void:'Void', future:'Future' }

export default function DayTrackerPage({ companies, properties, onBack }) {
  const { T } = useTheme()
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [hoverDay, setHoverDay] = useState(null) // { propId, day }

  const monthName = new Date(year, month-1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const days = daysInMonth(year, month)
  const dayNums = Array.from({ length: days }, (_, i) => i + 1)

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Day-of-week headers (Mon-Sun)
  const DOW = ['M','T','W','T','F','S','S']
  const firstDow = (new Date(year, month-1, 1).getDay() + 6) % 7 // 0=Mon

  // Filter to properties that have any payments or are rented
  const activeProps = properties.filter(p =>
    (p.rent_payments?.length > 0) || p.status === 'rented'
  )

  return (
    <div className="fade" style={{ paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12, marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onBack}
            style={{ fontFamily:mono, fontSize:11, padding:'6px 12px', borderRadius:7, border:`1px solid ${T.border}`, background:'transparent', color:T.muted, cursor:'pointer' }}>
            ← Back
          </button>
          <div>
            <h1 style={{ fontSize:26, fontWeight:700, letterSpacing:'-0.03em', marginBottom:4 }}>Day Tracker</h1>
            <p style={{ fontFamily:mono, color:T.muted, fontSize:12 }}>Daily rent coverage across all properties</p>
          </div>
        </div>

        {/* Month navigation */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={prevMonth}
            style={{ fontFamily:mono, fontSize:14, padding:'6px 12px', borderRadius:7, border:`1px solid ${T.border}`, background:'transparent', color:T.text, cursor:'pointer' }}>
            ←
          </button>
          <div style={{ fontFamily:mono, fontSize:13, fontWeight:700, color:T.text, minWidth:160, textAlign:'center' }}>{monthName}</div>
          <button onClick={nextMonth}
            style={{ fontFamily:mono, fontSize:14, padding:'6px 12px', borderRadius:7, border:`1px solid ${T.border}`, background:'transparent', color:T.text, cursor:'pointer' }}>
            →
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:16, marginBottom:20, flexWrap:'wrap' }}>
        {Object.entries(STATUS_LABEL).filter(([k])=>k!=='future').map(([k,l]) => (
          <span key={k} style={{ display:'flex', alignItems:'center', gap:5, fontFamily:mono, fontSize:11, color:T.muted }}>
            <span style={{ width:10, height:10, borderRadius:2, background:STATUS_COLOR[k], display:'inline-block', border:k==='void'?`1px solid ${T.border}`:'none' }}/>
            {l}
          </span>
        ))}
      </div>

      {/* Companies → Properties → Day rows */}
      {companies.map(company => {
        const compProps = activeProps.filter(p => p.company_id === company.id)
        if (!compProps.length) return null

        return (
          <div key={company.id} style={{ marginBottom:24 }}>
            {/* Company header */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:`2px solid ${company.color||T.gold}` }}>
              <div style={{ width:3, height:16, background:company.color||T.gold, borderRadius:2 }}/>
              <span style={{ fontSize:14, fontWeight:700, color:T.text }}>{company.name}</span>
              <span style={{ fontFamily:mono, fontSize:10, color:T.muted }}>{compProps.length} properties</span>
            </div>

            {/* Day grid */}
            <div style={{ overflowX:'auto' }}>
              <table style={{ borderCollapse:'collapse', width:'100%', minWidth: 600 }}>
                <thead>
                  <tr>
                    {/* Property name column */}
                    <th style={{ fontFamily:mono, fontSize:10, color:T.muted, textAlign:'left', padding:'0 12px 8px 0', whiteSpace:'nowrap', minWidth:160, position:'sticky', left:0, background:T.bg, zIndex:2 }}>
                      Property
                    </th>
                    {/* Day number columns */}
                    {dayNums.map(d => {
                      const dow = (firstDow + d - 1) % 7
                      const isWeekend = dow >= 5
                      const isToday = toKey(year,month,d) === toKey(now.getFullYear(),now.getMonth()+1,now.getDate())
                      return (
                        <th key={d} style={{
                          fontFamily:mono, fontSize:8, color:isToday?T.gold:isWeekend?T.muted:T.muted,
                          textAlign:'center', padding:'0 1px 4px', fontWeight:isToday?700:400,
                          minWidth:20
                        }}>
                          {d}
                        </th>
                      )
                    })}
                    {/* Stats columns */}
                    <th style={{ fontFamily:mono, fontSize:9, color:T.muted, padding:'0 0 4px 8px', whiteSpace:'nowrap' }}>Paid</th>
                    <th style={{ fontFamily:mono, fontSize:9, color:T.muted, padding:'0 0 4px 6px', whiteSpace:'nowrap' }}>Void</th>
                  </tr>
                </thead>
                <tbody>
                  {compProps.map((prop, pi) => {
                    const payments = prop.rent_payments || []
                    const dayStatuses = dayNums.map(d => getDayStatus(d, year, month, payments))
                    const paidDays = dayStatuses.filter(s => s === 'paid').length
                    const voidDays = dayStatuses.filter(s => s === 'void').length

                    return (
                      <tr key={prop.id} style={{ background: pi%2===0 ? T.card : T.surface }}>
                        {/* Property name */}
                        <td style={{
                          fontFamily:mono, fontSize:11, color:T.text, padding:'6px 12px 6px 0',
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                          maxWidth:160, position:'sticky', left:0, background:pi%2===0?T.card:T.surface, zIndex:1
                        }}>
                          {prop.name || prop.address}
                        </td>
                        {/* Day squares */}
                        {dayNums.map((d, di) => {
                          const status = dayStatuses[di]
                          const col = STATUS_COLOR[status]
                          const isFuture = status === 'future'
                          const isHovered = hoverDay?.propId===prop.id && hoverDay?.day===d

                          return (
                            <td key={d} style={{ padding:'4px 1px', textAlign:'center', position:'relative' }}>
                              <div
                                onMouseEnter={() => setHoverDay({ propId:prop.id, day:d, status, propName: prop.name||prop.address })}
                                onMouseLeave={() => setHoverDay(null)}
                                style={{
                                  width:16, height:16, borderRadius:3, margin:'0 auto',
                                  background: isFuture ? 'transparent' : col,
                                  border: isFuture ? `1px dashed ${T.border}` : 'none',
                                  transition:'transform 0.1s',
                                  transform: isHovered ? 'scale(1.4)' : 'scale(1)',
                                  cursor:'default',
                                }}
                              />
                            </td>
                          )
                        })}
                        {/* Stats */}
                        <td style={{ fontFamily:mono, fontSize:10, fontWeight:700, color:paidDays>0?'#2ECC8A':T.muted, padding:'4px 0 4px 8px', textAlign:'center' }}>
                          {paidDays}
                        </td>
                        <td style={{ fontFamily:mono, fontSize:10, fontWeight:700, color:voidDays>0?'#888EA8':T.muted, padding:'4px 0 4px 6px', textAlign:'center' }}>
                          {voidDays}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Hover tooltip */}
      {hoverDay && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:T.card, border:`1px solid ${T.border}`, borderRadius:10,
          padding:'8px 16px', fontFamily:mono, fontSize:11, color:T.text,
          pointerEvents:'none', zIndex:1000, whiteSpace:'nowrap',
          boxShadow:`0 4px 16px rgba(0,0,0,0.12)`
        }}>
          <span style={{ color:T.muted }}>{hoverDay.propName}</span>
          {' · '}
          <span style={{ color:STATUS_COLOR[hoverDay.status], fontWeight:700 }}>
            {year}/{String(month).padStart(2,'0')}/{String(hoverDay.day).padStart(2,'0')} — {STATUS_LABEL[hoverDay.status]}
          </span>
        </div>
      )}
    </div>
  )
}
