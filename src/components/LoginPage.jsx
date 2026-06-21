import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import { looksLikeCompanyInviteCode } from '../lib/inviteUtils'
import { logError } from '../lib/logError'
import { SANS } from '../lib/styles'
import { Icon } from '../lib/icons'

// OwnProperly redesign (design/redesign-2026) — split slate brand panel + paper
// form. The auth page is intentionally theme-independent (always the light /
// slate brand look) to match the mock and avoid dark-mode edge cases at the
// front door. Labels use the AA-safe muted ink (#5C6670, 5.3:1 on paper) rather
// than the mock's lighter #8A8E92 (2.97:1) — this page is in the HMRC AA audit.
const SLATE   = '#14202A'   // brand panel
const INK     = '#1C2830'   // primary text / primary button
const PAPER   = '#F4F3EF'   // form-side background
const WHITE   = '#FFFFFF'
const BORDER  = '#D8D4CB'   // input hairline (warm)
const MUTED   = '#5C6670'   // secondary text + labels (AA on paper & white)
const GOLD    = '#B8902F'   // light accent
const GOLD_D  = '#CBA64E'   // accent on the slate panel

const CSS = `
  .lp-scope *{box-sizing:border-box;}
  .lp-input{font-family:'DM Mono',monospace;background:#fff;border:1.5px solid ${BORDER};color:${INK};border-radius:10px;padding:12px 14px;width:100%;font-size:14px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;}
  .lp-input:focus{border-color:${INK};box-shadow:0 0 0 3px rgba(28,40,48,0.08);}
  .lp-input::placeholder{color:#B4B0A6;}
  .lp-label{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};display:block;margin-bottom:8px;}
  .lp-btn{font-family:${SANS};font-weight:700;background:${INK};color:white;border:none;border-radius:10px;padding:13px 20px;font-size:15px;width:100%;cursor:pointer;transition:background 0.18s,opacity 0.18s;}
  .lp-btn:hover:not(:disabled){background:#0F1A22;}
  .lp-btn:disabled{opacity:0.55;cursor:not-allowed;}
  .lp-link{font-family:'DM Mono',monospace;font-size:12px;background:none;border:none;color:${GOLD};cursor:pointer;font-weight:500;}
  .lp-link:hover{text-decoration:underline;text-underline-offset:3px;}
  .lp-page{min-height:100vh;display:flex;font-family:${SANS};color:${INK};}
  .lp-brandpanel{flex:1.1;background:${SLATE};color:${PAPER};padding:48px 56px;display:flex;flex-direction:column;justify-content:space-between;min-width:0;}
  .lp-formside{flex:1;background:${PAPER};padding:48px 56px;display:flex;align-items:center;justify-content:center;min-width:0;}
  @media(max-width:860px){.lp-brandpanel{display:none;}.lp-formside{padding:36px 22px;}}
`

