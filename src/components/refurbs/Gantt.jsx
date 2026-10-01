// Gantt-style programme for one refurb (or, later, the portfolio).
// Three layers per row, never merged:
//   planned   dashed outline  (the original programme)
//   forecast  solid bar       (what is expected now; falls back to planned)
//   actual    thin dark bar   (what really happened)
// Delayed / overdue rows are marked red. A dashed line marks today.
import { useMemo } from 'react'
import {
  flatStages, isoDate, addDays, daysBetween, expectedStart, expectedEnd, stageDelay, STAGE_STATUS_CFG,
} from '../../lib/refurbWorkspace'
import { mono, fmtShort } from './ui'

function rangeOf(rows, today) {
  let lo = null, hi = null
  const take = d => { if (!d) return; if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d }
  for (const s of rows) {
    take(isoDate(s.planned_start)); take(isoDate(s.planned_end))
    take(isoDate(s.forecast_start)); take(isoDate(s.forecast_end))
    take(isoDate(s.actual_start)); take(isoDate(s.actual_end))
  }
  if (!lo) return null
  const t = isoDate(today)
  if (t < lo && daysBetween(t, lo) < 30) lo = t
  if (t > hi && daysBetween(hi, t) < 30) hi = t
  // Start on a Monday, a few days of air either side.
  const start = new Date(addDays(lo, -3) + 'T00:00:00')
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return { start: isoDate(start), end: addDays(hi, 4) }
}

export default function Gantt({ stages, today = new Date(), onOpen, T, maxRows, emptyText = 'Add planned dates to stages to see the programme.' }) {
  const rows = useMemo(() => flatStages(stages).filter(s => s.status !== 'skipped'), [stages])
  const shown = maxRows ? rows.slice(0, maxRows) : rows
  const range = useMemo(() => rangeOf(rows, today), [rows, today])
  if (!range) return <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: '10px 0' }}>{emptyText}</div>
  const total = Math.max(1, daysBetween(range.start, range.end))
  const pos = d => (Math.max(0, Math.min(total, daysBetween(range.start, d))) / total) * 100
  const span = (a, b) => {
    if (!a && !b) return null
    const s = a || b, e = b || a
    const left = pos(s), right = pos(addDays(e, 1))
    return { left: `${left}%`, width: `${Math.max(0.8, right - left)}%` }
  }
  const weeks = []
  for (let d = range.start; d <= range.end; d = addDays(d, 7)) weeks.push(d)
  const t = isoDate(today)
  const todayLeft = t >= range.start && t <= range.end ? pos(t) : null
  const labelW = 170

  return <div style={{ overflowX: 'auto' }}>
    <div style={{ minWidth: 680 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `${labelW}px 1fr`, fontFamily: mono, fontSize: 9.5, color: T.muted }}>
        <div />
        <div style={{ position: 'relative', height: 18, borderBottom: `1px solid ${T.border}` }}>
          {weeks.map(w => <span key={w} style={{ position: 'absolute', left: `${pos(w)}%`, paddingLeft: 3, borderLeft: `1px solid ${T.border}`, height: 18, whiteSpace: 'nowrap' }}>{fmtShort(w)}</span>)}
        </div>
      </div>
      {shown.map(s => {
        const delay = stageDelay(s, today)
        const bad = delay.overdue || delay.slippedDays > 0
        const col = bad ? T.red : (STAGE_STATUS_CFG[s.status]?.color || T.gold)
        const planned = span(isoDate(s.planned_start), isoDate(s.planned_end))
        const fcStart = expectedStart(s), fcEnd = expectedEnd(s)
        const forecast = span(fcStart, fcEnd)
        const actual = span(isoDate(s.actual_start), isoDate(s.actual_end) || (s.actual_start && s.status !== 'complete' ? t : null))
        return <div key={s.id} style={{ display: 'grid', gridTemplateColumns: `${labelW}px 1fr`, alignItems: 'center', borderBottom: `1px solid ${T.border}55` }}>
          <button onClick={() => onOpen?.(s)} title={s.name}
            style={{ textAlign: 'left', background: 'none', border: 'none', padding: `6px 8px 6px ${s.parent_id ? 20 : 4}px`, color: T.text, fontSize: s.parent_id ? 11.5 : 12.5, cursor: onOpen ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: col, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
          </button>
          <div style={{ position: 'relative', height: 28, background: T.bg + '66' }}>
            {weeks.map(w => <span key={w} style={{ position: 'absolute', left: `${pos(w)}%`, top: 0, bottom: 0, borderLeft: `1px dashed ${T.border}88` }} />)}
            {planned && <span title={`Planned ${fmtShort(s.planned_start)} – ${fmtShort(s.planned_end)}`} style={{ position: 'absolute', top: 5, height: 14, ...planned, border: `1.5px dashed ${T.muted}`, borderRadius: 7, boxSizing: 'border-box' }} />}
            {forecast && <span title={`Forecast ${fmtShort(fcStart)} – ${fmtShort(fcEnd)}`} style={{ position: 'absolute', top: 7, height: 10, ...forecast, background: col, opacity: s.status === 'complete' ? 0.55 : 0.9, borderRadius: 5 }} />}
            {actual && <span title={`Actual ${fmtShort(s.actual_start)} – ${s.actual_end ? fmtShort(s.actual_end) : 'ongoing'}`} style={{ position: 'absolute', top: 21, height: 4, ...actual, background: T.text, borderRadius: 2 }} />}
            {todayLeft != null && <span style={{ position: 'absolute', left: `${todayLeft}%`, top: 0, bottom: 0, borderLeft: `2px solid ${T.gold}` }} />}
          </div>
        </div>
      })}
      {maxRows && rows.length > maxRows && <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, padding: '6px 4px' }}>+ {rows.length - maxRows} more stages</div>}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 8 }}>
        <span><span style={{ display: 'inline-block', width: 18, height: 9, border: `1.5px dashed ${T.muted}`, borderRadius: 5, verticalAlign: 'middle', marginRight: 5 }} />Planned</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 8, background: T.gold, borderRadius: 4, verticalAlign: 'middle', marginRight: 5 }} />Forecast</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 4, background: T.text, borderRadius: 2, verticalAlign: 'middle', marginRight: 5 }} />Actual</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: T.red, borderRadius: 4, verticalAlign: 'middle', marginRight: 5 }} />Delayed or overdue</span>
        <span><span style={{ display: 'inline-block', width: 2, height: 10, background: T.gold, verticalAlign: 'middle', marginRight: 5 }} />Today</span>
      </div>
    </div>
  </div>
}
