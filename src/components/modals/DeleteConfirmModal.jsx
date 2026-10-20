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
    setLoading(true); setError('')
    const ok = await onConfirm(password)
    if (!ok) setError('Incorrect password. Property not deleted.')
    setLoading(false)
  }

  return (
    <Modal onClose={onClose} size="sm" title="Delete property?"
      description={<>You are about to permanently delete <strong style={{color:T.text}}>{propName}</strong>, with all its rent history, refurb data and notes. This cannot be undone.</>}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={loading} onClick={handleConfirm}>
          {loading?'Verifying…':'Delete permanently'}
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
