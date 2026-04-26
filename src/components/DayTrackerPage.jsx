import { useState, useMemo } from 'react'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'

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

// Returns true if a property has at least one period that is past, not future,
// and not paid/void/refurb — i.e. an unpaid period the landlord should know about.
function isPropertyOverdue(prop) {
  const payments = prop.rent_payments || []
  const now = new Date()
  for (const p of payments) {
    if (p.status === 'missed' || p.status === 'late') {
      // A row marked missed/late is overdue regardless of date
      return true
    }
  }
  // Also flag rented properties with a past month that has no payment row
  // (i.e. fell through the cracks). Look back up to 3 months.
  if (prop.status === 'rented') {
    for (let backMonths = 1; backMonths <= 3; backMonths++) {
      const d = new Date(now.getFullYear(), now.getMonth() - backMonths, 1)
      const y = d.getFullYear(), m = d.getMonth() + 1
      const has = payments.some(p => p.year === y && p.month === m && p.status === 'paid')
      if (!has) return true
    }
  }
  return false
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

// Statuses the user can manually set via click. We deliberately omit 'future'
// (clicking a future day doesn't make sense) and 'refurb' (set elsewhere via
// the property's refurb tab so accidental clicks don't change refurb state).
const SETTABLE_STATUSES = ['paid', 'late', 'missed', 'void']

export default function DayTrackerPage({ companies, properties, setProperties, showToast, onBack }) {
  const { T } = useTheme()
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [hoverDay, setHoverDay] = useState(null) // { propId, day }

  // Click popover for marking paid/missed/void. Position: anchored to the cell.
  // Shape: { propId, propName, year, month, x, y, currentStatus } | null
  const [editPopover, setEditPopover] = useState(null)
  const [savingPayment, setSavingPayment] = useState(false)

  // Overdue filter: 'all' | 'overdue-only' | 'overdue-highlighted'
  const [overdueMode, setOverdueMode] = useState('all')

  // CSV export busy flag (for completeness — fast operation but UI feedback is good)
  const [exporting, setExporting] = useState(false)

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
  const baseActiveProps = properties.filter(p =>
    (p.rent_payments?.length > 0) || p.status === 'rented'
  )
  // Apply overdue filter mode. 'overdue-highlighted' keeps everything visible
  // and just adds a red border later. 'overdue-only' actually filters the list.
  const activeProps = overdueMode === 'overdue-only'
    ? baseActiveProps.filter(isPropertyOverdue)
    : baseActiveProps
  const overdueIds = useMemo(
    () => new Set(baseActiveProps.filter(isPropertyOverdue).map(p => p.id)),
    [baseActiveProps]
  )

  // ── Click-to-mark handler ─────────────────────────────────────────────
  // Opens the edit popover anchored to the clicked cell. Finds the current
  // status from the cell so the popover can show which option is active.
  function openEditPopover(e, prop, day) {
    const dateStr = toKey(year, month, day)
    const todayStr = toKey(now.getFullYear(), now.getMonth()+1, now.getDate())
    if (dateStr > todayStr) return  // don't allow editing future days
    const rect = e.currentTarget.getBoundingClientRect()
    const currentStatus = getDayStatus(day, year, month, prop.rent_payments || [])
    setEditPopover({
      propId: prop.id,
      propName: prop.name || prop.address,
      year, month, day,
      currentStatus,
      // Anchor the popover just below the clicked cell
      x: rect.left + rect.width / 2,
      y: rect.bottom + 6,
    })
  }

  // Apply a status to the WHOLE month for this property. Clicking a single
  // day still affects the whole month because the data model is monthly
  // (rent_payments has a unique constraint on property_id+year+month).
  async function applyStatus(newStatus) {
    if (!editPopover || savingPayment) return
    setSavingPayment(true)
    try {
      const prop = properties.find(p => p.id === editPopover.propId)
      const amount = prop?.rent_pcm || 0
      const periodStart = toKey(editPopover.year, editPopover.month, 1)
      const periodEnd   = toKey(editPopover.year, editPopover.month, daysInMonth(editPopover.year, editPopover.month))
      const saved = await api.upsertRentPayment(
        editPopover.propId, editPopover.year, editPopover.month,
        newStatus, amount, '', periodStart, periodEnd
      )
      // Update local state so the dot recolours immediately, no fetch required
      setProperties(prev => prev.map(p => {
        if (p.id !== editPopover.propId) return p
        const existing = p.rent_payments || []
        const idx = existing.findIndex(rp => rp.year === editPopover.year && rp.month === editPopover.month)
        const updated = idx >= 0
          ? existing.map((rp, i) => i === idx ? saved : rp)
          : [...existing, saved]
        return { ...p, rent_payments: updated }
      }))
      if (showToast) showToast(`${editPopover.propName}: ${monthLabel(editPopover.year, editPopover.month)} marked ${STATUS_LABEL[newStatus]}`)
      setEditPopover(null)
    } catch(e) {
      if (showToast) showToast(e.message || 'Update failed', 'error')
    }
    setSavingPayment(false)
  }

  function monthLabel(y, m) {
    return new Date(y, m - 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
  }

  // ── CSV export ────────────────────────────────────────────────────────
  // Builds a CSV of the last 12 months of rent payments across all visible
  // properties. Format: one row per (property × month), columns include
  // company, property, period, status, amount, notes.
  function exportCsv() {
    setExporting(true)
    try {
      const rows = []
      const header = ['Company','Property','Address','Year','Month','Period Start','Period End','Status','Amount','Notes']
      rows.push(header)

      // Build the last 12 months as (year, month) pairs (oldest first)
      const months = []
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        months.push({ y: d.getFullYear(), m: d.getMonth() + 1 })
      }

      for (const co of companies) {
        const props = baseActiveProps.filter(p => p.company_id === co.id)
        for (const p of props) {
          const payments = p.rent_payments || []
          for (const { y, m } of months) {
            const match = payments.find(rp => rp.year === y && rp.month === m)
            const status = match ? match.status : (p.status === 'rented' ? 'void' : '')
            const amount = match ? (match.amount || '') : ''
            const ps = match?.period_start || ''
            const pe = match?.period_end || ''
            const notes = match?.notes || ''
            rows.push([
              co.name || '', p.name || '', p.address || '',
              y, m, ps, pe, status, amount, notes,
            ])
          }
        }
      }

      // CSV escaping: wrap in quotes if contains comma/quote/newline; double up internal quotes
      const csv = rows.map(row => row.map(cell => {
        const s = cell == null ? '' : String(cell)
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"'
        }
        return s
      }).join(',')).join('\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rent-payments-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-last12.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      if (showToast) showToast('CSV downloaded')
    } catch(e) {
      if (showToast) showToast('Export failed: ' + (e.message || 'unknown'), 'error')
    }
    setExporting(false)
  }

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
            <p style={{ fontFamily:mono, color:T.muted, fontSize:12 }}>Daily rent coverage across all properties · click any day to update</p>
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

      {/* Toolbar: filter mode + export */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:18 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontFamily:mono, fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginRight:4 }}>View:</span>
          {[
            { v:'all',                 l:'All properties' },
            { v:'overdue-highlighted', l:'Highlight overdue' },
            { v:'overdue-only',        l:'Overdue only' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setOverdueMode(opt.v)}
              style={{
                fontFamily:mono, fontSize:11, padding:'5px 12px', borderRadius:20, cursor:'pointer',
                border: `1px solid ${overdueMode === opt.v ? T.gold : T.border}`,
                background: overdueMode === opt.v ? T.gold + '22' : 'transparent',
                color: overdueMode === opt.v ? T.gold : T.muted,
                fontWeight: overdueMode === opt.v ? 700 : 400,
              }}>
              {opt.l}
            </button>
          ))}
          {overdueMode !== 'all' && (
            <span style={{ fontFamily:mono, fontSize:10, color:T.muted, marginLeft:6 }}>
              {overdueIds.size} overdue
            </span>
          )}
        </div>
        <button onClick={exportCsv} disabled={exporting}
          style={{ fontFamily:mono, fontSize:11, padding:'6px 14px', borderRadius:7, border:`1px solid ${T.border}`, background:'transparent', color:T.text, cursor:exporting ? 'not-allowed' : 'pointer', opacity:exporting ? 0.6 : 1 }}>
          {exporting ? 'Exporting…' : '↓ Export CSV (last 12 months)'}
        </button>
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
                    const isOverdue = overdueIds.has(prop.id)
                    const highlightOverdue = overdueMode === 'overdue-highlighted' && isOverdue

                    return (
                      <tr key={prop.id} style={{
                        background: pi%2===0 ? T.card : T.surface,
                        outline: highlightOverdue ? `2px solid ${STATUS_COLOR.missed}88` : 'none',
                        outlineOffset: -1,
                      }}>
                        {/* Property name */}
                        <td style={{
                          fontFamily:mono, fontSize:11, color:T.text, padding:'6px 12px 6px 0',
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                          maxWidth:160, position:'sticky', left:0, background:pi%2===0?T.card:T.surface, zIndex:1
                        }}>
                          {highlightOverdue && <span style={{ color: STATUS_COLOR.missed, marginRight:4 }} title="Overdue">⚠</span>}
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
                                onClick={isFuture ? undefined : (e) => openEditPopover(e, prop, d)}
                                style={{
                                  width:16, height:16, borderRadius:3, margin:'0 auto',
                                  background: isFuture ? 'transparent' : col,
                                  border: isFuture ? `1px dashed ${T.border}` : 'none',
                                  transition:'transform 0.1s',
                                  transform: isHovered ? 'scale(1.4)' : 'scale(1)',
                                  cursor: isFuture ? 'default' : 'pointer',
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

      {/* Hover tooltip — only show when not editing */}
      {hoverDay && !editPopover && (
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

      {/* Edit popover — appears on click. Backdrop closes it. */}
      {editPopover && (
        <>
          {/* Click-outside backdrop */}
          <div onClick={() => !savingPayment && setEditPopover(null)}
            style={{ position:'fixed', inset:0, background:'transparent', zIndex:1500 }}/>
          <div
            style={{
              position:'fixed',
              left: clamp(editPopover.x - 110, 8, window.innerWidth - 228),
              top:  clamp(editPopover.y, 8, window.innerHeight - 180),
              width: 220, zIndex:1501,
              background:T.card, border:`1px solid ${T.border}`, borderRadius:10,
              padding:'12px 14px', boxShadow:'0 8px 32px rgba(0,0,0,0.18)',
            }}>
            <div style={{ fontFamily:mono, fontSize:11, fontWeight:700, color:T.text, marginBottom:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {editPopover.propName}
            </div>
            <div style={{ fontFamily:mono, fontSize:10, color:T.muted, marginBottom:10 }}>
              {monthLabel(editPopover.year, editPopover.month)} · currently <span style={{ color: STATUS_COLOR[editPopover.currentStatus], fontWeight:700 }}>{STATUS_LABEL[editPopover.currentStatus]}</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
              {SETTABLE_STATUSES.map(s => {
                const isCurrent = s === editPopover.currentStatus
                return (
                  <button key={s} onClick={() => applyStatus(s)} disabled={savingPayment || isCurrent}
                    style={{
                      fontFamily:mono, fontSize:11, fontWeight:700, padding:'7px 0', borderRadius:6,
                      border:`1px solid ${isCurrent ? STATUS_COLOR[s] : T.border}`,
                      background: isCurrent ? STATUS_COLOR[s] + '22' : 'transparent',
                      color: STATUS_COLOR[s],
                      cursor: (savingPayment || isCurrent) ? 'not-allowed' : 'pointer',
                      opacity: savingPayment ? 0.6 : 1,
                    }}>
                    {STATUS_LABEL[s]}
                  </button>
                )
              })}
            </div>
            <div style={{ fontFamily:mono, fontSize:9, color:T.muted, fontStyle:'italic', textAlign:'center', marginTop:4 }}>
              Affects the whole month
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Clamp a number into [min, max].
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}
