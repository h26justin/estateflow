import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { Icon, ICON_NAMES } from '../lib/icons'
import { MONO, FS, statusColors } from '../lib/styles'
import * as api from '../lib/api'
import { showAppToast } from '../lib/toast'
import { SkeletonTiles } from '../lib/Skeleton'

// Dashboard widget for #6: AI-generated portfolio insights.
// Reads the latest stored insights row on mount; provides a "Regenerate"
// button that calls the edge function and refreshes. Rate limiting is
// enforced server-side (one per 30 min per user).

// action_link is AI-generated, so treat it as untrusted: only in-app hash
// routes ('#/properties', '#/detail/<id>/compliance') are followed. Anything
// else (absolute URLs, javascript:, protocol-relative, query strings) is
// ignored and the CTA is not shown.
const SAFE_INSIGHT_LINK = /^#\/[a-z0-9/_-]+$/
export function safeInsightLink(link) {
  return typeof link === 'string' && link.length <= 200 && SAFE_INSIGHT_LINK.test(link) ? link : null
}

// Severity → shared status palette key (styles.js STATUS, AA in both themes).
const SEVERITY_STATUS = {
  critical:    'bad',
  warning:     'warn',
  opportunity: 'ok',
  info:        'info',
}

const CATEGORY_ICON = {
  yield:       'trending-up',
  rent:        'wallet',
  compliance:  'shield-check',
  expenses:    'wallet',
  arrears:     'alert-triangle',
  opportunity: 'sparkle',
  risk:        'alert-triangle',
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
    const safe = safeInsightLink(link)
    if (safe) window.location.hash = safe.slice(1)
  }

  return (
    <div style={{ marginTop: 28, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Icon name="sparkle" size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }}/> Portfolio Insights
            <span style={{
              fontFamily: MONO, fontSize: FS.xs, fontWeight: 700, letterSpacing: '0.1em',
              padding: '2px 7px', borderRadius: 10,
              background: T.gold + '22', color: T.goldText, border: `1px solid ${T.gold}44`,
            }}>AI</span>
            {companyName && (
              <span style={{
                fontFamily: MONO, fontSize: FS.xs, fontWeight: 600, letterSpacing: '0.05em',
                padding: '2px 8px', borderRadius: 10,
                background: T.muted + '22', color: T.muted,
              }}>· {companyName}</span>
            )}
          </h2>
          {row?.generated_at && (
            <div style={{ fontFamily: MONO, fontSize: FS.xs, color: T.muted, marginTop: 4 }}>
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
        <div aria-busy="true" aria-label="Loading insights"><SkeletonTiles count={3}/></div>
      ) : !row ? (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 22px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, opacity: 0.6, color: T.goldText }} aria-hidden="true"><Icon name="sparkle" size={26}/></div>
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
            const sc = statusColors(SEVERITY_STATUS[it.severity] || 'info', darkMode)
            const palette = { fg: sc.text, border: sc.text }
            const cardBg = sc.bg
            return (
              <div key={i} style={{
                background: cardBg,
                border: `1px solid ${palette.border}33`,
                borderLeft: `3px solid ${palette.fg}`,
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ display:'inline-flex' }} aria-hidden="true">{ICON_NAMES.includes(CATEGORY_ICON[it.category])?<Icon name={CATEGORY_ICON[it.category]} size={14}/>:(CATEGORY_ICON[it.category]||'•')}</span>
                  <span style={{
                    fontFamily: MONO, fontSize: FS.xs, fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: palette.fg,
                  }}>{it.severity}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.35 }}>
                  {it.title}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
                  {it.body}
                </div>
                {it.action_label && safeInsightLink(it.action_link) && (
                  <button onClick={() => handleAction(it.action_link)}
                    style={{
                      alignSelf: 'flex-start', marginTop: 4,
                      background: 'transparent', border: `1px solid ${palette.fg}66`,
                      color: palette.fg, fontFamily: MONO, fontSize: FS.xs, fontWeight: 600,
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
