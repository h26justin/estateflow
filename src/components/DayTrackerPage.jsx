import { useState, useMemo } from 'react'
import { MONO } from '../lib/styles'
import { useTheme } from '../lib/ThemeContext'
import * as api from '../lib/api'
import { isPropertyEarningRent } from '../lib/propertyStatus'

const mono = MONO

// Convert a YYYY-MM-DD string or Date to a plain date key YYYY-MM-DD
function toKey(y, m, d) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Does a payment row's dated period cover this day? (false for legacy rows
// that have no period_start/period_end.)
function segmentCoversDay(p, dateStr) {
  return !!(p.period_start && p.period_end && dateStr >= p.period_start && dateStr <= p.period_end)
}

// Find the payment row that applies to a given day, or null. Dated segments
// win over legacy whole-month rows (two passes) so a single day can never be
// claimed by an old full-month row when a precise range also exists.
function getSegmentForDay(day, year, month, payments) {
  const dateStr = toKey(year, month, day)
  for (const p of payments) if (segmentCoversDay(p, dateStr)) return p
  for (const p of payments) if (!p.period_start && p.year === year && p.month === month) return p
  return null
}

// Paid segments created by a Lodgify booking render as the pseudo-status
// 'stl' (purple) so short-term-let income reads differently from long-term
// rent. stlIds is the Set of rent_payment ids linked from stl_bookings.
function segDisplayStatus(seg, stlIds) {
  return (seg.status === 'paid' && stlIds?.has(seg.id)) ? 'stl' : seg.status
}

function getDayStatus(day, year, month, payments, stlIds) {
  const dateStr = toKey(year, month, day)
  const now = new Date()
  const today = toKey(now.getFullYear(), now.getMonth()+1, now.getDate())
  if (dateStr > today) return 'future'
  const seg = getSegmentForDay(day, year, month, payments)
  return seg ? segDisplayStatus(seg, stlIds) : 'void'  // uncovered past days are gaps → void
}

// Returns true if a property has at least one period that is past, not future,
// and not paid/void/refurb — i.e. an unpaid period the landlord should know about.
function isPropertyOverdue(prop) {
  const payments = prop.rent_payments || []
  const now = new Date()
  for (const p of payments) {
    if (p.status === 'overdue' || p.status === 'missed' || p.status === 'late') {
      // A row marked overdue/late is overdue regardless of date.
      // 'missed' kept for backward-compat with pre-2026-05-25 rows.
      return true
    }
  }
  // Also flag rented (or notice_given) properties with a past month that has
  // no payment row — these are properties still earning rent that may have
  // fallen through the cracks. Look back up to 3 months.
  if (isPropertyEarningRent(prop.status)) {
    // Months before tracking plausibly began (pre-tenancy, newly added
    // property) shouldn't flag. Use the earliest recorded payment row,
    // falling back to the property's creation date when no rows exist.
    let earliest = null
    for (const p of payments) {
      const k = p.period_start || (p.year && p.month ? toKey(p.year, p.month, 1) : null)
      if (k && (!earliest || k < earliest)) earliest = k
    }
    if (!earliest && prop.created_at) earliest = String(prop.created_at).slice(0, 10)
    for (let backMonths = 1; backMonths <= 3; backMonths++) {
      const d = new Date(now.getFullYear(), now.getMonth() - backMonths, 1)
      const y = d.getFullYear(), m = d.getMonth() + 1
      const monthStart = toKey(y, m, 1)
      const monthEnd = toKey(y, m, daysInMonth(y, m))
      if (earliest && earliest > monthEnd) continue
      // A month is accounted for when any row is keyed to it (paid, void,
      // refurb — explicit overdue/late rows already returned above) or a
      // dated segment overlaps it (cross-month segments carry the key of
      // the month their period starts in).
      const covered = payments.some(p =>
        (p.year === y && p.month === m) ||
        (p.period_start && p.period_end && p.period_start <= monthEnd && p.period_end >= monthStart)
      )
      if (!covered) return true
    }
  }
  return false
}

