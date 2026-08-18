// Historic rent + expense CSV importer.
//
// Deliberately a four-step page, not a one-click upload: backfilling years of
// financial history is exactly the operation where a silent mistake is
// expensive and hard to spot afterwards. So the user sees, per row, what will
// be created, what will be overwritten (with the old value shown), what will be
// skipped as already present, and what cannot be imported and why. Nothing is
// written until they approve that.
//
// The planning is pure and lives in lib/csvImport.js; the writes are in
// api/dataImport.js. This file is only the review surface.

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { safeOverlayClose } from '../lib/modalUtils'
import FocusTrap from '../lib/FocusTrap'
import { naturalCompare } from '../lib/addressUtils'
import {
  parseCsv, detectColumns, buildRentPlan, buildExpensePlan, aliasesToLearn,
} from '../lib/csvImport'

const fmt = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n || 0)

// The columns each mode needs, for the "what's missing" hint on the mapping step.
const REQUIRED = {
  rent: [['property'], ['period_start', 'month'], ['amount']],
  expenses: [['property'], ['date'], ['amount']],
}

const TEMPLATES = {
  rent: 'Property,Period Start,Period End,Amount,Status,Notes\n35 Henley Road,2025-01-01,2025-01-31,635.00,paid,\n',
  expenses: 'Property,Date,Category,Description,Amount,Notes\n35 Henley Road,2025-01-14,Repairs,Boiler service,120.50,\n',
}

const ACTION_META = {
  create: { label: 'New',     colour: 'green' },
  update: { label: 'Update',  colour: 'blue'  },
  skip:   { label: 'Skip',    colour: 'muted' },
  error:  { label: 'Blocked', colour: 'red'   },
}

