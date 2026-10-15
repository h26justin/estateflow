import { useState } from 'react'
import { MONO } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import FocusTrap from '../../lib/FocusTrap'
import { Icon } from '../../lib/icons'
import { Button } from '../ui'

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
      <FocusTrap onEscape={onClose}>
      <div className="modal" style={{maxWidth:420}} role="dialog" aria-modal="true" aria-labelledby="delete-confirm-modal-title">
        <div style={{padding:'28px 28px'}}>
          <div aria-hidden="true" style={{display:'flex',justifyContent:'center',marginBottom:12,color:T.red}}><Icon name="alert-triangle" size={32}/></div>
          <h2 id="delete-confirm-modal-title" style={{fontSize:20,fontWeight:700,letterSpacing:'-0.02em',marginBottom:8,color:T.text,textAlign:'center'}}>Delete Property?</h2>
          <p style={{fontFamily:MONO,color:T.muted,fontSize:12,marginBottom:6,textAlign:'center'}}>You are about to permanently delete:</p>
          <p style={{fontFamily:MONO,color:T.red,fontSize:13,fontWeight:700,marginBottom:20,textAlign:'center'}}>{propName}</p>
          <p style={{fontFamily:MONO,color:T.muted,fontSize:11,marginBottom:16,textAlign:'center'}}>This will delete all associated rent history, refurb data and notes. This cannot be undone.<br/><br/>Enter your password to confirm.</p>
          <div style={{marginBottom:16}}>
            <label>Your Password</label>
            <input aria-label="Your Password" type="password" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handleConfirm()}
              placeholder="••••••••" autoFocus/>
          </div>
          {error&&<div style={{fontFamily:MONO,fontSize:12,color:T.red,background:T.red+'11',border:`1px solid ${T.red}44`,borderRadius:8,padding:'10px 14px',marginBottom:16}}>{error}</div>}
          <div style={{display:'flex',gap:10}}>
            <Button variant="ghost" style={{flex:1}} onClick={onClose}>Cancel</Button>
            <Button variant="danger" style={{flex:1}} disabled={loading} onClick={handleConfirm}>
              {loading?'Verifying…':'Delete Permanently'}
            </Button>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  )
}
