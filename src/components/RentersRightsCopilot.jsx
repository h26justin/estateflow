import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { showAppToast } from '../lib/toast'
import FocusTrap from '../lib/FocusTrap'
import { safeOverlayClose } from '../lib/modalUtils'

const fmtDate = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-GB')
}
import {
  RRA_CHECKLIST,
  NOTICE_TYPES,
  fetchRraCompliance,
  ensureRraRow,
  updateRraCompliance,
  fetchRepairTimers,
  draftRraNotice,
} from '../lib/api/rentersRights'

const DISCLAIMER =
  'Guidance only — not legal advice. The Renters Rights Act changes possession ' +
  'grounds, notice periods and registration duties. Verify everything against ' +
  'current legislation and take advice from a qualified solicitor before acting.'

function Banner({ T }) {
  return (
    <div className="card" style={{ borderColor: T.gold, background: 'transparent', padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
      <strong style={{ color: T.gold }}>Renters Rights copilot</strong>
      <div style={{ marginTop: 4, opacity: 0.85 }}>{DISCLAIMER}</div>
    </div>
  )
}

function Toggle({ T, on, onClick, disabled }) {
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        minWidth: 110,
        borderColor: on ? T.green : T.border,
        color: on ? T.green : T.muted,
        fontFamily: "'DM Mono', monospace",
        fontSize: 12,
      }}
    >
      {on ? 'Done' : 'Mark done'}
    </button>
  )
}

function NoticeModal({ T, property, tenantName, onClose }) {
  const [noticeType, setNoticeType] = useState(NOTICE_TYPES[0].v)
  const [ground, setGround] = useState('')
  const [facts, setFacts] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    setDrafting(true)
    try {
      const out = await draftRraNotice({
        propertyId: property.id,
        noticeType,
        ground,
        facts,
        tenantName,
        propertyLabel: property.name || property.address,
      })
      setResult(out)
    } catch (e) {
      showAppToast(e.message || 'Could not draft notice', 'error')
    } finally {
      setDrafting(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.draft)
      showAppToast('Draft copied to clipboard', 'success')
    } catch {
      showAppToast('Copy failed — select the text manually', 'error')
    }
  }

  return (
    <div className="overlay" onClick={safeOverlayClose(false, onClose)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <FocusTrap onEscape={onClose}>
        <div role="dialog" aria-modal="true" aria-label="Draft a notice" className="card"
          style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontFamily: "'DM Mono', monospace" }}>Draft a notice / letter</h3>
            <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>

          {!result && (
            <>
              <label style={{ fontSize: 12, color: T.muted }}>Type</label>
              <select className="card" value={noticeType} onChange={(e) => setNoticeType(e.target.value)}
                style={{ width: '100%', padding: 8, marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>
                {NOTICE_TYPES.map((n) => <option key={n.v} value={n.v}>{n.l}</option>)}
              </select>

              {noticeType === 'possession_ground_8' && (
                <>
                  <label style={{ fontSize: 12, color: T.muted }}>Ground / reference (optional)</label>
                  <input className="card" value={ground} onChange={(e) => setGround(e.target.value)}
                    placeholder="e.g. rent arrears ground"
                    style={{ width: '100%', padding: 8, marginBottom: 10, fontFamily: "'DM Mono', monospace" }} />
                </>
              )}

              <label style={{ fontSize: 12, color: T.muted }}>Facts / context (optional)</label>
              <textarea className="card" value={facts} onChange={(e) => setFacts(e.target.value)} rows={4}
                placeholder="Relevant facts — arrears amount, dates, repair details. Leave blank for placeholders."
                style={{ width: '100%', padding: 8, marginBottom: 14, fontFamily: "'DM Mono', monospace" }} />

              <button type="button" className="btn-gold" onClick={run} disabled={drafting} style={{ width: '100%' }}>
                {drafting ? 'Drafting…' : 'Generate draft'}
              </button>
            </>
          )}

          {result && (
            <>
              <div style={{ fontSize: 11, color: T.gold, marginBottom: 6 }}>
                {result.confidence} · {result.model_used}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'DM Mono', monospace", fontSize: 12, background: T.surface, padding: 12, borderRadius: 6, maxHeight: '46vh', overflow: 'auto' }}>
                {result.draft}
              </pre>
              <div style={{ fontSize: 11, color: T.muted, margin: '8px 0' }}>{result.disclaimer}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-gold" onClick={copy}>Copy draft</button>
                <button type="button" className="btn-ghost" onClick={() => setResult(null)}>Start over</button>
              </div>
            </>
          )}
        </div>
      </FocusTrap>
    </div>
  )
}

