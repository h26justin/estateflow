import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import * as api from '../lib/api'
import { showAppToast } from '../lib/toast'

// Dashboard widget for #6: AI-generated portfolio insights.
// Reads the latest stored insights row on mount; provides a "Regenerate"
// button that calls the edge function and refreshes. Rate limiting is
// enforced server-side (one per 30 min per user).

const SEVERITY_COLOR = {
  critical:    { bg: '#FEF2F2', border: '#FECACA', fg: '#B91C1C', dark: '#2B1010' },
  warning:     { bg: '#FFF8E1', border: '#F2D17A', fg: '#8A6A00', dark: '#2B1A0A' },
  opportunity: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#15803D', dark: '#0D2B1F' },
  info:        { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', dark: '#0A1A2B' },
}

const CATEGORY_ICON = {
  yield:       '📈',
  rent:        '💰',
  compliance:  '📋',
  expenses:    '💸',
  arrears:     '⚠',
  opportunity: '✨',
  risk:        '⚠',
}

function timeAgo(iso) {
  if (!iso) return ''
  const sec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60)      return `${sec}s ago`
  if (sec < 3600)    return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400)   return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} days ago`
}

// Props:
//   companyId   — UUID or null. When set, insights are scoped to that
//                 single company. Filter pill changes upstream cause an
//                 automatic re-fetch (via useEffect dependency).
//   companyName — display only, used in the header so the user knows
//                 which company the insights describe.
export default function PortfolioInsightsWidget({ companyId = null, companyName = null }) {
  const { T, darkMode } = useTheme()
  const [row, setRow]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.fetchLatestPortfolioInsights(companyId)
      setRow(r)
    } catch(e) { /* non-fatal — show empty state */ }
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function regenerate() {
    setBusy(true)
    try {
      const r = await api.regeneratePortfolioInsights(companyId)
      setRow(r)
      showAppToast(companyName ? `Insights refreshed for ${companyName}` : 'Insights refreshed')
    } catch(e) {
      showAppToast(e.message || 'Could not refresh insights', 'error')
    }
    setBusy(false)
  }

  function handleAction(link) {
    if (!link) return
    if (link.startsWith('#')) window.location.hash = link.slice(1)
    else window.location.href = link
  }

  return (
    <div style={{ marginTop: 28, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span aria-hidden="true">✨</span> Portfolio Insights
            <span style={{
              fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              padding: '2px 7px', borderRadius: 10,
              background: T.gold + '22', color: T.gold, border: `1px solid ${T.gold}44`,
            }}>AI</span>
            {companyName && (
              <span style={{
                fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                padding: '2px 8px', borderRadius: 10,
                background: T.muted + '22', color: T.muted,
              }}>· {companyName}</span>
            )}
          </h2>
          {row?.generated_at && (
            <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 4 }}>
              Generated {timeAgo(row.generated_at)} · refreshes available every 30 min
            </div>
          )}
        </div>
        <button onClick={regenerate} disabled={busy}
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '6px 14px', opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Analysing…' : row ? '↻ Refresh' : 'Generate insights'}
        </button>
      </div>

      {loading && !row ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 22px', fontFamily: MONO, fontSize: 12, color: T.muted, textAlign: 'center' }}>
          Loading insights…
        </div>
      ) : !row ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 10, opacity: 0.6 }} aria-hidden="true">✨</div>
          <div style={{ fontSize: 14, color: T.text, fontWeight: 600, marginBottom: 4 }}>No insights yet</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 14, lineHeight: 1.6, maxWidth: 360, margin: '0 auto 14px' }}>
            Click below and Claude will scan your portfolio for opportunities — under-rented properties, expiring certs, high LTVs, things worth your attention.
          </div>
          <button className="btn btn-gold" onClick={regenerate} disabled={busy}
            style={{ fontSize: 12, padding: '8px 18px' }}>
            {busy ? 'Analysing…' : 'Generate insights'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {(row.insights || []).map((it, i) => {
            const palette = SEVERITY_COLOR[it.severity] || SEVERITY_COLOR.info
            const cardBg = darkMode ? palette.dark : palette.bg
            return (
              <div key={i} style={{
                background: cardBg,
                border: `1px solid ${palette.border}55`,
                borderLeft: `3px solid ${palette.fg}`,
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14 }} aria-hidden="true">{CATEGORY_ICON[it.category] || '•'}</span>
                  <span style={{
                    fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: palette.fg,
                  }}>{it.severity}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.35 }}>
                  {it.title}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
                  {it.body}
                </div>
                {it.action_label && (
                  <button onClick={() => handleAction(it.action_link)}
                    style={{
                      alignSelf: 'flex-start', marginTop: 4,
                      background: 'transparent', border: `1px solid ${palette.fg}66`,
                      color: palette.fg, fontFamily: MONO, fontSize: 10, fontWeight: 600,
                      padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                    }}>
                    {it.action_label} →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
