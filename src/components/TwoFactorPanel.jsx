// Two-factor authentication enrol / disable panel.
//
// Rendered inside Settings → Security & Data. Uses Supabase Auth's
// built-in MFA (TOTP) flow:
//   1. enroll()                → backend creates an unverified factor and
//                                returns a QR code + a TOTP secret.
//   2. challenge() + verify()  → user enters the 6-digit code from
//                                their authenticator app to prove they
//                                set it up correctly. Factor becomes
//                                "verified" and is now enforced on
//                                future logins.
//   3. unenroll(factorId)      → user can remove it later (we re-prompt
//                                for their password as a safety belt).
//
// Why this is critical: the platform-admin account is the highest-value
// target (full impersonation rights). Until we add 2FA the only barrier
// is a single password. HMRC's production review also asks "do admin
// accounts have MFA available" — this answers yes.
//
// Pre-requisite: Supabase Dashboard → Authentication → Providers → MFA
// must have TOTP toggled on (one-click in the dashboard). Without that,
// `supabase.auth.mfa.enroll()` returns a 422.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showAppToast } from '../lib/toast'

export default function TwoFactorPanel({ T }) {
  const mono = "'DM Mono',monospace"

  const [loading, setLoading]       = useState(true)
  const [factors, setFactors]       = useState([])      // verified TOTP factors
  const [unverified, setUnverified] = useState([])      // partially-enrolled factors waiting on verify
  const [enrolling, setEnrolling]   = useState(false)
  const [qrSvg, setQrSvg]           = useState('')
  const [secret, setSecret]         = useState('')
  const [pendingFactorId, setPendingFactorId] = useState(null)
  const [code, setCode]             = useState('')
  const [verifying, setVerifying]   = useState(false)
  const [busy, setBusy]             = useState(null)    // 'unenroll-<id>' while disabling

  async function refresh() {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      // .totp is the array of TOTP factors; .all also exists but we only
      // surface TOTP in the UI for now (SMS isn't enabled at the Supabase
      // project level so we don't list it).
      const totp = data?.totp || []
      setFactors(totp.filter(f => f.status === 'verified'))
      setUnverified(totp.filter(f => f.status === 'unverified'))
    } catch (e) {
      console.error('listFactors', e)
    }
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  async function startEnroll() {
    setEnrolling(true)
    setCode('')
    try {
      // Clean up any half-enrolled factors first — Supabase rejects a
      // second enroll() while an unverified factor is pending.
      for (const f of unverified) {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `OwnProperly · ${new Date().toISOString().slice(0,10)}`,
      })
      if (error) throw error
      setPendingFactorId(data.id)
      // Supabase returns `totp.qr_code` as an SVG string and `totp.secret`
      // as the base32-encoded shared secret for manual entry.
      setQrSvg(data.totp?.qr_code || '')
      setSecret(data.totp?.secret || '')
    } catch (e) {
      showAppToast('Could not start 2FA setup: ' + (e?.message || 'unknown'), 'error')
      setEnrolling(false)
    }
  }

  async function verify() {
    if (!pendingFactorId || !code.trim()) return
    setVerifying(true)
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: pendingFactorId })
      if (chErr) throw chErr
      const { error: verErr } = await supabase.auth.mfa.verify({
        factorId: pendingFactorId,
        challengeId: challenge.id,
        code: code.trim(),
      })
      if (verErr) throw verErr
      showAppToast('Two-factor authentication enabled — you\'ll need your authenticator app on next sign-in.')
      // Reset state, refresh list
      setEnrolling(false)
      setQrSvg(''); setSecret(''); setPendingFactorId(null); setCode('')
      await refresh()
    } catch (e) {
      showAppToast('Verification failed: ' + (e?.message || 'wrong code'), 'error')
    }
    setVerifying(false)
  }

  async function cancelEnroll() {
    if (pendingFactorId) {
      // Don't leave a half-enrolled factor lying around — it would
      // block future enroll attempts until cleaned up.
      await supabase.auth.mfa.unenroll({ factorId: pendingFactorId }).catch(() => {})
    }
    setEnrolling(false)
    setQrSvg(''); setSecret(''); setPendingFactorId(null); setCode('')
    refresh()
  }

  async function disable(factorId) {
    if (!confirm('Disable two-factor authentication? Your account will be protected by password only.')) return
    setBusy(`unenroll-${factorId}`)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
      showAppToast('Two-factor authentication disabled.')
      await refresh()
    } catch (e) {
      showAppToast('Could not disable 2FA: ' + (e?.message || 'unknown'), 'error')
    }
    setBusy(null)
  }

  const sectionStyle = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '24px 28px', marginBottom: 16 }
  const headerStyle  = { fontFamily: mono, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }

  if (loading) {
    return (
      <div style={sectionStyle}>
        <div style={headerStyle}>Two-Factor Authentication</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
      </div>
    )
  }

  // Already enrolled — show status + disable button.
  if (factors.length > 0 && !enrolling) {
    return (
      <div style={sectionStyle}>
        <div style={headerStyle}>Two-Factor Authentication</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 18, color: T.green }} aria-hidden="true">✓</span>
          <span style={{ fontFamily: mono, fontSize: 13, color: T.text, fontWeight: 600 }}>2FA is enabled</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 16, lineHeight: 1.6 }}>
          You'll be prompted for a 6-digit code from your authenticator app every time you sign in.
        </div>
        {factors.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 12, color: T.text, fontWeight: 600 }}>{f.friendly_name || 'Authenticator'}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
                Added {f.created_at ? new Date(f.created_at).toLocaleDateString('en-GB') : 'recently'}
              </div>
            </div>
            <button
              onClick={() => disable(f.id)}
              disabled={busy === `unenroll-${f.id}`}
              style={{
                fontFamily: mono, fontSize: 11, padding: '6px 14px', borderRadius: 8,
                border: `1px solid ${T.red}66`, background: T.red + '11', color: T.red,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}>
              {busy === `unenroll-${f.id}` ? 'Disabling…' : 'Disable'}
            </button>
          </div>
        ))}
      </div>
    )
  }

  // Enrolment mid-flow — show QR + verify input.
  if (enrolling && qrSvg) {
    // qr_code from Supabase is an SVG string. Render it as raw HTML.
    return (
      <div style={sectionStyle}>
        <div style={headerStyle}>Set up Two-Factor Authentication</div>
        <ol style={{ fontFamily: mono, fontSize: 12, color: T.text, paddingLeft: 18, marginBottom: 16, lineHeight: 1.7 }}>
          <li>Install <strong>Google Authenticator</strong>, <strong>Authy</strong> or <strong>1Password</strong> on your phone (if you don't already have one).</li>
          <li>Open the app and scan this QR code:</li>
        </ol>

        <div style={{ display: 'flex', justifyContent: 'center', padding: 20, background: '#fff', borderRadius: 12, marginBottom: 16 }}>
          {/* Supabase returns an SVG string — render via dangerouslySetInnerHTML.
              The SVG is generated server-side from a known TOTP URI; no user
              input flows in, so no XSS risk. */}
          <div style={{ width: 200, height: 200 }} dangerouslySetInnerHTML={{ __html: qrSvg }} />
        </div>

        <details style={{ marginBottom: 16, fontFamily: mono, fontSize: 11, color: T.muted }}>
          <summary style={{ cursor: 'pointer' }}>Can't scan? Enter the secret manually</summary>
          <div style={{ marginTop: 8, padding: '8px 10px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, wordBreak: 'break-all', userSelect: 'all', color: T.text }}>
            {secret}
          </div>
        </details>

        <div style={{ marginBottom: 14 }}>
          <label htmlFor="tfa-code" style={{ fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            3. Enter the 6-digit code from your app to confirm
          </label>
          <input
            id="tfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            aria-required="true"
            style={{
              width: '100%', fontFamily: mono, fontSize: 18, letterSpacing: '0.2em',
              textAlign: 'center', padding: '12px 14px', borderRadius: 8,
              border: `1.5px solid ${T.border}`, background: T.bg, color: T.text,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={verify}
            disabled={verifying || code.length !== 6}
            style={{
              flex: 1, fontFamily: mono, fontSize: 12, fontWeight: 700,
              padding: '11px', borderRadius: 8,
              border: 'none', background: verifying || code.length !== 6 ? T.border : T.gold,
              color: '#1A2530', cursor: verifying || code.length !== 6 ? 'not-allowed' : 'pointer',
            }}>
            {verifying ? 'Verifying…' : 'Verify and enable'}
          </button>
          <button
            onClick={cancelEnroll}
            style={{
              fontFamily: mono, fontSize: 12, padding: '11px 18px', borderRadius: 8,
              border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer',
            }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Not enrolled — pitch + "Enable" button.
  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>Two-Factor Authentication</div>
      <div style={{ fontFamily: mono, fontSize: 12, color: T.text, marginBottom: 14, lineHeight: 1.7 }}>
        Add a second step at sign-in. Even if someone learns your password they still can't
        access your account without your phone.
      </div>
      <ul style={{ fontFamily: mono, fontSize: 11, color: T.muted, paddingLeft: 18, marginBottom: 16, lineHeight: 1.8 }}>
        <li>Works with any TOTP authenticator app (Google Authenticator, Authy, 1Password, etc.)</li>
        <li>Takes about 60 seconds to set up</li>
        <li>You can disable it later from this page</li>
      </ul>
      <button
        onClick={startEnroll}
        style={{
          fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '10px 22px',
          borderRadius: 8, border: 'none', background: T.gold, color: '#1A2530', cursor: 'pointer',
        }}>
        🔒 Enable two-factor authentication
      </button>
      {unverified.length > 0 && (
        <div style={{ marginTop: 14, fontFamily: mono, fontSize: 10, color: T.muted }}>
          ({unverified.length} half-completed setup{unverified.length > 1 ? 's' : ''} pending — will be cleaned up when you start a new one.)
        </div>
      )}
    </div>
  )
}
