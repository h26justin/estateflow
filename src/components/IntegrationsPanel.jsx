import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { showAppToast } from '../lib/toast'

// ── INTEGRATIONS SETTINGS PANEL ──────────────────────────────────────
// Shown under Settings → Portfolio Setup → Integrations.
// Currently surfaces Xero (two-way sync). Future home for Plaid Open
// Banking re-enablement once we switch providers.

export default function IntegrationsPanel({ T, mono }) {
  const [xero, setXero] = useState(null)
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [conn, history] = await Promise.all([
        api.fetchXeroConnection(),
        api.fetchXeroSyncLog(10),
      ])
      setXero(conn)
      setLog(history)
    } catch (e) {
      console.error('Integrations load failed', e)
    }
    setLoading(false)
  }

  async function connectXero() {
    setBusy('connect')
    try {
      await api.startXeroOAuth()
      // redirects away
    } catch (e) {
      showAppToast(e.message, 'error')
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Xero? Your sync history stays for reference, but new entries will not flow until you reconnect.')) return
    setBusy('disconnect')
    try {
      await api.disconnectXero()
      showAppToast('Xero disconnected')
      load()
    } catch (e) {
      showAppToast(e.message, 'error')
    }
    setBusy(null)
  }

  async function syncNow() {
    setBusy('sync')
    try {
      const result = await api.runXeroSync('to_xero')
      const parts = [
        result.created ? `${result.created} created` : null,
        result.updated ? `${result.updated} updated` : null,
        result.failed  ? `${result.failed} failed`   : null,
      ].filter(Boolean).join(', ') || 'Nothing new to sync'
      showAppToast(`Xero sync: ${parts}`)
      load()
    } catch (e) {
      showAppToast('Sync failed: ' + e.message, 'error')
    }
    setBusy(null)
  }

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 26px', marginBottom: 16 }

  if (loading) return <div style={{ padding: 40, textAlign:'center', fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>

  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom: 6 }}>
        Integrations
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 18, lineHeight: 1.5 }}>
        Connect OwnProperly to your other tools. Sync runs are recorded so you can prove what landed and when.
      </div>

      {/* ── XERO ── */}
      <div style={card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 14, flexWrap:'wrap', gap: 10 }}>
          <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background:'#13B5EA22', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 22 }}>
              🟦
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Xero</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
                Push rent + expenses as bank transactions
              </div>
            </div>
          </div>
          {xero ? (
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding:'4px 11px', borderRadius: 20, background: T.green+'22', color: T.green }}>
              Connected
            </span>
          ) : (
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, padding:'4px 11px', borderRadius: 20, background: T.border, color: T.muted }}>
              Not connected
            </span>
          )}
        </div>

        {xero ? (
          <>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.text, marginBottom: 6 }}>
              <span style={{ color: T.muted }}>Organisation:</span> {xero.tenant_name || xero.tenant_id}
            </div>
            {xero.last_sync_at && (
              <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 14 }}>
                Last sync: {new Date(xero.last_sync_at).toLocaleString('en-GB')}
                {xero.last_sync_status === 'error' && <span style={{ color: T.red, marginLeft: 6 }}>· error: {xero.last_sync_error?.slice(0,80)}</span>}
                {xero.last_sync_status === 'partial' && <span style={{ color: T.amber, marginLeft: 6 }}>· some records failed</span>}
                {xero.last_sync_status === 'ok' && <span style={{ color: T.green, marginLeft: 6 }}>✓</span>}
              </div>
            )}
            <div style={{ display:'flex', gap: 10, flexWrap:'wrap' }}>
              <button onClick={syncNow} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
                {busy==='sync' ? 'Syncing…' : '🔄 Sync now'}
              </button>
              <button onClick={disconnect} className="btn btn-ghost" style={{ fontSize: 12 }} disabled={!!busy}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6, marginBottom: 14 }}>
              Connect your Xero account so rent payments and property expenses land as bank transactions automatically. Use tracking categories in Xero to run P&L by property.
            </div>
            <button onClick={connectXero} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
              {busy==='connect' ? 'Redirecting…' : '🔌 Connect Xero'}
            </button>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 10 }}>
              Requires a Xero account. We only request the scopes needed to read/write bank transactions, contacts and tracking categories.
            </div>
          </>
        )}
      </div>

      {/* Sync history */}
      {log.length > 0 && (
        <div style={card}>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom: 12 }}>
            Recent sync history
          </div>
          <div style={{ display:'grid', gap: 6 }}>
            {log.map(row => {
              const tone = row.status === 'ok' ? T.green : row.status === 'partial' ? T.amber : row.status === 'error' ? T.red : T.muted
              return (
                <div key={row.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background: T.bg, borderRadius: 8, fontFamily: mono, fontSize: 11 }}>
                  <div>
                    <span style={{ color: tone, fontWeight: 700, marginRight: 8 }}>●</span>
                    <span style={{ color: T.text }}>{row.direction === 'to_xero' ? '→ Xero' : '← Xero'}</span>
                    <span style={{ color: T.muted, marginLeft: 10 }}>{new Date(row.started_at).toLocaleString('en-GB')}</span>
                  </div>
                  <div style={{ color: T.muted }}>
                    {row.records_created ? <span style={{ color: T.green, marginRight: 8 }}>+{row.records_created}</span> : null}
                    {row.records_failed ? <span style={{ color: T.red }}>×{row.records_failed}</span> : null}
                    {!row.records_created && !row.records_failed && row.status === 'ok' && <span>no changes</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