const STATUS_COLOR = {
  paid:    '#2ECC8A',
  stl:     '#9B6FDE',  // pseudo-status: paid segment linked to a Lodgify booking
  partial: '#E0943A',  // part-paid = attention, same amber as late
  pending: '#9B6FDE',  // legacy rows from the pre-2026-07 Lodgify sync
  overdue: '#E05555',
  missed:  '#E05555',  // legacy alias for pre-2026-05-25 rows
  late:    '#E0943A',
  refurb:  '#4B8FE0',
  void:    '#888EA8',
  future:  'transparent',
}

const STATUS_LABEL = { paid:'Paid', stl:'STL', partial:'Partial', pending:'Pending', overdue:'Overdue', missed:'Overdue', late:'Late', refurb:'Refurb', void:'Void', future:'Future' }

// Statuses the user can manually set via click. We deliberately omit 'future'
// (clicking a future day doesn't make sense) and 'refurb' (set elsewhere via
// the property's refurb tab so accidental clicks don't change refurb state).
const SETTABLE_STATUSES = ['paid', 'late', 'overdue', 'void']

export default function DayTrackerPage({ companies, properties, setProperties, showToast, onBack }) {
  const { T } = useTheme()
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [hoverDay, setHoverDay] = useState(null) // { propId, day }

  // Click popover for marking paid/missed/void. Position: anchored to the cell.
  // Shape: { propId, propName, segmentId, x, y } | null  (form holds the fields)
  const [editPopover, setEditPopover] = useState(null)
  // Form for the popover's segment editor: { start, end, amount, status }
  const [form, setForm] = useState({ start:'', end:'', amount:'', status:'paid' })
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

  // Filter to properties that have any payments or are currently earning
  // rent (rented or notice_given). Excludes vacant, refurb, sold, etc.
  const baseActiveProps = properties.filter(p =>
    (p.rent_payments?.length > 0) || isPropertyEarningRent(p.status)
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
    const seg = getSegmentForDay(day, year, month, prop.rent_payments || [])
    if (seg) {
      // Editing an existing row. A legacy whole-month row (no period dates)
      // becomes a proper dated segment spanning the month on first save.
      setForm({
        start:  seg.period_start || toKey(year, month, 1),
        end:    seg.period_end   || toKey(year, month, daysInMonth(year, month)),
        amount: seg.amount ?? (prop?.rent_pcm || 0),
        status: SETTABLE_STATUSES.includes(seg.status) ? seg.status : 'paid',
      })
    } else {
      // New segment in an uncovered (void) gap — default to a single day.
      setForm({ start: dateStr, end: dateStr, amount: prop?.rent_pcm || 0, status: 'paid' })
    }
    setEditPopover({
      propId: prop.id,
      propName: prop.name || prop.address,
      segmentId: seg ? seg.id : null,
      // Anchor the popover just below the clicked cell
      x: rect.left + rect.width / 2,
      y: rect.bottom + 6,
    })
  }

  // Save the segment described by `form`: create a new dated row, or update the
  // existing one. A range can be any start→end (e.g. tenant in on the 18th), and
  // the amount is whatever was actually paid (supports partial payments).
  async function saveSegment() {
    if (!editPopover || savingPayment) return
    if (!form.start || !form.end || form.end < form.start) {
      if (showToast) showToast('End date must be on or after start date', 'error')
      return
    }
    const amount = Number(form.amount) || 0
    // A paid or late range with no amount used to save as £0 income, which
    // then silently understated every report that switches to actuals the
    // moment any paid row exists. Ask for the money, or a status that means
    // none arrived.
    if ((form.status === 'paid' || form.status === 'late') && amount <= 0) {
      if (showToast) showToast('Enter the amount received. Use Overdue if it was not paid, or Void if nothing was due.', 'error')
      return
    }
    setSavingPayment(true)
    try {
      let saved
      if (editPopover.segmentId) {
        saved = await api.updateRentSegment(editPopover.segmentId, {
          period_start: form.start, period_end: form.end, status: form.status, amount,
        })
      } else {
        saved = await api.createRentSegment(editPopover.propId, form.start, form.end, form.status, amount)
      }
      setProperties(prev => prev.map(p => {
        if (p.id !== editPopover.propId) return p
        const existing = p.rent_payments || []
        const idx = existing.findIndex(rp => rp.id === saved.id)
        const updated = idx >= 0
          ? existing.map((rp, i) => i === idx ? saved : rp)
          : [...existing, saved]
        return { ...p, rent_payments: updated }
      }))
      if (showToast) showToast(`${editPopover.propName}: ${form.start} → ${form.end} marked ${STATUS_LABEL[form.status]}`)
      setEditPopover(null)
    } catch(e) {
      if (showToast) showToast(e.message || 'Update failed', 'error')
    }
    setSavingPayment(false)
  }

  // Delete the segment being edited (clears that range back to a void gap).
  async function deleteSegment() {
    if (!editPopover?.segmentId || savingPayment) return
    setSavingPayment(true)
    try {
      await api.deleteRentSegment(editPopover.segmentId)
      setProperties(prev => prev.map(p => {
        if (p.id !== editPopover.propId) return p
        return { ...p, rent_payments: (p.rent_payments || []).filter(rp => rp.id !== editPopover.segmentId) }
      }))
      if (showToast) showToast(`${editPopover.propName}: range removed`)
      setEditPopover(null)
    } catch(e) {
      if (showToast) showToast(e.message || 'Delete failed', 'error')
    }
    setSavingPayment(false)
  }

  // ── CSV export ────────────────────────────────────────────────────────
  // Builds a CSV of the last 12 months of rent payments across all visible
  // properties. One row per dated segment (a month may have several); months
  // with no row at all are emitted as a single 'void' placeholder so gaps stay
  // visible. Columns: company, property, period, status, amount, notes.
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
            const matches = payments
              .filter(rp => rp.year === y && rp.month === m)
              .sort((a, b) => (a.period_start || '').localeCompare(b.period_start || ''))
            if (matches.length === 0) {
              const status = isPropertyEarningRent(p.status) ? 'void' : ''
              rows.push([co.name || '', p.name || '', p.address || '', y, m, '', '', status, '', ''])
              continue
            }
            for (const match of matches) {
              rows.push([
                co.name || '', p.name || '', p.address || '',
                y, m, match.period_start || '', match.period_end || '',
                match.status, match.amount || '', match.notes || '',
              ])
            }
          }
        }
      }

      // CSV escaping: wrap in quotes if contains comma/quote/newline; double up internal quotes.
      // Cells starting with = + - @ or tab execute as formulas in Excel/Sheets —
      // prefix a quote unless the value is a plain number.
      const csv = rows.map(row => row.map(cell => {
        let s = cell == null ? '' : String(cell)
        if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
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
        {Object.entries(STATUS_LABEL).filter(([k])=>k!=='future'&&k!=='missed'&&k!=='pending').map(([k,l]) => (
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
                    const stlIds = new Set((prop.stl_bookings || []).map(b => b.rent_payment_id).filter(Boolean))
                    const dayStatuses = dayNums.map(d => getDayStatus(d, year, month, payments, stlIds))
                    const paidDays = dayStatuses.filter(s => s === 'paid' || s === 'stl').length
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
                          // Unknown statuses render as void-grey rather than an
                          // invisible square (pending/partial were invisible
                          // until they got colours — never repeat that).
                          const col = STATUS_COLOR[status] || STATUS_COLOR.void
                          const isFuture = status === 'future'
                          // Future days covered by a dated segment (upcoming STL
                          // bookings) show the segment's colour faded, so the
                          // forward calendar is visible without being editable.
                          const futureSeg = isFuture ? getSegmentForDay(d, year, month, payments) : null
                          const futureStatus = futureSeg ? segDisplayStatus(futureSeg, stlIds) : null
                          const futureCol = futureStatus ? (STATUS_COLOR[futureStatus] || STATUS_COLOR.void) + '66' : 'transparent'
                          const isHovered = hoverDay?.propId===prop.id && hoverDay?.day===d

                          return (
                            <td key={d} style={{ padding:'4px 1px', textAlign:'center', position:'relative' }}>
                              <div
                                onMouseEnter={() => setHoverDay({ propId:prop.id, day:d, status: futureStatus || status, propName: prop.name||prop.address })}
                                onMouseLeave={() => setHoverDay(null)}
                                onClick={isFuture ? undefined : (e) => openEditPopover(e, prop, d)}
                                style={{
                                  width:16, height:16, borderRadius:3, margin:'0 auto',
                                  background: isFuture ? futureCol : col,
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
              left: clamp(editPopover.x - 120, 8, window.innerWidth - 248),
              top:  clamp(editPopover.y, 8, window.innerHeight - 320),
              width: 240, zIndex:1501,
              background:T.card, border:`1px solid ${T.border}`, borderRadius:10,
              padding:'12px 14px', boxShadow:'0 8px 32px rgba(0,0,0,0.18)',
            }}>
            <div style={{ fontFamily:mono, fontSize:11, fontWeight:700, color:T.text, marginBottom:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {editPopover.propName}
            </div>
            <div style={{ fontFamily:mono, fontSize:10, color:T.muted, marginBottom:10 }}>
              {editPopover.segmentId ? 'Edit rent period' : 'New rent period'}
            </div>

            {/* Date range */}
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              {[['start','From'],['end','To']].map(([k,label]) => (
                <label key={k} style={{ flex:1, minWidth:0, fontFamily:mono, fontSize:9, color:T.muted }}>
                  {label}
                  <input type="date" value={form[k]} disabled={savingPayment}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                    style={{ width:'100%', minWidth:0, marginTop:3, fontFamily:mono, fontSize:11, padding:'5px 6px', borderRadius:6,
                      border:`1px solid ${T.border}`, background:T.surface, color:T.text, boxSizing:'border-box' }}/>
                </label>
              ))}
            </div>

            {/* Amount paid */}
            <label style={{ display:'block', fontFamily:mono, fontSize:9, color:T.muted, marginBottom:8 }}>
              Amount paid (£)
              <input type="number" min="0" step="0.01" value={form.amount} disabled={savingPayment}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                style={{ width:'100%', marginTop:3, fontFamily:mono, fontSize:11, padding:'5px 6px', borderRadius:6,
                  border:`1px solid ${T.border}`, background:T.surface, color:T.text, boxSizing:'border-box' }}/>
            </label>

            {/* Status */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
              {SETTABLE_STATUSES.map(s => {
                const isSel = s === form.status
                return (
                  <button key={s} onClick={() => setForm(f => ({ ...f, status: s }))} disabled={savingPayment}
                    style={{
                      fontFamily:mono, fontSize:11, fontWeight:700, padding:'7px 0', borderRadius:6,
                      border:`1px solid ${isSel ? STATUS_COLOR[s] : T.border}`,
                      background: isSel ? STATUS_COLOR[s] + '22' : 'transparent',
                      color: STATUS_COLOR[s],
                      cursor: savingPayment ? 'not-allowed' : 'pointer',
                      opacity: savingPayment ? 0.6 : 1,
                    }}>
                    {STATUS_LABEL[s]}
                  </button>
                )
              })}
            </div>

            {/* Actions */}
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={saveSegment} disabled={savingPayment}
                style={{ flex:1, fontFamily:mono, fontSize:11, fontWeight:700, padding:'8px 0', borderRadius:6,
                  border:'none', background:T.gold, color:'#1A2530', cursor: savingPayment?'not-allowed':'pointer', opacity: savingPayment?0.6:1 }}>
                {savingPayment ? 'Saving…' : 'Save'}
              </button>
              {editPopover.segmentId && (
                <button onClick={deleteSegment} disabled={savingPayment} title="Remove this period"
                  style={{ fontFamily:mono, fontSize:11, fontWeight:700, padding:'8px 10px', borderRadius:6,
                    border:`1px solid ${STATUS_COLOR.overdue}`, background:'transparent', color:STATUS_COLOR.overdue,
                    cursor: savingPayment?'not-allowed':'pointer', opacity: savingPayment?0.6:1 }}>
                  Delete
                </button>
              )}
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
