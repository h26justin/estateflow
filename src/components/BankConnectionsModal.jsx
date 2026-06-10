import { useState, useEffect } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'
import { openPlaidLink } from '../lib/plaidLink'
import FocusTrap from '../lib/FocusTrap'

// Open Banking — live integration via Plaid UK.
//
// Two modes, decided on mount:
//   - "live"     — `listBankInstitutions` succeeded → show a "Connect"
//                  button that opens the Plaid Link widget (in-page,
//                  no redirect). User picks their bank inside the widget.
//   - "interest" — `listBankInstitutions` returned 503 (PLAID_CLIENT_ID
//                  + PLAID_SECRET not yet set on the edge function) →
//                  fall back to the "register interest" form so we still
//                  capture demand while Justin completes Plaid signup.

const STATUS_LABEL = {
  requested:   'Saved · waiting for our Open Banking partner to launch',
  pending:     'Authorisation in progress — finish at your bank',
  active:      'Connected · syncing',
  expired:     'Re-authorise to keep syncing (PSD2 · 90 days)',
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

  const [rows, setRows]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [mode, setMode]                 = useState('loading') // loading | live | interest
  const [interestBank, setInterestBank] = useState('')
  const [busy, setBusy]                 = useState(false)
  const [connecting, setConnecting]     = useState(false)
  const [syncing, setSyncing]           = useState(false)

  useEffect(() => {
    let cancelled = false
    api.fetchBankConnections().then(r => { if (!cancelled) { setRows(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })

    // listBankInstitutions is now a no-op success when creds are set
    // (TrueLayer hosts its own picker). 503 still means "creds missing"
    // → fall back to interest form.
    api.listBankInstitutions().then(() => {
      if (cancelled) return
      setMode('live')
    }).catch(err => {
      if (cancelled) return
      console.warn('Bank Feeds live mode unavailable:', err?.message)
      setMode('interest')
    })
    return () => { cancelled = true }
  }, [])

  async function startConnect() {
    setConnecting(true)
    try {
      // 1. Ask backend for a short-lived link_token
      const { link_token } = await api.createPlaidLinkToken()
      if (!link_token) throw new Error('No link_token returned')

      // 2. Open Plaid Link widget in-page (lazy-loads Plaid Link.js)
      await openPlaidLink({
        linkToken: link_token,
        onSuccess: async ({ publicToken, metadata }) => {
          try {
            await api.exchangePlaidPublicToken(
              publicToken,
              metadata?.institution?.institution_id || null,
              metadata?.institution?.name || null
            )
            showAppToast('Bank connected ✓ — syncing transactions now')
            const fresh = await api.fetchBankConnections()
            setRows(fresh)
            // Kick off an immediate sync so the user sees data right away
            api.syncBankTransactions().catch(() => {})
          } catch (e) {
            showAppToast(e.message || 'Connection exchange failed', 'error')
          } finally {
            setConnecting(false)
          }
        },
        onExit: ({ err }) => {
          setConnecting(false)
          if (err) showAppToast(err.display_message || err.error_message || 'Bank connection cancelled', 'error')
        },
      })
    } catch (e) {
      setConnecting(false)
      showAppToast(e.message || 'Could not start bank connection', 'error')
    }
  }

  async function registerInterest() {
    setBusy(true)
    try {
      const row = await api.registerBankInterest('pending-partner', interestBank.trim() || null)
      setRows(prev => [row, ...prev])
      setInterestBank('')
      showAppToast("Interest registered. We'll email you when Open Banking goes live.")
    } catch (e) {
      showAppToast(e.message || 'Could not save your request', 'error')
    }
    setBusy(false)
  }

  async function remove(id) {
    try {
      await api.deleteBankConnection(id)
      setRows(prev => prev.filter(r => r.id !== id))
    } catch (e) { showAppToast(e.message || 'Could not delete', 'error') }
  }

  async function manualSync() {
    setSyncing(true)
    try {
      const res = await api.syncBankTransactions()
      showAppToast(`Synced ${res?.inserted || 0} transactions (${res?.matched || 0} auto-matched)`)
      const fresh = await api.fetchBankConnections()
      setRows(fresh)
    } catch (e) {
      showAppToast(e.message || 'Sync failed', 'error')
    }
    setSyncing(false)
  }

  const hasActive = rows.some(r => r.status === 'active')

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <FocusTrap onEscape={onClose}>
      <div className="modal" style={{ maxWidth: 680 }} role="dialog" aria-modal="true" aria-labelledby="bank-connections-title">
        <div style={{ padding: '22px 26px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 id="bank-connections-title" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T.text }}>
              Bank Connections
            </h2>
            <p style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginTop: 4 }}>
              Connect your bank · we'll match rent payments automatically.
            </p>
          </div>
          <span style={{
            fontFamily: mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            padding: '4px 9px', borderRadius: 12,
            background: T.amber + '22', color: T.amber, border: `1px solid ${T.amber}44`,
            flexShrink: 0,
          }}>{mode === 'live' ? 'BETA' : 'EARLY ACCESS'}</span>
        </div>

        <div style={{ padding: '14px 26px 22px' }}>

          {mode === 'loading' && (
            <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: '20px 0' }}>
              Checking availability…
            </div>
          )}

          {mode === 'interest' && (
            <>
              <div style={{
                background: T.amber + '11', border: `1px solid ${T.amber}44`,
                borderRadius: 10, padding: '12px 14px', marginBottom: 16,
                fontFamily: mono, fontSize: 11, color: T.text, lineHeight: 1.65,
              }}>
                <strong>Coming soon.</strong> We're finalising a UK Open
                Banking integration. Once live, connecting your bank means
                rent payments appear in OwnProperly within hours of hitting
                your account — no more chasing PDF statements. Register
                your interest below and we'll prioritise launching for your bank.
              </div>

              <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Which bank do you use? (Optional)
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={interestBank} onChange={e => setInterestBank(e.target.value)}
                    placeholder="e.g. Barclays, Lloyds, Starling, Monzo…"
                    style={{
                      flex: 1, fontFamily: mono, fontSize: 13,
                      background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                      borderRadius: 8, padding: '10px 12px', outline: 'none',
                    }}/>
                  <button onClick={registerInterest} disabled={busy}
                    className="btn btn-gold" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {busy ? 'Saving…' : 'Register interest'}
                  </button>
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 6 }}>
                  We'll never charge extra for Open Banking — it's included in your plan.
                </div>
              </div>
            </>
          )}

          {mode === 'live' && (
            <>
              <div style={{
                background: T.green + '11', border: `1px solid ${T.green}44`,
                borderRadius: 10, padding: '12px 14px', marginBottom: 16,
                fontFamily: mono, fontSize: 11, color: T.text, lineHeight: 1.65,
              }}>
                <strong>Open Banking</strong> — FCA-regulated, read-only access.
                PSD2 consent renews every 90 days. We never see or store your
                bank login; we only see transactions you explicitly authorise.
              </div>

              {hasActive && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button onClick={manualSync} disabled={syncing}
                    className="btn btn-ghost" style={{ fontSize: 11 }}>
                    {syncing ? 'Syncing…' : '↻ Sync now'}
                  </button>
                </div>
              )}

              {/* Single CTA — TrueLayer hosts the bank-picker step. The
                  user clicks here, gets redirected to TrueLayer's page,
                  picks their bank, signs in, consents, and comes back to
                  ?bank_callback=1&code=…&state=… which App.jsx finalises. */}
              <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Add a connection
                </div>
                <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 12, lineHeight: 1.65 }}>
                  We'll redirect you to our Open Banking partner to pick your
                  bank and sign in. Takes about 30 seconds. You stay on your
                  bank's official login screen — we never see your credentials.
                </div>
                <button onClick={startConnect} disabled={connecting}
                  className="btn btn-gold" style={{ fontSize: 13, padding: '10px 22px', width: '100%' }}>
                  {connecting ? 'Redirecting…' : '🏦 Connect a bank account →'}
                </button>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 10, textAlign: 'center' }}>
                  Supported: Barclays · HSBC · Lloyds · NatWest · Santander · Monzo · Starling · Revolut · and 30+ more
                </div>
              </div>

            </>
          )}

          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Your connections
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
                    {r.last_synced_at && (
                      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 4 }}>
                        Last synced {new Date(r.last_synced_at).toLocaleString('en-GB')}
                      </div>
                    )}
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
      </FocusTrap>
    </div>
  )
}