function RepairTimers({ T, propertyId }) {
  const [timers, setTimers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchRepairTimers(propertyId)
      .then((rows) => { if (live) setTimers(rows) })
      .catch((e) => showAppToast(e.message || 'Could not load repair timers', 'error'))
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [propertyId])

  if (loading) return <div style={{ color: T.muted, fontSize: 13 }}>Loading repair timers…</div>
  const open = timers.filter((t) => t.open)
  if (!open.length) return <div style={{ color: T.muted, fontSize: 13 }}>No open repairs. Awaab's-Law timers track open maintenance jobs.</div>

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {open.map((t) => {
        const colour = t.breached ? T.red : t.days_to_deadline <= 1 ? T.gold : T.green
        return (
          <div key={t.id} className="card" style={{ padding: 10, borderColor: colour }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{t.title || t.description || 'Repair job'}</strong>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: colour }}>
                {t.severity === 'emergency' ? '24h' : '14d'} target
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
              Reported {fmtDate(t.created_at)} · open {t.elapsed_days}d ·{' '}
              <span style={{ color: colour }}>
                {t.breached ? `breached by ${Math.abs(t.days_to_deadline)}d` : `${t.days_to_deadline}d to target`}
              </span>
              {t.reported_by_tenant ? ' · tenant-reported' : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function RentersRightsCopilot({ companyId, property }) {
  const { T } = useTheme()
  const [row, setRow] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const propertyId = property?.id || null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (companyId) {
        const r = await ensureRraRow(companyId, propertyId)
        setRow(r)
        if (!propertyId) setRows(await fetchRraCompliance(companyId))
      }
    } catch (e) {
      showAppToast(e.message || 'Could not load compliance', 'error')
    } finally {
      setLoading(false)
    }
  }, [companyId, propertyId])

  useEffect(() => { load() }, [load])

  const toggle = async (item) => {
    if (!row) return
    const nextVal = !row[item.field]
    setSaving(item.field)
    try {
      const patch = { [item.field]: nextVal }
      if (item.dateField) patch[item.dateField] = nextVal ? new Date().toISOString().slice(0, 10) : null
      const updated = await updateRraCompliance(row.id, patch)
      setRow(updated)
    } catch (e) {
      showAppToast(e.message || 'Could not save', 'error')
    } finally {
      setSaving(null)
    }
  }

  const saveRef = async (item, value) => {
    if (!row || !item.ref) return
    try {
      const updated = await updateRraCompliance(row.id, { [item.ref]: value })
      setRow(updated)
    } catch (e) {
      showAppToast(e.message || 'Could not save reference', 'error')
    }
  }

  if (loading) return <div style={{ color: T.muted, padding: 16 }}>Loading…</div>
  if (!companyId) return <div style={{ color: T.muted, padding: 16 }}>Select a company to track Renters Rights Act compliance.</div>

  const done = RRA_CHECKLIST.filter((i) => row?.[i.field]).length

  return (
    <div style={{ padding: 4 }}>
      <Banner T={T} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontFamily: "'DM Mono', monospace" }}>
          Compliance checklist {property ? `· ${property.name || property.address}` : '· portfolio'}
        </h3>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: done === RRA_CHECKLIST.length ? T.green : T.gold }}>
          {done}/{RRA_CHECKLIST.length} complete
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        {RRA_CHECKLIST.map((item) => (
          <div key={item.key} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14 }}>{item.label}</span>
              <Toggle T={T} on={!!row?.[item.field]} disabled={saving === item.field} onClick={() => toggle(item)} />
            </div>
            {item.ref && row?.[item.field] && (
              <input className="card" defaultValue={row[item.ref] || ''} placeholder="Reference / registration number"
                onBlur={(e) => saveRef(item, e.target.value)}
                style={{ width: '100%', marginTop: 8, padding: 6, fontFamily: "'DM Mono', monospace", fontSize: 12 }} />
            )}
            {item.dateField && row?.[item.field] && row[item.dateField] && (
              <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>
                Converted {fmtDate(row[item.dateField])}
              </div>
            )}
          </div>
        ))}
      </div>

      {property && (
        <>
          <h3 style={{ fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>Awaab's-Law repair timers</h3>
          <div style={{ marginBottom: 20 }}>
            <RepairTimers T={T} propertyId={propertyId} />
          </div>

          <button type="button" className="btn-gold" onClick={() => setNoticeOpen(true)}>
            Draft a notice / letter
          </button>
        </>
      )}

      {!property && rows.length > 1 && (
        <div style={{ fontSize: 12, color: T.muted }}>
          {rows.length} tracker rows across this portfolio. Open a property to see its repair timers and draft notices.
        </div>
      )}

      {noticeOpen && property && (
        <NoticeModal T={T} property={property} tenantName="" onClose={() => setNoticeOpen(false)} />
      )}
    </div>
  )
}

export default RentersRightsCopilot
