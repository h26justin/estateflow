import { useState, useEffect } from 'react'
import { useTheme } from '../../lib/ThemeContext'
import { safeOverlayClose } from '../../lib/modalUtils'
import * as api from '../../lib/api'

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
  const { T } = useTheme()
  const mono = "'DM Mono',monospace"
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
    <div className="overlay" onClick={safeOverlayClose(isDirty, onClose)}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div style={{ padding: '24px 28px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12, textAlign: 'center' }}>🗑️</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', marginBottom: 6, color: T.text }}>
            Delete {company.name}?
          </h2>
          <p style={{ fontFamily: mono, fontSize: 12, color: T.muted, textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
            This will hide the company and everything inside it. You can restore it from the Trash within 30 days.
          </p>
        </div>
        <div style={{ padding: '0 28px 20px' }}>
          {/* What gets deleted */}
          <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Will be removed
            </div>
            {preview === null ? (
              <div style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>Loading…</div>
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
            <label style={{ fontFamily: mono, fontSize: 10, color: T.muted, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Type <strong style={{ color: T.text }}>{expectedConfirm}</strong> to confirm
            </label>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} autoFocus
              placeholder={expectedConfirm}
              style={{ width: '100%', fontFamily: mono, fontSize: 13, background: T.bg, border: `1.5px solid ${isConfirmed ? T.green : T.border}`, color: T.text, borderRadius: 8, padding: '10px 14px', outline: 'none', boxSizing: 'border-box' }}/>
          </div>

          {error && <div style={{ fontFamily: mono, fontSize: 11, color: T.red, marginBottom: 14 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ flex: 1, fontFamily: mono, fontSize: 12, padding: '11px', borderRadius: 10, border: `1px solid ${T.border}`, background: 'transparent', color: T.muted, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleDelete} disabled={!isConfirmed || busy}
              style={{ flex: 2, fontFamily: mono, fontSize: 12, fontWeight: 700, padding: '11px', borderRadius: 10, border: 'none',
                background: (!isConfirmed || busy) ? T.border : T.red,
                color: 'white',
                cursor: (!isConfirmed || busy) ? 'not-allowed' : 'pointer',
                opacity: (!isConfirmed || busy) ? 0.6 : 1 }}>
              {busy ? 'Deleting…' : 'Delete company'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
