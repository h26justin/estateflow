// Month-end review (rent brief C6): every property that needs a look this
// month, with what is outstanding, what fell overdue, what came in, what was
// corrected or imported, vacancy, missing sources, and whether its arrears
// explanation is written for this month. Each row opens the property's
// versioned notes in place. Nothing here changes rent figures.
import { useState, useEffect, useMemo } from 'react'
import { MONO, FS, SANS, CV } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { isoToday } from '../lib/rentEngine'
import { currentNotes, monthEndQueue, periodOf, periodLabel, QUEUE_FILTERS, AWAITING_REVIEW } from '../lib/arrearsNotes'
import { SkeletonList } from '../lib/Skeleton'
import { Button, Modal } from './ui'
import ArrearsNotesPanel from './ArrearsNotesPanel'

const money = n => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function MonthEndReviewPanel({ companies = [], properties, canEditRent, showToast, onClose, openDetail, asOf = isoToday() }) {
  const { T } = useTheme()
  const [notes, setNotes] = useState(null)
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(null)   // property id whose notes are shown
  const period = periodOf(asOf)

  async function load() {
    try { setNotes(await api.fetchArrearsNotes((properties || []).map(p => p.id))) }
    catch (e) { showToast?.(e.message || 'Could not load arrears notes', 'error'); setNotes([]) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const byProperty = useMemo(() => currentNotes(notes || []), [notes])
  const queue = useMemo(() => monthEndQueue({ properties, notesByProperty: byProperty, asOf }), [properties, byProperty, asOf])
  const active = QUEUE_FILTERS.find(f => f.v === filter) || QUEUE_FILTERS[0]
  const shown = queue.filter(active.test)
  const notesFor = id => (notes || []).filter(n => n.property_id === id)

  const chip = (label, colour) => (
    <span key={label} style={{ fontFamily: SANS, fontSize: FS.xs, padding: '1px 7px', borderRadius: 20, background: colour + '1f', color: colour, border: `1px solid ${colour}44`, whiteSpace: 'nowrap' }}>{label}</span>
  )

  return (
    <Modal onClose={onClose} size="lg" zIndex={2000} title={`Month-end review · ${periodLabel(period)}`}
      description="Properties with rent outstanding, newly overdue, money received, corrections, vacancy or missing sources, and whether each explanation is current for this month.">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {QUEUE_FILTERS.map(f => {
          const n = queue.filter(f.test).length
          const on = filter === f.v
          return (
            <button key={f.v} type="button" onClick={() => setFilter(f.v)} aria-pressed={on}
              style={{ fontFamily: SANS, fontSize: FS.sm, padding: '4px 11px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${on ? T.gold : T.border}`, background: on ? T.gold : 'transparent', color: on ? CV.onGold : T.muted }}>
              {f.l} ({n})
            </button>
          )
        })}
      </div>

      {notes === null && <SkeletonList count={3} height={56} />}
      {notes && shown.length === 0 && <div style={{ fontFamily: SANS, fontSize: FS.base, color: T.green, padding: '12px 0' }}>Nothing to review here.</div>}
      {notes && shown.map(r => {
        const co = companies.find(c => c.id === r.companyId)
        const isOpen = open === r.id
        const canEdit = !!canEditRent?.(r.companyId)
        const f = r.flags
        return (
          <div key={r.id} style={{ border: `1px solid ${T.border}`, borderLeft: `3px solid ${f.outstanding ? (r.noteCurrent ? T.amber : T.red) : T.blue}`, borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{r.name}{co ? <span style={{ fontFamily: SANS, fontSize: FS.sm, color: co.color || T.goldText, marginLeft: 6 }}>{co.abbr || co.name}</span> : null}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <Button variant={isOpen ? 'secondary' : 'primary'} size="sm" onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? 'Close notes' : 'Notes'}</Button>
                {openDetail && <Button variant="secondary" size="sm" onClick={() => { onClose?.(); openDetail(r.property, 'rent') }}>Open property</Button>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: MONO, fontSize: FS.xs, color: T.muted, marginTop: 4 }}>
              <span>Outstanding <b style={{ color: r.outstanding > 0 ? T.red : T.muted }}>{money(r.outstanding)}</b></span>
              {r.newlyOverdue > 0 && <span>Newly overdue <b style={{ color: T.red }}>{money(r.newlyOverdue)}</b></span>}
              {f.received && <span>Received this month <b style={{ color: T.green }}>{money(r.receivedThisMonth)}</b></span>}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {f.corrected && chip(`${r.correctedCount} corrected`, T.blue)}
              {f.imported && chip(`${r.importedCount} imported`, T.blue)}
              {f.vacancy && chip(`Vacancy: ${r.vacancy[0].reason}`, T.muted)}
              {f.needsBackfill && chip(`Paid, amount missing (${r.backfillPeriods})`, T.amber)}
              {f.noTenancy && chip('No tenancy record', T.amber)}
            </div>
            <div style={{ fontFamily: SANS, fontSize: FS.sm, marginTop: 6, color: r.noteCurrent ? T.text : T.muted }}>
              <span style={{ color: r.noteCurrent ? T.green : T.amber, fontWeight: 600 }}>{r.noteCurrent ? 'Explanation current' : r.note ? `Explanation from ${periodLabel(r.note.period)}` : AWAITING_REVIEW}</span>
              {r.note && <span>: {r.explanation}</span>}
            </div>
            {isOpen && (
              <div style={{ marginTop: 10 }}>
                <ArrearsNotesPanel property={r.property} rows={notesFor(r.id)} canEdit={canEdit} showToast={showToast} asOf={asOf} onChanged={load} />
              </div>
            )}
          </div>
        )
      })}
    </Modal>
  )
}
