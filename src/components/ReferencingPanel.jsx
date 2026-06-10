import { useEffect, useState } from 'react'
import { useTheme } from '../lib/ThemeContext'
import { useConfirm } from '../lib/ConfirmContext'
import { MONO } from '../lib/styles'
import { showAppToast } from '../lib/toast'
import * as api from '../lib/api'

// ── REFERENCING PANEL (Feature 7 scaffold) ───────────────────────────
// Order a tenant reference or Right-to-Rent check from the lettings /
// applicant flow. Partner-agnostic: the provider order is INERT until
// REFERENCING_PROVIDER_API_KEY is configured on the referencing-request
// edge function. While inert, an order is saved as a 'draft' and the
// panel surfaces "configure provider to enable" + the per-check pricing
// model. Gated behind feature flag "referencing".

const CHECK_TYPES = [
  { key: 'reference',     label: 'Tenant reference', blurb: 'Affordability, employment, landlord history & credit.' },
  { key: 'right_to_rent', label: 'Right-to-Rent',     blurb: 'Statutory immigration status check (England).' },
]

const STATUS_LABEL = {
  draft:       { label: 'Draft',       tone: 'muted' },
  ordered:     { label: 'Ordered',     tone: 'gold' },
  in_progress: { label: 'In progress', tone: 'gold' },
  completed:   { label: 'Completed',   tone: 'good' },
  failed:      { label: 'Failed',      tone: 'bad' },
  cancelled:   { label: 'Cancelled',   tone: 'muted' },
}

export default function ReferencingPanel({ propertyId, canEdit = true }) {
  const { T } = useTheme()
  const confirmDialog = useConfirm()
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const blank = { applicant_name: '', applicant_email: '', check_type: 'reference' }
  const [form, setForm] = useState(blank)

  useEffect(() => { load() /* eslint-disable-next-line */ }, [propertyId])
  async function load() {
    setLoading(true)
    try { setItems(await api.fetchReferencingChecks(propertyId)) }
    catch (e) { showAppToast(e.message || 'Failed to load checks', 'error') }
    setLoading(false)
  }

  function startAdd() { setForm(blank); setAdding(true) }
  function cancel() { setAdding(false); setForm(blank) }

  async function save() {
    if (!form.applicant_name.trim()) { showAppToast('Applicant name is required', 'error'); return }
    setSaving(true)
    try {
      const res = await api.orderReferencingCheck(propertyId, {
        applicant_name: form.applicant_name.trim(),
        applicant_email: form.applicant_email.trim() || undefined,
        check_type: form.check_type,
      })
      if (res?.inert) {
        showAppToast('Saved as draft — configure a referencing provider to order live', 'info')
      } else {
        showAppToast('Check ordered', 'success')
      }
      cancel()
      await load()
    } catch (e) {
      showAppToast(e.message || 'Failed to order check', 'error')
    }
    setSaving(false)
  }

  async function remove(it) {
    const ok = await confirmDialog({
      title: 'Delete check?',
      message: `Remove the ${it.check_type === 'right_to_rent' ? 'Right-to-Rent' : 'reference'} check for ${it.applicant_name}?`,
      confirmText: 'Delete', tone: 'danger',
    })
    if (!ok) return
    try { await api.deleteReferencingCheck(it.id); await load() }
    catch (e) { showAppToast(e.message || 'Failed to delete', 'error') }
  }

  const toneColor = (tone) => tone === 'good' ? '#3fb950' : tone === 'bad' ? '#f85149' : tone === 'gold' ? T.gold : T.muted

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>
          Referencing &amp; Right-to-Rent
          <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginLeft: 8 }}>
            ({items.length})
          </span>
        </h3>
        {canEdit && !adding && (
          <button onClick={startAdd} className="btn btn-ghost" style={{ fontSize: 11 }}>
            + New check
          </button>
        )}
      </div>

      {/* Inert / pricing notice */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontFamily: MONO, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
        <strong style={{ color: T.text }}>Provider not yet configured.</strong> Checks are saved as drafts.
        Connect a referencing partner (set <code>REFERENCING_PROVIDER_API_KEY</code>) to order live.
        Pricing is <strong style={{ color: T.text }}>per check</strong> — billed by the chosen provider at order time;
        Right-to-Rent and full references are priced separately.
      </div>

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: 12 }}>Loading…</div>
      ) : (
        <>
          {adding && (
            <div style={{ background: T.card, border: `1px solid ${T.gold}66`, borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                New check
              </div>
              <div style={{ marginBottom: 10 }}>
                <label>Check type</label>
                <select value={form.check_type} onChange={e => setForm(f => ({ ...f, check_type: e.target.value }))}>
                  {CHECK_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 4 }}>
                  {CHECK_TYPES.find(t => t.key === form.check_type)?.blurb}
                </div>
              </div>
              <div className="g2">
                <div>
                  <label>Applicant name</label>
                  <input value={form.applicant_name} onChange={e => setForm(f => ({ ...f, applicant_name: e.target.value }))} placeholder="e.g. Jane Smith"/>
                </div>
                <div>
                  <label>Applicant email <span style={{ color: T.muted, fontWeight: 400 }}>(optional)</span></label>
                  <input type="email" value={form.applicant_email} onChange={e => setForm(f => ({ ...f, applicant_email: e.target.value }))} placeholder="jane@example.com"/>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button onClick={cancel} className="btn btn-ghost" style={{ fontSize: 11 }} disabled={saving}>Cancel</button>
                <button onClick={save} className="btn btn-gold" style={{ fontSize: 11 }} disabled={saving}>
                  {saving ? 'Saving…' : 'Order check'}
                </button>
              </div>
            </div>
          )}

          {items.length === 0 && !adding ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: T.muted, padding: 12 }}>
              No checks yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map(it => {
                const st = STATUS_LABEL[it.status] || STATUS_LABEL.draft
                return (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{it.applicant_name}</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: T.muted, marginTop: 2 }}>
                        {it.check_type === 'right_to_rent' ? 'Right-to-Rent' : 'Tenant reference'}
                        {it.applicant_email ? ` · ${it.applicant_email}` : ''}
                        {it.created_at ? ` · ${new Date(it.created_at).toLocaleDateString('en-GB')}` : ''}
                      </div>
                      {it.result?.summary && (
                        <div style={{ fontFamily: MONO, fontSize: 10, color: T.text, marginTop: 4 }}>{it.result.summary}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: toneColor(st.tone), border: `1px solid ${toneColor(st.tone)}55`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                        {st.label}
                      </span>
                      {canEdit && (it.status === 'draft' || it.status === 'cancelled' || it.status === 'failed') && (
                        <button onClick={() => remove(it)} title="Delete"
                          style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
