import { useState } from 'react'
import { supabase } from '../lib/supabase'

const SLATE  = '#2D3C4A'
const GREY   = '#A3A8AC'
const BG     = '#F5F5F5'
const WHITE  = '#FFFFFF'
const BORDER = '#DDE1E5'
const MUTED  = '#7A8694'

function OwnProperlyLogo({ width = 280 }) {
  return (
    <svg width={width} viewBox="0 0 320 90" xmlns="http://www.w3.org/2000/svg">
      <path d="M 16,46 A 28,28 0 1 0 72,46"
        fill="none" stroke={SLATE} strokeWidth="7.5" strokeLinecap="butt"/>
      <polyline points="2,38 44,10 82,38"
        fill="none" stroke={SLATE} strokeWidth="5.5"
        strokeLinecap="square" strokeLinejoin="miter"/>
      <rect x="55" y="10" width="8" height="15" fill={SLATE}/>
      <path d="M 30,42 L 30,60 L 58,60 L 58,42 A 14,13 0 0 0 30,42 Z"
        fill="none" stroke={GREY} strokeWidth="2.2"/>
      <line x1="44" y1="42" x2="44" y2="60" stroke={GREY} strokeWidth="2"/>
      <line x1="30" y1="51" x2="58" y2="51" stroke={GREY} strokeWidth="2"/>
      <text x="88" y="66"
        fontFamily="'Arial Black', 'Helvetica Neue', Arial, sans-serif"
        fontSize="58" fontWeight="900" fill={SLATE} letterSpacing="-1">WNPROPERLY</text>
      <text x="160" y="84" textAnchor="middle"
        fontFamily="'Helvetica Neue', Arial, sans-serif"
        fontSize="12.5" fontWeight="400" fill={GREY} letterSpacing="3.5">PROPERTY MANAGEMENT</text>
    </svg>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
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

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [mode,     setMode]     = useState('login')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')
  const [showPw,   setShowPw]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true); setError(''); setSuccess('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Account created! Check your email to confirm, then sign in.')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:BG, display:'flex', alignItems:'center', justifyContent:'center', padding:24, fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>
      <style>{CSS}</style>

      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:36 }}>
          <OwnProperlyLogo width={280}/>
        </div>

        <div style={{ background:WHITE, border:`1.5px solid ${BORDER}`, borderRadius:20, padding:'36px 32px', boxShadow:'0 4px 24px rgba(45,60,74,0.08)' }}>
          <h2 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:6, color:SLATE }}>
            {mode==='login' ? 'Sign in to your account' : 'Create your account'}
          </h2>
          <p style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:MUTED, marginBottom:28 }}>
            {mode==='login' ? 'Welcome back.' : 'Get started with OwnProperly.'}
          </p>

          <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div>
              <label className="lp-label">Email Address</label>
              <input className="lp-input" type="email" value={email} required
                onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
            </div>
            <div>
              <label className="lp-label">Password</label>
              <div style={{ position:'relative' }}>
                <input className="lp-input" type={showPw?'text':'password'} value={password}
                  required minLength={8} onChange={e=>setPassword(e.target.value)}
                  placeholder="••••••••" style={{ paddingRight:52 }}/>
                <button type="button" onClick={()=>setShowPw(s=>!s)} style={{
                  position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer',
                  fontFamily:"'DM Mono',monospace", fontSize:10, color:MUTED, letterSpacing:'0.05em'
                }}>{showPw?'HIDE':'SHOW'}</button>
              </div>
            </div>

            {error&&<div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#DC2626', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'10px 14px', lineHeight:1.5 }}>{error}</div>}
            {success&&<div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:'#16A34A', background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'10px 14px', lineHeight:1.5 }}>{success}</div>}

            <button type="submit" className="lp-btn" disabled={loading} style={{ marginTop:4 }}>
              {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {mode==='login'&&(
            <div style={{ textAlign:'right', marginTop:12 }}>
              <button className="lp-link" style={{ fontSize:11 }} onClick={async()=>{
                if(!email){alert('Enter your email first');return}
                await supabase.auth.resetPasswordForEmail(email)
                setSuccess('Password reset email sent — check your inbox.')
              }}>Forgot password?</button>
            </div>
          )}

          <div style={{ textAlign:'center', marginTop:24, paddingTop:20, borderTop:`1px solid ${BORDER}` }}>
            <button className="lp-link" onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('');setSuccess('')}}>
              {mode==='login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>

        <p style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:MUTED, textAlign:'center', marginTop:24 }}>
          Your data is private and secure.
        </p>
      </div>
    </div>
  )
}
