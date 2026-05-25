import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { MONO } from '../lib/styles'
import { fmt, fmtMoney2dp } from '../lib/format'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'
import {
  currentTaxYear, parseTaxYear, quartersForTaxYear,
  buildQuarterlySummary, quarterStatusLabel,
} from '../lib/mtdItsa'

// ── MTD ITSA PAGE ──────────────────────────────────────────────────
// HMRC Making Tax Digital for Income Tax Self Assessment.
//
// Mandate hits 6 Apr 2026 for landlords with property income > £50k,
// 6 Apr 2027 for £30k+. Quarterly submissions required, ~1 month
// after each quarter end.
//
// This page:
//   1. Shows settings (NINO + business ID + sandbox toggle)
//   2. Lists the 4 quarters for the chosen tax year, with status,
//      deadline countdown, and aggregated income/expense preview
//   3. Lets the user "build draft" (aggregates client-side) and
//      "submit to HMRC" (calls mtd-submit edge function which is
//      currently stubbed in sandbox until live HMRC creds land)
//
// Available to all tiers — MTD compliance is non-negotiable for UK
// landlords. Charging extra for it would push customers to dedicated
// MTD tools (Hammock, Untied, etc).

export default function MtdItsaPage({ properties = [], accountType = null }) {
  const { T } = useTheme()
  const [settings, setSettings] = useState(null)
  const [taxYear, setTaxYear] = useState(currentTaxYear())
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [previewQuarter, setPreviewQuarter] = useState(null)
  const [previewData, setPreviewData] = useState(null)
  const [busy, setBusy] = useState(null)

  const quarters = useMemo(() => quartersForTaxYear(taxYear), [taxYear])

  useEffect(() => { load() /* eslint-disable-next-line */ }, [taxYear])

  // OAuth return-handler: after the user finishes the gov.uk dance, HMRC
  // bounces them back to /?hmrc_connected=1. Show a toast + scrub the
  // URL so a refresh doesn't re-fire it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('hmrc_connected') === '1') {
      showAppToast('HMRC connected — you can now file real submissions')
      params.delete('hmrc_connected')
      const q = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash)
      // Re-fetch so the "Connected ✓" badge appears immediately.
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [s, subs] = await Promise.all([
        api.fetchMtdSettings(),
        api.fetchMtdSubmissions(taxYear),
      ])
      setSettings(s)
      setSubmissions(subs)
    } catch (e) {
      showAppToast('Could not load MTD data: ' + e.message, 'error')
    }
    setLoading(false)
  }

  async function previewQ(q) {
    setBusy(`preview-${q.quarter}`)
    setPreviewQuarter(q)
    try {
      const { payments, expenses, mortgageInterest } = await api.fetchMtdRawForPeriod({ periodFrom: q.from, periodTo: q.to })
      // Pass mortgageInterest so it lands in residentialFinancialCost on the
      // HMRC summary — without it, landlords lose their 20% S24 basic-rate
      // tax credit on every quarterly filing.
      const summary = buildQuarterlySummary({ payments, expenses, mortgageInterest, periodFrom: q.from, periodTo: q.to })
      setPreviewData({ summary, payments, expenses, mortgageInterest })
    } catch (e) {
      showAppToast('Preview failed: ' + e.message, 'error')
      setPreviewQuarter(null)
    }
    setBusy(null)
  }

  async function saveDraft(q) {
    if (!previewData?.summary) return
    setBusy(`save-${q.quarter}`)
    try {
      await api.upsertMtdSubmission({
        tax_year: taxYear,
        quarter_number: q.quarter,
        period_from: q.from,
        period_to: q.to,
        deadline: q.deadline,
        summary_json: previewData.summary,
        status: 'draft',
      })
      showAppToast('Quarter saved as draft')
      setPreviewQuarter(null)
      setPreviewData(null)
      load()
    } catch (e) {
      showAppToast('Save failed: ' + e.message, 'error')
    }
    setBusy(null)
  }

  async function submitToHmrc(submission) {
    setBusy(`submit-${submission.quarter_number}`)
    try {
      const result = await api.submitMtdQuarter(submission.id)
      if (result?.sandbox) {
        showAppToast('Sandbox submission accepted (HMRC live creds pending)')
      } else {
        showAppToast('Submitted to HMRC ✓')
      }
      load()
    } catch (e) {
      showAppToast('HMRC submission failed: ' + e.message, 'error')
    }
    setBusy(null)
  }

  const yearsAvailable = useMemo(() => {
    // Show current year + 2 previous + 1 future
    const cur = parseTaxYear(currentTaxYear()).startYear
    const ys = []
    for (let y = cur + 1; y >= cur - 2; y--) {
      const end = String((y + 1) % 100).padStart(2, '0')
      ys.push(`${y}-${end}`)
    }
    return ys
  }, [])

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 24px', marginBottom: 16 }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', fontFamily: MONO, fontSize: 12, color: T.muted }}>Loading MTD data…</div>

  return (
    <div style={{ maxWidth: 920 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, marginBottom: 6, letterSpacing: '-0.01em' }}>
          🏛️ Making Tax Digital — Income Tax
        </h1>
        <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, maxWidth: 640, lineHeight: 1.6 }}>
          From 6 Apr 2026 HMRC requires quarterly submissions of property income & expenses from landlords with rental income above £50,000. We aggregate your data automatically — check the quarterly summary, then submit straight to HMRC.
        </p>
      </div>

      {/* Limited-company warning — they shouldn't be on this page */}
      {accountType === 'limited_company' && (
        <div style={{ background: T.amber+'14', border: `1px solid ${T.amber}44`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: T.amber, marginBottom: 4 }}>
            ⚠ MTD ITSA doesn't apply to limited companies
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
            You've told us you operate via a limited company. Your tax return is Corporation Tax (CT600) filed annually with HMRC — not the quarterly MTD ITSA regime this page is for. If you also hold properties personally, switch your account type to "Both" in <strong>Settings → Tax setup</strong>.
          </div>
        </div>
      )}

      {/* HMRC connection banner */}
      {!settings?.nino && accountType !== 'limited_company' && (
        <div style={{ background: T.amber+'14', border: `1px solid ${T.amber}44`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: T.amber, marginBottom: 4 }}>⚠ Set up your HMRC details</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 10, lineHeight: 1.5 }}>
            Add your National Insurance Number and HMRC property business ID to enable quarterly filing.
          </div>
          <button onClick={() => setShowSettings(true)} className="btn btn-gold" style={{ fontSize: 12 }}>
            ⚙ Configure HMRC settings
          </button>
        </div>
      )}

      {settings?.sandbox_mode && settings?.nino && (
        <div style={{ background: T.blue+'12', border: `1px solid ${T.blue}44`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontFamily: MONO, fontSize: 11, color: T.blue, lineHeight: 1.5 }}>
          ℹ <strong>Practice mode is on.</strong> Submissions return a mock <code>SANDBOX-…</code> reference — nothing reaches HMRC yet. When you're ready to file for real, untick "Sandbox mode" in Settings and then "Connect HMRC" below to sign in via gov.uk.
        </div>
      )}
      {!settings?.sandbox_mode && settings?.nino && !settings?.hmrc_access_token && (
        <div style={{ background: T.amber+'14', border: `1px solid ${T.amber}44`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontFamily: MONO, fontSize: 11, color: T.amber, lineHeight: 1.5 }}>
          ⚠ <strong>Sandbox mode is off, but HMRC isn't connected yet.</strong> Click "Connect HMRC" below to sign in via gov.uk — until then submissions still return a mock reference.
        </div>
      )}

      {/* Tax year switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {yearsAvailable.map(y => (
            <button key={y} onClick={() => setTaxYear(y)}
              style={{ fontFamily: MONO, fontSize: 11, padding: '6px 12px', borderRadius: 8,
                background: y === taxYear ? T.gold+'22' : 'transparent',
                color: y === taxYear ? T.gold : T.muted,
                border: `1px solid ${y === taxYear ? T.gold+'66' : T.border}`,
                cursor: 'pointer', fontWeight: y === taxYear ? 700 : 500 }}>
              {y}{y === currentTaxYear() && ' (current)'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="btn btn-ghost" style={{ fontSize: 11 }}>
          ⚙ Settings
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel T={T} settings={settings} onSaved={(s) => { setSettings(s); setShowSettings(false); load() }}/>
      )}

      {/* Quarter cards */}
      {quarters.map(q => {
        // Pre-flight: what (if anything) is missing before we can file this
        // quarter? Used to gate the Submit button + show inline guidance
        // so users never get to "click Submit" and then hit a server error.
        const issues = getReadinessIssues(settings)
        const sub = submissions.find(s => s.quarter_number === q.quarter)
        const status = quarterStatusLabel(q, sub)
        const toneColor = { green: T.green, blue: T.blue, amber: T.amber, red: T.red, muted: T.muted }[status.tone] || T.muted
        const formattedDeadline = new Date(q.deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
        const isLocked = sub?.status === 'submitted' || sub?.status === 'accepted'
        const cached = sub?.summary_json
        return (
          <div key={q.quarter} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Quarter {q.quarter}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: toneColor+'22', color: toneColor }}>
                    {status.label}
                  </span>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted }}>
                  {formatDate(q.from)} → {formatDate(q.to)} · Deadline {formattedDeadline}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {cached && (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 700, color: T.gold }}>
                      {fmt(cached.totals?.net || 0)}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
                      net · in {fmt(cached.totals?.income || 0)} · out {fmt(cached.totals?.expenses || 0)}
                    </div>
                  </>
                )}
              </div>
            </div>

            {sub?.hmrc_reference && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.green, marginBottom: 12 }}>
                ✓ HMRC ref: {sub.hmrc_reference}
                {sub.hmrc_reference.startsWith('SANDBOX-') && (
                  <span style={{ color: T.muted, marginLeft: 6 }}>
                    (mock — not yet sent to HMRC; needs gov.uk OAuth)
                  </span>
                )}
              </div>
            )}

            {/* Inline pre-flight gate. Only shows for quarters that have a
                draft ready (otherwise the user hasn't tried to file yet so
                the warning would be premature). */}
            {cached && !isLocked && issues.length > 0 && (
              <div style={{ background: T.amber+'14', border:`1px solid ${T.amber}44`, borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontFamily: MONO, fontSize: 11, color: T.amber, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  ⚠ Can't submit yet — finish setup first:
                </div>
                <ul style={{ margin: '4px 0 6px 18px', padding: 0 }}>
                  {issues.map((i, idx) => <li key={idx}>{i}</li>)}
                </ul>
                <button onClick={() => setShowSettings(true)}
                  style={{ background: 'none', border: `1px solid ${T.amber}66`, borderRadius: 6, padding: '4px 10px', fontFamily: MONO, fontSize: 10, color: T.amber, cursor: 'pointer', fontWeight: 700, marginTop: 2 }}>
                  ⚙ Open settings
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {!isLocked && (
                <button onClick={() => previewQ(q)} className="btn btn-ghost" style={{ fontSize: 11 }}
                  disabled={!!busy}>
                  {busy === `preview-${q.quarter}` ? 'Calculating…' : (cached ? '🔄 Refresh preview' : '👀 Build draft')}
                </button>
              )}
              {cached && !isLocked && (
                <button
                  onClick={() => submitToHmrc(sub)}
                  className="btn btn-gold"
                  style={{ fontSize: 11, opacity: issues.length > 0 ? 0.4 : 1, cursor: issues.length > 0 ? 'not-allowed' : 'pointer' }}
                  disabled={!!busy || !sub?.id || issues.length > 0}
                  title={issues.length > 0 ? issues.join(' · ') : (settings?.sandbox_mode ? 'Submits a mock response (not sent to HMRC)' : 'Submits to HMRC')}>
                  {busy === `submit-${q.quarter}`
                    ? 'Submitting…'
                    : (settings?.sandbox_mode ? '🧪 Submit (sandbox)' : '📤 Submit to HMRC')}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Preview modal */}
      {previewQuarter && previewData && (
        <PreviewModal
          T={T} q={previewQuarter} data={previewData} busy={busy}
          onSave={() => saveDraft(previewQuarter)}
          onClose={() => { setPreviewQuarter(null); setPreviewData(null) }}
        />
      )}
    </div>
  )
}

// ── SETTINGS PANEL ─────────────────────────────────────────────────

function SettingsPanel({ T, settings, onSaved }) {
  const [nino, setNino] = useState(settings?.nino || '')
  const [businessId, setBusinessId] = useState(settings?.mtd_business_id || '')
  const [sandbox, setSandbox] = useState(settings?.sandbox_mode ?? true)
  const [cashBasis, setCashBasis] = useState(settings?.cash_basis ?? true)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const cleanNino = nino.toUpperCase().replace(/\s/g, '')
      // Loose NINO format check (HMRC validates strictly server-side)
      if (cleanNino && !/^[A-Z]{2}\d{6}[A-D]?$/.test(cleanNino)) {
        showAppToast('NINO format looks wrong — expected e.g. QQ123456C', 'error')
        setSaving(false); return
      }
      const saved = await api.saveMtdSettings({
        nino: cleanNino || null,
        mtd_business_id: businessId || null,
        sandbox_mode: sandbox,
        cash_basis: cashBasis,
      })
      onSaved(saved)
    } catch (e) {
      showAppToast('Save failed: ' + e.message, 'error')
    }
    setSaving(false)
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '22px 24px', marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>HMRC Settings</div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label>National Insurance Number</label>
          <input value={nino} onChange={e => setNino(e.target.value)} placeholder="QQ123456C"
            style={{ fontFamily: MONO, textTransform: 'uppercase' }}/>
        </div>
        <div>
          <label>HMRC Property Business ID</label>
          <input value={businessId} onChange={e => setBusinessId(e.target.value)} placeholder="From HMRC online account"
            style={{ fontFamily: MONO }}/>
          <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 4 }}>
            Sign in to gov.uk → Self Assessment → "My businesses" to find this.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="sandbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} style={{ width: 18, height: 18 }}/>
          <label htmlFor="sandbox" style={{ marginBottom: 0, cursor: 'pointer' }}>Sandbox mode (don't actually submit to HMRC)</label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="cashbasis" checked={cashBasis} onChange={e => setCashBasis(e.target.checked)} style={{ width: 18, height: 18 }}/>
          <label htmlFor="cashbasis" style={{ marginBottom: 0, cursor: 'pointer' }}>Cash basis (recommended for most landlords)</label>
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={save} className="btn btn-gold" style={{ fontSize: 12 }} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save settings'}
        </button>
      </div>

      {/* ── HMRC OAuth connection ── */}
      <HmrcOAuthBlock T={T} settings={settings} onChanged={onSaved}/>
    </div>
  )
}

