import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../lib/icons'
import { useConfirm } from '../lib/ConfirmContext'
import { showAppToast } from '../lib/toast'
import FocusTrap from '../lib/FocusTrap'
import { safeOverlayClose } from '../lib/modalUtils'
import {
  listAutopilotActions,
  actOnAutopilotAction,
  dismissAutopilotAction,
} from '../lib/api/autopilot'

const KIND_META = {
  arrears:         { icon: 'pound', label: 'Arrears' },
  compliance:      { icon: 'shield-check', label: 'Compliance' },
  tenancy_renewal: { icon: 'calendar', label: 'Tenancy renewal' },
  mortgage:        { icon: 'landmark', label: 'Mortgage' },
}

const SEVERITY_ORDER = ['high', 'medium', 'low']

function fmtDueDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── DASHBOARD WIDGET ─────────────────────────────────────────────────────────
// Compact card for the dashboard. Shows the open-action count and the top few
// items; "Review all" opens the full panel.
export function AutopilotWidget({ companyId = null, onOpenFull }) {
  const { T } = useTheme()
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    listAutopilotActions({ status: 'open', companyId, limit: 50 })
      .then((rows) => { if (alive) setActions(rows) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [companyId])

  const highCount = actions.filter(a => a.severity === 'high').length
  const top = actions.slice(0, 4)

  return (
    <div className="card" style={{ padding: 18, marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
          Portfolio Autopilot
          {actions.length > 0 && (
            <span style={{ background: highCount > 0 ? T.red : T.amber, color: 'white', borderRadius: 20, fontSize: 11, fontFamily: "'DM Mono',monospace", padding: '2px 8px', fontWeight: 700 }}>
              {actions.length}
            </span>
          )}
        </h2>
        {actions.length > 0 && (
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onOpenFull}>Review all →</button>
        )}
      </div>

      {loading ? (
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: T.muted, padding: 12 }}>Loading…</div>
      ) : actions.length === 0 ? (
        <div style={{ fontFamily: "'DM Mono',monospace", color: T.green, fontSize: 12, padding: 16 }}>
          No actions awaiting review
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            {top.map(a => {
              const meta = KIND_META[a.kind] || { icon: '•', label: a.kind }
              const col = a.severity === 'high' ? T.red : a.severity === 'medium' ? T.amber : T.muted
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderLeft: `3px solid ${col}`, background: T.bg, borderRadius: 8 }}>
                  <span style={{ display:'inline-flex', color:T.muted }}>{ICON_NAMES.includes(meta.icon)?<Icon name={meta.icon} size={14}/>:meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 10, fontFamily: "'DM Mono',monospace", fontSize: 10, color: T.muted }}>
            AI-drafted suggestions — review before acting. Nothing is sent automatically.
          </div>
        </>
      )}
    </div>
  )
}

