import { useState, useEffect } from 'react'
import { MONO, FS, SANS } from '../../lib/styles'
import { useTheme } from '../../lib/ThemeContext'
import { useConfirm } from '../../lib/ConfirmContext'
import * as api from '../../lib/api'
import { Icon } from '../../lib/icons'
import { Skeleton } from '../../lib/Skeleton'
import { Button, Modal } from '../ui'

function PreviewRow({ label, value, T, mono }) {
  const dim = !value
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 12 }}>
      <span style={{ color: dim ? T.faint : T.muted }}>{label}</span>
      <span style={{ color: dim ? T.faint : T.text, fontWeight: dim ? 400 : 600 }}>{value}</span>
    </div>
  )
}

export default function DeleteCompanyModal({ company, userId, onClose, onDeleted }) {
  const confirmDiscard = useConfirm()
  const { T } = useTheme()
  const mono = MONO
  const [preview, setPreview] = useState(null)        // { properties, tenancies, documents, company_documents }
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Load deletion preview on open. Read-only — just counts what would be removed.
  useEffect(() => {
    let cancelled = false
    api.getCompanyDeletionPreview(company.id).then(p => {
      if (!cancelled) setPreview(p)
    }).catch(() => {
      if (!cancelled) setPreview({ properties: 0, tenancies: 0, documents: 0, company_documents: 0 })
    })
    return () => { cancelled = true }
  }, [company.id])

  // Type-the-name confirmation: must match the company name exactly (trimmed)
  const expectedConfirm = company.name.trim()
  const isConfirmed = confirmText.trim() === expectedConfirm
  // The form is "dirty" once user has started typing — protects against accidental click-outside
  const isDirty = confirmText.length > 0

  async function handleDelete() {
    if (!isConfirmed || busy) return
    setBusy(true); setError('')
    try {
      await api.softDeleteCompanyCascade(company.id, userId)
      onDeleted()
    } catch (e) {
      setError(e.message || 'Could not delete company.')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} size="md" labelledBy="delete-company-modal-title" isDirty={isDirty} confirmFn={confirmDiscard}>
        <div style={{ padding: '24px 28px 0' }}>
          <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: T.red }}><Icon name="trash" size={32}/></div>
          <h2 id="delete-company-modal-title" style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', marginBottom: 6, color: T.text }}>
            Delete {company.name}?
          </h2>
          <p style={{ fontFamily: SANS, fontSize: FS.base, color: T.muted, textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
            This will hide the company and everything inside it. You can restore it from the Trash within 30 days.
          </p>
        </div>
        <div style={{ padding: '0 28px 20px' }}>
          {/* What gets deleted */}
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Will be removed
            </div>
            {preview === null ? (
              <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 6 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} h={14}/>)}</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                <PreviewRow label="Properties"          value={preview.properties}        T={T} mono={mono}/>
                <PreviewRow label="Tenancies"           value={preview.tenancies}         T={T} mono={mono}/>
                <PreviewRow label="Property documents"  value={preview.documents}         T={T} mono={mono}/>
                <PreviewRow label="Company documents"   value={preview.company_documents} T={T} mono={mono}/>
              </div>
            )}
          </div>

          {/* Type-the-name confirmation */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: SANS, fontSize: FS.sm, color: T.muted, display: 'block', marginBottom: 6, }}>
              Type <strong style={{ color: T.text }}>{expectedConfirm}</strong> to confirm
            </label>
            <input aria-label="Type to confirm" value={confirmText} onChange={e => setConfirmText(e.target.value)} autoFocus
              placeholder={expectedConfirm}
              style={{ width: '100%', fontFamily: SANS, fontSize: FS.base, background: T.bg, border: `1.5px solid ${isConfirmed ? T.green : T.border}`, color: T.text, borderRadius: 8, padding: '10px 14px', boxSizing: 'border-box' }}/>
          </div>

          {error && <div style={{ fontFamily: SANS, fontSize: FS.sm, color: T.red, marginBottom: 14 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" style={{ flex: 1 }} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" style={{ flex: 2 }} onClick={handleDelete} disabled={!isConfirmed || busy}>
              {busy ? 'Deleting…' : 'Delete company'}
            </Button>
          </div>
        </div>
      </Modal>
  )
}
