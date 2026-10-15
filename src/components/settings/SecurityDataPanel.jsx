import { useState, useEffect } from 'react'
import { MONO, FS } from '../../lib/styles'
import * as api from '../../lib/api'
import { SkeletonRows } from '../../lib/Skeleton'

// ── SECURITY & DATA PANEL ─────────────────────────────────────────────────────
export function SecurityDataPanel({ user, T, showToast }) {
  const mono = MONO
  const [exporting, setExporting] = useState(false)
  const [deletedProps, setDeletedProps] = useState([])
  const [loadingTrash, setLoadingTrash] = useState(true)
  const [restoring, setRestoring] = useState(null)

  useEffect(() => {
    api.fetchDeletedProperties(user?.id).then(d => { setDeletedProps(d); setLoadingTrash(false) }).catch(() => setLoadingTrash(false))
  }, [])

  async function handleExport() {
    setExporting(true)
    try {
      const data = await api.exportUserData(user?.id)
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ownproperly-data-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('Data exported successfully')
    } catch(e) { showToast('Export failed: ' + e.message, 'error') }
    setExporting(false)
  }

  async function handleRestore(prop) {
    setRestoring(prop.id)
    try {
      await api.restoreProperty(prop.id, user?.id)
      setDeletedProps(prev => prev.filter(p => p.id !== prop.id))
      showToast(`${prop.name} restored`)
    } catch(e) { showToast(e.message, 'error') }
    setRestoring(null)
  }

  const sectionCard = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 24px', marginBottom: 16 }

  return (
    <div>
      {/* GDPR Data Export */}
      <div style={sectionCard}>
        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Your data</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.8, marginBottom: 16 }}>
          Under GDPR you have the right to data portability and to request deletion of your account. Download your complete data at any time from the Backups tab, or request account deletion here.
        </div>
        <div style={{ background: T.bg, borderRadius: 10, padding: '14px 18px', marginBottom: 16, fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.8 }}>
          <div style={{ color: T.green, marginBottom: 6 }}>✓ <strong>Weekly automatic backups</strong> — saved and restorable from the Backups tab</div>
          <div style={{ color: T.green, marginBottom: 6 }}>✓ <strong>30-day Trash</strong> — deleted items can be restored from the Trash tab</div>
          <div style={{ color: T.green, marginBottom: 6 }}>✓ <strong>Full audit log</strong> — every change is logged to the audit trail</div>
          <div style={{ color: T.green }}>✓ <strong>Row-level security</strong> — your data is isolated from other users at the database level</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => window.open('mailto:hello@ownproperly.com?subject=Data deletion request', '_blank')}
            style={{ fontFamily: mono, fontSize: 12, padding: '10px 22px', borderRadius: 8, border: `1px solid ${T.red}44`, background: 'transparent', color: T.red, cursor: 'pointer' }}>
            Request account deletion
          </button>
        </div>
        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, marginTop: 12, lineHeight: 1.7 }}>
          For account deletion requests, we'll respond within 30 days. Note: financial records may be retained for 7 years to comply with HMRC requirements.
        </div>
      </div>

      {/* Deleted properties trash */}
      <div style={sectionCard}>
        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Recently deleted properties</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.text, lineHeight: 1.8, marginBottom: 16 }}>
          Deleted properties are kept here for 30 days before permanent removal. You can restore any property within that window.
        </div>
        {loadingTrash ? (
          <SkeletonRows rows={2} height={28}/>
        ) : deletedProps.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, padding: '16px 0' }}>No deleted properties — your trash is empty.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {deletedProps.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{p.name}</div>
                  <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, marginTop: 2 }}>
                    Deleted {new Date(p.deleted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {p.company && ` · ${p.company.name}`}
                  </div>
                </div>
                <button onClick={() => handleRestore(p)} disabled={restoring === p.id}
                  style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', background: T.green + '22', color: T.green, cursor: 'pointer' }}>
                  {restoring === p.id ? '…' : '↩ Restore'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Privacy policy link */}
      <div style={sectionCard}>
        <div style={{ fontFamily: mono, fontSize: FS.xs, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Legal</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={() => window.dispatchEvent(new CustomEvent('ownproperly:show-privacy'))}
            style={{ fontFamily: mono, fontSize: 12, color: T.goldText, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Privacy Policy →
          </button>
          <a href="mailto:hello@ownproperly.com" style={{ fontFamily: mono, fontSize: 12, color: T.muted, textDecoration: 'none' }}>
            hello@ownproperly.com
          </a>
        </div>
      </div>
    </div>
  )
}
