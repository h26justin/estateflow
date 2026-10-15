import { useState } from 'react'
import * as api from '../../lib/api'
import { showAppToast } from '../../lib/toast'

// ── ACCOUNT TYPE PANEL ──────────────────────────────────────────────
// Lets the user say whether they file taxes as a sole-trader (individual),
// via a limited company (SPV), or both. Used to hide MTD ITSA from the
// nav for limited-company users (they file Corp Tax instead).
export function AccountTypePanel({ T, mono, user, accountType, setAccountType }) {
  const [saving, setSaving] = useState(false)
  const options = [
    { key: 'individual',      label: 'Sole-trader / individual',  desc: 'You file Self Assessment as a person. MTD ITSA applies from Apr 2026.' },
    { key: 'limited_company', label: 'Limited company (SPV)',     desc: 'Property held in a company — you file Corporation Tax annually. MTD ITSA does NOT apply.' },
    { key: 'mixed',           label: 'Both',                       desc: 'Some properties personal, some in a company. We\'ll show everything.' },
  ]
  async function pick(key) {
    setSaving(true)
    try {
      await api.upsertUserProfile(user.id, user.email, { account_type: key })
      setAccountType(key)
      showAppToast('Saved')
    } catch (e) {
      showAppToast('Save failed: ' + e.message, 'error')
    }
    setSaving(false)
  }
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 24px', marginBottom: 16 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
        Tax setup
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 14, lineHeight: 1.5 }}>
        How do you hold your properties? Drives which features appear in your nav.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {options.map(o => {
          const active = accountType === o.key
          return (
            <button key={o.key} onClick={() => pick(o.key)} disabled={saving}
              style={{
                textAlign: 'left', padding: '12px 14px',
                background: active ? T.gold + '14' : T.bg,
                border: `1px solid ${active ? T.gold + '88' : T.border}`,
                borderRadius: 10, cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? T.goldText : T.text, marginBottom: 3 }}>
                {o.label} {active && <span style={{ fontFamily: mono, fontSize: 10, color: T.goldText, marginLeft: 4 }}>selected</span>}
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.45 }}>{o.desc}</div>
            </button>
          )
        })}
      </div>
      {!accountType && (
        <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 10 }}>
          Not picked yet — by default we show everything.
        </div>
      )}
    </div>
  )
}
