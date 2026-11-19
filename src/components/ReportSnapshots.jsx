// Frozen month-end snapshots of the agent rent report (rent brief C7).
//
// "Freeze month-end snapshot" records the report on screen, as issued, for
// its as-of date and a month-end period. If that agent and period already has
// a snapshot, the new one is a restatement: it supersedes the old one and
// needs a note saying why. Rows are never edited (report_snapshots is insert
// and select only). The list shows every snapshot with whether it has been
// superseded, and "Compare with current" shows what has moved since.
//
// This only reads the report model; it does not change what the emailed
// report contains.

import { useState, useEffect, useMemo, useCallback, useId } from 'react'
import * as api from '../lib/api'
import { MONO, SANS, FS, inp } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import {
  snapshotFromAgentReport, diffSnapshots, currentSnapshotFor, supersededIds, reportCompanyId, periodOf, SNAPSHOT_KIND,
} from '../lib/reportSnapshots'
import { Button } from './ui'

const gbp = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const periodLabel = p => { const [y, m] = String(p || '').split('-').map(Number); return y && m ? `${MONTHS[m - 1]} ${y}` : (p || '—') }
const dateTime = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—')
const prevPeriod = p => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }
const signed = (v, money = true) => (v === 0 ? '—' : `${v > 0 ? '+' : '−'}${money ? gbp(Math.abs(v)) : Math.abs(v)}`)