// ── HMRC OAUTH BLOCK ───────────────────────────────────────────────
// Sits inside the SettingsPanel. Shows whether the user has authorised
// us to submit on their behalf via the gov.uk OAuth flow. Without this,
// mtd-submit falls back to the local mock path (SANDBOX-xxxxx) even
// when sandbox_mode is off.
function HmrcOAuthBlock({ T, settings, onChanged }) {
  const [busy, setBusy] = useState(false)
  const connected = !!settings?.hmrc_access_token
  const expiresAt = settings?.hmrc_token_expires_at ? new Date(settings.hmrc_token_expires_at) : null
  const expired = expiresAt && expiresAt.getTime() < Date.now()

  async function connect() {
    setBusy(true)
    try {
      await api.startHmrcOAuth()
      // ↑ redirects away — won't return
    } catch (e) {
      showAppToast(e.message, 'error')
      setBusy(false)
    }
  }
  async function disconnect() {
    if (!confirm('Disconnect HMRC? Future submissions will fall back to the local mock until you reconnect.')) return
    setBusy(true)
    try {
      await api.disconnectHmrc()
      showAppToast('HMRC disconnected')
      onChanged?.(null)
    } catch (e) {
      showAppToast(e.message, 'error')
    }
    setBusy(false)
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px dashed ${T.border}` }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        HMRC gov.uk connection
      </div>
      {connected && !expired ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: T.green+'22', color: T.green }}>
              ✓ Connected
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>
              Token expires {expiresAt.toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
            </span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.5, marginBottom: 12 }}>
            We can now file quarterly submissions on your behalf. Tokens refresh automatically before they expire.
          </div>
          <button onClick={disconnect} disabled={busy} className="btn btn-ghost" style={{ fontSize: 11 }}>
            {busy ? 'Working…' : 'Disconnect'}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: (expired ? T.amber : T.border), color: (expired ? T.amber : T.muted) }}>
              {expired ? 'Token expired' : 'Not connected'}
            </span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.5, marginBottom: 12 }}>
            {expired
              ? 'Your HMRC session has expired (PSD2 / consent lifetime). Reconnect to keep filing.'
              : 'Connect your gov.uk account so we can file MTD ITSA submissions on your behalf. We use HMRC\'s OAuth — your gov.uk credentials never touch our servers.'}
          </div>
          <button onClick={connect} disabled={busy} className="btn btn-gold" style={{ fontSize: 12 }}>
            {busy ? 'Redirecting…' : (expired ? '🔄 Reconnect HMRC' : '🔌 Connect HMRC')}
          </button>
        </>
      )}
    </div>
  )
}

// ── PREVIEW MODAL ──────────────────────────────────────────────────

function PreviewModal({ T, q, data, busy, onSave, onClose }) {
  const { summary, payments, expenses } = data
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div style={{ padding: '22px 26px 0' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Quarter {q.quarter} preview
          </h2>
          <p style={{ fontFamily: MONO, fontSize: 11, color: T.muted, marginBottom: 16 }}>
            {formatDate(q.from)} → {formatDate(q.to)} · Aggregated from {payments.length} rent payment{payments.length===1?'':'s'} + {expenses.length} expense{expenses.length===1?'':'s'}
          </p>
        </div>
        <div style={{ padding: '0 26px 22px' }}>
          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
            <Tile T={T} label="Income"   value={summary.totals.income}   color={T.green}/>
            <Tile T={T} label="Expenses" value={summary.totals.expenses} color={T.amber}/>
            <Tile T={T} label="Net"      value={summary.totals.net}      color={T.gold}/>
          </div>

          {/* Expense breakdown */}
          {Object.keys(summary.expenses).length > 0 && (
            <>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                Expenses by HMRC category
              </div>
              <div style={{ display: 'grid', gap: 4, marginBottom: 18 }}>
                {Object.entries(summary.expenses).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, background: T.bg, fontFamily: MONO, fontSize: 11 }}>
                    <span style={{ color: T.muted }}>{prettifyHmrcKey(k)}</span>
                    <span style={{ color: T.text, fontWeight: 600 }}>{fmtMoney2dp(v)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px', fontFamily: MONO, fontSize: 10, color: T.muted, marginBottom: 16 }}>
            💡 Saving this as a draft locks the quarter snapshot. You can refresh anytime before submission to HMRC.
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 12 }}>Cancel</button>
            <button onClick={onSave} className="btn btn-gold" style={{ fontSize: 12 }} disabled={!!busy}>
              {busy === `save-${q.quarter}` ? 'Saving…' : '💾 Save draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Tile({ T, label, value, color }) {
  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{fmt(value)}</div>
    </div>
  )
}

function prettifyHmrcKey(k) {
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim()
}

function formatDate(s) {
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Returns a list of human-readable reasons why we can't submit yet.
// Empty list = ready to submit. Each string is rendered as a bullet.
// Note: sandbox mode is a *valid* state — we don't block submission on
// missing OAuth when sandbox is ticked, because the edge function returns
// a mock response by design.
function getReadinessIssues(settings) {
  const issues = []
  if (!settings?.nino || !String(settings.nino).trim()) {
    issues.push('Save your National Insurance Number')
  }
  if (!settings?.mtd_business_id || !String(settings.mtd_business_id).trim()) {
    issues.push('Save your HMRC Property Business ID')
  }
  // Real submissions need a live OAuth token. Sandbox mode is exempt.
  if (!settings?.sandbox_mode && !settings?.hmrc_access_token) {
    issues.push('Connect HMRC via gov.uk OAuth (in HMRC Settings)')
  }
  return issues
}