// Decorative gold circle-check used in the brand panel feature list.
function BrandPanel({ branding, brandAccent }) {
  const points = [
    'Track rent across every tenancy',
    'Never miss a compliance deadline',
    'File MTD ITSA straight to HMRC',
  ]
  return (
    <div className="lp-brandpanel">
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:38, height:38, borderRadius:10, background:'#22323D', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontWeight:700, fontSize:21, letterSpacing:'-0.04em', color:PAPER }}>P<span style={{ color:GOLD_D }}>.</span></span>
        </div>
        <div style={{ fontSize:21, letterSpacing:'-0.02em' }}><span style={{ fontWeight:500 }}>Own</span><span style={{ fontWeight:700 }}>Properly</span></div>
      </div>

      <div style={{ maxWidth:440 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', color:GOLD_D, marginBottom:22 }}>
          {branding ? 'Tenant portal' : 'Property portfolio software'}
        </div>
        {/* Decorative strapline — kept as a div (not <h1>) so the form's
            "Welcome back" stays the page's single top-level heading. */}
        <div style={{ fontSize:42, lineHeight:1.08, fontWeight:700, letterSpacing:'-0.03em', margin:'0 0 20px' }}>
          {branding ? <>Your home, <span style={{ color:GOLD_D }}>managed properly.</span></> : <>Own your rental portfolio <span style={{ color:GOLD_D }}>properly.</span></>}
        </div>
        <p style={{ fontSize:16, lineHeight:1.6, color:'#A9B4BC', margin:'0 0 36px' }}>
          {branding
            ? 'Pay rent, raise repairs and find your documents — all in one place.'
            : 'Rent, compliance, tax and tenants — every UK landlord obligation in one place. Built for MTD ITSA and Section 24.'}
        </p>
        {!branding && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {points.map(p => (
              <div key={p} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <Icon name="check-circle" size={22} color={GOLD_D} />
                <span style={{ fontSize:15, color:'#E7E4DC' }}>{p}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#6E7A84' }}>
        {branding ? `Powered by OwnProperly` : 'Trusted by UK landlords from 1 to 200+ properties'}
      </div>
    </div>
  )
}

export default function LoginPage({ initialMode = 'login', onClose, branding = null }) {
  // Branded tenant login (served at <sub>.ownproperly.com). When present we
  // swap the OwnProperly logo + gold accent for the company's identity. Falls
  // back to the default gold when a company has no brand colour set.
  const brandAccent = branding?.color || GOLD
  const [mode,     setMode]     = useState(initialMode)
  const [email,    setEmail]    = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [phone,    setPhone]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '')

  useEffect(() => {
    // Only override mode for invite tokens — not for normal sign in/up flows
    if (inviteToken) setMode('signup')
    else setMode(initialMode)
  }, [initialMode])

  async function handleForgot() {
    if (!email) { setError('Enter your email first'); return }
    setError(''); setSuccess(''); setResetBusy(true)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setResetBusy(false)
    if (resetErr) setError("Couldn't send the reset email — try again in a minute.")
    else setSuccess('Password reset email sent — check your inbox.')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else if (inviteToken) {
        // Handle both kinds of invite token:
        //  - UUID-style per-email invitation token → acceptInvitation
        //  - Code-style company invite (e.g. HMD-7K3X) → redeemCompanyInvite
        // We sniff by shape: UUIDs always contain hyphens in fixed positions
        // and are lowercase hex; our codes are uppercase letters/numbers
        // with a dash but otherwise look very different.
        try {
          if (looksLikeCompanyInviteCode(inviteToken)) {
            await api.redeemCompanyInvite(inviteToken)
          } else {
            await api.acceptInvitation(inviteToken)
          }
        } catch(e) { logError('signin:redeemInvite', e) /* non-fatal: surfaced on dashboard if needed */ }
        window.history.replaceState({}, '', window.location.pathname)
      }
    } else {
      // Validate required fields
      if (!firstName.trim() || !lastName.trim()) {
        setError('Please enter your first and last name')
        setLoading(false); return
      }
      const fullName = `${firstName.trim()} ${lastName.trim()}`
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() } }
      })
      if (error) setError(error.message)
      else {
        // Save profile immediately (in case email confirmation is disabled they can use it right away)
        if (signUpData?.user?.id) {
          try {
            await supabase.from('user_profiles').upsert({
              user_id: signUpData.user.id,
              email,
              full_name: fullName,
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              phone: phone.trim(),
            }, { onConflict: 'user_id' })
          } catch(e) { logError('signup:profileUpsert', e) /* non-fatal — signup itself succeeded */ }
        }
        // If they used an invite, stash it so it gets redeemed once they
        // confirm their email and sign in. The redeem MUST run while signed
        // in (auth.uid() check), so we can't run it now if email confirmation
        // is required.
        if (inviteToken) {
          try { localStorage.setItem('pending_invite_token', inviteToken) } catch(e) {}
        }
        // If signup also created a session (i.e. confirmation disabled), try
        // to redeem right away.
        if (signUpData?.session && inviteToken) {
          try {
            if (looksLikeCompanyInviteCode(inviteToken)) {
              await api.redeemCompanyInvite(inviteToken)
            } else {
              await api.acceptInvitation(inviteToken)
            }
            try { localStorage.removeItem('pending_invite_token') } catch(e) {}
          } catch(e) { logError('signup:immediateRedeem', e) /* non-fatal — pending_invite_token still set for retry on next signin */ }
        }
        setSuccess('Account created! Check your email to confirm, then sign in.')
      }
    }
    setLoading(false)
  }

  const isModal = !!onClose

  const inner = (
    <div className="lp-scope" style={{ width:'100%', maxWidth: 380 }}>
      <style>{CSS}</style>

      {/* Compact brand mark — only in the modal / no-brand-panel context. On the
          full page the slate panel on the left already carries the brand. */}
      {isModal && (
        <div style={{ marginBottom:24 }}>
          {branding
            ? (branding.logo_url
                ? <img src={branding.logo_url} alt={branding.name || 'Company logo'} style={{ maxWidth:200, maxHeight:48, height:'auto', objectFit:'contain', display:'block' }}/>
                : <div style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', color:brandAccent }}>{branding.name}</div>)
            : <img src="/logo.svg" alt="OwnProperly" style={{ height:30, width:'auto', display:'block' }}/>}
        </div>
      )}

      <div>
        {/* h1 — the page's single top-level heading (a11y: WCAG 2.4.1). */}
        <h1 style={{ fontSize:26, fontWeight:700, letterSpacing:'-0.02em', color:INK, margin:'0 0 6px' }}>
          {branding
            ? (mode==='login' ? 'Sign in to your portal' : 'Create your account')
            : (mode==='login' ? 'Welcome back' : 'Create your free account')}
        </h1>
        <p style={{ fontSize:14, color:MUTED, margin:'0 0 28px' }}>
          {branding
            ? `${branding.name} tenant portal`
            : (mode==='login' ? 'Sign in to your portfolio.' : 'Start your 14-day free trial — no card needed.')}
        </p>

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {mode==='signup' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label className="lp-label" htmlFor="lp-firstname">First Name</label>
                  <input id="lp-firstname" className="lp-input" type="text" value={firstName} required
                    aria-required="true" autoComplete="given-name"
                    autoFocus onChange={e=>setFirstName(e.target.value)} placeholder="Jane"/>
                </div>
                <div>
                  <label className="lp-label" htmlFor="lp-lastname">Last Name</label>
                  <input id="lp-lastname" className="lp-input" type="text" value={lastName} required
                    aria-required="true" autoComplete="family-name"
                    onChange={e=>setLastName(e.target.value)} placeholder="Smith"/>
                </div>
              </div>
              <div>
                <label className="lp-label" htmlFor="lp-phone">Phone <span style={{textTransform:'none',letterSpacing:0,fontSize:10,opacity:0.7}}>(optional)</span></label>
                <input id="lp-phone" className="lp-input" type="tel" value={phone}
                  autoComplete="tel" inputMode="tel"
                  onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 900000"/>
              </div>
            </>
          )}
          <div>
            <label className="lp-label" htmlFor="lp-email">Email Address</label>
            <input id="lp-email" className="lp-input" type="email" value={email} required
              aria-required="true" autoComplete="email" inputMode="email"
              autoFocus={mode!=='signup'} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
          </div>
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
              <label className="lp-label" htmlFor="lp-password" style={{ marginBottom:0 }}>Password {mode==='signup'&&<span style={{textTransform:'none',letterSpacing:0}}>(min. 8 characters)</span>}</label>
              {mode==='login' && (
                <button type="button" className="lp-link" style={{ fontSize:11, opacity: resetBusy ? 0.6 : 1 }} disabled={resetBusy} onClick={handleForgot}>
                  {resetBusy ? 'Sending…' : 'Forgot?'}
                </button>
              )}
            </div>
            <div style={{ position:'relative' }}>
              <input id="lp-password" className="lp-input" type={showPw?'text':'password'} value={password}
                required minLength={8} aria-required="true"
                autoComplete={mode==='login' ? 'current-password' : 'new-password'}
                onChange={e=>setPassword(e.target.value)}
                placeholder="••••••••" style={{ paddingRight:46 }}/>
              <button type="button" onClick={()=>setShowPw(s=>!s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
                style={{
                  position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer', padding:0,
                  color:MUTED, display:'flex'
                }}><Icon name={showPw ? 'eye-off' : 'eye'} size={18} /></button>
            </div>
          </div>

          {/* aria-live so screen readers announce auth errors / success
              messages as they appear; without this they were silent. */}
          {error&&<div role="alert" aria-live="assertive" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#C5483B', background:'#FAEAE8', border:'1px solid #C5483B33', borderRadius:8, padding:'10px 14px' }}>{error}</div>}
          {success&&<div role="status" aria-live="polite" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#1F9D63', background:'#E8F4EC', border:'1px solid #1F9D6333', borderRadius:8, padding:'10px 14px' }}>{success}</div>}

          <button type="submit" className="lp-btn" disabled={loading}
            style={{ marginTop:6, ...(branding ? { background: brandAccent } : null) }}>
            {loading ? 'Please wait…' : mode==='login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ textAlign:'center', fontSize:13, color:MUTED, marginTop:28 }}>
          {mode==='login' ? <>New to OwnProperly? </> : <>Already have an account? </>}
          <button className="lp-link" style={{ fontSize:13, color:GOLD, fontWeight:600 }} onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('');setSuccess('')}}>
            {mode==='login' ? 'Start a 14-day free trial' : 'Sign in'}
          </button>
        </div>

        <p style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:MUTED, textAlign:'center', marginTop:22 }}>
          Your data is private and secure.
        </p>
      </div>
    </div>
  )

  // Standalone full-page version — split slate brand panel + paper form.
  if (!isModal) {
    return (
      <div className="lp-page">
        <style>{CSS}</style>
        <BrandPanel branding={branding} brandAccent={brandAccent} />
        <div className="lp-formside">{inner}</div>
      </div>
    )
  }

  // Modal version — just the form, no brand panel or full-page wrapper.
  return (
    <div className="lp-scope" style={{ padding:24, fontFamily:SANS, width:'100%', maxWidth:440, background:PAPER }}>
      {inner}
    </div>
  )
}

