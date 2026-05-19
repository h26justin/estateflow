import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

// Open Banking — shell modal.
//
// PRE-PARTNERSHIP. We're in the "register interest" stage until we sign
// with a partner referencing provider (TrueLayer / Plaid / GoCardless
// Bank Account Data). When that lands, the "Connect a bank" button will
// kick off an OAuth redirect to the partner; today it just records that
// the user wants the feature and shows the matching rough timeline.
//
// Component scoped to Rent Tracker but works elsewhere — just pass
// onClose. No prop dependencies on anything except useTheme + api.

const STATUS_LABEL = {
  requested:   'Saved · waiting for our Open Banking partner to launch',
  pending:     'OAuth in progress',
  active:      'Connected · syncing',
  expired:     'Re-authorise to keep syncing',
  revoked:     'Connection removed',
}
const STATUS_COLOR = {
  requested:   '#888EA8',
  pending:     '#E0943A',
  active:      '#2ECC8A',
  expired:     '#E0943A',
  revoked:     '#888EA8',
}

export default function BankConnectionsModal({ onClose }) {
  const { T } = useTheme()
  const mono = MONO
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [bank, setBank]       = useState('')

  useEffect(() => {
    api.fetchBankConnections().then(r => { setRows(r); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function register() {
    setBusy(true)
    try {
      const row = await api.registerBankInterest('pending-partner', bank.trim() || null)
      setRows(prev => [row, ...prev])
      setBank('')
      showAppToast("Interest registered. We'll email you when Open Banking goes live.")
    } catch(e) {
      showAppToast(e.message || 'Could not save your request', 'error')
    }
    setBusy(false)
  }

  async function remove(id) {
    try {
      await api.deleteBankConnection(id)
      setRows(prev => prev.filter(r => r.id !== id))
    } catch(e) { showAppToast(e.message || 'Could not delete', 'error') }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div style={{ padding: '22px 26px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
              Bank Connections
            </h2>
            <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
              Automatically match incoming rent payments to your tenancies — no statement imports.
            </p>
          </div>
          <span style={{
            fontFamily: mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            padding: '4px 9px', borderRadius: 12,
            background: T.amber + '22', color: T.amber, border: `1px solid ${T.amber}44`,
            flexShrink: 0,
          }}>EARLY ACCESS</span>
        </div>

        <div style={{ padding: '14px 26px 22px' }}>
          {/* Pre-launch note */}
          <div style={{
            background: T.amber + '11', border: `1px solid ${T.amber}44`,
            borderRadius: 10, padding: '12px 14px', marginBottom: 16,
            fontFamily: mono, fontSize: 11, color: T.text, lineHeight: 1.65,
          }}>
            <strong>Coming soon.</strong> We're finalising a UK Open Banking
            integration. Once live, connecting your bank means rent
            payments appear in OwnProperly within hours of hitting your
            account — no more chasing PDF statements. Register your
            interest below and we'll prioritise launching for your bank.
          </div>

          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Which bank do you use? (Optional)
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={bank} onChange={e => setBank(e.target.value)}
                placeholder="e.g. Barclays, Lloyds, Starling, Monzo…"
                style={{
                  flex: 1, fontFamily: mono, fontSize: 13,
                  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                  borderRadius: 8, padding: '10px 12px', outline: 'none',
                }}/>
              <button onClick={register} disabled={busy}
                className="btn btn-gold" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {busy ? 'Saving…' : 'Register interest'}
              </button>
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>
              We'll never charge for Open Banking. When it launches you'll keep paying just £2/property.
            </div>
          </div>

          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Your requests
          </div>
          {loading ? (
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 16px', textAlign: 'center', fontFamily: mono, fontSize: 12, color: T.muted }}>
              No bank connections yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {rows.map(r => (
                <div key={r.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>
                      {r.institution_name || 'Bank not specified'}
                    </div>
                    <span style={{
                      fontFamily: mono, fontSize: 10, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 10,
                      background: (STATUS_COLOR[r.status] || T.muted) + '22',
                      color: STATUS_COLOR[r.status] || T.muted,
                    }}>{STATUS_LABEL[r.status] || r.status}</span>
                  </div>
                  <button onClick={() => remove(r.id)}
                    aria-label="Remove"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.faint, fontSize: 14, padding: 4 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 18px' }}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
