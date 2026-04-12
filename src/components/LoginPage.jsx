import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'

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
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '')

  useEffect(() => {
    if (inviteToken) setMode('signup')
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else if (inviteToken) {
        try { await api.acceptInvitation(inviteToken) } catch(e) {}
        window.history.replaceState({}, '', window.location.pathname)
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Account created! Check your email to confirm, then sign in.')
    }
    setLoading(false)
  }

  const isModal = !!onClose

  const inner = (
    <div style={{ width:'100%', maxWidth: 420 }}>
      <style>{CSS}</style>

      {/* Logo — centered, visible on both standalone and modal */}
      <div style={{ textAlign:'center', marginBottom: 28 }}>
        <img src="/logo.svg" alt="OwnProperly" style={{ width: 220, height:'auto', display:'block', margin:'0 auto' }}/>
      </div>

      <div style={{ background:WHITE, border:`1.5px solid ${BORDER}`, borderRadius:20, padding:'32px 28px', boxShadow:'0 4px 32px rgba(45,60,74,0.12)' }}>
        <h2 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:6, color:SLATE }}>
          {mode==='login' ? 'Sign in to your account' : 'Create your free account'}
        </h2>
        <p style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:MUTED, marginBottom:24 }}>
          {mode==='login' ? 'Welcome back.' : 'Start your 14-day free trial — no card needed.'}
        </p>

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label className="lp-label">Email Address</label>
            <input className="lp-input" type="email" value={email} required
              autoFocus onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
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

          <button type="submit" className="lp-btn" disabled={loading} style={{ marginTop:4 }}>
            {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account →'}
          </button>
        </form>

        {mode==='login'&&(
          <div style={{ textAlign:'right', marginTop:10 }}>
            <button className="lp-link" style={{ fontSize:11 }} onClick={async()=>{
              if(!email){alert('Enter your email first');return}
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
