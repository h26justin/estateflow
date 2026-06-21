// AI Maintenance Triage button + result card.
//
// Drops into a maintenance job view. Shows an "AI triage" button; on click it
// calls the maintenance-triage edge function (via triageJob) and renders the
// returned DRAFT assessment — severity, suggested trade, diagnosis, a copyable
// contractor brief, and a suggested priority. Everything is advisory: the
// landlord decides whether to apply it. Optionally calls onApplyPriority so a
// parent can update the job's real priority on the landlord's say-so.
//
// Props:
//   job             the maintenance_jobs row (uses id, ai_triage, ai_triaged_at)
//   canTriage       whether the current user may run/re-run triage (write access)
//   onTriaged       optional (triage, ai_triaged_at) => void after a fresh run
//   onApplyPriority optional (priority) => void to apply the suggested priority
//   showToast       (msg, type?) => void

import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { triageJob } from '../../lib/api/maintenanceTriage'

const SEVERITY_LABEL = { emergency: 'EMERGENCY', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }
const TRADE_LABEL = {
  plumber: 'Plumber', electrician: 'Electrician', gas_engineer: 'Gas engineer',
  roofer: 'Roofer', builder: 'Builder', decorator: 'Decorator',
  damp_specialist: 'Damp specialist', glazier: 'Glazier', locksmith: 'Locksmith',
  handyman: 'Handyman', appliance_engineer: 'Appliance engineer',
  pest_control: 'Pest control', drainage: 'Drainage', other: 'General trade',
}

const mono = "'DM Mono',monospace"

export default function TriageButton({ job, canTriage = true, onTriaged, onApplyPriority, showToast }) {
  const { T } = useTheme()
  const [loading, setLoading] = useState(false)
  const [triage, setTriage] = useState(job?.ai_triage || null)
  const [triagedAt, setTriagedAt] = useState(job?.ai_triaged_at || null)

  function sevColor(sev) {
    if (sev === 'emergency') return '#FF0000'
    if (sev === 'high') return T.red
    if (sev === 'medium') return T.amber
    return T.muted
  }

  async function run() {
    setLoading(true)
    try {
      const res = await triageJob(job.id)
      setTriage(res.triage)
      setTriagedAt(res.ai_triaged_at)
      onTriaged?.(res.triage, res.ai_triaged_at)
      showToast?.('AI triage complete — review the draft below')
    } catch (e) {
      showToast?.(e.message || 'Triage failed', 'error')
    }
    setLoading(false)
  }

  function copyBrief() {
    if (!triage?.contractor_brief) return
    try {
      navigator.clipboard?.writeText(triage.contractor_brief)
      showToast?.('Contractor brief copied')
    } catch {
      showToast?.('Could not copy', 'error')
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {canTriage && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11 }}
            disabled={loading}
            onClick={run}
          >
            {loading ? 'Analysing…' : triage ? '↻ Re-run AI triage' : 'AI triage'}
          </button>
        )}
        {triagedAt && (
          <span style={{ fontFamily: mono, fontSize: 9, color: T.faint }}>
            Triaged {new Date(triagedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
      </div>

      {triage && (
        <div className="card" style={{ padding: '12px 14px', marginTop: 8, borderLeft: `3px solid ${sevColor(triage.severity)}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: sevColor(triage.severity), letterSpacing: '0.08em' }}>
              {SEVERITY_LABEL[triage.severity] || triage.severity?.toUpperCase()}
            </span>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>·</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.gold }}>
              {TRADE_LABEL[triage.suggested_trade] || triage.suggested_trade}
            </span>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>·</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'capitalize' }}>
              {triage.confidence} confidence
            </span>
            {typeof triage.photos_analysed === 'number' && triage.photos_analysed > 0 && (
              <span style={{ fontFamily: mono, fontSize: 9, color: T.faint }}>
                · {triage.photos_analysed} photo{triage.photos_analysed === 1 ? '' : 's'} read
              </span>
            )}
          </div>

          {triage.diagnosis && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.text, lineHeight: 1.5, marginBottom: 10 }}>
              {triage.diagnosis}
            </div>
          )}

          {triage.contractor_brief && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Contractor brief
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.5, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                {triage.contractor_brief}
              </div>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 10, marginTop: 6 }}
                onClick={copyBrief}
              >
                Copy brief
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.muted }}>
              Suggested priority: <strong style={{ color: sevColor(triage.severity), textTransform: 'capitalize' }}>{triage.suggested_priority}</strong>
            </span>
            {onApplyPriority && triage.suggested_priority && triage.suggested_priority !== job?.priority && (
              <button
                className="btn btn-gold"
                style={{ fontSize: 10 }}
                onClick={() => onApplyPriority(triage.suggested_priority)}
              >
                Apply priority
              </button>
            )}
          </div>

          <div style={{ fontFamily: mono, fontSize: 9, color: T.faint, fontStyle: 'italic' }}>
            {triage.disclaimer || 'AI-generated triage — review before acting.'}
          </div>
        </div>
      )}
    </div>
  )
}
