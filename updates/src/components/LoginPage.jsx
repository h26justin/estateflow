import { useState } from 'react'
import { supabase } from '../lib/supabase'

const T = { bg:'#0B0D14', card:'#171B28', border:'#1E2335', text:'#E4E0D8', muted:'#6B7191', gold:'#C8A84B', red:'#E05555', green:'#2ECC8A' }

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode]         = useState('login')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true); setError(''); setSuccess('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Account created! Check your email to confirm, then log in.')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:T.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:24, fontFamily:"'Fraunces',Georgia,serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input{font-family:'DM Mono',monospace;background:#12151F;border:1px solid #1E2335;color:#E4E0D8;border-radius:8px;padding:12px 14px;width:100%;font-size:14px;outline:none;transition:border-color 0.2s;}
        input:focus{border-color:#C8A84B;}
        label{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:#6B7191;display:block;margin-bottom:6px;}
      `}</style>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <div style={{ width:56, height:56, margin:'0 auto 16px', background:`linear-gradient(135deg,${T.gold},#8B6B1F)`, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28 }}>🏛</div>
          <div style={{ fontSize:28, fontWeight:700, letterSpacing:'-0.03em', color:T.text }}>Estateflow</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:T.muted, letterSpacing:'0.12em', textTransform:'uppercase', marginTop:4 }}>Portfolio Manager</div>
        </div>
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:18, padding:'32px 28px' }}>
          <h2 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:6, color:T.text }}>
            {mode==='login' ? 'Sign in to your account' : 'Create your account'}
          </h2>
          <p style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.muted, marginBottom:28 }}>
            {mode==='login' ? 'Welcome back.' : 'Get started with Estateflow.'}
          </p>
          <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div><label>Email Address</label><input type="email" value={email} required onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div>
            <div><label>Password</label><input type="password" value={password} required onChange={e=>setPassword(e.target.value)} placeholder="••••••••" minLength={8}/></div>
            {error   && <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.red,   background:'#2B1010', border:'1px solid #3D1A1A', borderRadius:8, padding:'10px 14px' }}>{error}</div>}
            {success && <div style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:T.green, background:'#0D2B1F', border:'1px solid #1A4A2E', borderRadius:8, padding:'10px 14px' }}>{success}</div>}
            <button type="submit" disabled={loading} style={{ fontFamily:"'DM Mono',monospace", fontWeight:600, background:loading?T.muted:T.gold, color:'#0B0D14', border:'none', borderRadius:10, padding:'13px 20px', fontSize:13, cursor:loading?'not-allowed':'pointer', marginTop:4 }}>
              {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <div style={{ textAlign:'center', marginTop:24 }}>
            <button onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('');setSuccess('')}}
              style={{ fontFamily:"'DM Mono',monospace", fontSize:12, background:'none', border:'none', color:T.gold, cursor:'pointer', textDecoration:'underline' }}>
              {mode==='login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
        <p style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:T.muted, textAlign:'center', marginTop:24 }}>Your data is private and secure.</p>
      </div>
    </div>
  )
}
