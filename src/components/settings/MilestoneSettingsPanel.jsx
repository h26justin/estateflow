import { useState } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import * as api from '../../lib/api'

// ── MASTER MILESTONE SETTINGS PANEL ──────────────────────────────────────────
export function MilestoneSettingsPanel({ user, config, onChange, showToast, T }) {
  const mono = MONO
  const [saving, setSaving] = useState(false)

  // Get all milestone definitions from api (imported at top)
  const ALL_MILESTONES = [
    ...api.DEFAULT_MILESTONES_STANDARD,
    ...api.DEFAULT_MILESTONES_AUCTION.filter(m => !api.DEFAULT_MILESTONES_STANDARD.find(s => s.key === m.key)),
    ...api.DEFAULT_MILESTONES_BRRR,
  ]

  const STAGE_LABELS = {
    offer: 'Offer Stage',
    professionals: 'Instructing Professionals',
    legal: 'Legal Due Diligence',
    exchange: 'Exchange',
    completion: 'Completion & Post-Completion',
    pre_auction: 'Pre-Auction',
    auction_day: 'Auction Day',
    brrr: 'BRRR — Refinance',
  }

  const stages = [...new Set(ALL_MILESTONES.map(m => m.stage))]

  async function toggle(key, currentEnabled) {
    const next = { ...config, [key]: !currentEnabled }
    onChange(next)
    setSaving(true)
    try {
      await api.saveMilestoneDefaults(user?.id, user?.email, next)
      showToast('Default updated — applies to new deals')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  async function resetAll(on) {
    const next = {}
    ALL_MILESTONES.forEach(m => { next[m.key] = on })
    onChange(next)
    setSaving(true)
    try {
      await api.saveMilestoneDefaults(user?.id, user?.email, next)
      showToast(on ? 'All steps enabled by default' : 'All steps disabled by default')
    } catch(e) { showToast(e.message, 'error') }
    setSaving(false)
  }

  return (
    <div>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Master deal milestone defaults</div>
        <div style={{ fontFamily: SANS, fontSize: FS.base, color: T.text, marginBottom: 16, lineHeight: 1.7 }}>
          Configure which steps appear by default when you create a new deal. You can still toggle individual steps on or off inside each deal — these are just the starting defaults.
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
          <button className="btn btn-ghost" style={{ fontSize: FS.sm }} onClick={() => resetAll(true)} disabled={saving}>
            Enable all
          </button>
          <button className="btn btn-ghost" style={{ fontSize: FS.sm }} onClick={() => resetAll(false)} disabled={saving}>
            Disable all
          </button>
          {saving && <span style={{ fontFamily: mono, fontSize: 11, color: T.muted, display: 'flex', alignItems: 'center' }}>Saving…</span>}
        </div>
      </div>

      {stages.map(stage => {
        const stageMilestones = ALL_MILESTONES.filter(m => m.stage === stage)
        return (
          <div key={stage} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 20px', background: T.bg, borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontFamily: mono, fontSize: FS.xs, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {STAGE_LABELS[stage] || stage}
              </span>
            </div>
            {stageMilestones.map(m => {
              const enabled = config[m.key] !== false // default true
              return (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${T.border}`, opacity: enabled ? 1 : 0.5 }}>
                  <button role="switch" aria-checked={enabled} onClick={() => toggle(m.key, enabled)}
                    style={{ border:'none', padding:0, width: 36, height: 20, borderRadius: 10, background: enabled ? T.blue : T.border, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 2, left: enabled ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: 'white', transition: 'left 0.2s' }}/>
                  </button>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: SANS, fontSize: FS.sm, color: T.text }}>{m.label}</span>
                    {m.required && (
                      <span style={{ fontFamily: mono, fontSize: FS.xs, color: T.goldText, marginLeft: 8 }}>recommended</span>
                    )}
                  </div>
                  <span style={{ fontFamily: SANS, fontSize: FS.sm, color: enabled ? T.blue : T.muted }}>
                    {enabled ? 'Default ON' : 'Default OFF'}
                  </span>
                </div>
              )
            })}
          </div>
        )
      })}

      <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, marginTop: 12, lineHeight: 1.6 }}>
        Changes apply to new deals only. Existing deals keep their current step configuration.
      </div>
    </div>
  )
}
