import { useEffect, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

// ── COMPANY INBOX PANEL ──────────────────────────────────────────────
// Surfaces each company's unique forwarding address for inbound rental
// statements. When the user's agent (or anyone) emails a PDF to the
// address, the ingest-statement-email edge function:
//   1. matches the token to this company
//   2. saves the PDF
//   3. fires AI extraction
//   4. drops a "New statement received" notification in the bell
// User clicks → reviews extracted rent_payments → confirms → imports.
//
// This panel is purely informational + copy-to-clipboard. The actual
// routing is server-side and per-token (set by the DB trigger on
// company insert).

const INBOX_DOMAIN = 'inbox.ownproperly.com'

export default function CompanyInboxPanel({ companies, T }) {
  const theme = T || useTheme().T
  const [tokens, setTokens]   = useState({})   // companyId → token
  const [loading, setLoading] = useState(true)
  const [busyCo, setBusyCo]   = useState(null) // companyId being rotated

  useEffect(() => {
    if (!companies?.length) { setLoading(false); return }
    Promise.all(
      companies.map(co => api.fetchCompanyInboxToken(co.id).then(token => [co.id, token]))
    ).then(pairs => {
      setTokens(Object.fromEntries(pairs))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [companies])

  async function copyAddress(addr) {
    try {
      await navigator.clipboard.writeText(addr)
      showAppToast('Address copied — paste into your agent\'s email')
    } catch {
      showAppToast('Copy failed — select the address manually', 'error')
    }
  }

  async function rotate(coId) {
    if (!confirm('Rotate the inbox address for this company? The old address will stop working immediately — any agent using it will need the new one.')) return
    setBusyCo(coId)
    try {
      const newToken = await api.rotateCompanyInboxToken(coId)
      setTokens(prev => ({ ...prev, [coId]: newToken }))
      showAppToast('Rotated. Share the new address with your agent.')
    } catch (e) { showAppToast(e.message || 'Rotation failed', 'error') }
    setBusyCo(null)
  }

  if (loading) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted, padding: 12 }}>Loading inbox addresses…</div>
  }

  return (
    <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            📨 Statement inbox
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Forward rental statements to your portfolio</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted, lineHeight: 1.65 }}>
            Each company has a unique forwarding address. When your letting agent emails a statement PDF to it, OwnProperly will scan the file, extract the rent payments, and drop a notification in your bell ready to review and import — no manual upload.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {companies.map(co => {
          const token = tokens[co.id]
          const addr = token ? `${token}@${INBOX_DOMAIN}` : null
          return (
            <div key={co.id} style={{
              background: theme.bg, border: `1px solid ${theme.border}`,
              borderRadius: 10, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                {co.abbr && (
                  <span style={{
                    fontFamily: MONO, fontSize: 10, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 4,
                    background: (co.color || theme.gold) + '22',
                    color: co.color || theme.gold,
                  }}>{co.abbr}</span>
                )}
                <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{co.name}</span>
              </div>

              {!addr ? (
                <div style={{ fontFamily: MONO, fontSize: 11, color: theme.muted }}>
                  No address allocated yet — re-save the company to provision one.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <code style={{
                    flex: '1 1 240px',
                    fontFamily: MONO, fontSize: 12, color: theme.text,
                    background: theme.surface, padding: '8px 12px',
                    borderRadius: 6, border: `1px solid ${theme.border}`,
                    userSelect: 'all', wordBreak: 'break-all',
                  }}>{addr}</code>
                  <button onClick={() => copyAddress(addr)}
                    style={{
                      fontFamily: MONO, fontSize: 11, padding: '7px 12px',
                      borderRadius: 6, border: `1px solid ${theme.gold}`,
                      background: theme.gold + '22', color: theme.gold,
                      cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap',
                    }}>
                    📋 Copy
                  </button>
                  <button onClick={() => rotate(co.id)} disabled={busyCo === co.id}
                    title="Generate a new address (the old one will stop working immediately)"
                    style={{
                      fontFamily: MONO, fontSize: 10, padding: '7px 10px',
                      borderRadius: 6, border: `1px solid ${theme.border}`,
                      background: 'transparent', color: theme.muted,
                      cursor: busyCo === co.id ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                    }}>
                    {busyCo === co.id ? '…' : '↻ Rotate'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{
        marginTop: 16, padding: '12px 14px',
        background: theme.gold + '11', border: `1px solid ${theme.gold}44`,
        borderRadius: 8, fontFamily: MONO, fontSize: 11, color: theme.text, lineHeight: 1.7,
      }}>
        <strong>How to use:</strong>
        <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li>Copy your company's address above.</li>
          <li>Forward (or set as the CC) for the monthly statement emails your letting agent sends.</li>
          <li>Within ~30 seconds you'll see a bell notification with the extracted rent payments — click to review and import.</li>
        </ol>
        <div style={{ marginTop: 8, color: theme.muted }}>
          We accept PDF and image attachments. Multiple files in one email are processed separately.
        </div>
      </div>
    </div>
  )
}
