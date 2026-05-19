import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import { looksLikeCompanyInviteCode } from '../lib/inviteUtils'

const SLATE  = '#2D3C4A'
const WHITE  = '#FFFFFF'
const BORDER = '#DDE1E5'
const MUTED  = '#7A8694'
const BG     = '#F5F5F5'

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0;}
  .lp-input{font-family:'DM Mono',monospace;background:#fff;border:1.5px solid #DDE1E5;color:#2D3C4A;border-radius:10px;padding:12px 14px;width:100%;font-size:14px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;}
  .lp-input:focus{border-color:#2D3C4A;box-shadow:0 0 0 3px rgba(45,60,74,0.08);}
  .lp-input::placeholder{color:#C0C5CA;}
  .lp-label{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:#7A8694;display:block;margin-bottom:6px;}
  .lp-btn{font-family:'DM Mono',monospace;font-weight:600;background:#2D3C4A;color:white;border:none;border-radius:10px;padding:14px 20px;font-size:13px;width:100%;cursor:pointer;letter-spacing:0.05em;transition:background 0.18s;}
  .lp-btn:hover:not(:disabled){background:#1E2C38;}
  .lp-btn:disabled{background:#A3A8AC;cursor:not-allowed;}
  .lp-link{font-family:'DM Mono',monospace;font-size:12px;background:none;border:none;color:#2D3C4A;cursor:pointer;text-decoration:underline;text-underline-offset:3px;}
`

export default function LoginPage({ initialMode = 'login', onClose }) {
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
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '')

  useEffect(() => {
    // Only override mode for invite tokens — not for normal sign in/up flows
    if (inviteToken) setMode('signup')
    else setMode(initialMode)
  }, [initialMode])

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
        } catch(e) { /* non-fatal: surface via toast on dashboard load if needed */ }
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
          } catch(e) { /* profile save failure shouldn't block signup */ }
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
          } catch(e) { /* non-fatal */ }
        }
        setSuccess('Account created! Check your email to confirm, then sign in.')
      }
    }
    setLoading(false)
  }

  const isModal = !!onClose

  const inner = (
    <div style={{ width:'100%', maxWidth: 420 }}>
      <style>{CSS}</style>

      {/* Logo panel — gold tint for signup, neutral for login */}
      <div style={{ background: mode==='signup' ? '#C8A84B22' : '#F4F3EF', border: mode==='signup' ? '1.5px solid #C8A84B44' : '1.5px solid transparent', borderRadius:16, padding:'24px 32px', marginBottom:24, textAlign:'center', transition:'background 0.3s' }}>
        <img src="/logo.svg" alt="OwnProperly" style={{ width: 280, height:'auto', display:'block', margin:'0 auto' }}/>
        {mode==='signup' && <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#8A6A00', marginTop:10, fontWeight:600, letterSpacing:'0.05em' }}>✨ 14-day free trial — no card needed</div>}
      </div>

      <div style={{ background:WHITE, border: mode==='signup' ? '1.5px solid #C8A84B66' : `1.5px solid ${BORDER}`, borderRadius:20, padding:'32px 28px', boxShadow: mode==='signup' ? '0 4px 32px rgba(200,168,75,0.15)' : '0 4px 32px rgba(45,60,74,0.12)', transition:'border-color 0.3s, box-shadow 0.3s' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background: mode==='signup' ? '#C8A84B' : '#2ECC8A', flexShrink:0 }}/>
          <h2 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', color:SLATE }}>
            {mode==='login' ? 'Sign in to your account' : 'Create your free account'}
          </h2>
        </div>
        <p style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:MUTED, marginBottom:24 }}>
          {mode==='login' ? 'Welcome back.' : 'Start your 14-day free trial — no card needed.'}
        </p>

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {mode==='signup' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label className="lp-label">First Name</label>
                  <input className="lp-input" type="text" value={firstName} required
                    autoFocus onChange={e=>setFirstName(e.target.value)} placeholder="Jane"/>
                </div>
                <div>
                  <label className="lp-label">Last Name</label>
                  <input className="lp-input" type="text" value={lastName} required
                    onChange={e=>setLastName(e.target.value)} placeholder="Smith"/>
                </div>
              </div>
              <div>
                <label className="lp-label">Phone <span style={{textTransform:'none',letterSpacing:0,fontSize:10,opacity:0.7}}>(optional)</span></label>
                <input className="lp-input" type="tel" value={phone}
                  onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 900000"/>
              </div>
            </>
          )}
          <div>
            <label className="lp-label">Email Address</label>
            <input className="lp-input" type="email" value={email} required
              autoFocus={mode!=='signup'} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
          </div>
          <div>
            <label className="lp-label">Password {mode==='signup'&&<span style={{textTransform:'none',letterSpacing:0}}>(min. 8 characters)</span>}</label>
            <div style={{ position:'relative' }}>
              <input className="lp-input" type={showPw?'text':'password'} value={password}
                required minLength={8} onChange={e=>setPassword(e.target.value)}
                placeholder="••••••••" style={{ paddingRight:52 }}/>
              <button type="button" onClick={()=>setShowPw(s=>!s)} style={{
                position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                background:'none', border:'none', cursor:'pointer',
                fontFamily:"'DM Mono',monospace", fontSize:10, color:MUTED
              }}>{showPw?'HIDE':'SHOW'}</button>
            </div>
          </div>

          {error&&<div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'10px 14px' }}>{error}</div>}
          {success&&<div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#16A34A', background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'10px 14px' }}>{success}</div>}

          <button type="submit" className="lp-btn" disabled={loading}
            style={{ marginTop:4, background: loading ? '#A3A8AC' : mode==='signup' ? '#C8A84B' : '#2D3C4A', color: mode==='signup' && !loading ? '#1A2530' : 'white' }}>
            {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account →'}
          </button>
        </form>

        {mode==='login'&&(
          <div style={{ textAlign:'right', marginTop:10 }}>
            <button className="lp-link" style={{ fontSize:11 }} onClick={async()=>{
              if(!email){setError('Enter your email first');return}
              setError('')
              await supabase.auth.resetPasswordForEmail(email)
              setSuccess('Password reset email sent — check your inbox.')
            }}>Forgot password?</button>
          </div>
        )}

        <div style={{ textAlign:'center', marginTop:20, paddingTop:16, borderTop:`1px solid ${BORDER}` }}>
          <button className="lp-link" onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('');setSuccess('')}}>
            {mode==='login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>

      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color: isModal ? '#999' : MUTED, textAlign:'center', marginTop:20 }}>
        Your data is private and secure.
      </p>
    </div>
  )

  // Standalone full-page version
  if (!isModal) {
    return (
      <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', padding:24, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>
        {inner}
      </div>
    )
  }

  // Modal version — just the card, no full-page wrapper
  return (
    <div style={{ padding:24, fontFamily:"'Helvetica Neue',Arial,sans-serif", width:'100%', maxWidth:480 }}>
      {inner}
    </div>
  )
}
