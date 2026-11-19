// Arrears explanation for one property (rent brief C6): what was charged,
// what came in and what is outstanding period by period, then the current
// explanation with its earlier versions and the actions to update it.
// Every change inserts a new version (arrears_notes is insert-only); nothing
// is overwritten, so earlier explanations stay visible under History.
import { useState, useEffect, useMemo } from 'react'
import { MONO, FS, SANS } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { isoToday, BUCKET_LABEL } from '../lib/rentEngine'
import { currentTenancy } from '../lib/tenancyUtils'
import {
  currentNotes, noteIsCurrent, outstandingPeriods, nextVersion, explanationText, periodOf, periodLabel,
  NOTE_STATUSES, NOTE_STATUS_LABEL, NOTE_FIELDS, AWAITING_REVIEW,
} from '../lib/arrearsNotes'
import { SkeletonList } from '../lib/Skeleton'
import { Button } from './ui'

const money = n => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const EMPTY = { reason: '', response: '', payment_plan: '', next_action: '', follow_up_date: '', owner: '', status: 'open' }
const LIMIT = { reason: 2000, response: 2000, payment_plan: 1000, next_action: 1000, owner: 120 }

export default function ArrearsNotesPanel({ property, canEdit = false, showToast, rows: givenRows, onChanged, asOf = isoToday(), showPeriods = true }) {
  const { T } = useTheme()
  const [rows, setRows] = useState(givenRows || null)
  const [form, setForm] = useState(null)   // { mode: 'new'|'edit'|'replace', fields }
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const period = periodOf(asOf)

  async function load() {
    try { const r = await api.fetchArrearsNotes([property.id]); setRows(r); return r }
    catch (e) { showToast?.(e.message || 'Could not load arrears notes', 'error'); setRows([]); return [] }
  }
  useEffect(() => {
    setForm(null); setShowHistory(false)
    if (givenRows) setRows(givenRows); else { setRows(null); load() }
  }, [property.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const entry = useMemo(() => (rows ? currentNotes(rows).get(property.id) : null) || null, [rows, property.id])
  const current = entry?.current || null
  const history = entry?.history || []
  const isCurrent = noteIsCurrent(current, period)
  const periods = useMemo(() => (showPeriods ? outstandingPeriods(property, asOf) : []), [property, asOf, showPeriods])
  const tenancyId = currentTenancy(property.tenancies || [], asOf)?.id || current?.tenancy_id || null

  async function save(fields) {
    if (saving) return
    setSaving(true)
    try {
      await api.addArrearsNote(fields)
      showToast?.('Explanation saved as a new version')
      setForm(null)
      const r = await load()
      onChanged?.(r)
    } catch (e) { showToast?.(e.message || 'Could not save the explanation', 'error') }
    setSaving(false)
  }
  const version = changes => nextVersion(current, { period, property_id: property.id, tenancy_id: tenancyId, changes })
  const keepLast = () => save(version({}))
  const needsInvestigation = () => save(version({ status: 'needs_investigation' }))
  function openForm(mode) {
    const fields = mode === 'edit' && current
      ? Object.fromEntries(NOTE_FIELDS.map(k => [k, current[k] ?? EMPTY[k]]))
      : { ...EMPTY, owner: current?.owner || '' }
    setForm({ mode, fields })
  }
  function submitForm() {
    if (!form) return
    if (!String(form.fields.reason || '').trim()) { showToast?.('Write the reason for the arrears', 'error'); return }
    save(version({ ...form.fields }))
  }
  const setField = (k, v) => setForm(f => ({ ...f, fields: { ...f.fields, [k]: v } }))

  const statusColour = { open: T.amber, needs_investigation: T.red, awaiting_review: T.blue, resolved: T.green }
  const pill = s => (
    <span style={{ fontFamily: SANS, fontSize: FS.sm, padding: '2px 8px', borderRadius: 20, background: (statusColour[s] || T.muted) + '22', color: statusColour[s] || T.muted, border: `1px solid ${(statusColour[s] || T.muted)}44` }}>{NOTE_STATUS_LABEL[s] || s}</span>
  )
  const detail = (label, v) => v ? <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.text, marginTop: 2 }}><span style={{ color: T.muted }}>{label}: </span>{v}</div> : null
  const renderVersion = (n, muted) => (
    <div key={n.id} style={{ borderTop: muted ? `1px solid ${T.border}` : 'none', paddingTop: muted ? 8 : 0, marginTop: muted ? 8 : 0, opacity: muted ? 0.85 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: FS.xs, color: T.muted }}>{periodLabel(n.period)}</span>
        {pill(n.status)}
        <span style={{ fontFamily: MONO, fontSize: FS.xs, color: T.faint }}>written {fmtDate(n.created_at)}</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: FS.base, color: explanationText(n) ? T.text : T.muted, marginTop: 4, whiteSpace: 'pre-wrap' }}>{explanationText(n) || AWAITING_REVIEW}</div>
      {detail('Tenant / agent response', n.response)}
      {detail('Payment plan', n.payment_plan)}
      {detail('Next action', n.next_action)}
      {detail('Follow up', n.follow_up_date ? fmtDate(n.follow_up_date) : null)}
      {detail('Owner', n.owner)}
    </div>
  )

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontFamily: MONO, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Arrears explanation · {periodLabel(period)}</div>
        {rows && (isCurrent
          ? <span style={{ fontFamily: SANS, fontSize: FS.sm, color: T.green }}>Up to date for {periodLabel(period)}</span>
          : <span style={{ fontFamily: SANS, fontSize: FS.sm, color: T.amber }}>{current ? `Last written for ${periodLabel(current.period)}` : AWAITING_REVIEW}</span>)}
      </div>

      {showPeriods && periods.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: SANS, fontSize: FS.sm }}>
            <thead><tr style={{ color: T.muted, textAlign: 'left' }}>
              <th style={{ padding: '2px 6px', fontWeight: 500 }}>Period</th>
              <th style={{ padding: '2px 6px', fontWeight: 500, textAlign: 'right' }}>Charged</th>
              <th style={{ padding: '2px 6px', fontWeight: 500, textAlign: 'right' }}>Received</th>
              <th style={{ padding: '2px 6px', fontWeight: 500, textAlign: 'right' }}>Outstanding</th>
              <th style={{ padding: '2px 6px', fontWeight: 500 }}>Status</th>
            </tr></thead>
            <tbody>{periods.map(({ e, b }) => (
              <tr key={e.id} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={{ padding: '3px 6px', color: T.text }}>{fmtDate(e.periodStart)} – {fmtDate(e.periodEnd)}</td>
                <td style={{ padding: '3px 6px', fontFamily: MONO, textAlign: 'right' }}>{e.expected == null ? '—' : money(e.expected)}</td>
                <td style={{ padding: '3px 6px', fontFamily: MONO, textAlign: 'right' }}>{e.received == null ? '—' : money(e.received)}</td>
                <td style={{ padding: '3px 6px', fontFamily: MONO, textAlign: 'right', color: b.bucket === 'overdue' ? T.red : T.amber }}>{money(b.owed)}</td>
                <td style={{ padding: '3px 6px', color: T.muted }}>{BUCKET_LABEL[b.bucket] || b.bucket}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {rows === null && <SkeletonList count={1} height={48} />}
      {rows && !current && !form && <div style={{ fontFamily: SANS, fontSize: FS.base, color: T.muted, marginBottom: 8 }}>No explanation written yet: {AWAITING_REVIEW.toLowerCase()}.</div>}
      {current && !form && renderVersion(current, false)}

      {canEdit && rows && !form && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {!current && <Button variant="primary" size="sm" onClick={() => openForm('new')}>Add explanation</Button>}
          {current && current.period !== period && <Button variant="primary" size="sm" disabled={saving} onClick={keepLast}>Keep last month's explanation</Button>}
          {current && <Button variant="secondary" size="sm" onClick={() => openForm('edit')}>Edit and update</Button>}
          {current && <Button variant="secondary" size="sm" onClick={() => openForm('replace')}>Replace with new reason</Button>}
          {current && <Button variant="secondary" size="sm" disabled={saving} onClick={needsInvestigation}>Needs investigation</Button>}
        </div>
      )}

      {form && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginBottom: 8 }}>
            {form.mode === 'replace' ? 'A new reason. The previous explanation stays in the history.' : form.mode === 'edit' ? 'Saved as a new version; the previous one stays in the history.' : 'The first explanation for this property.'} For {periodLabel(period)}.
          </div>
          <div style={{ marginBottom: 8 }}><label>Reason</label><textarea aria-label="Reason" rows={2} maxLength={LIMIT.reason} value={form.fields.reason || ''} onChange={e => setField('reason', e.target.value)} /></div>
          <div style={{ marginBottom: 8 }}><label>Tenant / agent response</label><textarea aria-label="Tenant or agent response" rows={2} maxLength={LIMIT.response} value={form.fields.response || ''} onChange={e => setField('response', e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 10 }}>
            <div><label>Payment plan</label><input aria-label="Payment plan" maxLength={LIMIT.payment_plan} value={form.fields.payment_plan || ''} onChange={e => setField('payment_plan', e.target.value)} /></div>
            <div><label>Next action</label><input aria-label="Next action" maxLength={LIMIT.next_action} value={form.fields.next_action || ''} onChange={e => setField('next_action', e.target.value)} /></div>
            <div><label>Follow-up date</label><input aria-label="Follow-up date" type="date" value={form.fields.follow_up_date || ''} onChange={e => setField('follow_up_date', e.target.value)} /></div>
            <div><label>Owner</label><input aria-label="Owner" maxLength={LIMIT.owner} value={form.fields.owner || ''} onChange={e => setField('owner', e.target.value)} /></div>
            <div><label>Status</label><select aria-label="Status" value={form.fields.status || 'open'} onChange={e => setField('status', e.target.value)}>{NOTE_STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="sm" onClick={submitForm} disabled={saving}>{saving ? 'Saving…' : 'Save new version'}</Button>
            <Button variant="secondary" size="sm" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory}
            style={{ fontFamily: SANS, fontSize: FS.sm, background: 'transparent', border: 'none', cursor: 'pointer', color: T.goldText, padding: 0, textDecoration: 'underline' }}>
            {showHistory ? 'Hide' : 'Show'} earlier versions ({history.length})
          </button>
          {showHistory && <div style={{ marginTop: 4 }}>{history.map(n => renderVersion(n, true))}</div>}
        </div>
      )}
    </div>
  )
}