export default function ReportSnapshots({ model, user, T }) {
  const agentId = model?.agent?.id || null
  const companyId = useMemo(() => reportCompanyId(model), [model])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [freezing, setFreezing] = useState(false)
  const [saving, setSaving] = useState(false)
  const asOfPeriod = periodOf(model?.asOf)
  const [period, setPeriod] = useState(asOfPeriod)
  const [note, setNote] = useState('')
  const [compareId, setCompareId] = useState(null)
  const noteId = useId(), periodId = useId(), headingId = useId()

  const load = useCallback(async () => {
    if (!agentId) return
    setLoading(true); setLoadError(null)
    try { setRows(await api.fetchReportSnapshots({ kind: SNAPSHOT_KIND.agentRent, agentId })) }
    catch (e) { setLoadError(e?.message || 'Could not load snapshots') }
    setLoading(false)
  }, [agentId])
  useEffect(() => { load() }, [load])

  // Only this report's scope (same agent, same company coverage).
  const scoped = useMemo(() => rows.filter(r => (r.company_id || null) === (companyId || null)), [rows, companyId])
  const gone = useMemo(() => supersededIds(scoped), [scoped])
  const fields = useMemo(() => (model ? snapshotFromAgentReport(model, { period, companyId }) : null), [model, period, companyId])
  const restates = useMemo(() => (fields ? currentSnapshotFor(scoped, fields) : null), [scoped, fields])
  const compared = scoped.find(r => r.id === compareId) || null
  const diff = useMemo(() => (compared && fields ? diffSnapshots(compared, fields) : null), [compared, fields])

  if (!model || !agentId) return null

  async function save(e) {
    e.preventDefault()
    if (restates && !note.trim()) return
    setSaving(true)
    try {
      await api.addReportSnapshot({ ...fields, supersedes: restates?.id || null, note: note.trim() || null })
      showAppToast(restates ? `Restatement for ${periodLabel(period)} saved` : `Snapshot for ${periodLabel(period)} frozen`)
      setFreezing(false); setNote('')
      await load()
    } catch (err) { showAppToast('Could not save the snapshot: ' + (err?.message || 'unknown error'), 'error') }
    setSaving(false)
  }

  const who = r => (r.created_by && user?.id && r.created_by === user.id ? 'You' : 'Another member')
  const th = { textAlign: 'left', fontFamily: MONO, fontSize: FS.xs, color: T.muted, fontWeight: 600, padding: '8px 10px', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }
  const td = { fontFamily: SANS, fontSize: FS.sm, color: T.text, padding: '8px 10px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }
  const num = { ...td, textAlign: 'right', fontFamily: MONO }

  return (
    <section aria-labelledby={headingId} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 id={headingId} style={{ fontSize: FS.md, fontWeight: 700, color: T.text, margin: 0 }}>Month-end snapshots</h3>
        <span style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted }}>The figures as issued, frozen. A correction is a dated restatement, never an edit.</span>
        {!freezing && (
          <Button size="sm" icon="lock" style={{ marginLeft: 'auto' }} onClick={() => { setPeriod(asOfPeriod); setFreezing(true) }}>
            Freeze month-end snapshot
          </Button>
        )}
      </div>

      {freezing && (
        <form onSubmit={save} style={{ marginTop: 12, padding: 12, border: `1px solid ${T.border}`, borderRadius: 10, background: T.bg, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor={periodId} style={{ fontFamily: SANS, fontSize: FS.sm, color: T.text, fontWeight: 600 }}>Month end</label>
            <select id={periodId} value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inp(T), width: 'auto', padding: '6px 10px' }}>
              {[asOfPeriod, prevPeriod(asOfPeriod)].map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
            <span style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted }}>
              Position at {model.asOf}: owed {gbp(fields.summary.owed)}, older arrears {gbp(fields.summary.arrears)}, {fields.lines.length} {fields.lines.length === 1 ? 'property' : 'properties'}.
            </span>
          </div>
          {restates && (
            <p role="note" style={{ margin: 0, fontFamily: SANS, fontSize: FS.sm, color: T.amber }}>
              {periodLabel(period)} was already frozen on {dateTime(restates.created_at)}. This will be a restatement that supersedes it; say why below.
            </p>
          )}
          <div style={{ display: 'grid', gap: 4 }}>
            <label htmlFor={noteId} style={{ fontFamily: SANS, fontSize: FS.sm, color: T.text, fontWeight: 600 }}>
              {restates ? 'Why is this being restated? (required)' : 'Note (optional)'}
            </label>
            <textarea id={noteId} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={2} required={!!restates}
              aria-required={!!restates} style={{ ...inp(T), resize: 'vertical' }}
              placeholder={restates ? 'e.g. October receipt for Flat 2 posted after the first snapshot' : ''}/>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" size="sm" loading={saving} disabled={saving || (!!restates && !note.trim())}>
              {restates ? 'Save restatement' : 'Freeze snapshot'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setFreezing(false); setNote('') }} disabled={saving}>Cancel</Button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 12 }}>
        {loading ? <p style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, margin: 0 }}>Loading snapshots…</p>
          : loadError ? <p role="alert" style={{ fontFamily: SANS, fontSize: FS.sm, color: T.red, margin: 0 }}>Could not load snapshots: {loadError}</p>
            : !scoped.length ? <p style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, margin: 0 }}>No snapshots yet for this agent.</p>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Snapshots for {model.agent.name}</caption>
                    <thead>
                      <tr>
                        <th scope="col" style={th}>Period</th>
                        <th scope="col" style={th}>As of</th>
                        <th scope="col" style={th}>Frozen</th>
                        <th scope="col" style={th}>Who</th>
                        <th scope="col" style={{ ...th, textAlign: 'right' }}>Owed</th>
                        <th scope="col" style={{ ...th, textAlign: 'right' }}>Older arrears</th>
                        <th scope="col" style={{ ...th, textAlign: 'right' }}>Properties</th>
                        <th scope="col" style={th}>Status</th>
                        <th scope="col" style={th}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoped.map(r => {
                        const superseded = gone.has(r.id)
                        return (
                          <tr key={r.id} style={{ opacity: superseded ? 0.7 : 1 }}>
                            <th scope="row" style={{ ...td, fontWeight: 600, textAlign: 'left' }}>{periodLabel(r.period)}</th>
                            <td style={td}>{r.as_of}</td>
                            <td style={td}>{dateTime(r.created_at)}</td>
                            <td style={td}>{who(r)}</td>
                            <td style={num}>{gbp(r.summary?.owed)}</td>
                            <td style={num}>{gbp(r.summary?.arrears)}</td>
                            <td style={num}>{r.summary?.units ?? (r.lines || []).length}</td>
                            <td style={td}>
                              <span style={{ fontWeight: 600, color: superseded ? T.muted : T.green }}>{superseded ? 'Superseded' : 'Current'}</span>
                              {r.supersedes && <span style={{ color: T.muted }}> · restatement</span>}
                              {r.note && <div style={{ color: T.muted, fontSize: FS.xs, marginTop: 2 }}>{r.note}</div>}
                            </td>
                            <td style={td}>
                              <Button variant="secondary" size="sm" aria-pressed={compareId === r.id}
                                onClick={() => setCompareId(compareId === r.id ? null : r.id)}>
                                {compareId === r.id ? 'Hide comparison' : 'Compare with current'}
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
      </div>

      {diff && compared && <SnapshotDiff diff={diff} compared={compared} asOf={model.asOf} T={T} th={th} td={td} num={num} onClose={() => setCompareId(null)}/>}
    </section>
  )
}

function SnapshotDiff({ diff, compared, asOf, T, th, td, num, onClose }) {
  const color = v => (v > 0 ? T.red : v < 0 ? T.green : T.muted)
  return (
    <div role="region" aria-label="Comparison with the current report" style={{ marginTop: 14, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: FS.base, fontWeight: 700, color: T.text }}>
          {periodLabel(compared.period)} snapshot (as of {compared.as_of}) compared with the report now (as of {asOf})
        </h4>
        <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</Button>
      </div>
      {diff.formulaChanged && <p role="note" style={{ margin: '0 0 8px', fontFamily: SANS, fontSize: FS.sm, color: T.amber }}>This snapshot was worked out with an earlier formula version ({compared.formula_version}); some movement may come from the method, not the data.</p>}
      {!diff.changed ? <p style={{ margin: 0, fontFamily: SANS, fontSize: FS.sm, color: T.green }}>No change: the report now matches this snapshot.</p> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <caption style={{ textAlign: 'left', fontFamily: MONO, fontSize: FS.xs, color: T.muted, padding: '4px 0' }}>Headline totals</caption>
              <thead><tr><th scope="col" style={th}>Figure</th><th scope="col" style={{ ...th, textAlign: 'right' }}>Snapshot</th><th scope="col" style={{ ...th, textAlign: 'right' }}>Now</th><th scope="col" style={{ ...th, textAlign: 'right' }}>Change</th></tr></thead>
              <tbody>
                {diff.totals.map(t => (
                  <tr key={t.key}>
                    <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 400 }}>{t.label}</th>
                    <td style={num}>{t.money ? gbp(t.old) : t.old}</td>
                    <td style={num}>{t.money ? gbp(t.new) : t.new}</td>
                    <td style={{ ...num, fontWeight: t.delta ? 700 : 400, color: color(t.delta) }}>{signed(t.delta, t.money)}</td>
                  </tr>
                ))}
                {diff.aged.filter(a => a.bucket !== 'total').map(a => (
                  <tr key={a.bucket}>
                    <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 400 }}>Aged {a.bucket === 'historic' ? 'historic arrears' : `${a.bucket} days`}</th>
                    <td style={num}>{gbp(a.old)}</td>
                    <td style={num}>{gbp(a.new)}</td>
                    <td style={{ ...num, fontWeight: a.delta ? 700 : 400, color: color(a.delta) }}>{signed(a.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {diff.properties.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption style={{ textAlign: 'left', fontFamily: MONO, fontSize: FS.xs, color: T.muted, padding: '4px 0' }}>Properties that moved</caption>
                <thead><tr>
                  <th scope="col" style={th}>Property</th><th scope="col" style={th}>Company</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Owed change</th><th scope="col" style={{ ...th, textAlign: 'right' }}>Arrears change</th>
                </tr></thead>
                <tbody>
                  {diff.properties.map(p => (
                    <tr key={p.id}>
                      <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                        {p.name}{p.change !== 'changed' && <span style={{ color: T.muted, fontWeight: 400 }}> ({p.change === 'added' ? 'not in snapshot' : 'no longer in report'})</span>}
                      </th>
                      <td style={td}>{p.company || '—'}</td>
                      <td style={{ ...num, color: color(p.owed.delta) }}>{signed(p.owed.delta)} <span style={{ color: T.muted, fontWeight: 400 }}>({gbp(p.owed.old)} → {gbp(p.owed.new)})</span></td>
                      <td style={{ ...num, color: color(p.arrears.delta) }}>{signed(p.arrears.delta)} <span style={{ color: T.muted, fontWeight: 400 }}>({gbp(p.arrears.old)} → {gbp(p.arrears.new)})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