// Shared full-page shell for the post-login gate screens below (MFA
// challenge, set-new-password). Same visual language as the login page.
function GateShell({ children }) {
  return (
    <div className="lp-scope" style={{ minHeight:'100vh', background:PAPER, display:'flex', alignItems:'center', justifyContent:'center', padding:24, fontFamily:SANS, color:INK }}>
      <div style={{ width:'100%', maxWidth: 400 }}>
        <style>{CSS}</style>
        <div style={{ marginBottom:24, textAlign:'center' }}>
          <img src="/logo.svg" alt="OwnProperly" style={{ height:32, width:'auto', display:'inline-block' }}/>
        </div>
        <div style={{ background:WHITE, border:`1.5px solid ${BORDER}`, borderRadius:16, padding:'32px 28px', boxShadow:'0 10px 30px rgba(28,40,48,0.10)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// MFA step-up — shown by AuthContext when the user has a verified TOTP
// factor but the current session is still AAL1 (password only). The app
// does not render until verify() succeeds, so a stolen password alone no
// longer grants access.
export function MfaChallengeScreen({ onVerified, onSignOut }) {
  const [code, setCode]   = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy]   = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (code.length !== 6 || busy) return
    setBusy(true); setError('')
    try {
      const { data: factorData, error: fErr } = await supabase.auth.mfa.listFactors()
      if (fErr) throw fErr
      const factor = (factorData?.totp || []).find(f => f.status === 'verified')
      if (!factor) throw new Error('No verified authenticator found on this account.')
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: factor.id, challengeId: challenge.id, code: code.trim(),
      })
      if (vErr) throw vErr
      onVerified?.()
    } catch (err) {
      logError('mfaChallenge:verify', err)
      setError(err?.message || 'Verification failed — try again.')
    }
    setBusy(false)
  }

  return (
    <GateShell>
      <h1 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', color:SLATE, margin:0, marginBottom:6 }}>
        Two-factor authentication
      </h1>
      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:MUTED, marginBottom:24 }}>
        Enter the 6-digit code from your authenticator app to finish signing in.
      </p>
      <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label className="lp-label" htmlFor="lp-mfa-code">Authentication code</label>
          <input id="lp-mfa-code" className="lp-input" type="text" inputMode="numeric"
            autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
            autoFocus aria-required="true" placeholder="000000"
            onChange={e=>setCode(e.target.value.replace(/\D/g, ''))}
            style={{ textAlign:'center', fontSize:18, letterSpacing:'0.2em' }}/>
        </div>
        {error&&<div role="alert" aria-live="assertive" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'10px 14px' }}>{error}</div>}
        <button type="submit" className="lp-btn" disabled={busy || code.length !== 6} style={{ marginTop:4 }}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <div style={{ textAlign:'center', marginTop:20, paddingTop:16, borderTop:`1px solid ${BORDER}` }}>
        <button className="lp-link" onClick={onSignOut}>Sign out and use a different account</button>
      </div>
    </GateShell>
  )
}