// ── FULL LIST VIEW ───────────────────────────────────────────────────────────
// Actions grouped by severity, each with approve / dismiss and the drafted body.
export function AutopilotPage({ companyId = null }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [viewing, setViewing] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    listAutopilotActions({ status: 'open', companyId, limit: 300 })
      .then(setActions)
      .catch(() => showAppToast('Could not load Autopilot actions', 'error'))
      .finally(() => setLoading(false))
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function handleAct(a) {
    setBusyId(a.id)
    try {
      await actOnAutopilotAction(a.id)
      setActions(prev => prev.filter(x => x.id !== a.id))
      setViewing(null)
      showAppToast('Marked as actioned', 'success')
    } catch (e) {
      showAppToast(e.message || 'Could not update action', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDismiss(a) {
    const ok = await confirmDialog({ title: 'Dismiss this suggestion?', body: 'It will be removed from your review list.', confirmLabel: 'Dismiss' })
    if (!ok) return
    setBusyId(a.id)
    try {
      await dismissAutopilotAction(a.id)
      setActions(prev => prev.filter(x => x.id !== a.id))
      setViewing(null)
      showAppToast('Dismissed', 'info')
    } catch (e) {
      showAppToast(e.message || 'Could not dismiss', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const grouped = SEVERITY_ORDER.map(sev => ({
    sev,
    items: actions.filter(a => a.severity === sev),
  })).filter(g => g.items.length > 0)

  const sevColor = (sev) => sev === 'high' ? T.red : sev === 'medium' ? T.amber : T.muted
  const sevLabel = (sev) => sev === 'high' ? 'High priority' : sev === 'medium' ? 'Medium priority' : 'Low priority'

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
          Portfolio Autopilot
        </h1>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={load}>↻ Refresh</button>
      </div>
      <p style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: T.muted, marginBottom: 24 }}>
        Daily AI-drafted action list. Every item is a suggestion for you to review — approving an item never sends or books anything automatically.
      </p>

      {loading ? (
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: T.muted, padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : actions.length === 0 ? (
        <div className="card" style={{ fontFamily: "'DM Mono',monospace", color: T.green, fontSize: 13, textAlign: 'center', padding: 48 }}>
          Nothing needs your attention — Autopilot found no open actions.
        </div>
      ) : (
        grouped.map(group => (
          <div key={group.sev} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: sevColor(group.sev) }} />
              <h2 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: "'DM Mono',monospace" }}>
                {sevLabel(group.sev)} <span style={{ color: T.muted }}>({group.items.length})</span>
              </h2>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {group.items.map(a => {
                const meta = KIND_META[a.kind] || { icon: '•', label: a.kind }
                const due = fmtDueDate(a.due_date)
                return (
                  <div key={a.id} className="card" style={{ padding: 16, borderLeft: `3px solid ${sevColor(group.sev)}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <span style={{ display:'inline-flex', color:T.muted }}>{ICON_NAMES.includes(meta.icon)?<Icon name={meta.icon} size={18}/>:meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: T.muted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span>{meta.label}</span>
                          {a.property?.name && <span>· {a.property.name}</span>}
                          {due && <span>· due {due}</span>}
                        </div>
                        {a.draft_body && (
                          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: T.text, background: T.bg, borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap' }}>
                            {a.draft_body}
                          </div>
                        )}
                        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            className="btn-gold"
                            style={{ fontSize: 12 }}
                            disabled={busyId === a.id}
                            onClick={() => handleAct(a)}
                          >
                            Mark actioned
                          </button>
                          {a.draft_body && (
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 12 }}
                              disabled={busyId === a.id}
                              onClick={() => setViewing(a)}
                            >
                              Copy draft
                            </button>
                          )}
                          <button
                            className="btn-ghost"
                            style={{ fontSize: 12, color: T.muted }}
                            disabled={busyId === a.id}
                            onClick={() => handleDismiss(a)}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {viewing && <DraftModal action={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

// Small modal that surfaces the full drafted text with a copy button. Read-only
// — the landlord copies it into their own email/letter tool to send manually.
function DraftModal({ action, onClose }) {
  const { T } = useTheme()
  const [copied, setCopied] = useState(false)
  const initialRef = useRef(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(action.draft_body || '')
      setCopied(true)
      showAppToast('Draft copied to clipboard', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {
      showAppToast('Could not copy — select and copy manually', 'error')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Drafted action"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) safeOverlayClose(false, onClose) }}
    >
      <FocusTrap onEscape={onClose} initialFocusRef={initialRef}>
        <div className="card" style={{ maxWidth: 540, width: '100%', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{action.title}</h3>
            <button ref={initialRef} className="btn-ghost" aria-label="Close" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: T.bg, borderRadius: 8, padding: 16, marginBottom: 16, color: T.text }}>
            {action.draft_body}
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: T.muted, marginBottom: 16 }}>
            AI-generated draft. Review and edit before sending — OwnProperly does not send this for you.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Close</button>
            <button className="btn-gold" onClick={copy} style={{ fontSize: 13 }}>{copied ? 'Copied' : 'Copy draft'}</button>
          </div>
        </div>
      </FocusTrap>
    </div>
  )
}

export default AutopilotPage
