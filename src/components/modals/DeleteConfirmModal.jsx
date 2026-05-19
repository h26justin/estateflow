import { useState } from 'react'
import { useTheme } from '../../lib/ThemeContext'

export default function DeleteConfirmModal({ propName, onClose, onConfirm }) {
  const { T } = useTheme()
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleConfirm() {
    if (!password) { setError('Please enter your password'); return }
    setLoading(true); setError('')
    const ok = await onConfirm(password)
    if (!ok) setError('Incorrect password. Property not deleted.')
    setLoading(false)
  }

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:420}}>
        <div style={{padding:'28px 28px'}}>
          <div style={{fontSize:32,marginBottom:12,textAlign:'center'}}>⚠️</div>
          <h2 style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8,color:T.text,textAlign:'center'}}>Delete Property?</h2>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:12,marginBottom:6,textAlign:'center'}}>You are about to permanently delete:</p>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.red,fontSize:13,fontWeight:700,marginBottom:20,textAlign:'center'}}>{propName}</p>
          <p style={{fontFamily:"'DM Mono',monospace",color:T.muted,fontSize:11,marginBottom:16,textAlign:'center'}}>This will delete all associated rent history, refurb data and notes. This cannot be undone.<br/><br/>Enter your password to confirm.</p>
          <div style={{marginBottom:16}}>
            <label>Your Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handleConfirm()}
              placeholder="••••••••" autoFocus/>
          </div>
          {error&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.red,background:'#2B1010',border:'1px solid #3D1A1A',borderRadius:8,padding:'10px 14px',marginBottom:16}}>{error}</div>}
          <div style={{display:'flex',gap:10}}>
            <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
            <button disabled={loading} onClick={handleConfirm}
              style={{flex:1,fontFamily:"'DM Mono',monospace",fontWeight:600,background:loading?'#3D1A1A':'#2B1010',color:'#E05555',border:'1px solid #5C2C2C',borderRadius:8,padding:'10px',fontSize:13,cursor:loading?'not-allowed':'pointer'}}>
              {loading?'Verifying…':'Delete Permanently'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