// Password-recovery completion — shown by AuthContext when Supabase fires
// the PASSWORD_RECOVERY event (user clicked a reset-password email link).
// Without this the reset flow never actually changed the password.
export function SetNewPasswordScreen({ onDone }) {
  const [password,  setPassword]  = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy]   = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPw) { setError('Passwords do not match.'); return }
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) { setError(err.message || 'Could not update your password — try again.'); return }
    onDone?.()
  }

  return (
    <GateShell>
      <h1 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', color:SLATE, margin:0, marginBottom:6 }}>
        Set a new password
      </h1>
      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:MUTED, marginBottom:24 }}>
        You followed a password-reset link. Choose a new password to finish.
      </p>
      <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label className="lp-label" htmlFor="lp-new-password">New password (min. 8 characters)</label>
          <input id="lp-new-password" className="lp-input" type="password" value={password}
            required minLength={8} aria-required="true" autoComplete="new-password" autoFocus
            onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/>
        </div>
        <div>
          <label className="lp-label" htmlFor="lp-confirm-password">Confirm new password</label>
          <input id="lp-confirm-password" className="lp-input" type="password" value={confirmPw}
            required minLength={8} aria-required="true" autoComplete="new-password"
            onChange={e=>setConfirmPw(e.target.value)} placeholder="••••••••"/>
        </div>
        {error&&<div role="alert" aria-live="assertive" style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'10px 14px' }}>{error}</div>}
        <button type="submit" className="lp-btn" disabled={busy} style={{ marginTop:4 }}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
      <div style={{ textAlign:'center', marginTop:20, paddingTop:16, borderTop:`1px solid ${BORDER}` }}>
        <button className="lp-link" onClick={()=>onDone?.()}>Skip — keep my current password</button>
      </div>
    </GateShell>
  )
}