export function DataImporter({ properties, companies, showToast, onClose, asPage = false }) {
  const confirm = useConfirm()
  const { T } = useTheme()
  const [step, setStep] = useState('upload')   // upload | map | preview | done
  const [kind, setKind] = useState('rent')
  const [filename, setFilename] = useState('')
  const [parsed, setParsed] = useState(null)   // { headers, rows }
  const [columns, setColumns] = useState({})
  const [overrides, setOverrides] = useState({})  // line -> propertyId (manual fix)
  const [context, setContext] = useState({ payments: [], expenses: [] })
  const [aliases, setAliases] = useState([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [batches, setBatches] = useState([])
  const [showAll, setShowAll] = useState(false)
  const fileRef = useRef()

  const sortedProps = useMemo(
    () => [...(properties || [])].sort((a, b) => naturalCompare(a.name, b.name)),
    [properties]
  )

  useEffect(() => {
    let live = true
    api.fetchStatementAliases()
      .then(rows => { if (live) setAliases(rows) })
      .catch(e => console.error('DataImporter:fetchStatementAliases', e))
    api.fetchImportBatches()
      .then(rows => { if (live) setBatches(rows) })
      .catch(e => console.error('DataImporter:fetchImportBatches', e))
    return () => { live = false }
  }, [])

  // Property overrides are applied by rewriting the label's alias set, so the
  // pure planner stays the single source of truth for matching and we never
  // maintain a second, divergent copy of the resolution logic.
  const effectiveAliases = useMemo(() => {
    const extra = []
    for (const [line, propertyId] of Object.entries(overrides)) {
      const row = parsed?.rows.find(r => String(r.__line) === String(line))
      const label = row && columns.property ? row[columns.property] : null
      if (label && propertyId) extra.push({ property_id: propertyId, alias: label, alias_norm: null, __manual: true })
    }
    return [...aliases, ...extra]
  }, [aliases, overrides, parsed, columns.property])

  const planned = useMemo(() => {
    if (!parsed?.rows.length) return null
    const build = kind === 'rent' ? buildRentPlan : buildExpensePlan
    const out = build({
      rows: parsed.rows,
      columns,
      properties: sortedProps,
      aliases: effectiveAliases,
      existing: kind === 'rent' ? context.payments : context.expenses,
    })
    // Mark the rows the user fixed by hand so alias learning can pick them up.
    out.plan.forEach(r => { if (overrides[r.line]) r.matchedVia = 'manual' })
    return out
  }, [parsed, columns, sortedProps, effectiveAliases, context, kind, overrides])

  const missing = useMemo(() => {
    return (REQUIRED[kind] || []).filter(group => !group.some(f => columns[f]))
      .map(group => group.join(' or '))
  }, [columns, kind])

  async function handleFile(file) {
    if (!file) return
    if (!/\.(csv|txt)$/i.test(file.name)) {
      showToast('Please choose a CSV file', 'error')
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      const p = parseCsv(text)
      if (!p.rows.length) {
        showToast('That file has a header row but no data', 'error')
        setBusy(false)
        return
      }
      setFilename(file.name)
      setParsed(p)
      setColumns(detectColumns(p.headers))
      setOverrides({})
      setStep('map')
    } catch (e) {
      console.error('DataImporter:handleFile', e)
      showToast('Could not read that file: ' + (e?.message || 'unknown error'), 'error')
    }
    setBusy(false)
  }

  // Existing rows are needed before a plan means anything — without them every
  // row would look new and the whole point (spotting what is already there)
  // would be lost. So this gate is hard: no context, no preview.
  const goToPreview = useCallback(async () => {
    setBusy(true)
    try {
      const ids = [...new Set((properties || []).map(p => p.id))]
      setContext(await api.fetchImportContext(ids))
      setStep('preview')
    } catch (e) {
      console.error('DataImporter:fetchImportContext', e)
      showToast('Could not load existing records to compare against: ' + e.message, 'error')
    }
    setBusy(false)
  }, [properties, showToast])

  async function handleCommit() {
    if (!planned) return
    setBusy(true)
    try {
      const res = await api.commitImport({
        kind, source: 'csv', filename,
        plan: planned.plan,
        companyId: companies?.length === 1 ? companies[0].id : null,
        notes: `${planned.summary.create} created, ${planned.summary.update} updated from ${filename}`,
      })
      // Learning the corrections is a convenience, never a reason to fail an
      // import that has already written money.
      try {
        for (const a of aliasesToLearn(planned.plan, sortedProps)) {
          await api.saveStatementAlias(a.propertyId, a.alias, a.aliasNorm)
        }
      } catch (e) { console.error('DataImporter:saveStatementAlias', e) }

      setResult(res)
      setStep('done')
      api.fetchImportBatches().then(setBatches).catch(() => {})
    } catch (e) {
      console.error('DataImporter:commitImport', e)
      showToast('Import failed: ' + e.message, 'error')
    }
    setBusy(false)
  }

  async function handleRevert(batch) {
    const ok = await confirm({
      title: 'Revert this import?',
      body: `This deletes the ${batch.rows_created} row(s) it created and restores the ${batch.rows_updated} row(s) it changed to their previous values. This cannot be undone.`,
      confirmLabel: 'Revert import',
      cancelLabel: 'Keep it',
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await api.revertImportBatch(batch.id)
      showToast(`Reverted — ${r.rentDeleted + r.expensesDeleted} deleted, ${r.restored} restored`)
      api.fetchImportBatches().then(setBatches).catch(() => {})
    } catch (e) {
      showToast('Could not revert: ' + e.message, 'error')
    }
    setBusy(false)
  }

  const s = planned?.summary
  const canCommit = s && s.error === 0 && (s.create > 0 || s.update > 0)

  const label = { fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '.06em' }
  const cell = { fontFamily: MONO, fontSize: 11, padding: '6px 8px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }
  const chip = (colour, text) => (
    <span style={{
      fontFamily: MONO, fontSize: 9, padding: '2px 6px', borderRadius: 4,
      background: (T[colour] || T.muted) + '22', color: T[colour] || T.muted, whiteSpace: 'nowrap',
    }}>{text}</span>
  )

  const inner = (
    <>
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 id="data-importer-title" style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 2 }}>
              Import historic data
            </h2>
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
              {step === 'upload' && 'Rent or expenses, from a CSV'}
              {step === 'map' && `${filename} · ${parsed?.rows.length} rows · check the column mapping`}
              {step === 'preview' && `${filename} · review every row before anything is written`}
              {step === 'done' && 'Import complete'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: T.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
      </div>

      <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
        {/* ── STEP 1: upload ─────────────────────────────────────────── */}
        {step === 'upload' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {['rent', 'expenses'].map(k => (
                <button key={k} onClick={() => setKind(k)}
                  className={kind === k ? 'btn btn-gold' : 'btn btn-ghost'}
                  style={{ fontSize: 11, textTransform: 'capitalize' }}>{k}</button>
              ))}
            </div>

            <div onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${T.border}`, borderRadius: 12, padding: '36px 20px',
                textAlign: 'center', cursor: 'pointer', marginBottom: 18,
              }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 13, color: T.text, marginBottom: 4 }}>
                {busy ? 'Reading…' : `Choose a ${kind} CSV`}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
                Columns are detected automatically. You confirm the mapping next.
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files?.[0])} />
            </div>

            <div style={{ ...label, marginBottom: 6 }}>Expected columns</div>
            <pre style={{
              fontFamily: MONO, fontSize: 10, color: T.muted, background: T.bg2 || 'transparent',
              border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, overflowX: 'auto', marginBottom: 18,
            }}>{TEMPLATES[kind]}</pre>
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, lineHeight: 1.7, marginBottom: 18 }}>
              Record rent <strong>gross</strong>, with agent fees as separate expenses. A row marked paid with no
              amount is rejected: reports treat a paid month with no figure as zero income, which quietly removes it
              from your P&amp;L. Dates may be YYYY-MM-DD or DD/MM/YYYY (read as day first), and a whole month may be
              given as 2025-01 or Jan 2025.
            </div>

            {batches.length > 0 && (
              <>
                <div style={{ ...label, marginBottom: 6 }}>Previous imports</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {batches.slice(0, 8).map(b => (
                      <tr key={b.id}>
                        <td style={cell}>{new Date(b.created_at).toLocaleDateString('en-GB')}</td>
                        <td style={cell}>{b.kind}</td>
                        <td style={{ ...cell, color: T.muted }}>{b.filename || '—'}</td>
                        <td style={cell}>+{b.rows_created} ~{b.rows_updated}</td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {b.reverted_at
                            ? chip('muted', 'reverted')
                            : <button className="btn btn-ghost" style={{ fontSize: 10 }} disabled={busy}
                                onClick={() => handleRevert(b)}>Revert</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {/* ── STEP 2: column mapping ─────────────────────────────────── */}
        {step === 'map' && parsed && (
          <>
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 16 }}>
              Detected mapping below. Anything left as "not used" is ignored.
            </div>
            <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
              {(kind === 'rent'
                ? ['property', 'period_start', 'period_end', 'month', 'amount', 'status', 'notes', 'source_ref']
                : ['property', 'date', 'category', 'description', 'amount', 'notes', 'source_ref']
              ).map(field => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ ...label, width: 110, flexShrink: 0 }}>{field.replace(/_/g, ' ')}</div>
                  <select value={columns[field] || ''} style={{ flex: 1, fontFamily: MONO, fontSize: 11 }}
                    onChange={e => setColumns(c => ({ ...c, [field]: e.target.value || undefined }))}>
                    <option value="">— not used —</option>
                    {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {missing.length > 0 && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.red, marginBottom: 16 }}>
                Still needed: {missing.join(', ')}
              </div>
            )}

            <div style={{ ...label, marginBottom: 6 }}>First rows as read</div>
            <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{parsed.headers.map(h => <th key={h} style={{ ...cell, ...label, textAlign: 'left' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 4).map(r => (
                    <tr key={r.__line}>{parsed.headers.map(h => <td key={h} style={cell}>{r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── STEP 3: the plan ───────────────────────────────────────── */}
        {step === 'preview' && planned && (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                ['New rows', s.create, 'green'],
                ['Updates', s.update, 'blue'],
                ['Already there', s.skip, 'muted'],
                ['Blocked', s.error, s.error ? 'red' : 'muted'],
              ].map(([t, v, c]) => (
                <div key={t}>
                  <div style={{ ...label }}>{t}</div>
                  <div style={{ fontFamily: MONO, fontSize: 20, color: T[c] || T.text }}>{v}</div>
                </div>
              ))}
              <div>
                <div style={{ ...label }}>Value to post</div>
                <div style={{ fontFamily: MONO, fontSize: 20, color: T.text }}>{fmt(s.amount)}</div>
              </div>
            </div>

            {s.error > 0 && (
              <div style={{ background: T.red + '14', border: `1px solid ${T.red}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.red }}>
                  {s.error} row{s.error === 1 ? '' : 's'} cannot be imported. Fix them below, or correct the file and
                  upload again. Nothing will be written while any row is blocked.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ ...label }}>Rows</div>
              <button className="btn btn-ghost" style={{ fontSize: 10 }} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Show problems only' : `Show all ${planned.plan.length}`}
              </button>
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Line', '', 'Label / property', kind === 'rent' ? 'Period' : 'Date', 'Amount', 'Detail'].map((h, i) => (
                      <th key={i} style={{ ...cell, ...label, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {planned.plan
                    .filter(r => showAll || r.action === 'error' || r.warnings.length || r.action === 'update')
                    .map(r => {
                      const meta = ACTION_META[r.action]
                      return (
                        <tr key={r.line}>
                          <td style={{ ...cell, color: T.muted }}>{r.line}</td>
                          <td style={cell}>{chip(meta.colour, meta.label)}</td>
                          <td style={cell}>
                            <div>{r.propertyName || <span style={{ color: T.red }}>unmatched</span>}</div>
                            <div style={{ color: T.muted, fontSize: 10 }}>{r.label}</div>
                            {!r.propertyId && (
                              <select value={overrides[r.line] || ''} style={{ fontFamily: MONO, fontSize: 10, marginTop: 4, maxWidth: 200 }}
                                onChange={e => setOverrides(o => ({ ...o, [r.line]: e.target.value || undefined }))}>
                                <option value="">— pick a property —</option>
                                {sortedProps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td style={cell}>
                            {kind === 'rent'
                              ? (r.period_start ? `${r.period_start} → ${r.period_end}` : '—')
                              : (r.date || '—')}
                          </td>
                          <td style={cell}>
                            {r.amount == null ? '—' : fmt(r.amount)}
                            {r.action === 'update' && r.before && (
                              <div style={{ color: T.muted, fontSize: 10 }}>
                                was {r.before.amount == null ? 'blank' : fmt(r.before.amount)} / {r.before.status}
                              </div>
                            )}
                            {kind === 'rent' && <div style={{ color: T.muted, fontSize: 10 }}>{r.status}</div>}
                          </td>
                          <td style={cell}>
                            {r.errors.map((e, i) => <div key={i} style={{ color: T.red }}>{e}</div>)}
                            {r.warnings.map((w, i) => <div key={i} style={{ color: T.amber }}>{w}</div>)}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── STEP 4: result ─────────────────────────────────────────── */}
        {step === 'done' && result && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>{result.failed.length ? '⚠️' : '✅'}</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: T.text, marginBottom: 16 }}>
              {result.created} created · {result.updated} updated · {result.skipped} skipped
            </div>
            {result.failed.length > 0 && (
              <div style={{ background: T.red + '14', border: `1px solid ${T.red}`, borderRadius: 8, padding: 12, marginBottom: 16, textAlign: 'left' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.red, marginBottom: 6 }}>
                  {result.failed.length} ROW(S) FAILED
                </div>
                {result.failed.map((f, i) => (
                  <div key={i} style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>
                    line {f.line} · {f.label} · {f.message}
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 16 }}>
              This import can be reverted in one action from the first screen.
            </div>
            <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={onClose}>Close &amp; refresh</button>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      {step === 'map' && (
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.border}`, flexShrink: 0, display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setStep('upload')}>← Back</button>
          <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={missing.length > 0 || busy} onClick={goToPreview}>
            {busy ? 'Loading…' : 'Review the plan →'}
          </button>
        </div>
      )}
      {step === 'preview' && s && (
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.border}`, flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: 1, fontFamily: MONO, fontSize: 11, color: T.muted }}>
            {canCommit
              ? `${s.create} new, ${s.update} updated, ${fmt(s.amount)}`
              : s.error > 0 ? `${s.error} blocked row(s) must be fixed first` : 'Nothing to import'}
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setStep('map')}>← Back</button>
          <button className="btn btn-gold" style={{ fontSize: 11 }} disabled={!canCommit || busy} onClick={handleCommit}>
            {busy ? 'Importing…' : `Import ${s.create + s.update} row(s)`}
          </button>
        </div>
      )}
    </>
  )

  const dirty = step === 'map' || step === 'preview'

  if (asPage) return (
    <div className="fade" style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {inner}
      </div>
    </div>
  )

  return (
    <div className="overlay" onClick={safeOverlayClose(dirty, onClose, confirm)}>
      <FocusTrap onEscape={() => safeOverlayClose(dirty, onClose, confirm)({ target: null, currentTarget: null })}>
        <div className="modal" style={{ maxWidth: 960, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          role="dialog" aria-modal="true" aria-labelledby="data-importer-title">
          {inner}
        </div>
      </FocusTrap>
    </div>
  )
}
