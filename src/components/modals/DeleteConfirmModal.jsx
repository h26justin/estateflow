import { useState } from 'react'
import { SANS, FS, R } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import { Button, Modal } from '../ui'

export default function DeleteConfirmModal({ propName, onClose, onConfirm }) {
  const { T } = useTheme()
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleConfirm() {
    if (!password) { setError('Please enter your password'); return }
    if (loading) return
    setLoading(true); setError('')
    // onConfirm resolves true on success. On failure it may resolve false
    // (the reason — wrong password, 2FA cancelled, a save error — is shown
    // by the caller's notification), a reason string, or { error }. Never
    // assume a failure was the password.
    let res
    try { res = await onConfirm(password) }
    catch (e) { res = { error: e?.message } }
    if (res !== true) {
      const reason = typeof res === 'string' ? res : res?.error
      setError(reason ? `Property not deleted: ${reason}` : 'Property not deleted. Check the message shown and try again.')
    }
    setLoading(false)
  }

  return (
    <Modal onClose={onClose} size="sm" title="Delete property?"
      description={<>You are about to delete <strong style={{color:T.text}}>{propName}</strong>. It moves to Trash with its rent history, refurb data and notes, and can be restored from Trash for 30 days. After that it is permanently removed.</>}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={loading} onClick={handleConfirm}>
          {loading?'Verifying…':'Move to Trash'}
        </Button>
      </>}>
      <label htmlFor="delete-confirm-password">Enter your password to confirm</label>
      <input id="delete-confirm-password" type="password" value={password} onChange={e=>setPassword(e.target.value)}
        onKeyDown={e=>e.key==='Enter'&&handleConfirm()}
        placeholder="••••••••" autoFocus/>
      {error&&<div role="alert" style={{fontFamily:SANS,fontSize:FS.sm,color:T.red,background:T.red+'11',border:`1px solid ${T.red}44`,borderRadius:R.sm,padding:'10px 14px',marginTop:12}}>{error}</div>}
    </Modal>
  )
}
